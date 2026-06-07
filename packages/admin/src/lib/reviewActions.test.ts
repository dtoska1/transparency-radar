import { describe, expect, it } from 'vitest';
import {
  buildReviewActionLocation,
  noticeForReviewResponse,
  parseReviewActionForm,
  parseReviewNotice,
} from './reviewActions';

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('review action helpers', () => {
  it('parses an approve action without accepting unrelated status input', () => {
    const parsed = parseReviewActionForm(
      formData({
        action: 'approve',
        vertical: 'vendime',
        id: '051abce1-feb1-4011-8fcf-3968d73fe5d5',
        review_status: 'rejected',
        returnVertical: 'konsultime',
        returnMunicipality: 'shkoder',
        returnOffset: '20',
      }),
    );

    expect(parsed).toEqual({
      filters: { vertical: 'konsultime', municipality: 'shkoder', offset: 20 },
      input: {
        action: 'approve',
        vertical: 'vendime',
        id: '051abce1-feb1-4011-8fcf-3968d73fe5d5',
      },
    });
    expect(parsed.input).not.toHaveProperty('review_status');
  });

  it('trims an optional rejection reason and rejects invalid input', () => {
    expect(
      parseReviewActionForm(
        formData({
          action: 'reject',
          vertical: 'prokurime',
          id: '051abce1-feb1-4011-8fcf-3968d73fe5d5',
          reason: '  Duplicate record  ',
        }),
      ).input,
    ).toEqual({
      action: 'reject',
      vertical: 'prokurime',
      id: '051abce1-feb1-4011-8fcf-3968d73fe5d5',
      reason: 'Duplicate record',
    });

    expect(
      parseReviewActionForm(
        formData({
          action: 'reject',
          vertical: 'prokurime',
          id: 'not-a-uuid',
        }),
      ).input,
    ).toBeNull();
    expect(
      parseReviewActionForm(
        formData({
          action: 'reject',
          vertical: 'prokurime',
          id: '051abce1-feb1-4011-8fcf-3968d73fe5d5',
          reason: 'x'.repeat(501),
        }),
      ).input,
    ).toBeNull();
  });

  it('rebuilds return locations only from validated queue filters', () => {
    const parsed = parseReviewActionForm(
      formData({
        action: 'approve',
        vertical: 'vendime',
        id: '051abce1-feb1-4011-8fcf-3968d73fe5d5',
        returnVertical: 'unknown',
        returnMunicipality: 'tirana',
        returnOffset: '-10',
        returnUrl: 'https://evil.example',
      }),
    );

    expect(buildReviewActionLocation(parsed.filters, 'approved')).toBe(
      '/?municipality=tirana&notice=approved',
    );
  });

  it('maps upstream outcomes without exposing upstream response bodies', () => {
    expect(noticeForReviewResponse(200, 'approve')).toBe('approved');
    expect(noticeForReviewResponse(200, 'reject')).toBe('rejected');
    expect(noticeForReviewResponse(401, 'approve')).toBe('login');
    expect(noticeForReviewResponse(404, 'approve')).toBe('stale');
    expect(noticeForReviewResponse(409, 'reject')).toBe('stale');
    expect(noticeForReviewResponse(400, 'approve')).toBe('error');
    expect(noticeForReviewResponse(503, 'reject')).toBe('error');
  });

  it('accepts only known notice keys', () => {
    expect(parseReviewNotice(new URLSearchParams('notice=approved'))).toEqual({
      kind: 'success',
      text: 'Document approved and published to the public site.',
    });
    expect(parseReviewNotice(new URLSearchParams('notice=raw-api-error'))).toBeNull();
  });
});
