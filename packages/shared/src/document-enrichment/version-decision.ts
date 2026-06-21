export interface LatestVersion {
  document_id: string;
  id: string;
  version_no: number;
}

export type VersionDecision =
  | { action: 'insert'; versionNo: number }
  | { action: 'reuse'; id: string }
  | { action: 'version'; versionNo: number };

export function resolveVersionDecision(
  latest: LatestVersion | null | undefined,
  documentId: string,
): VersionDecision {
  if (!latest) return { action: 'insert', versionNo: 1 };
  if (latest.document_id === documentId) return { action: 'reuse', id: latest.id };
  return { action: 'version', versionNo: latest.version_no + 1 };
}
