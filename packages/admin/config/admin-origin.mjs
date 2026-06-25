export const ADMIN_PUBLIC_ORIGIN = 'https://admin.radarvendor.com';

const url = new URL(ADMIN_PUBLIC_ORIGIN);
export const ADMIN_ALLOWED_DOMAIN = Object.freeze({
  hostname: url.hostname,
  protocol: url.protocol.slice(0, -1),
});
