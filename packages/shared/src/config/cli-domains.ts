export type CliDomainNamespace = 'label' | 'source' | 'skill' | 'permission' | 'theme'

export interface CliDomainPolicy {
  namespace: CliDomainNamespace
  helpCommand: string
  workspacePathScopes: string[]
  readActions: string[]
  quickExamples: string[]
  /** Optional workspace-relative paths guarded for direct Bash operations */
  bashGuardPaths?: string[]
}

const POLICIES: Record<CliDomainNamespace, CliDomainPolicy> = {
  label: {
    namespace: 'label',
    helpCommand: 'otto label --help',
    workspacePathScopes: ['labels/**'],
    readActions: ['list', 'get', 'auto-rule-list', 'auto-rule-validate'],
    quickExamples: [
      'otto label list',
      'otto label create --name "Bug" --color "accent"',
      'otto label update bug --json \'{"name":"Bug Report"}\'',
    ],
    bashGuardPaths: ['labels/**'],
  },
  source: {
    namespace: 'source',
    helpCommand: 'otto source --help',
    workspacePathScopes: ['sources/**'],
    readActions: ['list', 'get', 'validate', 'test', 'auth-help'],
    quickExamples: [
      'otto source list',
      'otto source get <slug>',
      'otto source update <slug> --json "{...}"',
      'otto source validate <slug>',
    ],
  },
  skill: {
    namespace: 'skill',
    helpCommand: 'otto skill --help',
    workspacePathScopes: ['skills/**'],
    readActions: ['list', 'get', 'validate', 'where'],
    quickExamples: [
      'otto skill list',
      'otto skill get <slug>',
      'otto skill update <slug> --json "{...}"',
      'otto skill validate <slug>',
    ],
  },
  permission: {
    namespace: 'permission',
    helpCommand: 'otto permission --help',
    workspacePathScopes: ['permissions.json', 'sources/*/permissions.json'],
    readActions: ['list', 'get', 'validate'],
    quickExamples: [
      'otto permission list',
      'otto permission get --source linear',
      'otto permission add-mcp-pattern "list" --comment "All list ops" --source linear',
      'otto permission validate',
    ],
    bashGuardPaths: ['permissions.json', 'sources/*/permissions.json'],
  },
  theme: {
    namespace: 'theme',
    helpCommand: 'otto theme --help',
    workspacePathScopes: ['config.json', 'theme.json', 'themes/*.json'],
    readActions: ['get', 'validate', 'list-presets', 'get-preset'],
    quickExamples: [
      'otto theme get',
      'otto theme list-presets',
      'otto theme set-color-theme nord',
      'otto theme set-workspace-color-theme default',
      'otto theme set-override --json "{\"accent\":\"#3b82f6\"}"',
    ],
    bashGuardPaths: ['config.json', 'theme.json', 'themes/*.json'],
  },
}

export const CLI_DOMAIN_POLICIES = POLICIES

export interface CliDomainScopeEntry {
  namespace: CliDomainNamespace
  scope: string
}

function dedupeScopes(scopes: string[]): string[] {
  return [...new Set(scopes)]
}

/**
 * Canonical workspace-relative path scopes owned by otto CLI domains.
 * Use these for file-path ownership checks to avoid drift across call sites.
 */
export const OTTO_CLI_OWNED_WORKSPACE_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.workspacePathScopes)
)

/**
 * Canonical workspace-relative path scopes guarded for direct Bash operations.
 */
export const OTTO_CLI_OWNED_BASH_GUARD_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.bashGuardPaths ?? [])
)

/**
 * Namespace-aware workspace scope entries for otto CLI owned paths.
 */
export const OTTO_CLI_WORKSPACE_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => policy.workspacePathScopes.map(scope => ({ namespace: policy.namespace, scope })))

/**
 * Namespace-aware Bash guard scope entries.
 */
export const OTTO_CLI_BASH_GUARD_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => (policy.bashGuardPaths ?? []).map(scope => ({ namespace: policy.namespace, scope })))

export interface BashPatternRule {
  pattern: string
  comment: string
}

/**
 * Derive the canonical Explore-mode read-only otto bash patterns from
 * CLI domain policies. Keeps permissions regexes aligned with command metadata.
 */
export function getOttoReadOnlyBashPatterns(): BashPatternRule[] {
  const namespaces = Object.keys(POLICIES) as CliDomainNamespace[]
  const namespaceAlternation = namespaces.join('|')

  const rules: BashPatternRule[] = namespaces.map((namespace) => {
    const policy = POLICIES[namespace]
    const actions = policy.readActions.join('|')
    return {
      pattern: `^otto\\s+${namespace}\\s+(${actions})\\b`,
      comment: `otto ${namespace} read-only operations`,
    }
  })

  rules.push(
    { pattern: '^otto\\s*$', comment: 'otto bare invocation (prints help)' },
    { pattern: `^otto\\s+(${namespaceAlternation})\\s*$`, comment: 'otto entity help' },
    { pattern: `^otto\\s+(${namespaceAlternation})\\s+--help\\b`, comment: 'otto entity help flags' },
    { pattern: '^otto\\s+--(help|version|discover)\\b', comment: 'otto global flags' },
  )

  return rules
}

export function getCliDomainPolicy(namespace: CliDomainNamespace): CliDomainPolicy {
  return POLICIES[namespace]
}
