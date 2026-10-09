import type { Database } from "@otto/db";
import { type FileStorage, readFile, requireFileAudience } from "@otto/files";
import { getRunAudience, getRunSkillFile } from "@otto/runs";
import { DomainError } from "@otto/shared";

import { inWorkspace } from "@otto/workspaces";

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
  },
) {
  const actor = { userId: input.sponsorId };
  const authorize = () =>
    inWorkspace(
      db,
      input.workspaceId,
      actor,
      async (c) => {
        const reference = await getRunSkillFile(
          c,
          input.runId,
          input.skillId,
          input.path,
        );
        const audience = await getRunAudience(c, input.runId);
        await requireFileAudience(c, reference.fileId, audience.humans);
        return reference;
      },
      false,
    );
  const reference = await authorize();
  const bytes = await readFile(
    db,
    storage,
    input.workspaceId,
    actor,
    reference.fileId,
  );
  const current = await authorize();
  if (
    current.fileId !== reference.fileId ||
    bytes.length !== reference.byteLength ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
      reference.sha256
  )
    throw new DomainError("conflict", "Accepted skill bytes changed");
  return bytes;
}
