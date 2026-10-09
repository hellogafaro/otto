import type { Database } from "@otto/db";
import { type FileStorage, readFile, requireFileAudience } from "@otto/files";
import { getRunAudience, getRunSkillFile } from "@otto/runs";
import {
  type Attempt,
  assertRunAttempt,
  withRunAttempt,
} from "@otto/runs/runtime";
import { validateSchedule } from "@otto/schedules";
import { recordSessionSources } from "@otto/sessions";
import type { NativeSessionStorage } from "@otto/sessions/native";
import { DomainError } from "@otto/shared";
import { getSkill } from "@otto/skills";
import { inWorkspace } from "@otto/workspaces";
import { authorizeRunSources } from "./run-sources";

/** Reads only an accepted immutable reference and rechecks source authorization after storage I/O. */
export async function readRunSkillFile(
  db: Database,
  storage: FileStorage,
  input: {
    workspaceId: string;
    sponsorId: string;
    runId: string;
    skillId: string;
    path: string;
    attempt: Attempt;
    native: NativeSessionStorage;
  },
) {
  const scope = await withRunAttempt(
    db,
    input.attempt,
    async (c, run) => ({
      workspaceId: c.workspaceId,
      sponsorId: run.sponsorId,
      actor: c.actor,
    }),
    validateSchedule,
    input.native,
    authorizeRunSources,
  );
  if (
    input.workspaceId !== scope.workspaceId ||
    input.sponsorId !== scope.sponsorId ||
    input.runId !== input.attempt.runId
  )
    throw new DomainError("forbidden");
  const actor = scope.actor;
  const sourceActor = { userId: scope.sponsorId };
  const authorize = (expected?: Awaited<ReturnType<typeof getRunSkillFile>>) =>
    inWorkspace(
      db,
      input.workspaceId,
      actor,
      async (c) => {
        const run = await assertRunAttempt(
          c,
          input.attempt,
          validateSchedule,
          input.native,
          authorizeRunSources,
        );
        await getSkill(c, input.skillId);
        const reference = await getRunSkillFile(
          c,
          input.runId,
          input.skillId,
          input.path,
        );
        const audience = await getRunAudience(c, input.runId);
        await requireFileAudience(
          { ...c, actor: sourceActor },
          reference.fileId,
          audience.humans,
        );
        if (expected) {
          if (
            reference.fileId !== expected.fileId ||
            reference.sha256 !== expected.sha256 ||
            reference.byteLength !== expected.byteLength
          )
            throw new DomainError("conflict", "Accepted skill bytes changed");
          if (run.sessionId)
            await recordSessionSources(c, run.sessionId, [
              {
                type: "skill-file",
                skillId: input.skillId,
                ...reference,
              },
            ]);
        }
        return reference;
      },
      expected !== undefined,
    );
  const reference = await authorize();
  const bytes = await readFile(
    db,
    storage,
    input.workspaceId,
    sourceActor,
    reference.fileId,
  );
  if (
    bytes.length !== reference.byteLength ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
      reference.sha256
  )
    throw new DomainError("conflict", "Accepted skill bytes changed");
  await authorize(reference);
  return bytes;
}
