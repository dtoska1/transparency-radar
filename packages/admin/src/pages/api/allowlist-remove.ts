import type { APIRoute } from 'astro';
import { noticeForAllowlistResponse, parseRemoveAllowlistForm } from '../../lib/allowlistActions';
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

  const parsed = parseRemoveAllowlistForm(formData);
  if (!parsed) return redirectResponse(locationFor('invalid'));

  try {
    const upstream = await adminApiFetch(`/api/admin/allowlist/${parsed.id}`, {
      method: 'DELETE',
      cookieHeader: request.headers.get('cookie'),
    });
    const headers = new Headers();
    relaySetCookies(upstream, headers);

    const outcome = noticeForAllowlistResponse(upstream.status, 'remove');
    if (outcome === 'login') return redirectResponse('/login', headers);
    return redirectResponse(locationFor(outcome), headers);
  } catch {
    return redirectResponse(locationFor('error'));
  }
};
