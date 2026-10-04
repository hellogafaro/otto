# Skills and Documents

`@otto/skills` owns reusable instructions, when-to-use text, Agent Skills frontmatter, immutable supporting-file references, import/export and proposed changes. `skills` contains those fields with a human `createdBy`, `user | workspace` visibility and optional Project. Documents retain ordinary bodies, Collections/properties, attachments and their own proposals. There is no shared content base or second stored Agent selection.

Agent selections persist in `agents_skills`, with an `(agentId, skillId)` primary key and workspace-safe Agent/Skill foreign keys. Selection is unordered, hydrated deterministically by ID and replaced atomically with the Agent edit fence. Skills use the existing content edit token for instruction/file edits and stale proposal application. Creators alone edit or apply proposals; eligible humans and selected Agents may read/propose within current Project, visibility and output-audience authority. Archive blocks new selection while authorized accepted attempts retain current reads and explicit controls.

The authenticated `/api/workspaces/:workspaceId/skills` routes own create/get/discovery/update, archive, `/files`, `/import`, `/:id/export` and proposals. Scoped Pi tools are `skill.get`, `skill.proposeChange` and `skill.read`; ordinary `document.get` and `document.proposeChange` only address accepted ordinary Document context. Skill format `allowed-tools` remains data and grants no authority. Internet shares remain the existing explicit selected Document/Chat/Resource publication feature, without a new Skill publication mechanism.

Accepted Run/Session JSON still uses its historical private `skills[].documentId` key for the immutable Skill identity. It is not a public alias: new Skill operations use `skillId`. Instructions, tokens, supporting byte hashes/lengths and retained scope strings are never reconstructed from current records. Materialization uses those accepted instructions/files, checks current source and Resource audience before/after storage I/O, and verifies bytes before compute launch. Missing or revoked identities fail closed.

## Existing populated databases

Fresh pre-MVP development uses native `bun db:push`. Do not approve destructive removal of old Document skill columns on a populated database. Stop Otto, inspect and back up the database, and review [transfer-skills.sql](../scripts/transfer-skills.sql) before executing it explicitly through an authorized operator with transaction-error stopping. No runtime/startup command runs this procedure.

The transfer copies old skill rows and proposals under their exact IDs into Skills, repoints the junction and names it `agents_skills`, removes the old skill rows/columns, and leaves ordinary Documents, queue jobs, accepted Run input/request JSON, private Session rows and retained scope strings untouched. It requires quiescent attempts and released leases. Existing Skills tables, ordinary Document data on skill rows, skill metadata on ordinary rows, public Document selections, ordinary accepted Document context/retained sources, Task links of type `document`, or Collection-property links to a skill refuse transfer. UUID reference matching is case-insensitive; stored reference and accepted-input bytes are not normalized. Such mixed links need a separate operator decision; there is no silent interpretation or automated repair. New supporting-file references retain their existing Resource identities, hashes and lengths.

Private PostgreSQL regression `tests/skills-transfer.test.ts` reconstructs the captured prior storage shape, demonstrates atomic refusal for a mixed Document link, transfers exact IDs/proposals/accepted evidence, then repeats native schema push and checks unchanged evidence. This qualifies that bounded fixture, not a shared/live database conversion. Historical creator/skill and Pi acceptance records remain scoped to their original source; the new split requires its own independent review.

## Complete relation naming inventory

The native public-schema inspection contains 35 tables. Only `agents_skills` is an ID-only structural junction; both entity names are plural. No other pure junction is present.

| Classification | Tables | Retained meaning |
| --- | --- | --- |
| Pure junction | `agents_skills` | Agent/Skill selection only; workspace-safe identity constraints |
| Membership records | `workspace_members`, `project_members` | Authoritative workspace/Project roles and membership transitions |
| Participant records | `chat_participants` | Human-or-Agent identity, role ceiling and creator-managed participation |
| Read state | `chat_reads` | Monotonic reader cursor, not presence of a relationship |
| Delegated authority | `connection_grants` | Resource/action/approval/audience, sponsor, generation and revocation |
| Named private/lifecycle records | `agent_sessions`, `environments`, `connection_operations`, `schedule_history`, `run_activities`, `content_shares`, `task_links`, `document_proposals`, `skill_proposals`, `invitations`, `installation_setups` | Continuing private binding, lease, operation, dedup/outcome, output, selected publication, work link, proposed content, recipient acceptance or installation claim; each has behavior beyond association |
| Domain entities | `workspaces`, `projects`, `tasks`, `chats`, `messages`, `documents`, `collections`, `skills`, `files`, `agents`, `schedules`, `connections`, `subscriptions`, `runs` | Product records with their own content/configuration/state |
| Native Better Auth model | `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications` | Library-owned human identity/authentication conventions |

Native pg-boss `queue.*` tables are outside this 35-table public composition and retain upstream names/construction. Foreign keys on an entity or payload-bearing record do not make it a pure junction. This distinction preserves current membership, participant, cursor and delegated-authority behavior; it does not add new links or rename those records cosmetically.
