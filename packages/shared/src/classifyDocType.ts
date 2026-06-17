// Konsultime document-type classifier (pure, no I/O, no DB).
// Drop into packages/shared/src/. Maps a document's label/filename to a taxonomy type.

export type KonsultimeDocType =
  | 'draft_act'
  | 'notice'
  | 'timeline'
  | 'feedback_report'
  | 'ria'
  | 'explanatory_memo'
  | 'hearing'
  | 'expert_consultation'
  | 'other';

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Albanian words take grammatical suffixes (njoftim->njoftimi, degjes->degjese,
// projektvendim->projektvendimi). Match the keyword as a WORD-START stem: it must
// begin at a word boundary but may be followed by more letters (the suffix).
// Anchored at the start so short stems like "ria" cannot match inside "aktiviteti".
function hasStem(hay: string, kw: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(fold(kw))}`);
  return re.test(hay);
}

// Order matters: a "njoftim" that merely mentions a draft act is still a notice,
// so notice is checked before draft_act. Higher-signal report/RIA/hearing first.
const RULES: ReadonlyArray<{ type: KonsultimeDocType; keywords: readonly string[] }> = [
  {
    type: 'feedback_report',
    keywords: [
      'raport i konsultimit',
      'raporti i konsultimit',
      'raport konsultimi',
      'permbledhje e komenteve',
      'raport permbledhes',
    ],
  },
  {
    type: 'ria',
    keywords: ['vleresim ndikimi', 'vleresim i ndikimit', 'vleresimi strategjik', '(ria)'],
  },
  { type: 'hearing', keywords: ['procesverbal', 'degjes', 'seance degjimore'] },
  { type: 'explanatory_memo', keywords: ['relacion', 'memorandum shpjegues'] },
  { type: 'expert_consultation', keywords: ['konsultim me eksperte', 'konsultime me eksperte'] },
  { type: 'timeline', keywords: ['kalendar', 'afat', 'periudha e konsultimit'] },
  { type: 'notice', keywords: ['njoftim', 'ftese per konsultim', 'ftese'] },
  {
    type: 'draft_act',
    keywords: [
      'projektakt',
      'projekt-akt',
      'projekt akt',
      'projektligj',
      'projekt ligj',
      'projektvendim',
      'projekt vendim',
      'projekt-vendim',
      'draft',
    ],
  },
];

/**
 * Classify a konsultime document by its label/title and optional URL filename.
 * Returns 'other' when nothing matches — deliberately under-claims rather than guesses.
 */
export function classifyDocType(label: string, url = ''): KonsultimeDocType {
  const hay = fold(`${label} ${url}`);
  for (const rule of RULES) {
    if (rule.keywords.some((k) => hasStem(hay, k))) return rule.type;
  }
  return 'other';
}
