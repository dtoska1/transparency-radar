export const MUNICIPALITIES = ['tirana', 'shkoder', 'durres', 'vlore', 'pogradec'] as const;
export const VERTICALS = ['vendime', 'konsultime', 'prokurime'] as const;

export type MunicipalitySlug = (typeof MUNICIPALITIES)[number];
export type Vertical = (typeof VERTICALS)[number];

export interface PendingRow {
  id: string;
  title: string;
  published_date: string;
  municipality: MunicipalitySlug;
  vertical: Vertical;
  source_id: string;
  source_origin: string;
  source_page_url: string;
  source_url: string;
  is_unofficial_proxy: boolean;
  sha256: string | null;
  tsr_timestamp_at: string | null;
  stamped: boolean;
  review_status: 'pending';
  collected_at: string;
  created_at: string;
}

export interface PendingEnvelope {
  data: PendingRow[];
  limit: number;
  offset: number;
}

export interface QueueFilters {
  municipality?: MunicipalitySlug;
  vertical?: Vertical;
  offset: number;
}

export const QUEUE_PAGE_SIZE = 20;
const QUEUE_LOOKAHEAD_LIMIT = QUEUE_PAGE_SIZE + 1;

const MUNICIPALITY_LABELS: Record<MunicipalitySlug, string> = {
  tirana: 'Tiranë',
  shkoder: 'Shkodër',
  durres: 'Durrës',
  vlore: 'Vlorë',
  pogradec: 'Pogradec',
};

const VERTICAL_LABELS: Record<Vertical, string> = {
  vendime: 'Vendime',
  konsultime: 'Konsultime',
  prokurime: 'Prokurime',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isMunicipality(value: unknown): value is MunicipalitySlug {
  return typeof value === 'string' && MUNICIPALITIES.includes(value as MunicipalitySlug);
}

function isVertical(value: unknown): value is Vertical {
  return typeof value === 'string' && VERTICALS.includes(value as Vertical);
}

function parsePendingRow(value: unknown): PendingRow {
  if (!isRecord(value)) throw new Error('Invalid pending row');

  const valid =
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.published_date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.published_date) &&
    isMunicipality(value.municipality) &&
    isVertical(value.vertical) &&
    typeof value.source_id === 'string' &&
    typeof value.source_origin === 'string' &&
    typeof value.source_page_url === 'string' &&
    typeof value.source_url === 'string' &&
    typeof value.is_unofficial_proxy === 'boolean' &&
    isStringOrNull(value.sha256) &&
    isStringOrNull(value.tsr_timestamp_at) &&
    typeof value.stamped === 'boolean' &&
    value.review_status === 'pending' &&
    typeof value.collected_at === 'string' &&
    typeof value.created_at === 'string';

  if (!valid || (value.stamped && value.sha256 === null)) {
    throw new Error('Invalid pending row');
  }

  return value as unknown as PendingRow;
}

export function parsePendingEnvelope(value: unknown): PendingEnvelope {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    typeof value.limit !== 'number' ||
    !Number.isInteger(value.limit) ||
    typeof value.offset !== 'number' ||
    !Number.isInteger(value.offset)
  ) {
    throw new Error('Invalid pending response');
  }

  return {
    data: value.data.map(parsePendingRow),
    limit: value.limit,
    offset: value.offset,
  };
}

export function parseQueueFilters(searchParams: URLSearchParams): QueueFilters {
  const verticalValue = searchParams.get('vertical');
  const municipalityValue = searchParams.get('municipality');
  const offsetValue = Number(searchParams.get('offset') ?? '0');

  return {
    ...(isVertical(verticalValue) ? { vertical: verticalValue } : {}),
    ...(isMunicipality(municipalityValue) ? { municipality: municipalityValue } : {}),
    offset: Number.isInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0,
  };
}

export function buildPendingApiPath(filters: QueueFilters): string {
  const params = new URLSearchParams();
  if (filters.vertical) params.set('vertical', filters.vertical);
  if (filters.municipality) params.set('municipality', filters.municipality);
  params.set('limit', String(QUEUE_LOOKAHEAD_LIMIT));
  params.set('offset', String(filters.offset));
  return `/api/admin/pending?${params.toString()}`;
}

export function paginatePendingRows(rows: PendingRow[]): {
  rows: PendingRow[];
  hasNext: boolean;
} {
  const counts = new Map<Vertical, number>();
  let hasNext = false;
  const visibleRows: PendingRow[] = [];

  for (const row of rows) {
    const count = counts.get(row.vertical) ?? 0;
    counts.set(row.vertical, count + 1);
    if (count >= QUEUE_PAGE_SIZE) {
      hasNext = true;
      continue;
    }
    visibleRows.push(row);
  }

  return { rows: visibleRows, hasNext };
}

export function buildQueuePageUrl(filters: QueueFilters, offset: number): string {
  const params = new URLSearchParams();
  if (filters.vertical) params.set('vertical', filters.vertical);
  if (filters.municipality) params.set('municipality', filters.municipality);
  if (offset > 0) params.set('offset', String(offset));
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export function municipalityLabel(slug: MunicipalitySlug): string {
  return MUNICIPALITY_LABELS[slug];
}

export function verticalLabel(slug: Vertical): string {
  return VERTICAL_LABELS[slug];
}

export function formatPublishedDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Tirane',
  }).format(date);
}

export function shortId(value: string): string {
  return value.slice(0, 8);
}

export function shortHash(value: string): string {
  return `${value.slice(0, 10)}…`;
}

export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
