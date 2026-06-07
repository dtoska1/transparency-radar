import { hashBytes } from './hash.js';

export const APP_COLUMNS = [
  'Autoriteti_kontraktues',
  'Numri_i_references',
  'Objekti_i_prokurimit',
  'Lloji_i_procedures',
  'Tipi_i_kontrates',
  'Lloji_i_marreveshjes_kuader',
  'Fondi_limit',
  'Data_e_publikimit',
  'Data_e_hapjes',
  'Data_e_mbylljes',
  'Anulluar',
  'Arsyeja_e_anullimit',
  'Pezulluar',
  'Fituesi',
  'NIPT_i_fituesit',
  'Vlera_e_fituesit',
  'Vlera_e_fituesit_ne_lidhjen_e_kontrates',
  'Lidhja_e_kontrates_me_TVSH',
  'Numri_i_ofertave_te_dorezuara',
  'Numri_i_ofertave_te_kualifikuara',
  'Kodet_CPV',
] as const;

export type AppColumn = (typeof APP_COLUMNS)[number];
export type AppCsvRow = Record<AppColumn, string>;

const AMOUNT_COLUMNS = new Set<AppColumn>([
  'Fondi_limit',
  'Vlera_e_fituesit',
  'Vlera_e_fituesit_ne_lidhjen_e_kontrates',
]);

const DATE_COLUMNS = new Set<AppColumn>(['Data_e_publikimit', 'Data_e_hapjes', 'Data_e_mbylljes']);

const INTEGER_COLUMNS = new Set<AppColumn>([
  'Numri_i_ofertave_te_dorezuara',
  'Numri_i_ofertave_te_kualifikuara',
]);

function normalizeScalar(value: string): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeInteger(value: string): string {
  const normalized = normalizeScalar(value).replace(/\s/g, '');
  if (!normalized) return '';
  if (!/^-?\d+$/.test(normalized)) return normalizeScalar(value);

  const sign = normalized.startsWith('-') ? '-' : '';
  const digits = sign ? normalized.slice(1) : normalized;
  const integer = digits.replace(/^0+(?=\d)/, '');
  return integer === '0' ? '0' : `${sign}${integer}`;
}

function canonicalizeAmount(value: string): string {
  const original = normalizeScalar(value);
  let normalized = original.replace(/\s/g, '');
  if (!normalized) return '';

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  if (hasComma && hasDot) {
    normalized = normalized.replace(/,/g, '');
  } else if (hasComma && /^-?\d{1,3}(,\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/,/g, '');
  } else if (hasComma && /^-?\d+,\d+$/.test(normalized)) {
    normalized = normalized.replace(',', '.');
  }

  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return original;

  const [, sign, integerRaw, fractionRaw = ''] = match;
  const integer = integerRaw.replace(/^0+(?=\d)/, '');
  const fraction = fractionRaw.replace(/0+$/, '');
  const isZero = integer === '0' && !fraction;
  const prefix = sign && !isZero ? sign : '';
  return `${prefix}${integer}${fraction ? `.${fraction}` : ''}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

function parseAppDate(raw: string): string | null {
  const normalized = normalizeScalar(raw);
  if (!normalized) return null;

  const match = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw] = match;
  const day = Number.parseInt(dayRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const year = Number.parseInt(yearRaw, 10);

  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function canonicalizeColumn(column: AppColumn, value: string): string {
  if (AMOUNT_COLUMNS.has(column)) return canonicalizeAmount(value);
  if (INTEGER_COLUMNS.has(column)) return canonicalizeInteger(value);
  if (DATE_COLUMNS.has(column)) return parseAppDate(value) ?? normalizeScalar(value);
  return normalizeScalar(value);
}

export function canonicalAppRowHash(row: AppCsvRow): { bytes: Buffer; sha256: string } {
  const fields = APP_COLUMNS.map((column) => [column, canonicalizeColumn(column, row[column])]);
  const bytes = Buffer.from(
    `${JSON.stringify({
      schema: 'app.gov.al.prokurime.export-row.v1',
      fields,
    })}\n`,
    'utf8',
  );

  return { bytes, sha256: hashBytes(bytes) };
}
