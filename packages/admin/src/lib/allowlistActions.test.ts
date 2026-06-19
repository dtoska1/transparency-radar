import { describe, expect, it } from 'vitest';
import {
  noticeForAllowlistResponse,
  parseAddAllowlistForm,
  parseAllowlistNotice,
  parseRemoveAllowlistForm,
} from './allowlistActions';

function formDataOf(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe('parseAddAllowlistForm', () => {
  it('trims and lowercases a valid email', () => {
    expect(parseAddAllowlistForm(formDataOf({ email: '  External-Dev@Gmail.com  ' }))).toEqual({
      email: 'external-dev@gmail.com',
    });
  });

  it('rejects a missing email field', () => {
    expect(parseAddAllowlistForm(formDataOf({}))).toBeNull();
  });

  it('rejects a value without an @', () => {
    expect(parseAddAllowlistForm(formDataOf({ email: 'not-an-email' }))).toBeNull();
  });

  it('rejects an overlong email', () => {
    expect(parseAddAllowlistForm(formDataOf({ email: `${'a'.repeat(315)}@gmail.com` }))).toBeNull();
  });
});

describe('parseRemoveAllowlistForm', () => {
  it('accepts a valid uuid', () => {
    expect(
      parseRemoveAllowlistForm(formDataOf({ id: '11111111-1111-4111-8111-111111111111' })),
    ).toEqual({ id: '11111111-1111-4111-8111-111111111111' });
  });

  it('rejects a non-uuid id', () => {
    expect(parseRemoveAllowlistForm(formDataOf({ id: 'not-a-uuid' }))).toBeNull();
  });
});

describe('noticeForAllowlistResponse', () => {
  it('maps 200 to added for add and removed for remove', () => {
    expect(noticeForAllowlistResponse(200, 'add')).toBe('added');
    expect(noticeForAllowlistResponse(200, 'remove')).toBe('removed');
  });

  it('maps 401 to login', () => {
    expect(noticeForAllowlistResponse(401, 'add')).toBe('login');
  });

  it('maps 400 to invalid', () => {
    expect(noticeForAllowlistResponse(400, 'add')).toBe('invalid');
  });

  it('maps other statuses to error', () => {
    expect(noticeForAllowlistResponse(500, 'remove')).toBe('error');
  });
});

describe('parseAllowlistNotice', () => {
  it('returns copy for a known notice', () => {
    expect(parseAllowlistNotice(new URLSearchParams('notice=added'))).toMatchObject({
      kind: 'success',
    });
  });

  it('returns null for an unknown or missing notice', () => {
    expect(parseAllowlistNotice(new URLSearchParams())).toBeNull();
    expect(parseAllowlistNotice(new URLSearchParams('notice=bogus'))).toBeNull();
  });
});
