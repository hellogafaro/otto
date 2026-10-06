/**
 * Tests for auth state management: setup needs derivation from auth state
 */
import { describe, it, expect } from 'bun:test';
import { getSetupNeeds, type AuthState } from '../state.ts';

// ============================================
// getSetupNeeds tests (pure function)
// ============================================

describe('getSetupNeeds', () => {
  describe('billing configuration', () => {
    it('should need billing config when type is null', () => {
      const state: AuthState = {
        billing: {
          type: null,
          hasCredentials: false,
          apiKey: null,
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsBillingConfig).toBe(true);
      expect(needs.needsCredentials).toBe(false);
      expect(needs.isFullyConfigured).toBe(false);
    });

    it('should not need billing config when type is set', () => {
      const state: AuthState = {
        billing: {
          type: 'api_key',
          hasCredentials: true,
          apiKey: 'sk-test',
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsBillingConfig).toBe(false);
    });
  });

  describe('credentials', () => {
    it('should need credentials when type is set but hasCredentials is false', () => {
      const state: AuthState = {
        billing: {
          type: 'oauth_token',
          hasCredentials: false,
          apiKey: null,
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsBillingConfig).toBe(false);
      expect(needs.needsCredentials).toBe(true);
      expect(needs.isFullyConfigured).toBe(false);
    });

    it('should not need credentials when hasCredentials is true', () => {
      const state: AuthState = {
        billing: {
          type: 'oauth_token',
          hasCredentials: true,
          apiKey: null,
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsCredentials).toBe(false);
      expect(needs.isFullyConfigured).toBe(true);
    });
  });

  describe('fully configured', () => {
    it('should be fully configured when billing type and credentials are set', () => {
      const state: AuthState = {
        billing: {
          type: 'api_key',
          hasCredentials: true,
          apiKey: 'sk-test',
        },
        workspace: { hasWorkspace: true, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.isFullyConfigured).toBe(true);
      expect(needs.needsBillingConfig).toBe(false);
      expect(needs.needsCredentials).toBe(false);
    });
  });
});
