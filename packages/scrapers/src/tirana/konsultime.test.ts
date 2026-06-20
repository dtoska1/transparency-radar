import { describe, expect, it, vi } from 'vitest';

vi.mock('@tra/db', () => ({
  db: {},
  konsultime: {},
  municipalities: {},
  scrape_runs: {},
  sources: {},
}));

import {
  parseFilenameTimestamp,
  parseTiranaKonsultimeHtml,
  parseVisibleDate,
} from './konsultime.js';

const CATEGORY_URL =
  'https://tirana.al/kategoria-e-publikimit/regjistri-i-projekt-akteve-per-konsultim';
const REGISTER_URL =
  'https://tirana.al/uploads/2026/5/20260520142956_regjistri-i-projektakteve-per-konsultim-1.doc';

describe('Tiranë konsultime date parsing', () => {
  it('parses filename timestamps and visible dates manually', () => {
    expect(parseFilenameTimestamp(REGISTER_URL)).toBe('2026-05-20');
    expect(parseVisibleDate('Publikuar më 20.05.2026')).toBe('2026-05-20');
    expect(parseVisibleDate('Publikuar më 20/05/2026')).toBe('2026-05-20');
    expect(parseVisibleDate('Publikuar më 2026-05-20')).toBe('2026-05-20');
  });
});

describe('parseTiranaKonsultimeHtml', () => {
  it('keeps only the official register document metadata candidate', () => {
    const html = `
      <main>
        <article>
          <p>Publikuar më 19.05.2026</p>
          <a href="/uploads/2026/5/20260520142956_regjistri-i-projektakteve-per-konsultim-1.doc">
            Regjistri i projektakteve per Konsultim Publik
          </a>
          <a href="https://tirana.al/uploads/2026/5/20260520142956_regjistri-i-projektakteve-per-konsultim-1.doc">
            Regjistri i projektakteve per Konsultim Publik
          </a>
        </article>
        <footer>
          <a href="/uploads/2026/5/logo-footer.png">Logo</a>
          <a href="/uploads/2026/5/broshure-e-pergjithshme.pdf">Broshure</a>
          <a href="/faqe/konsultimet-publike">Hub</a>
          <a href="${CATEGORY_URL}">Category page</a>
        </footer>
        <section>
          <a href="/uploads/2022/12/20221230101010_regjistri-i-projektakteve-per-konsultim-arkiv.doc">
            Regjistri i vjeter
          </a>
          <a href="/uploads/2026/5/regjistri-i-projektakteve-per-konsultim-pa-date.doc">
            Regjistri pa date
          </a>
        </section>
      </main>
    `;

    const items = parseTiranaKonsultimeHtml(html);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Regjistri i projektakteve per Konsultim Publik',
      sourceUrl: REGISTER_URL,
      sourceOrigin: 'tirana.al',
      sourcePageUrl: CATEGORY_URL,
      publishedDate: '2026-05-19',
      kind: 'draft_act',
      isUnofficialProxy: false,
    });
    expect(items.every((item) => !item.sourceUrl.includes('logo-footer'))).toBe(true);
    expect(items.every((item) => !item.sourceUrl.includes('broshure-e-pergjithshme'))).toBe(true);
    expect(items.every((item) => !item.sourceUrl.includes('konsultimet-publike'))).toBe(true);
    expect(items.every((item) => !('review_status' in item))).toBe(true);
    expect(items.every((item) => !('document' in item))).toBe(true);
    expect(items.every((item) => !('documents' in item))).toBe(true);
    expect(items.every((item) => !('attachments' in item))).toBe(true);
    expect(items.every((item) => !('files' in item))).toBe(true);
  });

  it('falls back to the filename timestamp and fallback title when link text is weak', () => {
    const html = `
      <a href="${REGISTER_URL}">Shkarko</a>
    `;

    expect(parseTiranaKonsultimeHtml(html)).toEqual([
      {
        title: 'Regjistri i projektakteve për konsultim publik',
        sourceUrl: REGISTER_URL,
        sourceOrigin: 'tirana.al',
        sourcePageUrl: CATEGORY_URL,
        publishedDate: '2026-05-20',
        kind: 'draft_act',
        isUnofficialProxy: false,
      },
    ]);
  });

  it('skips pre-2023 and no-date register-like URLs', () => {
    const html = `
      <a href="/uploads/2022/12/20221230101010_regjistri-i-projektakteve-per-konsultim-arkiv.doc">
        Regjistri i vjeter
      </a>
      <a href="/uploads/2026/5/regjistri-i-projektakteve-per-konsultim-pa-date.doc">
        Regjistri pa date
      </a>
    `;

    expect(parseTiranaKonsultimeHtml(html)).toEqual([]);
  });
});
