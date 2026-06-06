import type { APIRoute } from 'astro';
import { adminApiFetch, relaySetCookies } from '../../lib/apiClient';
import { isAllowedPostOrigin } from '../../lib/requestSecurity';
import { forbiddenResponse, redirectResponse } from '../../lib/responses';

export const POST: APIRoute = async ({ request }) => {
  if (!isAllowedPostOrigin(request)) return forbiddenResponse();

  try {
    const upstream = await adminApiFetch('/api/admin/auth/logout', {
      method: 'POST',
      cookieHeader: request.headers.get('cookie'),
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'Admin service unavailable' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const headers = new Headers();
    relaySetCookies(upstream, headers);
    return redirectResponse('/login', headers);
  } catch {
    return new Response(JSON.stringify({ error: 'Admin service unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
