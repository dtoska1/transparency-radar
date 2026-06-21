import { describe, expect, it } from 'vitest';
import { assertDevDatabase } from './dev-database-guard.js';

describe('assertDevDatabase', () => {
  it('allows known local database hosts', () => {
    expect(() => assertDevDatabase('postgresql://tra:tra_dev@localhost:5432/tra')).not.toThrow();
    expect(() => assertDevDatabase('postgresql://tra:tra_dev@127.0.0.1:5432/tra')).not.toThrow();
    expect(() => assertDevDatabase('postgresql://tra:tra_dev@postgres:5432/tra')).not.toThrow();
  });

  it('rejects non-local hosts and includes the scraper name in the message', () => {
    expect(() =>
      assertDevDatabase(
        'postgresql://user:secret@example.neon.tech/tra',
        'Shkodër konsultime document enrichment',
      ),
    ).toThrow(/Shkodër konsultime document enrichment is DEV-only/);
  });

  it('defaults the scraper name when none is given', () => {
    expect(() => assertDevDatabase('postgresql://user:secret@example.neon.tech/tra')).toThrow(
      /DEV-only/,
    );
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => assertDevDatabase(undefined)).toThrow(/DATABASE_URL is required/);
  });
});
