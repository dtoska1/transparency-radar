import { describe, expect, it, vi } from 'vitest';

vi.mock('@tra/db', () => ({
  db: {},
  konsultime: {},
  municipalities: {},
  scrape_runs: {},
  sources: {},
}));

import { classifyKind, parseListingDate, parsePogradecKonsultimeHtml } from './konsultime.js';

function card(slug: string, title: string, excerpt: string, date: string): string {
  return `
    <article>
      <section>
        <h3 class="grid-title">
          <a href="/publikime/konsultim-publik-10/${slug}/">${title}</a>
        </h3>
        <p>${excerpt}</p>
      </section>
      <section>
        <span>Kategori</span>
        <span>${date}</span>
      </section>
    </article>
  `;
}

describe('parseListingDate', () => {
  it('converts DD-MM-YYYY to ISO YYYY-MM-DD', () => {
    expect(parseListingDate('15-03-2024')).toBe('2024-03-15');
  });

  it('converts single-digit day and month', () => {
    expect(parseListingDate('05-06-2023')).toBe('2023-06-05');
  });

  it('returns null for non-matching text', () => {
    expect(parseListingDate('invalid')).toBeNull();
  });

  it('extracts date from text containing extra characters', () => {
    expect(parseListingDate(' 20-11-2025 ')).toBe('2025-11-20');
  });
});

describe('classifyKind', () => {
  it('returns hearing when title contains dëgjes', () => {
    expect(classifyKind('Dëgjesë Publike 2024', '')).toBe('hearing');
  });

  it('returns hearing when excerpt contains degjes (unaccented)', () => {
    expect(classifyKind('Konsultim', 'degjes publike')).toBe('hearing');
  });

  it('returns draft_act when title contains projekt and akt', () => {
    expect(classifyKind('Projekt-Akt për Buxhetin', '')).toBe('draft_act');
  });

  it('returns draft_act when title contains projekt and vendim', () => {
    expect(classifyKind('Projektvendim nr.5', '')).toBe('draft_act');
  });

  it('returns consultation_notice as default', () => {
    expect(classifyKind('Konsultim Publik mbi Planin', '')).toBe('consultation_notice');
  });
});

describe('parsePogradecKonsultimeHtml', () => {
  it('extracts representative cards, ignores old rows, and finds explicit DD-MM-YYYY dates', () => {
    const html = `
      <main>
        ${card(
          'konsultim-publik-900',
          'Konsultim Publik për Projekt-Buxhetin 2025',
          'Njoftim për konsultimin publik të projekt-buxhetit.',
          '20-11-2025',
        )}
        ${card('konsultim-publik-899', 'Dëgjesë Publike për Transportin', 'Degjes publike.', '15-03-2024')}
        ${card('konsultim-publik-898', 'Projektvendim për Taksat Vendore', 'Projektvendim për konsultim.', '05-06-2023')}
        ${card('konsultim-publik-897', 'Konsultim Publik për Arsimin', 'Material konsultimi.', '11-07-2023')}
        ${card('konsultim-publik-896', 'Konsultim Publik për Sportin', 'Njoftim konsultimi.', '12-08-2023')}
        ${card('konsultim-publik-895', 'Konsultim Publik për Kulturën', 'Thirrje për komente.', '13-09-2023')}
        ${card('konsultim-publik-894', 'Konsultim Publik për Turizmin', 'Takim konsultues.', '14-10-2023')}
        ${card('konsultim-publik-893', 'Konsultim Publik për Mjedisin', 'Projekt akt për diskutim.', '15-11-2023')}
        ${card('konsultim-publik-700', 'Konsultim i Vjetër Publik', 'Duhet të filtrohet.', '22-12-2022')}
      </main>
    `;

    const items = parsePogradecKonsultimeHtml(html);

    expect(items).toHaveLength(8);
    expect(items.some((item) => item.title === 'Konsultim i Vjetër Publik')).toBe(false);
    expect(items[0]).toEqual({
      title: 'Konsultim Publik për Projekt-Buxhetin 2025',
      sourceUrl:
        'https://bashkiapogradec.gov.al/publikime/konsultim-publik-10/konsultim-publik-900/',
      excerpt: 'Njoftim për konsultimin publik të projekt-buxhetit.',
      publishedDate: '2025-11-20',
    });
  });
});
