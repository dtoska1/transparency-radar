import { describe, expect, it } from 'vitest';
import { deriveDocFormat } from './document-format.js';

describe('deriveDocFormat', () => {
  it('maps pdf', () => {
    expect(deriveDocFormat('https://x/a.pdf')).toEqual({ ext: 'pdf', mime: 'application/pdf' });
  });

  it('maps doc', () => {
    expect(deriveDocFormat('https://x/a.doc')).toEqual({ ext: 'doc', mime: 'application/msword' });
  });

  it('maps docx', () => {
    expect(deriveDocFormat('https://x/a.docx')).toEqual({
      ext: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('maps zip', () => {
    expect(deriveDocFormat('https://x/a.zip')).toEqual({ ext: 'zip', mime: 'application/zip' });
  });

  it('lowercases uppercase extensions', () => {
    expect(deriveDocFormat('https://x/A.PDF')).toEqual({ ext: 'pdf', mime: 'application/pdf' });
  });

  it('ignores a query string', () => {
    expect(deriveDocFormat('https://x/foo.pdf?v=2')).toEqual({
      ext: 'pdf',
      mime: 'application/pdf',
    });
  });

  it('handles dots before the extension', () => {
    expect(
      deriveDocFormat(
        'https://durres.gov.al/wp-content/uploads/Vendimi-nr.-62-date-11.11.2025.pdf',
      ),
    ).toEqual({ ext: 'pdf', mime: 'application/pdf' });
  });

  it('maps rar', () => {
    expect(deriveDocFormat('https://x/archive.rar')).toEqual({
      ext: 'rar',
      mime: 'application/vnd.rar',
    });
  });

  it('maps 7z', () => {
    expect(deriveDocFormat('https://x/archive.7z')).toEqual({
      ext: '7z',
      mime: 'application/x-7z-compressed',
    });
  });

  it('falls back to bin for no extension', () => {
    expect(deriveDocFormat('https://x/document')).toEqual({
      ext: 'bin',
      mime: 'application/octet-stream',
    });
  });
});
