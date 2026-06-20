import { PogradecKonsultimeScraper } from './konsultime.js';

const scraper = new PogradecKonsultimeScraper();

try {
  await scraper.run();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
