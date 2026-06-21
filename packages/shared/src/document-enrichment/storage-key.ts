export function buildContentAddressedStorageKey(
  municipality: string,
  vertical: string,
  sha256: string,
  ext: string,
): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid sha256 for storage key');
  return `${municipality}/${vertical}/${sha256}.${ext}`;
}
