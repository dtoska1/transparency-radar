import { describe, expect, it } from 'vitest';
import { resolveVersionDecision } from './version-decision.js';

describe('resolveVersionDecision', () => {
  it('inserts version 1 when no prior version exists at this slot', () => {
    expect(resolveVersionDecision(null, 'doc-1')).toEqual({ action: 'insert', versionNo: 1 });
  });

  it('reuses the latest version when the document id is unchanged', () => {
    expect(
      resolveVersionDecision({ id: 'v1', document_id: 'doc-1', version_no: 1 }, 'doc-1'),
    ).toEqual({ action: 'reuse', id: 'v1' });
  });

  it('creates a new version when the document id changed (bytes changed at this slot)', () => {
    expect(
      resolveVersionDecision({ id: 'v1', document_id: 'doc-1', version_no: 1 }, 'doc-2'),
    ).toEqual({ action: 'version', versionNo: 2 });
  });
});
