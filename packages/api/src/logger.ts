import type { IncomingMessage } from 'node:http';
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const redact = {
  paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  censor: '[redacted]',
};

const SENSITIVE_QUERY_PARAMS = ['code', 'state'];

// pino's path-based `redact` can't reach inside a URL string, but the Microsoft
// OAuth callback carries the one-time authorization code and CSRF state as
// query params on req.url — strip those before the request serializer logs it.
export function redactSensitiveQueryParams(url: string): string {
  const [path, query] = url.split('?', 2);
  if (!query) return url;

  const params = new URLSearchParams(query);
  for (const name of SENSITIVE_QUERY_PARAMS) {
    if (params.has(name)) params.set(name, '[redacted]');
  }
  return `${path}?${params.toString()}`;
}

const serializers = {
  req(req: IncomingMessage) {
    const serialized = pino.stdSerializers.req(req);
    return { ...serialized, url: redactSensitiveQueryParams(serialized.url) };
  },
};

export const logger = pino(
  isDev
    ? {
        level: 'debug',
        redact,
        serializers,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : {
        level: 'info',
        redact,
        serializers,
      },
);
