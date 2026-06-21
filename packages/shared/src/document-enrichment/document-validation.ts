export type AllowedDocumentExt = 'pdf' | 'doc' | 'docx';

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

function hasPrefix(bytes: Buffer, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

export function validateDocumentBytes(bytes: Buffer, ext: AllowedDocumentExt): void {
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error('Document exceeds max size of 50 MB');
  }

  if (ext === 'pdf' && hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return;
  if (ext === 'doc' && hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return;
  if (
    ext === 'docx' &&
    (hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
      hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
      hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08]))
  ) {
    return;
  }

  throw new Error(`Document magic bytes do not match .${ext}`);
}
