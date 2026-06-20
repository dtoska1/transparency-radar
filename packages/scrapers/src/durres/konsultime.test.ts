import { describe, expect, it, vi } from 'vitest';

vi.mock('@tra/db', () => ({
  db: {},
  konsultime: {},
  municipalities: {},
  scrape_runs: {},
  sources: {},
}));

import {
  parseDurresKonsultimeDetailHtml,
  parseDurresKonsultimeListingHtml,
  parseIsoPublishedDate,
  parseVisibleAlbanianDate,
} from './konsultime.js';

describe('parseDurresKonsultimeListingHtml', () => {
  it('collects only deduped WordPress detail-post URLs and ignores document-only links', () => {
    const html = `
      <section>
        <h2>2026</h2>
        <a href="https://durres.gov.al/2026/06/09/per-programin-buxhetor-afatmesem-2027-2029-faza-e-pare-te-bashkise-durres/">Detail</a>
        <a href="/2026/03/20/njoftim-per-degjese-publike-4/">Dëgjesë</a>
        <a href="/2026/03/20/njoftim-per-degjese-publike-4/">Duplicate</a>
        <a href="/wp-content/uploads/2026/03/njoftim.pdf">PDF</a>
        <a href="/wp-content/uploads/2026/03/relacion.docx">DOCX</a>
        <a href="/wp-content/uploads/2026/03/tabele.xlsx">XLSX</a>
        <a href="/wp-content/uploads/2026/03/arkiv.zip">ZIP</a>
        <a href="/2026/03/20/material.pdf">Looks dated but document</a>
        <h2>2021</h2>
      </section>
    `;

    expect(parseDurresKonsultimeListingHtml(html)).toEqual([
      'https://durres.gov.al/2026/06/09/per-programin-buxhetor-afatmesem-2027-2029-faza-e-pare-te-bashkise-durres/',
      'https://durres.gov.al/2026/03/20/njoftim-per-degjese-publike-4/',
    ]);
  });
});

describe('Durrës date parsing', () => {
  it('extracts ISO JSON-LD dates and visible Albanian dates without Date objects', () => {
    expect(parseIsoPublishedDate('2026-06-08T07:01:44+00:00')).toBe('2026-06-08');
    expect(parseVisibleAlbanianDate('8 Qershor, 2026 9:01 am')).toBe('2026-06-08');
    expect(parseVisibleAlbanianDate('17 Nëntor, 2025')).toBe('2025-11-17');
    expect(parseVisibleAlbanianDate('17 Nentor, 2025')).toBe('2025-11-17');
  });
});

describe('parseDurresKonsultimeDetailHtml', () => {
  it('uses h1 title, JSON-LD datePublished priority, and the final URL', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            { "headline": "JSON-LD title", "datePublished": "2026-06-08T07:01:44+00:00" }
          </script>
        </head>
        <body>
          <h1 class="entry-title">Për Programin Buxhetor Afatmesëm 2027-2029, faza e parë, të bashkisë Durrës</h1>
          <span class="elementor-post-info__item--type-date">9 Qershor, 2026 9:01 am</span>
          <a href="/wp-content/uploads/2026/06/attachment.pdf">Attachment not metadata</a>
        </body>
      </html>
    `;

    const item = parseDurresKonsultimeDetailHtml(
      html,
      'https://durres.gov.al/2026/06/08/per-programin-buxhetor-afatmesem-2027-2029-faza-e-pare-te-bashkise-durres/',
    );

    expect(item).toEqual({
      title:
        'Për Programin Buxhetor Afatmesëm 2027-2029, faza e parë, të bashkisë Durrës',
      sourceUrl:
        'https://durres.gov.al/2026/06/08/per-programin-buxhetor-afatmesem-2027-2029-faza-e-pare-te-bashkise-durres/',
      publishedDate: '2026-06-08',
      kind: 'consultation_notice',
    });
    expect(item && 'attachments' in item).toBe(false);
    expect(item && 'documents' in item).toBe(false);
    expect(item && 'files' in item).toBe(false);
  });

  it('reads JSON-LD values from @graph and classifies dëgjesë as hearing', () => {
    const html = `
      <script type="application/ld+json">
        {
          "@graph": [
            { "@type": "WebSite", "name": "Bashkia Durrës" },
            {
              "@type": "Article",
              "headline": "Njoftim për dëgjesë publike",
              "datePublished": "2026-03-20T12:42:56+00:00"
            }
          ]
        }
      </script>
      <main><p>Njoftim per degjese publike me qytetaret.</p></main>
    `;

    expect(
      parseDurresKonsultimeDetailHtml(
        html,
        'https://durres.gov.al/2026/03/20/njoftim-per-degjese-publike-4/',
      ),
    ).toMatchObject({
      title: 'Njoftim për dëgjesë publike',
      sourceUrl: 'https://durres.gov.al/2026/03/20/njoftim-per-degjese-publike-4/',
      publishedDate: '2026-03-20',
      kind: 'hearing',
    });
  });

  it('falls back to visible Albanian date when JSON-LD has no datePublished', () => {
    const html = `
      <h1>Njoftim per konsultim publik</h1>
      <span class="elementor-post-info__item--type-date">8 Qershor, 2026 9:01 am</span>
    `;

    expect(
      parseDurresKonsultimeDetailHtml(
        html,
        'https://durres.gov.al/2026/06/09/njoftim-per-konsultim-publik/',
      ),
    ).toMatchObject({
      title: 'Njoftim per konsultim publik',
      publishedDate: '2026-06-08',
      kind: 'consultation_notice',
    });
  });

  it('uses permalink path date only as last-resort fallback', () => {
    const html = '<h1>Njoftim publik pa datë të dukshme</h1>';

    expect(
      parseDurresKonsultimeDetailHtml(
        html,
        'https://durres.gov.al/2025/04/03/njoftim-publik-pa-date/',
      ),
    ).toMatchObject({
      title: 'Njoftim publik pa datë të dukshme',
      publishedDate: '2025-04-03',
    });
  });

  it('skips details with missing title, missing date, or pre-2023 date', () => {
    expect(
      parseDurresKonsultimeDetailHtml(
        '<span class="elementor-post-info__item--type-date">8 Qershor, 2026</span>',
        'https://durres.gov.al/2026/06/08/no-title/',
      ),
    ).toBeNull();
    expect(
      parseDurresKonsultimeDetailHtml(
        '<h1>Njoftim pa datë</h1>',
        'https://durres.gov.al/no-date/',
      ),
    ).toBeNull();
    expect(
      parseDurresKonsultimeDetailHtml(
        '<h1>Njoftim i vjetër</h1><span>8 Qershor, 2022</span>',
        'https://durres.gov.al/2022/06/08/njoftim-i-vjeter/',
      ),
    ).toBeNull();
  });
});
