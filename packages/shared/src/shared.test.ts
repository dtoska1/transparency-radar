import { describe, expect, it } from 'vitest';
import { ConsoleNotifier } from './console-notifier.js';
import { MUNICIPALITY_SLUGS, VERTICALS } from './constants.js';
import { NullEmailer } from './null-emailer.js';

describe('shared exports', () => {
  it('has 5 municipality slugs', () => {
    expect(MUNICIPALITY_SLUGS).toHaveLength(5);
    expect(MUNICIPALITY_SLUGS).toContain('tirana');
    expect(MUNICIPALITY_SLUGS).toContain('shkoder');
    expect(MUNICIPALITY_SLUGS).toContain('durres');
    expect(MUNICIPALITY_SLUGS).toContain('vlore');
    expect(MUNICIPALITY_SLUGS).toContain('pogradec');
  });

  it('has 3 verticals', () => {
    expect(VERTICALS).toHaveLength(3);
    expect(VERTICALS).toContain('vendime');
    expect(VERTICALS).toContain('konsultime');
    expect(VERTICALS).toContain('prokurime');
  });

  it('NullEmailer.send resolves without throwing', async () => {
    const emailer = new NullEmailer();
    await expect(
      emailer.send({ to: 'test@test.com', subject: 'hi', html: '<p>hi</p>' }),
    ).resolves.toBeUndefined();
  });

  it('ConsoleNotifier.notify resolves without throwing', async () => {
    const notifier = new ConsoleNotifier();
    await expect(
      notifier.notify({ channel: 'general', message: 'hello' }),
    ).resolves.toBeUndefined();
  });
});
