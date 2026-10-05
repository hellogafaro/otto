import { describe, it, expect } from 'bun:test';
import { isValidEmail } from '../../utils/email.ts';
import { validatePreferencesContent } from '../validators.ts';

describe('isValidEmail', () => {
  it('accepts a basic email shape', () => {
    for (const value of ['ada@example.com', 'a.b+tag@mail.example.co.uk', ' ada@example.com ']) {
      expect(isValidEmail(value)).toBe(true);
    }
  });

  it('rejects anything else, including the empty string', () => {
    for (const value of ['', 'ada', 'ada@', '@example.com', 'ada@example', 'ada@@example.com', 'a da@example.com', 'ada@example..com', 'ada@.com']) {
      expect(isValidEmail(value)).toBe(false);
    }
  });
});

describe('validatePreferencesContent', () => {
  it('accepts a name with a valid email, and a name with no email', () => {
    expect(validatePreferencesContent(JSON.stringify({ name: 'Ada', email: 'ada@example.com' }))).toEqual({ success: true });
    expect(validatePreferencesContent(JSON.stringify({ name: 'Ada' }))).toEqual({ success: true });
  });

  it('allows an empty email (no email set)', () => {
    expect(validatePreferencesContent(JSON.stringify({ name: 'Ada', email: '' }))).toEqual({ success: true });
  });

  it('refuses a malformed email and names the field', () => {
    const result = validatePreferencesContent(JSON.stringify({ email: 'not-an-email' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('email');
  });

  it('keeps fields it does not manage', () => {
    expect(validatePreferencesContent(JSON.stringify({ uiLanguage: 'en', includeCoAuthoredBy: false, diffViewer: { diffStyle: 'split' } }))).toEqual({ success: true });
  });

  it('refuses invalid JSON and non-object content', () => {
    expect(validatePreferencesContent('{').success).toBe(false);
    expect(validatePreferencesContent('"text"').success).toBe(false);
  });
});
