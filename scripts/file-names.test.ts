import { expect, test } from 'bun:test'
import { execSync } from 'node:child_process'

// Files and directories are kebab-case. Exempt by convention: all-caps community docs,
// Dockerfile*, Python files, `__tests__`, GitHub templates, locale codes, retina asset names.
const KEBAB = /^[a-z0-9][a-z0-9._-]*$/
const CONVENTIONAL_DOCS = /^(README|AGENTS|CLAUDE|DESIGN|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|TRADEMARK|UPSTREAM|CHANGELOG)\.md$/

function violations(path: string): string[] {
  const segments = path.split('/')
  const name = segments.pop()!
  const bad = segments.filter(
    (dir) => !KEBAB.test(dir) && !dir.startsWith('.') && !['__tests__', 'ISSUE_TEMPLATE', 'Assets'].includes(dir),
  )
  const fileOk =
    KEBAB.test(name) ||
    name.startsWith('.') ||
    CONVENTIONAL_DOCS.test(name) ||
    ['LICENSE', 'NOTICE'].includes(name) ||
    /^Dockerfile(\..+)?$/.test(name) ||
    name.endsWith('.py') ||
    /^[a-z0-9-]+@\dx\.[a-z]+$/.test(name) ||
    (path.includes('/locales/') && /^[a-z]{2,3}(-[A-Za-z]+)?\.json$/.test(name)) ||
    path.startsWith('.github/ISSUE_TEMPLATE/') ||
    path.includes('.icon/Assets/')
  return fileOk ? bad : [...bad, name]
}

test('tracked files and directories are kebab-case', () => {
  const tracked = execSync('git ls-files -z', { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean)
  const offenders = tracked.filter((path) => violations(path).length > 0)
  expect(offenders).toEqual([])
})
