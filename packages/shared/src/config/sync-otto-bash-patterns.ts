#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getOttoReadOnlyBashPatterns } from './cli-domains.ts'

interface AllowedBashEntry {
  pattern: string
  comment?: string
}

interface PermissionsConfig {
  version?: string
  allowedBashPatterns?: AllowedBashEntry[]
  [key: string]: unknown
}

function isOttoPattern(entry: AllowedBashEntry): boolean {
  return typeof entry.pattern === 'string' && entry.pattern.startsWith('^otto\\s')
}

function syncOttoPatterns(config: PermissionsConfig): PermissionsConfig {
  const patterns = config.allowedBashPatterns ?? []
  const firstOttoIndex = patterns.findIndex(isOttoPattern)

  const withoutOtto = patterns.filter(entry => !isOttoPattern(entry))
  const generated = getOttoReadOnlyBashPatterns()

  const insertAt = firstOttoIndex >= 0 ? firstOttoIndex : withoutOtto.length
  const nextAllowedBashPatterns = [
    ...withoutOtto.slice(0, insertAt),
    ...generated,
    ...withoutOtto.slice(insertAt),
  ]

  return {
    ...config,
    allowedBashPatterns: nextAllowedBashPatterns,
  }
}

function main() {
  const targetPath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(process.cwd(), 'apps/electron/resources/permissions/default.json')

  const config = JSON.parse(readFileSync(targetPath, 'utf-8')) as PermissionsConfig
  const nextConfig = syncOttoPatterns(config)

  writeFileSync(targetPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf-8')
  process.stdout.write(`Synced otto bash patterns in ${targetPath}\n`)
}

if (import.meta.main) {
  main()
}
