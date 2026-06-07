import {
  type QueueFilters,
  VERTICALS,
  type Vertical,
  buildQueuePageUrl,
  parseQueueFilters,
} from './reviewQueue';

export const REVIEW_ACTIONS = ['approve', 'reject'] as const;
export const REVIEW_NOTICES = ['approved', 'rejected', 'stale', 'error'] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
export type ReviewNotice = (typeof REVIEW_NOTICES)[number];

export interface ReviewActionInput {
  action: ReviewAction;
  vertical: Vertical;
  id: string;
  reason?: string;
}

export interface ParsedReviewActionForm {
  filters: QueueFilters;
  input: ReviewActionInput | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NOTICE_COPY: Record<ReviewNotice, { kind: 'success' | 'warning' | 'error'; text: string }> = {
  approved: {
    kind: 'success',
    text: 'Document approved and published to the public site.',
  },
  rejected: {
    kind: 'success',
    text: 'Document rejected and removed from the pending queue.',
  },
  stale: {
    kind: 'warning',
    text: 'This document is no longer pending. The queue has been refreshed.',
  },
  error: {
    kind: 'error',
    text: "The review action couldn't be completed. Please try again.",
  },
};

function stringValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' ? value : null;
}

function isReviewAction(value: string | null): value is ReviewAction {
  return value !== null && REVIEW_ACTIONS.includes(value as ReviewAction);
}

function isVertical(value: string | null): value is Vertical {
  return value !== null && VERTICALS.includes(value as Vertical);
}

function parseReturnFilters(formData: FormData): QueueFilters {
  const params = new URLSearchParams();
  const vertical = stringValue(formData, 'returnVertical');
  const municipality = stringValue(formData, 'returnMunicipality');
  const offset = stringValue(formData, 'returnOffset');

  if (vertical) params.set('vertical', vertical);
  if (municipality) params.set('municipality', municipality);
  if (offset) params.set('offset', offset);
  return parseQueueFilters(params);
}

export function parseReviewActionForm(formData: FormData): ParsedReviewActionForm {
  const filters = parseReturnFilters(formData);
  const action = stringValue(formData, 'action');
  const vertical = stringValue(formData, 'vertical');
  const id = stringValue(formData, 'id');
  const reasonValue = stringValue(formData, 'reason');
  const reason = reasonValue?.trim() ?? '';

  if (
    !isReviewAction(action) ||
    !isVertical(vertical) ||
    id === null ||
    !UUID_PATTERN.test(id) ||
    reason.length > 500
  ) {
    return { filters, input: null };
  }

  return {
    filters,
    input: {
      action,
      vertical,
      id,
      ...(action === 'reject' && reason ? { reason } : {}),
    },
  };
}

export function buildReviewActionLocation(filters: QueueFilters, notice: ReviewNotice): string {
  const location = new URL(buildQueuePageUrl(filters, filters.offset), 'http://admin.local');
  location.searchParams.set('notice', notice);
  return `${location.pathname}${location.search}`;
}

export function parseReviewNotice(
  searchParams: URLSearchParams,
): (typeof NOTICE_COPY)[ReviewNotice] | null {
  const value = searchParams.get('notice');
  if (!REVIEW_NOTICES.includes(value as ReviewNotice)) return null;
  return NOTICE_COPY[value as ReviewNotice];
}

export function noticeForReviewResponse(
  status: number,
  action: ReviewAction,
): ReviewNotice | 'login' {
  if (status === 200) return action === 'approve' ? 'approved' : 'rejected';
  if (status === 401) return 'login';
  if (status === 404 || status === 409) return 'stale';
  return 'error';
}
