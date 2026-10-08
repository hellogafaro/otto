import { describe, it, expect } from 'bun:test'
import {
  isCompatProvider,
  toBedrockNativeId,
  fromBedrockNativeId,
  normalizeBedrockModelId,
  deriveBedrockRegionPrefix,
} from '../llm-connections'
import { ANTHROPIC_MODELS, getModelDisplayName, getModelContextWindow, getModelShortName, isClaudeModel, normalizeDeprecatedModelId } from '../models'


describe('isCompatProvider', () => {
  it('returns true for a custom endpoint', () => {
    expect(isCompatProvider('custom')).toBe(true)
  })

  it('returns false for a named provider', () => {
    expect(isCompatProvider('anthropic')).toBe(false)
  })
})

// ============================================================
// Bedrock model ID mapping
// ============================================================

describe('toBedrockNativeId', () => {
  it('maps bare Anthropic IDs to US inference profile IDs', () => {
    expect(toBedrockNativeId('claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('claude-sonnet-4-6')).toBe('us.anthropic.claude-sonnet-4-6')
    expect(toBedrockNativeId('claude-haiku-4-5-20251001')).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0')
  })

  it('keeps Opus 4.7 mapped and selectable', () => {
    expect(toBedrockNativeId('claude-opus-4-7')).toBe('us.anthropic.claude-opus-4-7')
    expect(fromBedrockNativeId('us.anthropic.claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  it('maps Sonnet 5 forward and reverse across regions and base IDs', () => {
    expect(toBedrockNativeId('claude-sonnet-5')).toBe('us.anthropic.claude-sonnet-5')
    expect(toBedrockNativeId('claude-sonnet-5', 'eu')).toBe('eu.anthropic.claude-sonnet-5')
    expect(toBedrockNativeId('anthropic.claude-sonnet-5')).toBe('us.anthropic.claude-sonnet-5')
    expect(fromBedrockNativeId('us.anthropic.claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(fromBedrockNativeId('eu.anthropic.claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(fromBedrockNativeId('global.anthropic.claude-sonnet-5')).toBe('claude-sonnet-5')
  })

  it('normalizes deprecated Opus IDs to Opus 4.8 before mapping, keeping Opus 4.6', () => {
    expect(toBedrockNativeId('claude-opus-4-5-20251101')).toBe('us.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('claude-opus-4-6')).toBe('us.anthropic.claude-opus-4-6-v1')
    expect(toBedrockNativeId('anthropic.claude-opus-4-6-v1')).toBe('us.anthropic.claude-opus-4-6-v1')
    expect(toBedrockNativeId('eu.anthropic.claude-opus-4-6-v1')).toBe('eu.anthropic.claude-opus-4-6-v1')
  })

  it('maps base Bedrock IDs to US inference profile IDs', () => {
    expect(toBedrockNativeId('anthropic.claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('anthropic.claude-sonnet-4-6')).toBe('us.anthropic.claude-sonnet-4-6')
  })

  it('passes through already US-prefixed IDs', () => {
    expect(toBedrockNativeId('us.anthropic.claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
  })

  it('passes through unknown IDs', () => {
    expect(toBedrockNativeId('some-custom-model')).toBe('some-custom-model')
    expect(toBedrockNativeId('gpt-5')).toBe('gpt-5')
  })

  it('maps to EU inference profiles when regionPrefix is eu', () => {
    expect(toBedrockNativeId('claude-opus-4-8', 'eu')).toBe('eu.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('claude-sonnet-4-6', 'eu')).toBe('eu.anthropic.claude-sonnet-4-6')
  })

  it('defaults to US when regionPrefix is omitted or us', () => {
    expect(toBedrockNativeId('claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('claude-opus-4-8', 'us')).toBe('us.anthropic.claude-opus-4-8')
  })

  it('passes through unknown IDs regardless of regionPrefix', () => {
    expect(toBedrockNativeId('some-custom-model', 'eu')).toBe('some-custom-model')
  })
})

describe('deriveBedrockRegionPrefix', () => {
  it('returns us for US regions', () => {
    expect(deriveBedrockRegionPrefix('us-east-1')).toBe('us')
    expect(deriveBedrockRegionPrefix('us-west-2')).toBe('us')
  })

  it('returns eu for EU regions', () => {
    expect(deriveBedrockRegionPrefix('eu-west-1')).toBe('eu')
    expect(deriveBedrockRegionPrefix('eu-central-1')).toBe('eu')
  })

  it('returns us for other regions (fallback)', () => {
    expect(deriveBedrockRegionPrefix('ap-southeast-1')).toBe('us')
    expect(deriveBedrockRegionPrefix('me-south-1')).toBe('us')
  })

  it('returns us when undefined', () => {
    expect(deriveBedrockRegionPrefix(undefined)).toBe('us')
  })
})


describe('fromBedrockNativeId', () => {
  it('maps US inference profile IDs back to bare Anthropic', () => {
    expect(fromBedrockNativeId('us.anthropic.claude-opus-4-8')).toBe('claude-opus-4-8')
    expect(fromBedrockNativeId('us.anthropic.claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    expect(fromBedrockNativeId('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('claude-haiku-4-5-20251001')
  })

  it('maps EU/Global inference profile IDs back to bare', () => {
    expect(fromBedrockNativeId('eu.anthropic.claude-opus-4-8')).toBe('claude-opus-4-8')
    expect(fromBedrockNativeId('global.anthropic.claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('maps base Bedrock IDs back to bare', () => {
    expect(fromBedrockNativeId('anthropic.claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('passes through bare IDs', () => {
    expect(fromBedrockNativeId('claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('maps Opus 4.6 native IDs back to the bare ID', () => {
    expect(fromBedrockNativeId('us.anthropic.claude-opus-4-6-v1')).toBe('claude-opus-4-6')
  })
})

describe('normalizeBedrockModelId', () => {
  it('strips pi/ prefix and maps to US inference profile', () => {
    expect(normalizeBedrockModelId('pi/claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
    expect(normalizeBedrockModelId('pi/claude-sonnet-4-6')).toBe('us.anthropic.claude-sonnet-4-6')
  })

  it('maps bare IDs to US inference profile', () => {
    expect(normalizeBedrockModelId('claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
  })

  it('maps Opus 4.6 IDs to their own native IDs', () => {
    expect(normalizeBedrockModelId('pi/claude-opus-4-6')).toBe('us.anthropic.claude-opus-4-6-v1')
    expect(normalizeBedrockModelId('claude-opus-4-6', 'eu')).toBe('eu.anthropic.claude-opus-4-6-v1')
  })

  it('maps base Bedrock IDs to US inference profile', () => {
    expect(normalizeBedrockModelId('anthropic.claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
  })

  it('is idempotent for already US-prefixed IDs', () => {
    expect(normalizeBedrockModelId('us.anthropic.claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
  })

  it('handles empty/undefined', () => {
    expect(normalizeBedrockModelId(undefined)).toBe('')
    expect(normalizeBedrockModelId('')).toBe('')
  })

  it('respects regionPrefix for EU', () => {
    expect(normalizeBedrockModelId('pi/claude-opus-4-8', 'eu')).toBe('eu.anthropic.claude-opus-4-8')
    expect(normalizeBedrockModelId('claude-sonnet-4-6', 'eu')).toBe('eu.anthropic.claude-sonnet-4-6')
  })
})

// ============================================================
// Bedrock-aware display and lookup
// ============================================================

describe('Bedrock-native model display', () => {
  it('getModelDisplayName resolves US inference profile IDs', () => {
    expect(getModelDisplayName('us.anthropic.claude-opus-4-8')).toBe('Opus 4.8')
    expect(getModelDisplayName('us.anthropic.claude-sonnet-4-6')).toBe('Sonnet 4.6')
    expect(getModelDisplayName('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('Haiku 4.5')
  })

  it('getModelDisplayName resolves EU/base Bedrock IDs', () => {
    expect(getModelDisplayName('eu.anthropic.claude-opus-4-8')).toBe('Opus 4.8')
    expect(getModelDisplayName('anthropic.claude-opus-4-8')).toBe('Opus 4.8')
  })

  it('getModelShortName resolves Bedrock IDs', () => {
    expect(getModelShortName('us.anthropic.claude-opus-4-8')).toBe('Opus')
    expect(getModelShortName('us.anthropic.claude-sonnet-4-6')).toBe('Sonnet')
  })

  it('getModelContextWindow resolves Bedrock IDs', () => {
    expect(getModelContextWindow('us.anthropic.claude-opus-4-8')).toBe(1_000_000)
    expect(getModelContextWindow('us.anthropic.claude-sonnet-4-6')).toBe(200_000)
  })

  it('isClaudeModel recognizes Bedrock IDs', () => {
    expect(isClaudeModel('us.anthropic.claude-opus-4-8')).toBe(true)
    expect(isClaudeModel('anthropic.claude-sonnet-4-6')).toBe(true)
    expect(isClaudeModel('eu.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(true)
  })
})

// ============================================================
// Claude Fable 5 registration (Claude Agent SDK path)
// ============================================================

describe('Claude Fable 5', () => {
  it('is registered as an Anthropic model with the expected metadata', () => {
    const fable = ANTHROPIC_MODELS.find(m => m.id === 'claude-fable-5')
    expect(fable).toBeDefined()
    expect(fable!.provider).toBe('anthropic')
    expect(fable!.name).toBe('Fable 5')
    expect(fable!.shortName).toBe('Fable')
    expect(fable!.contextWindow).toBe(1_000_000)
    expect(fable!.descriptionKey).toBe('model.fableDesc')
  })

  it('resolves display/short name, context window, and Claude detection', () => {
    expect(getModelDisplayName('claude-fable-5')).toBe('Fable 5')
    expect(getModelShortName('claude-fable-5')).toBe('Fable')
    expect(getModelContextWindow('claude-fable-5')).toBe(1_000_000)
    expect(isClaudeModel('claude-fable-5')).toBe(true)
  })

  it('round-trips through the Bedrock inference-profile mapping', () => {
    expect(toBedrockNativeId('claude-fable-5')).toBe('us.anthropic.claude-fable-5')
    expect(toBedrockNativeId('claude-fable-5', 'eu')).toBe('eu.anthropic.claude-fable-5')
    expect(fromBedrockNativeId('us.anthropic.claude-fable-5')).toBe('claude-fable-5')
    expect(fromBedrockNativeId('eu.anthropic.claude-fable-5')).toBe('claude-fable-5')
    expect(fromBedrockNativeId('global.anthropic.claude-fable-5')).toBe('claude-fable-5')
    expect(fromBedrockNativeId('anthropic.claude-fable-5')).toBe('claude-fable-5')
    // Bedrock-native id resolves to display metadata too
    expect(getModelDisplayName('us.anthropic.claude-fable-5')).toBe('Fable 5')
  })
})

// ============================================================
// Claude Fable 5.1 registration (Claude Agent SDK path)
// ============================================================

describe('Claude Fable 5.1', () => {
  it('is registered as an Anthropic model with the expected metadata', () => {
    const fable = ANTHROPIC_MODELS.find(m => m.id === 'claude-fable-5-1')
    expect(fable).toBeDefined()
    expect(fable!.provider).toBe('anthropic')
    expect(fable!.name).toBe('Fable 5.1')
    expect(fable!.shortName).toBe('Fable')
    expect(fable!.contextWindow).toBe(1_000_000)
    expect(fable!.descriptionKey).toBe('model.fableDesc')
  })

  it('is listed before Fable 5 so the newest Fable wins shortName resolution', () => {
    const ids = ANTHROPIC_MODELS.map(m => m.id)
    expect(ids.indexOf('claude-fable-5-1')).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf('claude-fable-5-1')).toBeLessThan(ids.indexOf('claude-fable-5'))
  })

  it('resolves display/short name, context window, and Claude detection', () => {
    expect(getModelDisplayName('claude-fable-5-1')).toBe('Fable 5.1')
    expect(getModelShortName('claude-fable-5-1')).toBe('Fable')
    expect(getModelContextWindow('claude-fable-5-1')).toBe(1_000_000)
    expect(isClaudeModel('claude-fable-5-1')).toBe(true)
  })

  it('round-trips through the Bedrock inference-profile mapping', () => {
    expect(toBedrockNativeId('claude-fable-5-1')).toBe('us.anthropic.claude-fable-5-1')
    expect(toBedrockNativeId('claude-fable-5-1', 'eu')).toBe('eu.anthropic.claude-fable-5-1')
    expect(fromBedrockNativeId('us.anthropic.claude-fable-5-1')).toBe('claude-fable-5-1')
    expect(fromBedrockNativeId('eu.anthropic.claude-fable-5-1')).toBe('claude-fable-5-1')
    expect(fromBedrockNativeId('global.anthropic.claude-fable-5-1')).toBe('claude-fable-5-1')
    expect(fromBedrockNativeId('anthropic.claude-fable-5-1')).toBe('claude-fable-5-1')
    // Bedrock-native id resolves to display metadata too
    expect(getModelDisplayName('us.anthropic.claude-fable-5-1')).toBe('Fable 5.1')
  })

  it('the 5.1 and 5.0 ids never cross-map through the Bedrock tables', () => {
    // Exact-key maps must not let the 'claude-fable-5' prefix swallow 5.1.
    expect(fromBedrockNativeId('us.anthropic.claude-fable-5')).toBe('claude-fable-5')
    expect(toBedrockNativeId('claude-fable-5')).toBe('us.anthropic.claude-fable-5')
  })
})

// ============================================================
// Claude Opus 5.5 (new default) and Opus 5 registration
// ============================================================

describe('Claude Opus 5.5', () => {
  it('is registered as an Anthropic model with the expected metadata', () => {
    const opus = ANTHROPIC_MODELS.find(m => m.id === 'claude-opus-5-5')
    expect(opus).toBeDefined()
    expect(opus!.provider).toBe('anthropic')
    expect(opus!.name).toBe('Opus 5.5')
    expect(opus!.shortName).toBe('Opus')
    expect(opus!.contextWindow).toBe(1_000_000)
    expect(opus!.descriptionKey).toBe('model.opusDesc')
  })

  it('resolves display/short name, context window, and Claude detection', () => {
    expect(getModelDisplayName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(getModelShortName('claude-opus-5-5')).toBe('Opus')
    expect(getModelContextWindow('claude-opus-5-5')).toBe(1_000_000)
    expect(isClaudeModel('claude-opus-5-5')).toBe(true)
  })

  it('round-trips through the Bedrock inference-profile mapping', () => {
    expect(toBedrockNativeId('claude-opus-5-5')).toBe('us.anthropic.claude-opus-5-5')
    expect(toBedrockNativeId('claude-opus-5-5', 'eu')).toBe('eu.anthropic.claude-opus-5-5')
    expect(toBedrockNativeId('anthropic.claude-opus-5-5')).toBe('us.anthropic.claude-opus-5-5')
    expect(fromBedrockNativeId('us.anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(fromBedrockNativeId('eu.anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(fromBedrockNativeId('global.anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(fromBedrockNativeId('anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(normalizeBedrockModelId('pi/claude-opus-5-5', 'eu')).toBe('eu.anthropic.claude-opus-5-5')
    expect(getModelDisplayName('us.anthropic.claude-opus-5-5')).toBe('Opus 5.5')
  })

  it('the 5.5 and 5.0 ids never cross-map through the Bedrock tables', () => {
    expect(fromBedrockNativeId('us.anthropic.claude-opus-5')).toBe('claude-opus-5')
    expect(toBedrockNativeId('claude-opus-5')).toBe('us.anthropic.claude-opus-5')
    expect(toBedrockNativeId('claude-opus-5', 'eu')).toBe('eu.anthropic.claude-opus-5')
    expect(fromBedrockNativeId('global.anthropic.claude-opus-5')).toBe('claude-opus-5')
  })
})

describe('Claude Opus 5', () => {
  it('is registered as the previous Opus generation with 1M context', () => {
    const opus = ANTHROPIC_MODELS.find(m => m.id === 'claude-opus-5')
    expect(opus).toBeDefined()
    expect(opus!.name).toBe('Opus 5')
    expect(opus!.shortName).toBe('Opus')
    expect(opus!.contextWindow).toBe(1_000_000)
    expect(getModelDisplayName('eu.anthropic.claude-opus-5')).toBe('Opus 5')
  })

  it('keeps Opus 4.8 registered and selectable (no forced migration to 5.5)', () => {
    expect(ANTHROPIC_MODELS.some(m => m.id === 'claude-opus-4-8')).toBe(true)
    expect(normalizeDeprecatedModelId('claude-opus-4-8')).toBe('claude-opus-4-8')
    expect(normalizeDeprecatedModelId('claude-opus-5')).toBe('claude-opus-5')
  })
})
