const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ALLOWLIST_NOTICES = ['added', 'removed', 'invalid', 'error'] as const;
export type AllowlistNotice = (typeof ALLOWLIST_NOTICES)[number];

const NOTICE_COPY: Record<
  AllowlistNotice,
  { kind: 'success' | 'warning' | 'error'; text: string }
> = {
  added: { kind: 'success', text: 'Email added to the allowlist.' },
  removed: { kind: 'success', text: 'Email removed from the allowlist.' },
  invalid: { kind: 'warning', text: 'Please enter a valid email address.' },
  error: { kind: 'error', text: "That action couldn't be completed. Please try again." },
};

function stringValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' ? value : null;
}

export function parseAddAllowlistForm(formData: FormData): { email: string } | null {
  const raw = stringValue(formData, 'email');
  if (raw === null) return null;

  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 320 || !EMAIL_PATTERN.test(email)) return null;

  return { email };
}

export function parseRemoveAllowlistForm(formData: FormData): { id: string } | null {
  const id = stringValue(formData, 'id');
  if (id === null || !UUID_PATTERN.test(id)) return null;

  return { id };
}

export function noticeForAllowlistResponse(
  status: number,
  kind: 'add' | 'remove',
): AllowlistNotice | 'login' {
  if (status === 200) return kind === 'add' ? 'added' : 'removed';
  if (status === 401) return 'login';
  if (status === 400) return 'invalid';
  return 'error';
}

export function parseAllowlistNotice(
  searchParams: URLSearchParams,
): (typeof NOTICE_COPY)[AllowlistNotice] | null {
  const value = searchParams.get('notice');
  if (!ALLOWLIST_NOTICES.includes(value as AllowlistNotice)) return null;
  return NOTICE_COPY[value as AllowlistNotice];
}
