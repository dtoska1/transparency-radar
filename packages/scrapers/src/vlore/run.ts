import { VloreVendimeScraper } from './vendime.js';

const firstRunLimit = process.env.FIRST_RUN_LIMIT
  ? Number.parseInt(process.env.FIRST_RUN_LIMIT, 10)
  : 10;

const scraper = new VloreVendimeScraper({ firstRunLimit });
await scraper.run();
