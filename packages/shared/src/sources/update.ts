import { z } from 'zod'
import { PermissionsConfigSchema } from '../agent/mode-types.ts'
import { validatePermissionsConfig } from '../agent/permissions-config.ts'
import { splitSourceGuide } from './guide.ts'

const literalMcpPattern = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).refine((value) => !value.startsWith('mcp__'), 'Use an unqualified literal MCP action pattern')
const pattern = z.union([
  literalMcpPattern,
  z.object({ pattern: literalMcpPattern, comment: z.string().max(1000).nullish().transform((value) => value ?? undefined) }).strict(),
])
const apiEndpoint = PermissionsConfigSchema.shape.allowedApiEndpoints.unwrap().element.strict().extend({
  path: z.string().min(1).max(1000).refine((value) => {
    const unescaped = value.replace(/\\/g, '')
    return !/(?:https?|file|ftp)\??:\/\/|^\^?\/\/|[\r\n\u0000]/i.test(unescaped)
  }, 'Use a relative API path pattern, not a URL'),
  comment: z.string().max(1000).nullish().transform((value) => value ?? undefined),
})

export const SourcePermissionsUpdateSchema = PermissionsConfigSchema.pick({ allowedMcpPatterns: true, allowedApiEndpoints: true }).extend({
  allowedMcpPatterns: z.array(pattern).max(200).nullish().transform((value) => value ?? undefined),
  allowedApiEndpoints: z.array(apiEndpoint).max(200).nullish().transform((value) => value ?? undefined),
}).strict().refine((value) => value.allowedMcpPatterns !== undefined || value.allowedApiEndpoints !== undefined, 'Provide a source permission list; [] clears that list').superRefine((value, ctx) => {
  if (validatePermissionsConfig(value).length) ctx.addIssue({ code: 'custom', message: 'Invalid source permission patterns' })
})

export const SourceUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).nullish().transform((value) => value ?? undefined),
  tagline: z.string().max(1000).nullish().transform((value) => value ?? undefined),
  guide: z.string().max(20_000).refine((value) => {
    try {
      const parts = splitSourceGuide(value)
      return !parts.frontmatter && !parts.cache
    } catch { return false }
  }, 'Provide the public guide body, not frontmatter or cache metadata').nullish().transform((value) => value ?? undefined),
  permissions: SourcePermissionsUpdateSchema.nullish().transform((value) => value ?? undefined),
}).strict().refine((value) => value.title !== undefined || value.tagline !== undefined || value.guide !== undefined || value.permissions !== undefined, 'Provide a source field to update')

export type SourceUpdate = z.input<typeof SourceUpdateSchema>
