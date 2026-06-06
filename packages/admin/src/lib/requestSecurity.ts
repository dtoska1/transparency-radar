export function isAllowedPostOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;

  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
