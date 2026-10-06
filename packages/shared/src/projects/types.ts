/** What callers (including the renderer) see of projects; no database imports here. */

export type ProjectStatus = 'active' | 'archived' | 'deleted'
export type ProjectErrorCode = 'not_found' | 'conflict' | 'invalid'
export type MemberRole = 'contributor' | 'viewer'

export type ResourceType = 'url' | 'library' | 'chat'

/** A link from a project or task to something else. `ref` is the URL, a library item id or a chat id; it may dangle. */
export type Resource = { type: ResourceType; title: string; ref: string }

/** Timestamps are epoch milliseconds so a project survives JSON as is. */
export type Project = {
  id: string
  title: string
  description: string
  status: ProjectStatus
  resources: Resource[]
  createdAt: number
  updatedAt: number
}

/** `actor` is 'user' or 'agent:<id>'. */
export type ProjectMember = { actor: string; role: MemberRole }

/** `status`: left out means active only; ask for 'archived' or 'deleted' explicitly. */
export type ProjectFilter = { status?: ProjectStatus | ProjectStatus[] }

/** `expectedUpdatedAt` is the `updatedAt` the caller last saw; a different stored value is a `conflict`. */
export type ProjectUpdate = { title?: string; description?: string; resources?: Resource[]; expectedUpdatedAt?: number }

/** What the agent prompt gets of the project a chat is bound to. */
export type ProjectPromptContext = Pick<Project, 'title' | 'description' | 'resources'>
