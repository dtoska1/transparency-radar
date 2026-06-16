import { describe, expect, it } from 'vitest';
import { classifyDocType } from './classifyDocType.js';

describe('classifyDocType', () => {
  it('types a draft act (with Albanian -i suffix)', () => {
    expect(classifyDocType('Projekt Vendimi I Linjave Te Transportit')).toBe('draft_act');
    expect(classifyDocType('Projektligji per garantimin e sigurise')).toBe('draft_act');
  });

  it('types a notice even when it mentions a draft act', () => {
    expect(classifyDocType('Njoftim per konsultim publik: Titulli i Projekt-aktit')).toBe('notice');
    expect(classifyDocType('Njoftimi Konsultimit Per Linjat E Transportit')).toBe('notice');
  });

  it('types a feedback/consultation report', () => {
    expect(classifyDocType('Raporti i konsultimit publik me komentet e qytetareve')).toBe(
      'feedback_report',
    );
  });

  it('types RIA / impact assessment but NOT the substring inside other words', () => {
    expect(classifyDocType('Vleresim i ndikimit rregullator (RIA)')).toBe('ria');
    expect(classifyDocType('Vleresimi Strategjik Mjedisor')).toBe('ria');
    // "aktiviteti" contains "ria" as a substring — must NOT match
    expect(classifyDocType('Foto nga aktiviteti')).toBe('other');
  });

  it('types a hearing, accent-tolerant and suffix-tolerant', () => {
    expect(classifyDocType('Procesverbal i degjeses publike')).toBe('hearing');
    expect(classifyDocType('Degjese me pensionistet e zones')).toBe('hearing'); // unaccented + suffix
    expect(classifyDocType('Dëgjesë publike')).toBe('hearing'); // accented
  });

  it('types explanatory memo, timeline, expert consultation', () => {
    expect(classifyDocType('Relacion shpjegues per projektvendimin')).toBe('explanatory_memo');
    expect(classifyDocType('Kalendari i Konsultimit Publik')).toBe('timeline');
    expect(classifyDocType('Konsultim me eksperte mbi planin')).toBe('expert_consultation');
  });

  it('falls back to other when nothing matches', () => {
    expect(classifyDocType('Foto nga aktiviteti', 'galeria.jpg')).toBe('other');
    expect(classifyDocType('')).toBe('other');
  });

  it('uses the URL filename as a fallback signal', () => {
    expect(classifyDocType('Shkarko', '-projekt-vendimi-i-linjave-.pdf')).toBe('draft_act');
  });
});
