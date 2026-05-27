export const MUNICIPALITY_SLUGS = ['tirana', 'shkoder', 'durres', 'vlore', 'pogradec'] as const;

export type MunicipalitySlug = (typeof MUNICIPALITY_SLUGS)[number];

export const VERTICALS = ['vendime', 'konsultime', 'prokurime'] as const;

export type Vertical = (typeof VERTICALS)[number];
