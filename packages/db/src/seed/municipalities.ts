import { MUNICIPALITY_SLUGS, type MunicipalitySlug } from '@tra/shared';
import { db } from '../connection.js';
import { municipalities } from '../schema/index.js';

const DISPLAY_NAMES: Record<MunicipalitySlug, string> = {
  tirana: 'Tiranë',
  shkoder: 'Shkodër',
  durres: 'Durrës',
  vlore: 'Vlorë',
  pogradec: 'Pogradec',
};

async function seed() {
  const rows = MUNICIPALITY_SLUGS.map((slug) => ({
    slug,
    name: DISPLAY_NAMES[slug],
  }));

  await db
    .insert(municipalities)
    .values(rows)
    .onConflictDoNothing({ target: municipalities.slug });

  console.log(`Seeded ${rows.length.toString()} municipalities.`);
  process.exit(0);
}

seed().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
