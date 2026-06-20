import { ShkoderKonsultimeScraper } from './konsultime.js';

const scraper = new ShkoderKonsultimeScraper();

try {
  await scraper.run();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
