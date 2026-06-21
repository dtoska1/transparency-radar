import { describe, expect, it } from 'vitest';
import { validateDocumentBytes } from './document-validation.js';

function validPdf(): Buffer {
  return Buffer.from('%PDF-valid fixture', 'utf8');
}

function validDoc(): Buffer {
  return Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
}

function validDocx(): Buffer {
  return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
}

describe('validateDocumentBytes', () => {
  it('accepts a valid PDF magic-byte prefix', () => {
    expect(() => validateDocumentBytes(validPdf(), 'pdf')).not.toThrow();
  });

  it('accepts a valid DOC (OLE) magic-byte prefix', () => {
    expect(() => validateDocumentBytes(validDoc(), 'doc')).not.toThrow();
  });

  it('accepts a valid DOCX (ZIP) magic-byte prefix', () => {
    expect(() => validateDocumentBytes(validDocx(), 'docx')).not.toThrow();
  });

  it('rejects bytes that do not match the claimed extension', () => {
    expect(() => validateDocumentBytes(Buffer.from('not a pdf'), 'pdf')).toThrow(/magic bytes/);
  });

  it('rejects documents larger than 50 MB', () => {
    const oversized = Buffer.concat([validPdf(), Buffer.alloc(51 * 1024 * 1024)]);
    expect(() => validateDocumentBytes(oversized, 'pdf')).toThrow(/50 MB/);
  });
});
