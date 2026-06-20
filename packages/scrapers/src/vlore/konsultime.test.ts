import { describe, expect, it, vi } from 'vitest';

vi.mock('@tra/db', () => ({
  db: {},
  konsultime: {},
  municipalities: {},
  scrape_runs: {},
  sources: {},
}));

import {
  extractVloreKonsultimeUrl,
  parseVloreKonsultimeHtml,
  parseVloreListingDate,
} from './konsultime.js';

const SOURCE_PAGE_URL =
  'https://vlora.gov.al/regjistri-i-projekt-akteve-per-konsultim-publik-te-keshillit-bashkiak/';

describe('parseVloreListingDate', () => {
  it('converts slash and dot date formats to ISO strings without Date parsing', () => {
    expect(parseVloreListingDate('25/01/2024')).toBe('2024-01-25');
    expect(parseVloreListingDate('10.11.2023')).toBe('2023-11-10');
  });

  it('returns null for invalid dates', () => {
    expect(parseVloreListingDate('2024-01-25')).toBeNull();
    expect(parseVloreListingDate('32.01.2024')).toBeNull();
    expect(parseVloreListingDate('25.13.2024')).toBeNull();
  });
});

describe('extractVloreKonsultimeUrl', () => {
  it('normalizes URLs from anchor hrefs and plain text', () => {
    expect(extractVloreKonsultimeUrl('/wp-content/uploads/2024/01/projekt-akt.pdf', '')).toBe(
      'https://vlora.gov.al/wp-content/uploads/2024/01/projekt-akt.pdf',
    );
    expect(
      extractVloreKonsultimeUrl(
        null,
        'Dokumenti: https://vlora.gov.al/wp-content/uploads/2023/11/njoftim.pdf.',
      ),
    ).toBe('https://vlora.gov.al/wp-content/uploads/2023/11/njoftim.pdf');
  });
});

describe('parseVloreKonsultimeHtml', () => {
  it('parses only tablepress-7 rows and keeps draft-act metadata', () => {
    const html = `
      <table id="tablepress-6">
        <tbody>
          <tr>
            <td><a href="https://vlora.gov.al/wp-content/uploads/2024/01/ignored-table-6.pdf">Ignored table</a></td>
            <td>25.01.2024</td>
          </tr>
        </tbody>
      </table>
      <table id="tablepress-7">
        <tbody>
          <tr>
            <td><a href="https://vlora.gov.al/wp-content/uploads/2023/11/projekt-akti-per-taksat.pdf">Projekt akt për taksat vendore</a></td>
            <td>10.11.2023</td>
            <td>20.11.2023</td><td>10 ditë</td><td></td><td>Online</td><td></td><td>Jo</td><td></td>
          </tr>
          <tr>
            <td>https://vlora.gov.al/wp-content/uploads/2023/09/projekt-akt-buxheti.pdf</td>
            <td>05.09.2023</td>
            <td></td><td></td><td></td><td>Me shkrim</td><td></td><td>Jo</td><td></td>
          </tr>
          <tr>
            <td><a href="/wp-content/uploads/2024/01/projekt-akt-urbanistika.pdf">Shkarko</a></td>
            <td>25/01/2024</td>
            <td></td><td></td><td></td><td>Dëgjesë</td><td></td><td>Jo</td><td></td>
          </tr>
          <tr>
            <td><a href="https://vlora.gov.al/wp-content/uploads/2023/11/projekt_akt_per_transportin.pdf">Projekt akt për transportin</a></td>
            <td>25.11.2023</td>
            <td></td><td></td><td></td><td>Publikim</td><td></td><td>Jo</td><td></td>
          </tr>
          <tr>
            <td><a href="https://vlora.gov.al/wp-content/uploads/2022/12/projekt-i-vjeter.pdf">Projekt i vjetër</a></td>
            <td>30.12.2022</td>
            <td></td><td></td><td></td><td>Publikim</td><td></td><td>Jo</td><td></td>
          </tr>
          <tr>
            <td>Pa URL ne kolonen e pare</td>
            <td>10.11.2023</td>
            <td></td><td></td><td></td><td>Publikim</td><td></td><td>Jo</td><td></td>
          </tr>
          <tr>
            <td><a href="https://vlora.gov.al/wp-content/uploads/2023/11/date-invalid.pdf">Invalid date</a></td>
            <td>invalid</td>
            <td></td><td></td><td></td><td>Publikim</td><td></td><td>Jo</td><td></td>
          </tr>
        </tbody>
      </table>
    `;

    const items = parseVloreKonsultimeHtml(html);

    expect(items).toHaveLength(4);
    expect(items.some((item) => item.sourceUrl.includes('ignored-table-6'))).toBe(false);
    expect(items.some((item) => item.title === 'Projekt i vjetër')).toBe(false);
    expect(items.map((item) => item.kind)).toEqual([
      'draft_act',
      'draft_act',
      'draft_act',
      'draft_act',
    ]);
    expect(items.every((item) => item.sourceOrigin === 'vlora.gov.al')).toBe(true);
    expect(items.every((item) => item.sourcePageUrl === SOURCE_PAGE_URL)).toBe(true);
    expect(items.every((item) => item.isUnofficialProxy === false)).toBe(true);
    expect(items.every((item) => !('review_status' in item))).toBe(true);

    expect(items[0]).toMatchObject({
      title: 'Projekt akt për taksat vendore',
      sourceUrl: 'https://vlora.gov.al/wp-content/uploads/2023/11/projekt-akti-per-taksat.pdf',
      publishedDate: '2023-11-10',
    });
    expect(items[1]).toMatchObject({
      title: 'projekt akt buxheti',
      sourceUrl: 'https://vlora.gov.al/wp-content/uploads/2023/09/projekt-akt-buxheti.pdf',
      publishedDate: '2023-09-05',
    });
    expect(items[2]).toMatchObject({
      title: 'projekt akt urbanistika',
      sourceUrl: 'https://vlora.gov.al/wp-content/uploads/2024/01/projekt-akt-urbanistika.pdf',
      publishedDate: '2024-01-25',
    });
    expect(items[3]).toMatchObject({
      title: 'Projekt akt për transportin',
      sourceUrl: 'https://vlora.gov.al/wp-content/uploads/2023/11/projekt_akt_per_transportin.pdf',
      publishedDate: '2023-11-25',
    });
  });
});
