import { VloreKonsultimeScraper } from './konsultime.js';

const scraper = new VloreKonsultimeScraper();

try {
  await scraper.run();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
