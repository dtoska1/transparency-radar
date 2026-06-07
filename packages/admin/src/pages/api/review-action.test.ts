import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApiFetch } from '../../lib/apiClient';
import { POST } from './review-action';

vi.mock('../../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/apiClient')>();
  return {
    ...actual,
    adminApiFetch: vi.fn(),
  };
});

const mockedAdminApiFetch = vi.mocked(adminApiFetch);
const ROW_ID = '051abce1-feb1-4011-8fcf-3968d73fe5d5';

function actionRequest(
  values: Record<string, string>,
  options: { origin?: string; cookie?: string } = {},
): Request {
  const body = new URLSearchParams(values);
  const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
  if (options.origin) headers.set('Origin', options.origin);
  if (options.cookie) headers.set('Cookie', options.cookie);
  return new Request('http://localhost:4321/api/review-action', {
    method: 'POST',
    headers,
    body,
  });
}

async function invoke(request: Request): Promise<Response> {
  return POST({ request } as never);
}

describe('POST /api/review-action', () => {
  beforeEach(() => {
    mockedAdminApiFetch.mockReset();
  });

  it('rejects a mismatched Origin before making an API call', async () => {
    const response = await invoke(
      actionRequest(
        { action: 'approve', vertical: 'vendime', id: ROW_ID },
        { origin: 'https://evil.example' },
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(mockedAdminApiFetch).not.toHaveBeenCalled();
  });

  it('approves without a body or client-selected review status and relays cookies', async () => {
    const upstreamHeaders = new Headers();
    upstreamHeaders.append(
      'Set-Cookie',
      'tra_admin_session=refreshed; Path=/; HttpOnly; SameSite=Strict',
    );
    mockedAdminApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: upstreamHeaders }),
    );

    const response = await invoke(
      actionRequest(
        {
          action: 'approve',
          vertical: 'vendime',
          id: ROW_ID,
          review_status: 'rejected',
          returnMunicipality: 'shkoder',
          returnOffset: '20',
        },
        { origin: 'http://localhost:4321', cookie: 'tra_admin_session=raw; analytics=ignored' },
      ),
    );

    expect(mockedAdminApiFetch).toHaveBeenCalledWith(`/api/admin/vendime/${ROW_ID}/approve`, {
      method: 'POST',
      cookieHeader: 'tra_admin_session=raw; analytics=ignored',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(
      '/?municipality=shkoder&offset=20&notice=approved',
    );
    expect(response.headers.getSetCookie()).toEqual(upstreamHeaders.getSetCookie());
  });

  it('rejects with only the optional reason in its JSON body', async () => {
    mockedAdminApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const response = await invoke(
      actionRequest({
        action: 'reject',
        vertical: 'konsultime',
        id: ROW_ID,
        reason: '  Out of scope  ',
        review_status: 'approved',
        returnVertical: 'konsultime',
      }),
    );

    expect(mockedAdminApiFetch).toHaveBeenCalledWith(`/api/admin/konsultime/${ROW_ID}/reject`, {
      method: 'POST',
      cookieHeader: null,
      contentType: 'application/json',
      body: JSON.stringify({ reason: 'Out of scope' }),
    });
    const requestOptions = mockedAdminApiFetch.mock.calls[0]?.[1];
    expect(JSON.parse(String(requestOptions?.body))).toEqual({ reason: 'Out of scope' });
    expect(JSON.parse(String(requestOptions?.body))).not.toHaveProperty('review_status');
    expect(response.headers.get('Location')).toBe('/?vertical=konsultime&notice=rejected');
  });

  it.each([404, 409])('handles upstream %s as a stale pending row', async (status) => {
    mockedAdminApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'upstream detail' }), { status }),
    );

    const response = await invoke(
      actionRequest({ action: 'approve', vertical: 'prokurime', id: ROW_ID }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/?notice=stale');
  });

  it('redirects an expired session to login and relays the clearing cookie', async () => {
    const upstreamHeaders = new Headers({
      'Set-Cookie': 'tra_admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict',
    });
    mockedAdminApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: upstreamHeaders,
      }),
    );

    const response = await invoke(
      actionRequest({ action: 'reject', vertical: 'vendime', id: ROW_ID }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/login');
    expect(response.headers.getSetCookie()).toEqual(upstreamHeaders.getSetCookie());
  });

  it('fails closed on invalid input without calling the API', async () => {
    const response = await invoke(
      actionRequest({
        action: 'approve',
        vertical: 'unknown',
        id: ROW_ID,
        returnUrl: 'https://evil.example',
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/?notice=error');
    expect(mockedAdminApiFetch).not.toHaveBeenCalled();
  });
});
