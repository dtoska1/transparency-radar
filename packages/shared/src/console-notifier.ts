import type { INotificationAdapter } from './adapters.js';

export class ConsoleNotifier implements INotificationAdapter {
  async notify(opts: Parameters<INotificationAdapter['notify']>[0]): Promise<void> {
    console.log(
      `[notification] channel=${opts.channel} message=${opts.message}`,
      opts.metadata ?? '',
    );
  }
}
