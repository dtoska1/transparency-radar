import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const redact = {
  paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  censor: '[redacted]',
};

export const logger = pino(
  isDev
    ? {
        level: 'debug',
        redact,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : {
        level: 'info',
        redact,
      },
);
