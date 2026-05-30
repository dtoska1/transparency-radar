import { PogradecVendimeScraper } from './vendime.js';

const firstRunLimit = process.env.FIRST_RUN_LIMIT
  ? Number.parseInt(process.env.FIRST_RUN_LIMIT, 10)
  : 1;

const scraper = new PogradecVendimeScraper({ firstRunLimit });
await scraper.run();
