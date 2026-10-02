import {
  type ArtifactStorage,
  readArtifact,
  requireArtifactAudience,
} from "@otto/artifacts";
import type { Database } from "@otto/db";
import { getRunAudience, getRunSkillFile } from "@otto/runs";
import { DomainError } from "@otto/shared";

import { inWorkspace } from "@otto/workspaces";

/** Reads only an accepted immutable reference and rechecks source authorization after storage I/O. */
export async function readRunSkillFile(
  db: Database,
  storage: ArtifactStorage,
  input: {
    workspaceId: string;
    sponsorId: string;
    runId: string;
    documentId: string;
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
          input.documentId,
          input.path,
        );
        const audience = await getRunAudience(c, input.runId);
        await requireArtifactAudience(c, reference.artifactId, audience.humans);
        return reference;
      },
      false,
    );
  const reference = await authorize();
  const bytes = await readArtifact(
    db,
    storage,
    input.workspaceId,
    actor,
    reference.artifactId,
  );
  const current = await authorize();
  if (
    current.artifactId !== reference.artifactId ||
    bytes.length !== reference.byteLength ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
      reference.sha256
  )
    throw new DomainError("conflict", "Accepted skill bytes changed");
  return bytes;
}
