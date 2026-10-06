/**
 * An actor is who did or owns something: 'user' for the person, 'agent:<agentId>' for an
 * agent ('agent:default' until agents are modeled). Plain strings until users exist.
 */
export const isActor = (value: unknown): value is string =>
  typeof value === 'string' && (value === 'user' || /^agent:[A-Za-z0-9._-]{1,64}$/.test(value))
