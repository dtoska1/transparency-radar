import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { TimeStampReq, id_sha512 } from 'pkijs';
import { describe, expect, it, vi } from 'vitest';
import {
  APP_COLUMNS,
  type AppCsvRow,
  canonicalAppRowHash,
  hashBytes,
  requestTimestamp,
  validateTimestampToken,
} from './index.js';

const fixtureUrl = (name: string) => new URL(`./__fixtures__/${name}`, import.meta.url);

interface FixtureProvenance {
  legacy: {
    expected_digest: string;
    gen_time: string;
  };
  current: {
    expected_digest: string;
    gen_time: string;
  };
  untrusted: {
    expected_digest: string;
  };
}

async function readProvenance(): Promise<FixtureProvenance> {
  return JSON.parse(await readFile(fixtureUrl('provenance.json'), 'utf8')) as FixtureProvenance;
}

async function readToken(name: string): Promise<string> {
  return (await readFile(fixtureUrl(name))).toString('base64');
}

describe('APP canonical hashing', () => {
  it('is byte-identical to the existing locked APP canonical artifact', async () => {
    const expectedBytes = await readFile(fixtureUrl('app-canonical-reference.artifact'));
    const artifact = JSON.parse(expectedBytes.toString('utf8')) as {
      fields: [string, string][];
    };
    const row = {
      ...(Object.fromEntries(artifact.fields) as AppCsvRow),
      Autoriteti_kontraktues: '  Ndermarrja\r\nRruga   Durres ',
      Fondi_limit: '345,000.00',
      Data_e_publikimit: '28.03.2023',
      Data_e_hapjes: '30.03.2023',
      Data_e_mbylljes: '31.03.2023',
      Vlera_e_fituesit: '300,000.00',
      Numri_i_ofertave_te_dorezuara: '007',
      Numri_i_ofertave_te_kualifikuara: '04',
    };

    expect(APP_COLUMNS).toHaveLength(21);
    expect(canonicalAppRowHash(row)).toEqual({
      bytes: expectedBytes,
      sha256: '987119f6a3bf62a15615d06d8e2cd8f86b742eca74ba648becb88be62c60021c',
    });
  });

  it('canonicalizes equivalent amount formatting without decimal drift', () => {
    const base = Object.fromEntries(APP_COLUMNS.map((column) => [column, ''])) as AppCsvRow;
    const variants = ['59,000.00', '59000.00', '59000', '59 000.000'];
    const artifacts = variants.map((amount) =>
      canonicalAppRowHash({ ...base, Fondi_limit: amount }),
    );

    expect(artifacts.map(({ sha256 }) => sha256)).toEqual(
      Array.from({ length: variants.length }, () => artifacts[0].sha256),
    );
    expect(artifacts[0].bytes.toString('utf8')).toContain('["Fondi_limit","59000"]');
  });
});

describe('tamper primitives', () => {
  it('hashes exact bytes with SHA-256', () => {
    expect(hashBytes(Buffer.from('TRA', 'utf8'))).toBe(
      'd2ec5d83fb85186c29b03d27a9a8021be3dd55b30c16a9d0dd61ddfbee8299be',
    );
  });

  it('sends the exact existing 59-byte SHA-256 timestamp query', async () => {
    const digest = '987119f6a3bf62a15615d06d8e2cd8f86b742eca74ba648becb88be62c60021c';
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(Buffer.from(init?.body as Uint8Array).toString('hex')).toBe(
        `30390201013031300d060960864801650304020105000420${digest}0101ff`,
      );
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });

    await expect(requestTimestamp(digest, fetchMock)).resolves.toBe('AQID');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://freetsa.org/tsr',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/timestamp-query',
          Accept: 'application/timestamp-reply',
        },
      }),
    );
  });
});

describe('RFC-3161 timestamp validation', () => {
  it('validates a genuine pre-rollover FreeTSA token at its 2024 genTime', async () => {
    const provenance = await readProvenance();
    const source = await readFile(fixtureUrl('freetsa-legacy-source.png'));
    const requestBytes = await readFile(fixtureUrl('freetsa-legacy-2024.tsq'));
    const request = TimeStampReq.fromBER(
      requestBytes.buffer.slice(
        requestBytes.byteOffset,
        requestBytes.byteOffset + requestBytes.byteLength,
      ) as ArrayBuffer,
    );

    expect(createHash('sha512').update(source).digest('hex')).toBe(
      provenance.legacy.expected_digest,
    );
    expect(request.messageImprint.hashAlgorithm.algorithmId).toBe(id_sha512);
    expect(Buffer.from(request.messageImprint.hashedMessage.getValue()).toString('hex')).toBe(
      provenance.legacy.expected_digest,
    );

    const result = await validateTimestampToken(
      await readToken('freetsa-legacy-2024.tsr'),
      provenance.legacy.expected_digest,
    );

    expect(result).toEqual({
      valid: true,
      tsaTime: new Date(provenance.legacy.gen_time),
    });
  }, 15_000);

  it('validates a genuine current FreeTSA token from the DEV APP document row', async () => {
    const provenance = await readProvenance();
    const result = await validateTimestampToken(
      await readToken('freetsa-current-dev-2026.tsr'),
      provenance.current.expected_digest,
    );

    expect(result).toEqual({
      valid: true,
      tsaTime: new Date(provenance.current.gen_time),
    });
  }, 15_000);

  it('rejects a valid token when the expected digest is wrong', async () => {
    const result = await validateTimestampToken(
      await readToken('freetsa-current-dev-2026.tsr'),
      '0'.repeat(64),
    );

    expect(result).toMatchObject({
      valid: false,
      reason: 'timestamp message imprint does not match the expected digest',
    });
  });

  it('rejects a malformed timestamp reply', async () => {
    await expect(
      validateTimestampToken('bm90LWFuLXJmYzMxNjEtdG9rZW4=', '0'.repeat(64)),
    ).resolves.toMatchObject({
      valid: false,
      tsaTime: null,
    });
  });

  it('rejects a cryptographically valid token from an untrusted TSA', async () => {
    const provenance = await readProvenance();
    const result = await validateTimestampToken(
      await readToken('untrusted-dfn-2017.tsr'),
      provenance.untrusted.expected_digest,
    );

    expect(result).toMatchObject({
      valid: false,
      reason: 'timestamp is not rooted in the pinned FreeTSA CA',
    });
  }, 15_000);
});
