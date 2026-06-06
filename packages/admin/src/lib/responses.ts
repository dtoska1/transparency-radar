export function redirectResponse(location: string, headers = new Headers()): Response {
  headers.set('Location', location);
  return new Response(null, { status: 303, headers });
}

export function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
