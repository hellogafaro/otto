/**
 * Pure-helper coverage for the model-picker. The helpers are tiny but they
 * back both the desktop dropdown and the compact (drawer) selector — pinning
 * the behavior here so future refactors of the picker can't quietly diverge
 * the two surfaces.
 */

import { describe, test, expect } from 'bun:test'
import type { LlmConnection } from '@otto/shared/config/llm-connections'
import {
  formatTokenCount,
  groupConnectionsByProvider,
  stripPiPrefixForDisplay,
} from '../model-picker-helpers'

// -----------------------------------------------------------------------------
// stripPiPrefixForDisplay
// -----------------------------------------------------------------------------

describe('stripPiPrefixForDisplay', () => {
  test('strips the "pi/" prefix when present', () => {
    expect(stripPiPrefixForDisplay('pi/claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  test('returns input unchanged when prefix is absent', () => {
    expect(stripPiPrefixForDisplay('claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  test('does NOT strip "pi:" (legacy other-form prefix)', () => {
    // The prefix is "pi/" — the alternative "pi:" form is intentionally not
    // collapsed because some IDs use a colon for unrelated purposes.
    expect(stripPiPrefixForDisplay('pi:claude-opus-4-7')).toBe('pi:claude-opus-4-7')
  })

  test('only strips at the start, not mid-string', () => {
    expect(stripPiPrefixForDisplay('foo-pi/bar')).toBe('foo-pi/bar')
  })

  test('handles empty string', () => {
    expect(stripPiPrefixForDisplay('')).toBe('')
  })
})

// -----------------------------------------------------------------------------
// formatTokenCount
// -----------------------------------------------------------------------------

describe('formatTokenCount', () => {
  test('renders zero as "0"', () => {
    expect(formatTokenCount(0)).toBe('0')
  })

  test('renders < 1k literally', () => {
    expect(formatTokenCount(42)).toBe('42')
    expect(formatTokenCount(999)).toBe('999')
  })

  test('renders 1k..<10k with one decimal', () => {
    expect(formatTokenCount(1000)).toBe('1.0k')
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(9999)).toBe('10.0k')
  })

  test('renders ≥ 10k as whole-k', () => {
    expect(formatTokenCount(10_000)).toBe('10k')
    expect(formatTokenCount(200_000)).toBe('200k')
    expect(formatTokenCount(999_999)).toBe('1000k')
  })

  test('renders ≥ 1M with one decimal', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
    expect(formatTokenCount(12_345_678)).toBe('12.3M')
  })
})

// -----------------------------------------------------------------------------
// groupConnectionsByProvider
// -----------------------------------------------------------------------------

function conn(
  slug: string,
  type: string,
  extras: Partial<LlmConnection> = {},
): LlmConnection {
  return {
    slug,
    name: slug,
    type,
    authType: 'api_key',
    createdAt: 0,
    ...extras,
  }
}

describe('groupConnectionsByProvider', () => {
  test('returns empty array for empty input', () => {
    expect(groupConnectionsByProvider([])).toEqual([])
  })

  test('groups Anthropic API keys and Claude subscriptions into "anthropic"', () => {
    const a = conn('a', 'anthropic')
    const b = conn('b', 'claude-code', { authType: 'cli_login' })
    const result = groupConnectionsByProvider([a, b])
    expect(result).toEqual([['anthropic', [a, b]]])
  })

  test('preserves intra-group order', () => {
    const a = conn('first', 'anthropic')
    const b = conn('second', 'anthropic')
    const c = conn('third', 'anthropic')
    const result = groupConnectionsByProvider([a, b, c])
    expect(result[0][1].map(c => c.slug)).toEqual(['first', 'second', 'third'])
  })

  test('places "anthropic" before the other groups (display order)', () => {
    const other = conn('or-1', 'openrouter')
    const anth = conn('anthropic-1', 'anthropic')
    const result = groupConnectionsByProvider([other, anth])
    expect(result.map(([k]) => k)).toEqual(['anthropic', 'other'])
  })

  test('a custom endpoint with a localhost baseUrl goes to "local"', () => {
    const local = conn('ollama', 'custom', { baseUrl: 'http://localhost:11434' })
    const result = groupConnectionsByProvider([local])
    expect(result).toEqual([['local', [local]]])
  })

  test('a custom endpoint with a remote baseUrl goes to "other"', () => {
    const remote = conn('proxy', 'custom', { baseUrl: 'https://proxy.example.com/v1' })
    const result = groupConnectionsByProvider([remote])
    expect(result).toEqual([['other', [remote]]])
  })

  test('drops empty groups from the output', () => {
    const a = conn('a', 'anthropic')
    const result = groupConnectionsByProvider([a])
    expect(result.length).toBe(1)
    expect(result[0][0]).toBe('anthropic')
  })

  test('full mixed input — anthropic + local + remote custom + provider', () => {
    const anth = conn('a', 'anthropic')
    const local = conn('ollama', 'custom', { baseUrl: 'http://127.0.0.1:1234' })
    const remote = conn('proxy', 'custom', { baseUrl: 'https://proxy.example.com' })
    const other = conn('p', 'openrouter')
    const result = groupConnectionsByProvider([anth, local, remote, other])
    expect(result.map(([k, conns]) => [k, conns.map(c => c.slug)])).toEqual([
      ['anthropic', ['a']],
      ['local', ['ollama']],
      ['other', ['proxy', 'p']],
    ])
  })
})
