import type { APIRoute } from 'astro';
import { noticeForAllowlistResponse, parseAddAllowlistForm } from '../../lib/allowlistActions';
import { adminApiFetch, relaySetCookies } from '../../lib/apiClient';
import { isAllowedPostOrigin } from '../../lib/requestSecurity';
import { forbiddenResponse, redirectResponse } from '../../lib/responses';

function locationFor(notice: string): string {
  return `/users?notice=${notice}`;
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAllowedPostOrigin(request)) return forbiddenResponse();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectResponse(locationFor('error'));
  }

  const parsed = parseAddAllowlistForm(formData);
  if (!parsed) return redirectResponse(locationFor('invalid'));

  try {
    const upstream = await adminApiFetch('/api/admin/allowlist', {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ email: parsed.email }),
      cookieHeader: request.headers.get('cookie'),
    });
    const headers = new Headers();
    relaySetCookies(upstream, headers);

    const outcome = noticeForAllowlistResponse(upstream.status, 'add');
    if (outcome === 'login') return redirectResponse('/login', headers);
    return redirectResponse(locationFor(outcome), headers);
  } catch {
    return redirectResponse(locationFor('error'));
  }
};
