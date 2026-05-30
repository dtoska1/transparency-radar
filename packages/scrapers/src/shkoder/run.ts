import { ShkoderVendimeScraper } from './vendime.js';

const firstRunLimit = process.env.FIRST_RUN_LIMIT
  ? Number.parseInt(process.env.FIRST_RUN_LIMIT, 10)
  : 1;

const scraper = new ShkoderVendimeScraper({ firstRunLimit });
await scraper.run();
