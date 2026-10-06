import { dirname, join } from 'node:path'
import type { Db } from '../db/index.ts'
import { createBundleStore, type BundleTarget, type SyncStatus } from '../bundles/store.ts'
import type { BundleFiles } from '../bundles/bundle.ts'
import { domainError } from '../utils/errors.ts'
import { skills } from './schema.ts'
import { loadSkill, parseSkillFile } from './storage.ts'
import type { LoadedSkill, Skill } from './types.ts'

/**
 * Skills on rows plus bundles: `createBundleStore` (../bundles/store.ts, which holds the write order and the sync of
 * folder and bucket) with the skills table. A skill is a folder whose SKILL.md has a name and a description in its
 * frontmatter; they are the row's `title` and `description`.
 */

export type SkillsTarget = BundleTarget
export type { SyncStatus }

const toSkill = (row: typeof skills.$inferSelect): Skill => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  description: row.description,
  createdBy: row.createdBy,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
})

function indexSkill(files: BundleFiles) {
  const skillMd = files.get('SKILL.md')
  if (!skillMd) throw domainError('invalid', 'A skill needs a SKILL.md')
  const parsed = parseSkillFile(new TextDecoder().decode(skillMd))
  if (!parsed) throw domainError('invalid', 'SKILL.md needs a name and a description in its frontmatter')
  return { title: parsed.metadata.name, description: parsed.metadata.description }
}

export function createSkillsStore(db: Db, targetFor: (workspaceId: string) => SkillsTarget) {
  const bundles = createBundleStore(db, { noun: 'skill', kind: 'skills', table: skills, mainFile: 'SKILL.md', index: indexSkill, toItem: toSkill }, targetFor)

  return {
    getSkills: bundles.getItems,
    getSkill: bundles.getItem,

    /** The workspace's skills as clients show them: one per row, read from its folder when the folder is there. */
    getLoadedSkills(workspaceId: string): LoadedSkill[] {
      const target = targetFor(workspaceId)
      return bundles.rows(workspaceId).map(
        (row) =>
          loadSkill(dirname(target.dir), row.slug) ?? {
            slug: row.slug,
            metadata: { name: row.title, description: row.description },
            content: '',
            path: join(target.dir, row.slug),
          },
      )
    },

    /** Makes a skill of a whole bundle. `conflict` when the slug is taken. */
    createSkill: bundles.create,
    updateBundle: bundles.update,
    deleteSkill: bundles.delete,
    syncLocalSkill: (workspaceId: string, slug: string) => bundles.syncLocal(workspaceId, slug),
    syncSkills: bundles.sync,
  }
}
