const CSDG_DOMAIN_SUFFIX = '@csdgalbania.org';

export function isCsdgDomainEmail(email: string): boolean {
  return email.toLowerCase().endsWith(CSDG_DOMAIN_SUFFIX);
}

export function isAllowedAdminEmail(email: string, allowlist: Set<string>): boolean {
  const normalized = email.toLowerCase();
  return isCsdgDomainEmail(normalized) || allowlist.has(normalized);
}
