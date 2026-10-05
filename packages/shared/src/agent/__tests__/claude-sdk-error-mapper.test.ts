import { describe, expect, it } from 'bun:test';
import { mapClaudeSdkAssistantError } from '../claude-sdk-error-mapper.ts';

const baseContext = {
  actualError: null,
  capturedApiError: null,
} as const;

describe('mapClaudeSdkAssistantError', () => {
  it('maps server_error to provider_error', () => {
    const error = mapClaudeSdkAssistantError('server_error', baseContext);

    expect(error.code).toBe('provider_error');
    expect(error.message.toLowerCase()).toContain('provider');
  });

  it('maps unknown + captured 500 to provider_error', () => {
    const error = mapClaudeSdkAssistantError('unknown', {
      ...baseContext,
      capturedApiError: {
        status: 500,
        statusText: 'Internal Server Error',
        message: 'Internal server error',
        timestamp: Date.now(),
      },
    });

    expect(error.code).toBe('provider_error');
    expect(error.details?.some((detail) => detail.includes('Status: 500 Internal Server Error'))).toBe(true);
  });

  it('maps unknown + captured 529 overloaded to provider_error', () => {
    const error = mapClaudeSdkAssistantError('unknown', {
      ...baseContext,
      capturedApiError: {
        status: 529,
        statusText: '',
        message: 'Overloaded',
        timestamp: Date.now(),
      },
    });

    expect(error.code).toBe('provider_error');
    expect(error.details?.some((detail) => detail.includes('Status: 529'))).toBe(true);
  });

  it('keeps unknown network failures as network_error', () => {
    const error = mapClaudeSdkAssistantError('unknown', {
      ...baseContext,
      actualError: {
        errorType: 'error',
        message: 'fetch failed: ECONNREFUSED',
      },
    });

    expect(error.code).toBe('network_error');
    expect(error.message.toLowerCase()).toContain('internet connection');
  });

  describe('invalid_request — context overflow and attachments', () => {
    it('routes generic context_window phrasing to Context Window Exceeded', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        actualError: {
          errorType: 'invalid_request_error',
          message: 'prompt exceeds the context window for this model',
        },
      });

      expect(error.title).toBe('Context Window Exceeded');
      expect(error.details?.some(d => /compact|new session/i.test(d))).toBe(true);
    });

    it('Context Window Exceeded suppresses Retry and offers /compact', () => {
      // Retrying the same payload hits the same wall. The action should be
      // /compact, not Retry — and canRetry must be false so the UI hides
      // the retry button entirely.
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        actualError: {
          errorType: 'invalid_request_error',
          message: 'prompt is too long',
        },
      });

      expect(error.title).toBe('Context Window Exceeded');
      expect(error.canRetry).toBe(false);
      expect(error.actions?.some(a => a.action === 'retry')).toBe(false);
      expect(error.actions?.some(a => a.command === '/compact')).toBe(true);
    });

    it('maps "image input is not available on your tier" to the attachment advice', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'Image input is not available on your tier',
          timestamp: Date.now(),
        },
      });

      // "image" appears in the error → attachment-rejection path fires,
      // which is the correct disambiguation here.
      expect(error.title).toBe('Invalid Request');
      expect(error.details?.some(d => d.toLowerCase().includes('attachments'))).toBe(true);
    });

    it('routes "prompt is too long" to Context Window Exceeded', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        actualError: {
          errorType: 'invalid_request_error',
          message: 'prompt is too long: 250000 tokens > 200000 maximum',
        },
      });

      expect(error.title).toBe('Context Window Exceeded');
    });

    it('shows attachment hints when API explicitly mentions image format', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'image format not supported',
          timestamp: Date.now(),
        },
      });

      expect(error.code).toBe('invalid_request');
      expect(error.title).toBe('Invalid Request');
      expect(error.details?.some(d => d.toLowerCase().includes('attachments'))).toBe(true);
    });

    it('shows attachment hints when the user-sent turn had attachments', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        userTurnHadAttachments: true,
      });

      expect(error.title).toBe('Invalid Request');
      expect(error.details?.some(d => d.toLowerCase().includes('attachments'))).toBe(true);
    });

    it('does NOT show attachment hints for plain-text turns with no attachment signal', () => {
      // This is the poisoned-session case: history grew too large, but the
      // current turn had no attachments and the API gave no detail. Showing
      // "remove attachments" advice misleads the user.
      const error = mapClaudeSdkAssistantError('invalid_request', baseContext);

      expect(error.title).toBe('Invalid Request');
      expect(error.details?.some(d => d.toLowerCase().includes('attachments'))).toBe(false);
      expect(error.details?.some(d => /compact|new session/i.test(d))).toBe(true);
    });

    it('appends a diagnostic pointer when no error detail is available', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', baseContext);

      expect(error.details?.some(d => /main process log/i.test(d))).toBe(true);
    });

    it('falls back to generic invalid_request when no captured/actual error info exists', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', baseContext);

      expect(error.title).toBe('Invalid Request');
    });
  });
});

describe('mapClaudeSdkAssistantError — extended codes not yet in SDK type but returned by backend', () => {
  it('maps verification_required to a non-retryable credentials error pointing at the Console', () => {
    const error = mapClaudeSdkAssistantError('verification_required', baseContext);

    expect(error.code).toBe('invalid_credentials');
    expect(error.title).toBe('Verification Required');
    expect(error.canRetry).toBe(false);
    expect(error.details?.some(d => /console/i.test(d))).toBe(true);
    expect(error.actions.some(a => a.action === 'settings')).toBe(true);
  });

  it('maps cloud_credential_error to a credentials error naming the cloud providers', () => {
    const error = mapClaudeSdkAssistantError('cloud_credential_error', {
      ...baseContext,
      capturedApiError: {
        status: 403,
        statusText: 'Forbidden',
        message: 'The security token included in the request is expired',
        timestamp: Date.now(),
      },
    });

    expect(error.code).toBe('invalid_credentials');
    expect(error.title).toBe('Cloud Credential Error');
    expect(error.canRetry).toBe(false);
    expect(error.details?.some(d => /AWS|Google Cloud|Azure/.test(d))).toBe(true);
    expect(error.details?.some(d => d.includes('Status: 403 Forbidden'))).toBe(true);
  });
});
