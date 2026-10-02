import { type Database, DomainError, required } from "@otto/db";
import { getProject, getProjectAudience } from "@otto/projects";
import { getRunAudience } from "@otto/runs";
import {
  type Actor,
  advanceRevision,
  type Context,
  getWorkspaceAudience,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { artifacts } from "./schema";
import type { ArtifactStorage } from "./storage";

export type { ArtifactStorage } from "./storage";
export async function getArtifact(c: Context, id: string) {
  const row = required(
    (
      await c.tx
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.id, id),
            eq(artifacts.workspaceId, c.workspaceId),
            eq(artifacts.state, "saved"),
          ),
        )
    )[0],
  );
  if (row.projectId) await getProject(c, row.projectId);
  if (
    row.access === "restricted" &&
    (c.actor.agentId !== undefined || row.ownerId !== c.actor.userId)
  )
    throw new DomainError("forbidden");
  if (row.sourceRunId) {
    const audience = await getRunAudience(c, row.sourceRunId);
    if (
      !audience.humans.includes(c.actor.userId) ||
      (c.actor.agentId !== undefined &&
        !audience.agents.includes(c.actor.agentId))
    )
      throw new DomainError(
        "forbidden",
        "Outside the saved source Run audience",
      );
  }
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    labels: row.labels,
    mediaType: row.mediaType,
    byteLength: row.byteLength,
    sha256: row.sha256,
    archived: row.archived,
    sourceRunId: row.sourceRunId,
  };
}
/** Persist upload intent before storage I/O. Pending records remain durable retry work and never appear saved. */
export async function saveArtifact(
  db: Database,
  storage: ArtifactStorage,
  workspaceId: string,
  actor: Actor,
  input: {
    requestId: string;
    title: string;
    kind: string;
    labels?: string[];
    projectId?: string;
    access: "inherited" | "restricted";
    mediaType: string;
    sourceRunId?: string;
  },
  bytes: Uint8Array,
) {
  if (bytes.length > 8 * 1024 * 1024)
    throw new DomainError("invalid", "Artifact too large");
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const intent = await inWorkspace(db, workspaceId, actor, async (c) => {
    requireHuman(c);
    requireWriter(c);
    if (input.projectId) await getProject(c, input.projectId, true);
    await requireSourceAudience(c, input);
    const existing = (
      await c.tx
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.workspaceId, workspaceId),
            eq(artifacts.ownerId, actor.userId),
            eq(artifacts.requestId, input.requestId),
          ),
        )
    )[0];
    if (existing) {
      if (
        existing.sha256 !== sha256 ||
        existing.title !== input.title ||
        existing.kind !== input.kind ||
        existing.mediaType !== input.mediaType ||
        existing.sourceRunId !== (input.sourceRunId ?? null) ||
        existing.access !== input.access ||
        existing.projectId !== (input.projectId ?? null)
      )
        throw new DomainError("conflict");
      return existing;
    }
    return required(
      (
        await c.tx
          .insert(artifacts)
          .values({
            ...input,
            workspaceId,
            ownerId: actor.userId,
            objectKey: `${workspaceId}/${crypto.randomUUID()}`,
            sha256,
            byteLength: bytes.length,
          })
          .returning()
      )[0],
    );
  });
  if (intent.state !== "saved")
    await storage.put(intent.objectKey, bytes, sha256);
  return inWorkspace(db, workspaceId, actor, async (c) => {
    requireWriter(c);
    if (intent.projectId) await getProject(c, intent.projectId, true);
    await requireSourceAudience(c, input);
    await c.tx
      .update(artifacts)
      .set({ state: "saved" })
      .where(eq(artifacts.id, intent.id));
    await advanceRevision(c);
    return getArtifact(c, intent.id);
  });
}
export async function readArtifact(
  db: Database,
  storage: ArtifactStorage,
  workspaceId: string,
  actor: Actor,
  id: string,
) {
  const key = await inWorkspace(
    db,
    workspaceId,
    actor,
    async (c) => {
      await getArtifact(c, id);
      return required(
        (
          await c.tx
            .select({ objectKey: artifacts.objectKey })
            .from(artifacts)
            .where(eq(artifacts.id, id))
        )[0],
      ).objectKey;
    },
    false,
  );
  const bytes = await storage.get(key);
  const artifact = await inWorkspace(
    db,
    workspaceId,
    actor,
    (c) => getArtifact(c, id),
    false,
  );
  if (
    bytes.length !== artifact.byteLength ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
      artifact.sha256
  )
    throw new DomainError(
      "conflict",
      "Stored bytes do not match the saved artifact",
    );
  return bytes;
}

async function requireSourceAudience(
  c: Context,
  input: {
    sourceRunId?: string;
    access: "inherited" | "restricted";
    projectId?: string;
  },
) {
  if (!input.sourceRunId) return;
  const source = await getRunAudience(c, input.sourceRunId);
  const destination =
    input.access === "restricted"
      ? [c.actor.userId]
      : input.projectId
        ? await getProjectAudience(c, input.projectId)
        : await getWorkspaceAudience(c);
  if (destination.some((userId) => !source.humans.includes(userId)))
    throw new DomainError(
      "forbidden",
      "Artifact audience exceeds its source Run",
    );
}
export async function archiveArtifact(
  c: Context,
  id: string,
  archived: boolean,
) {
  requireHuman(c);
  requireWriter(c);
  await getArtifact(c, id);
  const row = required(
    (await c.tx.select().from(artifacts).where(eq(artifacts.id, id)))[0],
  );
  if (row.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  await c.tx.update(artifacts).set({ archived }).where(eq(artifacts.id, id));
  await advanceRevision(c);
}

/** Access-filtered keyset pagination for the workspace library or one authorized Project. */
export async function getArtifacts(
  c: Context,
  filter: {
    projectId?: string;
    after?: string;
    kind?: string;
    label?: string;
    archived?: boolean;
  },
) {
  if (filter.projectId) await getProject(c, filter.projectId);
  const rows = await c.tx
    .select({
      id: artifacts.id,
      title: artifacts.title,
      kind: artifacts.kind,
      labels: artifacts.labels,
      archived: artifacts.archived,
      byteLength: artifacts.byteLength,
      mediaType: artifacts.mediaType,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, c.workspaceId),
        eq(artifacts.state, "saved"),
        eq(artifacts.archived, filter.archived ?? false),
        filter.projectId
          ? eq(artifacts.projectId, filter.projectId)
          : isNull(artifacts.projectId),
        or(
          eq(artifacts.access, "inherited"),
          c.actor.agentId === undefined
            ? eq(artifacts.ownerId, c.actor.userId)
            : undefined,
        ),
        filter.after ? gt(artifacts.id, filter.after) : undefined,
        filter.kind ? eq(artifacts.kind, filter.kind) : undefined,
        filter.label
          ? sql`${artifacts.labels} @> ${JSON.stringify([filter.label])}::jsonb`
          : undefined,
      ),
    )
    .orderBy(artifacts.id)
    .limit(100);
  const items: typeof rows = [];
  for (const row of rows) {
    try {
      // Reuse metadata authorization, including the immutable source-Run cap.
      await getArtifact(c, row.id);
      items.push(row);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "forbidden")
        throw error;
    }
  }
  // Cursor advances over the bounded scanned page, even when access filters it out.
  return { items, next: rows.length === 100 ? rows.at(-1)?.id : null };
}
