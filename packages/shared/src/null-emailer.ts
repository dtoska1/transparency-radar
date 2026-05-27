import type { IEmailAdapter } from './adapters.js';

export class NullEmailer implements IEmailAdapter {
  async send(_opts: Parameters<IEmailAdapter['send']>[0]): Promise<void> {
    // no-op
  }
}
