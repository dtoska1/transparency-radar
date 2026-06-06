const ADMIN_SESSION_COOKIE_NAME = 'tra_admin_session';
const DEFAULT_ADMIN_API_BASE_URL = 'http://localhost:3000';

export interface AdminApiRequest {
  method?: string;
  body?: BodyInit;
  contentType?: string;
  cookieHeader?: string | null;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export function extractSessionCookie(cookieHeader: string | null | undefined): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const cookie = part.trim();
    const separator = cookie.indexOf('=');
    if (separator === -1) continue;
    if (cookie.slice(0, separator) !== ADMIN_SESSION_COOKIE_NAME) continue;
    return cookie;
  }

  return undefined;
}

export function getAdminApiBaseUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const configured = env.ADMIN_API_BASE_URL?.trim() || DEFAULT_ADMIN_API_BASE_URL;
  const url = new URL(configured);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ADMIN_API_BASE_URL must use http or https');
  }
  return url;
}

export async function adminApiFetch(
  path: string,
  {
    method = 'GET',
    body,
    contentType,
    cookieHeader,
    fetchImpl = fetch,
    env = process.env,
  }: AdminApiRequest = {},
): Promise<Response> {
  const headers = new Headers();
  const sessionCookie = extractSessionCookie(cookieHeader);
  if (sessionCookie) headers.set('Cookie', sessionCookie);
  if (contentType) headers.set('Content-Type', contentType);

  return fetchImpl(new URL(path, getAdminApiBaseUrl(env)), {
    method,
    headers,
    body,
    redirect: 'manual',
  });
}

export function relaySetCookies(upstream: Pick<Response, 'headers'>, downstream: Headers): void {
  for (const cookie of upstream.headers.getSetCookie()) {
    downstream.append('Set-Cookie', cookie);
  }
}
