/**
 * An actor is who did or owns something: 'user:<userId>' for a person, 'agent:<agentId>' for an
 * agent ('agent:default' until agents are modeled). Plain strings in one column, so a person and
 * an agent filter the same way. The bare 'user' of the days before users is rewritten once, when the
 * first user appears (users/index.ts), and refused after. The server, never the client, fills it in.
 */
export const userActor = (userId: string) => `user:${userId}`

export const isActor = (value: unknown): value is string =>
  typeof value === 'string' && /^(user:[a-z0-9]{12}|agent:[A-Za-z0-9._-]{1,64})$/.test(value)
