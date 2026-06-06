import type { APIRoute } from 'astro';
import { adminApiFetch, relaySetCookies } from '../../lib/apiClient';
import { isAllowedPostOrigin } from '../../lib/requestSecurity';
import { forbiddenResponse, redirectResponse } from '../../lib/responses';

const LOGIN_ERROR_LOCATION = '/login?error=1';

export const POST: APIRoute = async ({ request }) => {
  if (!isAllowedPostOrigin(request)) return forbiddenResponse();

  let email: FormDataEntryValue | null;
  let password: FormDataEntryValue | null;
  try {
    const formData = await request.formData();
    email = formData.get('email');
    password = formData.get('password');
  } catch {
    return redirectResponse(LOGIN_ERROR_LOCATION);
  }

  if (typeof email !== 'string' || typeof password !== 'string') {
    return redirectResponse(LOGIN_ERROR_LOCATION);
  }

  try {
    const upstream = await adminApiFetch('/api/admin/auth/login', {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ email, password }),
    });

    if (!upstream.ok) return redirectResponse(LOGIN_ERROR_LOCATION);

    const headers = new Headers();
    relaySetCookies(upstream, headers);
    return redirectResponse('/', headers);
  } catch {
    return redirectResponse(LOGIN_ERROR_LOCATION);
  }
};
