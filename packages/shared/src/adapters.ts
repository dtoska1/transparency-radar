export interface IStorageAdapter {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export interface IEmailAdapter {
  send(opts: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
  }): Promise<void>;
}

export interface INotificationAdapter {
  notify(opts: {
    channel: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
