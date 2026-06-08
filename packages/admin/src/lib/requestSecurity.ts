import { ADMIN_PUBLIC_ORIGIN } from '../../config/admin-origin.mjs';

function firstForwardedValue(value: string | null): string | undefined {
  return value?.split(',', 1)[0]?.trim().toLowerCase() || undefined;
}

export function isAllowedPostOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;

  try {
    if (origin === new URL(request.url).origin) return true;

    const forwardedProtocol = firstForwardedValue(request.headers.get('X-Forwarded-Proto'));
    const forwardedHost = firstForwardedValue(
      request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host'),
    );
    const publicUrl = new URL(ADMIN_PUBLIC_ORIGIN);
    return (
      forwardedProtocol === publicUrl.protocol.slice(0, -1) &&
      forwardedHost === publicUrl.host &&
      origin === publicUrl.origin
    );
  } catch {
    return false;
  }
}
