import { AuthSessionId, type OrchestrationCommand } from "@otto/contracts";
import type { AccountPerson } from "../auth/organization-accounts-runtime.ts";

export interface AuthenticatedCommandActor {
  readonly personId: AuthSessionId;
  readonly displayName: string;
  readonly canManageGroups: boolean;
}

const NON_ACCOUNT_SUBJECTS = new Set(["one-time-token", "desktop-bootstrap"]);

/**
 * The person behind a session. Account sessions all belong to one user, so the user is the
 * person; a paired device without an account stays its own person.
 */
export function sessionPersonId(session: {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
}): AuthSessionId {
  return NON_ACCOUNT_SUBJECTS.has(session.subject)
    ? session.sessionId
    : AuthSessionId.make(session.subject);
}

/**
 * Adding someone to a group names an organization member; the server fills in their name.
 * Returns null when the person is not in the organization.
 */
export function applyKnownGroupPerson(
  command: OrchestrationCommand,
  people: ReadonlyArray<AccountPerson>,
): OrchestrationCommand | null {
  const known = (personId: string) => {
    const person = people.find((candidate) => candidate.userId === personId);

    return person
      ? {
          kind: "person" as const,
          personId: AuthSessionId.make(person.userId),
          displayName: person.displayName,
        }
      : null;
  };

  if (command.type === "group.create" && command.people !== undefined) {
    const added = command.people.map((person) => known(person.personId));

    return added.every((person) => person !== null) ? { ...command, people: added } : null;
  }

  if (command.type !== "group.person.assign") return command;
  const person = known(command.person.personId);

  return person ? { ...command, person } : null;
}

/** Commands whose people must be checked against the organization before dispatch. */
export function commandNamesPeople(command: OrchestrationCommand): boolean {
  return (
    command.type === "group.person.assign" ||
    (command.type === "group.create" && command.people !== undefined)
  );
}

const actorParticipant = (actor: AuthenticatedCommandActor) => ({
  kind: "person" as const,
  personId: actor.personId,
  displayName: actor.displayName,
});

/** Library commands a client sends always act as the signed-in person. */
export const isLibraryClientCommand = (command: OrchestrationCommand) =>
  command.type.startsWith("library.");

export function applyAuthenticatedCommandActor(
  command: OrchestrationCommand,
  actor: AuthenticatedCommandActor,
): OrchestrationCommand {
  switch (command.type) {
    case "group.create":
      return {
        ...command,
        creator: {
          kind: "person",
          personId: actor.personId,
          displayName: actor.displayName,
        },
      };
    case "group.leave":
      return { ...command, personId: actor.personId };
    case "bot.create":
      return { ...command, owner: actorParticipant(actor) };
    case "bot.update":
      return { ...command, by: actorParticipant(actor) };
    case "library.folder.create": {
      const { threadId: _threadId, projectId: _projectId, ...rest } = command;

      return { ...rest, by: actorParticipant(actor) };
    }

    case "library.file.update": {
      const {
        sizeBytes: _sizeBytes,
        share: _share,
        expectedUpdatedAt: _expected,
        ...rest
      } = command;

      return { ...rest, by: actorParticipant(actor) };
    }

    case "library.folder.update":
    case "library.folder.delete":
    case "library.file.delete":
      return { ...command, by: actorParticipant(actor) };
    case "mcp-server.create":
    case "mcp-server.update":
    case "mcp-server.instructions.set":
    case "mcp-server.delete":
    case "mcp-server.enable":
    case "mcp-server.disable":
    case "mcp-server.access.set":
      return { ...command, by: { personId: actor.personId, displayName: actor.displayName } };
    case "thread.create":
      return { ...command, createdBy: actor.personId };
    case "thread.approval.respond":
      return {
        ...command,
        responder: {
          personId: actor.personId,
          displayName: actor.displayName,
          canWrite: actor.canManageGroups,
        },
      };
    case "thread.meta.update":
    case "routine.update":
      return { ...command, by: actor.personId };
    case "thread.turn.start":
      return {
        ...command,
        senderPersonId: actor.personId,
        senderDisplayName: actor.displayName,
        senderCanManageGroups: actor.canManageGroups,
      };
    default:
      return command;
  }
}
