import { describe, it, expect, afterEach } from 'bun:test';
import { isDevRuntime, isDeveloperFeedbackEnabled } from '../feature-flags.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  OTTO_DEBUG: process.env.OTTO_DEBUG,
  OTTO_FEATURE_DEVELOPER_FEEDBACK: process.env.OTTO_FEATURE_DEVELOPER_FEEDBACK,
};

afterEach(() => {
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;

  if (ORIGINAL_ENV.OTTO_DEBUG === undefined) delete process.env.OTTO_DEBUG;
  else process.env.OTTO_DEBUG = ORIGINAL_ENV.OTTO_DEBUG;

  if (ORIGINAL_ENV.OTTO_FEATURE_DEVELOPER_FEEDBACK === undefined) delete process.env.OTTO_FEATURE_DEVELOPER_FEEDBACK;
  else process.env.OTTO_FEATURE_DEVELOPER_FEEDBACK = ORIGINAL_ENV.OTTO_FEATURE_DEVELOPER_FEEDBACK;

});

describe('feature-flags runtime helpers', () => {
  it('isDevRuntime returns true for explicit dev NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.OTTO_DEBUG;

    expect(isDevRuntime()).toBe(true);
  });

  it('isDevRuntime returns true for OTTO_DEBUG override', () => {
    process.env.NODE_ENV = 'production';
    process.env.OTTO_DEBUG = '1';

    expect(isDevRuntime()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled honors explicit override false', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTTO_FEATURE_DEVELOPER_FEEDBACK = '0';

    expect(isDeveloperFeedbackEnabled()).toBe(false);
  });

  it('isDeveloperFeedbackEnabled honors explicit override true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OTTO_DEBUG;
    process.env.OTTO_FEATURE_DEVELOPER_FEEDBACK = '1';

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled falls back to dev runtime when no override', () => {
    process.env.NODE_ENV = 'production';
    process.env.OTTO_DEBUG = '1';
    delete process.env.OTTO_FEATURE_DEVELOPER_FEEDBACK;

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });
});
