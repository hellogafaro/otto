import { describe, it, expect } from 'bun:test'
import {
  parseTestConnectionError,
  validateModelList,
} from '@otto/server-core/domain'
import type { ModelDefinition } from '@otto/shared/config/models'

// ============================================================
// validateModelList
// ============================================================

describe('validateModelList', () => {
  it('accepts a string list with a matching default', () => {
    const result = validateModelList(['model-a', 'model-b', 'model-c'], 'model-b')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts ModelDefinition[] with a matching default', () => {
    const models: ModelDefinition[] = [
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', shortName: 'Sonnet', description: '', provider: 'anthropic', contextWindow: 200000 },
      { id: 'claude-haiku-4-5', name: 'Haiku 4.5', shortName: 'Haiku', description: '', provider: 'anthropic', contextWindow: 200000 },
    ]
    const result = validateModelList(models, 'claude-haiku-4-5')
    expect(result.valid).toBe(true)
  })

  // Regression: Pi ModelDefinition[] with valid default was falsely rejected
  // because the old code used Array.includes() to compare strings against objects
  it('regression: Pi ModelDefinition[] with valid default is accepted', () => {
    const piModels: ModelDefinition[] = [
      { id: 'pi/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', shortName: 'Sonnet', description: '', provider: 'pi', contextWindow: 200000 },
      { id: 'pi/claude-haiku-4-5', name: 'Claude Haiku 4.5', shortName: 'Haiku', description: '', provider: 'pi', contextWindow: 200000 },
    ]
    const result = validateModelList(piModels, 'pi/claude-sonnet-4-6')
    expect(result.valid).toBe(true)
  })

  it('rejects when default model is not in the list', () => {
    const result = validateModelList(['model-a', 'model-b'], 'model-c')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('model-c')
    expect(result.error).toContain('not in the provided model list')
  })

  it('auto-selects first model when default is undefined', () => {
    const result = validateModelList(['first-model', 'second-model'], undefined)
    expect(result.valid).toBe(true)
    expect(result.resolvedDefaultModel).toBe('first-model')
  })

  it('auto-selects first ModelDefinition.id when default is undefined', () => {
    const models: ModelDefinition[] = [
      { id: 'def-first', name: 'First', shortName: 'F', description: '', provider: 'anthropic', contextWindow: 200000 },
    ]
    const result = validateModelList(models, undefined)
    expect(result.valid).toBe(true)
    expect(result.resolvedDefaultModel).toBe('def-first')
  })

  it('returns valid for empty model list', () => {
    const result = validateModelList([], 'anything')
    expect(result.valid).toBe(true)
  })
})

// ============================================================
// parseTestConnectionError
// ============================================================

describe('parseTestConnectionError', () => {
  it('maps ECONNREFUSED to friendly message', () => {
    const result = parseTestConnectionError('connect ECONNREFUSED 127.0.0.1:8080')
    expect(result).toContain('Cannot connect to API server')
  })

  it('maps ENOTFOUND to friendly message', () => {
    const result = parseTestConnectionError('getaddrinfo ENOTFOUND api.example.com')
    expect(result).toContain('Cannot connect to API server')
  })

  it('maps fetch failed to friendly message', () => {
    const result = parseTestConnectionError('TypeError: fetch failed')
    expect(result).toContain('Cannot connect to API server')
  })

  it('maps 401 to invalid API key', () => {
    const result = parseTestConnectionError('Request failed with status 401')
    expect(result).toBe('Invalid API key')
  })

  it('maps unauthorized to invalid API key', () => {
    const result = parseTestConnectionError('Unauthorized access')
    expect(result).toBe('Invalid API key')
  })

  it('maps 404+model to model message', () => {
    const result = parseTestConnectionError('404: model not found')
    expect(result).toContain('Model not found')
  })

  it('maps 404 without model to endpoint message', () => {
    const result = parseTestConnectionError('404 Not Found')
    expect(result).toContain('API endpoint not found')
  })

  it('maps 429 to rate limit', () => {
    const result = parseTestConnectionError('429 Too Many Requests')
    expect(result).toContain('Rate limit')
  })

  it('maps 403 to permission error', () => {
    const result = parseTestConnectionError('403 Forbidden')
    expect(result).toContain('does not have permission')
  })

  it('maps provider mismatch API key errors to actionable guidance', () => {
    const result = parseTestConnectionError('No API key found for huggingface. Use /login or set an API key environment variable.')
    expect(result).toContain('does not match the provider')
  })

  it('passes through unknown errors truncated to 300 chars', () => {
    const longMsg = 'x'.repeat(500)
    const result = parseTestConnectionError(longMsg)
    expect(result.length).toBe(300)
  })

  it('passes through short unknown errors as-is', () => {
    const result = parseTestConnectionError('Something went wrong')
    expect(result).toBe('Something went wrong')
  })
})
