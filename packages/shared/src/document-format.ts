// Maps a known document extension to its MIME type. Drives both the storage-key
// suffix and the documents.mime_type column, so the pipeline stops assuming PDF.
const KNOWN: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
};

export interface DocFormat {
  ext: string;
  mime: string;
}

// Derive the file extension + MIME type from a source URL (or bare path/filename).
// Unknown/extension-less inputs fall back to a neutral binary type — callers should
// log that case so a mystery format surfaces instead of silently becoming a .bin blob.
export function deriveDocFormat(sourceUrl: string): DocFormat {
  let path = sourceUrl;
  try {
    path = new URL(sourceUrl).pathname; // strips ?query / #hash for absolute URLs
  } catch {
    path = sourceUrl.split(/[?#]/)[0] ?? sourceUrl; // bare filename/path → strip query/hash manually
  }
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
  const mime = KNOWN[ext];
  return mime ? { ext, mime } : { ext: 'bin', mime: 'application/octet-stream' };
}
