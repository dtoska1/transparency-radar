import { describe, expect, it, vi } from 'vitest';

vi.mock('@tra/db', () => ({
  db: {},
  konsultime: {},
  municipalities: {},
  scrape_runs: {},
  sources: {},
}));

import {
  classifyKind,
  getShkoderKonsultimeNextPageUrl,
  parseShkoderKonsultimeHtml,
  parseShkoderListingDate,
} from './konsultime.js';

function card(slug: string, title: string, excerpt: string, date: string): string {
  return `
    <div class="article-paginated">
      <h4><a href="/këshillim_m_publikun/${slug}/">${title}</a></h4>
      <div class="post-excerpt">${excerpt}</div>
      <div class="post-date">${date}</div>
    </div>
  `;
}

describe('parseShkoderListingDate', () => {
  it('converts Albanian month names to ISO dates without Date parsing', () => {
    expect(parseShkoderListingDate('29 Maj, 2026')).toBe('2026-05-29');
    expect(parseShkoderListingDate('17 Nëntor, 2025')).toBe('2025-11-17');
    expect(parseShkoderListingDate('17 Nentor, 2025')).toBe('2025-11-17');
  });

  it('returns null for unparseable dates', () => {
    expect(parseShkoderListingDate('Maj 29 2026')).toBeNull();
    expect(parseShkoderListingDate('29 Foo, 2026')).toBeNull();
  });
});

describe('classifyKind', () => {
  it.each(['Dëgjesë', 'dëgjesë', 'DËGJESË', 'degjese', 'DEGJESE'])(
    'classifies %s as hearing accent-insensitively',
    (word) => {
      expect(classifyKind(`${word} publike`, '')).toBe('hearing');
    },
  );

  it('defaults to consultation_notice', () => {
    expect(classifyKind('Konsultim me publikun', 'Njoftim per komente')).toBe(
      'consultation_notice',
    );
  });
});

describe('parseShkoderKonsultimeHtml', () => {
  it('extracts representative items, applies the year floor, and normalizes Unicode URLs', () => {
    const html = `
      <main>
        ${card(
          'degjese-buxheti-2026',
          'Dëgjesë publike për projekt-buxhetin',
          'Ftohen qytetarët për konsultim.',
          '29 Maj, 2026',
        )}
        ${card(
          'njoftim-nentor-2025',
          'Njoftim për këshillim me publikun',
          'Material për diskutim publik.',
          '17 Nëntor, 2025',
        )}
        ${card(
          'njoftim-nentor-pa-diacritike',
          'Konsultim për planin vendor',
          'Takim konsultues me komunitetin.',
          '21 Nentor, 2025',
        )}
        ${card(
          'njoftim-i-vjeter',
          'Konsultim i vjetër',
          'Duhet të filtrohet nga viti.',
          '20 Dhjetor, 2022',
        )}
      </main>
      <div class="pagination">
        <a class="page-numbers" href="https://bashkiashkoder.gov.al/keshillim-me-publikun/page/2/">2</a>
        <a class="next page-numbers" href="https://bashkiashkoder.gov.al/keshillim-me-publikun/page/2/">Next</a>
      </div>
    `;

    const first = parseShkoderKonsultimeHtml(html);
    const second = parseShkoderKonsultimeHtml(html);

    expect(first).toHaveLength(3);
    expect(first).toEqual(second);
    expect(first.some((item) => item.title === 'Konsultim i vjetër')).toBe(false);
    expect(first[0]).toEqual({
      title: 'Dëgjesë publike për projekt-buxhetin',
      sourceUrl: 'https://bashkiashkoder.gov.al/k%C3%ABshillim_m_publikun/degjese-buxheti-2026/',
      excerpt: 'Ftohen qytetarët për konsultim.',
      publishedDate: '2026-05-29',
    });
  });

  it('dedupes repeated source URLs inside the parser', () => {
    const html = `
      <main>
        ${card('njoftim-i-perseritur', 'Konsultim publik', 'Tekst.', '23 Janar, 2026')}
        ${card('njoftim-i-perseritur', 'Konsultim publik kopje', 'Tekst kopje.', '23 Janar, 2026')}
      </main>
    `;

    expect(parseShkoderKonsultimeHtml(html)).toHaveLength(1);
  });
});

describe('getShkoderKonsultimeNextPageUrl', () => {
  it('resolves discovered next pagination links', () => {
    const html = `
      <div class="pagination">
        <a class="page-numbers" href="/keshillim-me-publikun/page/2/">2</a>
        <a class="next page-numbers" href="/keshillim-me-publikun/page/2/">Next</a>
      </div>
    `;

    expect(getShkoderKonsultimeNextPageUrl(html)).toBe(
      'https://bashkiashkoder.gov.al/keshillim-me-publikun/page/2/',
    );
  });

  it('returns null when no next pagination link exists', () => {
    expect(getShkoderKonsultimeNextPageUrl('<main>No pagination</main>')).toBeNull();
  });
});
