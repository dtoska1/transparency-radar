import type { APIRoute } from 'astro';
import { adminApiFetch, relaySetCookies } from '../../lib/apiClient';
import { isAllowedPostOrigin } from '../../lib/requestSecurity';
import { forbiddenResponse, redirectResponse } from '../../lib/responses';
import {
  buildReviewActionLocation,
  noticeForReviewResponse,
  parseReviewActionForm,
} from '../../lib/reviewActions';

export const POST: APIRoute = async ({ request }) => {
  if (!isAllowedPostOrigin(request)) return forbiddenResponse();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectResponse('/?notice=error');
  }

  const parsed = parseReviewActionForm(formData);
  if (!parsed.input) {
    return redirectResponse(buildReviewActionLocation(parsed.filters, 'error'));
  }

  const { action, vertical, id, reason } = parsed.input;

  try {
    const upstream = await adminApiFetch(`/api/admin/${vertical}/${id}/${action}`, {
      method: 'POST',
      cookieHeader: request.headers.get('cookie'),
      ...(action === 'reject'
        ? {
            contentType: 'application/json',
            body: JSON.stringify(reason ? { reason } : {}),
          }
        : {}),
    });
    const headers = new Headers();
    relaySetCookies(upstream, headers);

    const outcome = noticeForReviewResponse(upstream.status, action);
    if (outcome === 'login') return redirectResponse('/login', headers);
    return redirectResponse(buildReviewActionLocation(parsed.filters, outcome), headers);
  } catch {
    return redirectResponse(buildReviewActionLocation(parsed.filters, 'error'));
  }
};
