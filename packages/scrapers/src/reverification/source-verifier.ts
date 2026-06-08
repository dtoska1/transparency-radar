import { APP_COLUMNS, type AppCsvRow, canonicalAppRowHash, hashBytes } from '@tra/shared';
import { parse } from 'csv-parse/sync';
import { fetch } from 'undici';
import type { DocumentSourceSlot, SourceResult, SourceVerificationSummary } from './types.js';

const APP_EXPORT_URL = (year: number) =>
  `https://app.gov.al/GetData/ExportDocument?year=${year.toString()}`;

const HTTP_HEADERS = {
  'User-Agent':
    'TransparencyRadarBot/1.0 (+https://github.com/dtoska1/transparency-radar; CSDG; dtoska@csdgalbania.org)',
  'Accept-Language': 'sq-AL,sq;q=0.9,en;q=0.8',
};

interface FetchResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ReverificationFetch = (
  url: string,
  init: {
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<FetchResponse>;

export interface SourceVerifier {
  verify(
    slots: DocumentSourceSlot[],
    expectedSha256: string,
    runId: string,
  ): Promise<SourceVerificationSummary>;
}

interface SourceVerifierOptions {
  fetchImpl?: ReverificationFetch;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
  minimumRequestIntervalMs?: number;
  retryBackoffsMs?: readonly number[];
  timeoutMs?: number;
}

interface AppExportIndex {
  rowsByReference: Map<string, AppCsvRow[]>;
}

function normalizeReference(value: string): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toAppRow(values: string[]): AppCsvRow {
  return Object.fromEntries(
    APP_COLUMNS.map((column, index) => [column, values[index] ?? '']),
  ) as AppCsvRow;
}

function parseAppExport(bytes: Buffer, year: number): AppExportIndex {
  const records = parse(bytes.toString('utf8'), {
    bom: true,
    skip_empty_lines: true,
  }) as string[][];
  const [header, ...rows] = records;

  if (
    !header ||
    header.length !== APP_COLUMNS.length ||
    !APP_COLUMNS.every((column, index) => normalizeReference(header[index] ?? '') === column)
  ) {
    throw new Error(`APP CSV ${year.toString()} header mismatch`);
  }

  const rowsByReference = new Map<string, AppCsvRow[]>();
  for (const [index, values] of rows.entries()) {
    if (values.length !== APP_COLUMNS.length) {
      throw new Error(
        `APP CSV ${year.toString()} row ${(index + 2).toString()} has ${values.length.toString()} columns`,
      );
    }
    const row = toAppRow(values);
    const reference = normalizeReference(row.Numri_i_references);
    if (!reference) continue;
    const matches = rowsByReference.get(reference) ?? [];
    matches.push(row);
    rowsByReference.set(reference, matches);
  }

  return { rowsByReference };
}

function summarize(results: SourceResult[]): SourceVerificationSummary {
  const changedResults = results.filter((result) => result.ok === false);
  const applicableResults = results.filter(
    (result) => result.source_type === 'url' || result.source_type === 'app_export',
  );
  const unreachable = applicableResults.some((result) => result.ok === null);
  const observedHashes = [
    ...new Set(changedResults.flatMap((result) => result.observed_sha256 ?? [])),
  ];

  return {
    sourceOk:
      changedResults.length > 0
        ? false
        : unreachable || applicableResults.length === 0
          ? null
          : true,
    changed: changedResults.length > 0,
    unreachable,
    notApplicableOnly: applicableResults.length === 0,
    ...(observedHashes.length === 1 ? { observedSourceSha256: observedHashes[0] } : {}),
    results: [...results].sort((left, right) => left.slot_ref.localeCompare(right.slot_ref)),
  };
}

export class DefaultSourceVerifier implements SourceVerifier {
  private readonly fetchImpl: ReverificationFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly nowMs: () => number;
  private readonly minimumRequestIntervalMs: number;
  private readonly retryBackoffsMs: readonly number[];
  private readonly timeoutMs: number;
  private readonly appExportCache = new Map<string, Promise<AppExportIndex>>();
  private requestQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(options: SourceVerifierOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as Promise<FetchResponse>);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nowMs = options.nowMs ?? Date.now;
    this.minimumRequestIntervalMs = options.minimumRequestIntervalMs ?? 1_000;
    this.retryBackoffsMs = options.retryBackoffsMs ?? [2_000, 4_000];
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async verify(
    slots: DocumentSourceSlot[],
    expectedSha256: string,
    runId: string,
  ): Promise<SourceVerificationSummary> {
    const results: SourceResult[] = [];
    for (const slot of slots) {
      if (slot.sourceType === 'manual' || slot.sourceType === 'historical') {
        results.push({
          slot_ref: slot.slotRef,
          source_type: slot.sourceType,
          ok: null,
          reason: slot.reason,
        });
        continue;
      }

      results.push(
        slot.sourceType === 'url'
          ? await this.verifyUrl(slot.slotRef, slot.url, expectedSha256)
          : await this.verifyApp(slot, expectedSha256, runId),
      );
    }

    return summarize(results);
  }

  private async verifyUrl(
    slotRef: string,
    url: string,
    expectedSha256: string,
  ): Promise<SourceResult> {
    try {
      const bytes = await this.fetchBytes(url);
      const observedSha256 = hashBytes(bytes);
      return {
        slot_ref: slotRef,
        source_type: 'url',
        ok: observedSha256 === expectedSha256,
        observed_sha256: observedSha256,
        ...(observedSha256 === expectedSha256
          ? {}
          : { reason: 'source bytes no longer match the captured document' }),
      };
    } catch (error) {
      return {
        slot_ref: slotRef,
        source_type: 'url',
        ok: null,
        reason: error instanceof Error ? error.message : 'source fetch failed',
      };
    }
  }

  private async verifyApp(
    slot: Extract<DocumentSourceSlot, { sourceType: 'app_export' }>,
    expectedSha256: string,
    runId: string,
  ): Promise<SourceResult> {
    try {
      const index = await this.loadAppExport(runId, slot.year);
      const rows = index.rowsByReference.get(normalizeReference(slot.appId)) ?? [];
      if (rows.length === 0) {
        return {
          slot_ref: slot.slotRef,
          source_type: 'app_export',
          ok: false,
          reason: `APP reference not found in ${slot.year.toString()} export`,
        };
      }
      if (rows.length > 1) {
        return {
          slot_ref: slot.slotRef,
          source_type: 'app_export',
          ok: null,
          reason: `APP reference appears more than once in ${slot.year.toString()} export`,
        };
      }

      const { sha256: observedSha256 } = canonicalAppRowHash(rows[0]);
      return {
        slot_ref: slot.slotRef,
        source_type: 'app_export',
        ok: observedSha256 === expectedSha256,
        observed_sha256: observedSha256,
        ...(observedSha256 === expectedSha256
          ? {}
          : { reason: 'APP canonical row no longer matches the captured document' }),
      };
    } catch (error) {
      return {
        slot_ref: slot.slotRef,
        source_type: 'app_export',
        ok: null,
        reason: error instanceof Error ? error.message : 'APP export fetch failed',
      };
    }
  }

  private loadAppExport(runId: string, year: number): Promise<AppExportIndex> {
    const key = `${runId}:${year.toString()}`;
    const cached = this.appExportCache.get(key);
    if (cached) return cached;

    const promise = this.fetchBytes(APP_EXPORT_URL(year)).then((bytes) =>
      parseAppExport(bytes, year),
    );
    this.appExportCache.set(key, promise);
    if (this.appExportCache.size > 32) {
      const oldestKey = this.appExportCache.keys().next().value;
      if (oldestKey) this.appExportCache.delete(oldestKey);
    }
    return promise;
  }

  private async fetchBytes(url: string): Promise<Buffer> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.retryBackoffsMs.length; attempt++) {
      if (attempt > 0) await this.sleep(this.retryBackoffsMs[attempt - 1] ?? 0);
      await this.waitForRequestTurn();

      try {
        const response = await this.fetchImpl(url, {
          headers: HTTP_HEADERS,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          lastError = new Error(`source responded ${response.status.toString()}`);
          continue;
        }
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        lastError = new Error(error instanceof Error ? error.message : 'source fetch failed');
      }
    }
    throw lastError ?? new Error('source fetch failed');
  }

  private async waitForRequestTurn(): Promise<void> {
    const previous = this.requestQueue;
    let release: (() => void) | undefined;
    this.requestQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    const waitMs = Math.max(0, this.nextRequestAt - this.nowMs());
    if (waitMs > 0) await this.sleep(waitMs);
    this.nextRequestAt = this.nowMs() + this.minimumRequestIntervalMs;
    release?.();
  }
}
