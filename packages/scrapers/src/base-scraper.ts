import type { MunicipalitySlug, Vertical } from '@tra/shared';
import pino from 'pino';

export abstract class BaseScraper {
  protected readonly logger: pino.Logger;

  constructor(
    readonly municipality: MunicipalitySlug,
    readonly vertical: Vertical,
  ) {
    this.logger = pino({ name: `scraper:${municipality}:${vertical}` });
  }

  abstract run(): Promise<void>;
}
