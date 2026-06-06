import { describe, expect, it, vi } from 'vitest';
import {
  adminApiFetch,
  extractSessionCookie,
  getAdminApiBaseUrl,
  relaySetCookies,
} from './apiClient';

describe('admin BFF API client', () => {
  it('extracts only the exact admin session cookie', () => {
    expect(
      extractSessionCookie(
        'analytics=abc; tra_admin_session=raw-session-token; other=value; tra_admin_session_extra=no',
      ),
    ).toBe('tra_admin_session=raw-session-token');
    expect(extractSessionCookie('tra_admin_session_extra=no; other=value')).toBeUndefined();
  });

  it('defaults to the local API and accepts only http or https configuration', () => {
    expect(getAdminApiBaseUrl({}).href).toBe('http://localhost:3000/');
    expect(getAdminApiBaseUrl({ ADMIN_API_BASE_URL: 'https://api.example.test/base/' }).href).toBe(
      'https://api.example.test/base/',
    );
    expect(() => getAdminApiBaseUrl({ ADMIN_API_BASE_URL: 'file:///tmp/api' })).toThrow(
      'ADMIN_API_BASE_URL must use http or https',
    );
  });

  it('forwards only the session cookie and explicitly requested content type', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    await adminApiFetch('/api/admin/pending?limit=1', {
      method: 'POST',
      body: '{}',
      contentType: 'application/json',
      cookieHeader:
        'analytics=abc; tra_admin_session=raw-session-token; preferences=dark; authorization=no',
      fetchImpl,
      env: { ADMIN_API_BASE_URL: 'http://api.internal:3000' },
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(url?.toString()).toBe('http://api.internal:3000/api/admin/pending?limit=1');
    expect(headers.get('Cookie')).toBe('tra_admin_session=raw-session-token');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect([...headers.keys()].sort()).toEqual(['content-type', 'cookie']);
    expect(init?.redirect).toBe('manual');
  });

  it('relays every Set-Cookie value verbatim', () => {
    const upstreamHeaders = new Headers();
    upstreamHeaders.append(
      'Set-Cookie',
      'tra_admin_session=one; Path=/; HttpOnly; SameSite=Strict',
    );
    upstreamHeaders.append('Set-Cookie', 'second=value; Path=/');
    const downstream = new Headers();

    relaySetCookies({ headers: upstreamHeaders }, downstream);

    expect(downstream.getSetCookie()).toEqual(upstreamHeaders.getSetCookie());
  });
});
