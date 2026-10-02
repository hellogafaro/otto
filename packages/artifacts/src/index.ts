import { isDeepStrictEqual } from "node:util";
import { getConversation } from "@otto/conversations";
import type { Database } from "@otto/db";
import {
  getProject,
  getProjectAudience,
  requireProjectMember,
} from "@otto/projects";
import { getRun, getRunAudience } from "@otto/runs";
import {
  DomainError,
  filterPage,
  getPage,
  parsePageOptions,
  required,
} from "@otto/shared";

import {
  type Actor,
  advanceCursor,
  type Context,
  getWorkspaceAudience,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, gt, or, sql } from "drizzle-orm";
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
    row.visibility === "user" &&
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
    projectId: row.projectId,
    creatorAgentId: row.creatorAgentId,
    ownerId: row.ownerId,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    title: row.title,
    type: row.type,
    labels: row.labels,
    mediaType: row.mediaType,
    byteLength: row.byteLength,
    sha256: row.sha256,
    archived: row.archived,
    sourceRunId: row.sourceRunId,
  };
}
/** Persist intent before I/O. Agent publication requires a trusted sponsor/attempt/launch/environment check in both transactions. */
export async function createArtifact(
  db: Database,
  storage: ArtifactStorage,
  workspaceId: string,
  actor: Actor,
  input: {
    requestId: string;
    title: string;
    type: string;
    labels?: string[];
    projectId?: string;
    visibility?: "user" | "workspace";
    mediaType: string;
    sourceRunId?: string;
  },
  bytes: Uint8Array,
  authorizeRun?: (c: Context, sourceRunId: string) => Promise<void>,
) {
  if (bytes.length > 8 * 1024 * 1024)
    throw new DomainError("invalid", "Artifact too large");
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const intent = await inWorkspace(db, workspaceId, actor, async (c) => {
    await authorizeCreation(c);
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
        existing.creatorAgentId !== (actor.agentId ?? null) ||
        existing.sha256 !== sha256 ||
        !isDeepStrictEqual(existing.request, {
          title: input.title,
          type: input.type,
          labels: input.labels ?? [],
          projectId: input.projectId ?? null,
          visibility: input.visibility ?? "user",
          mediaType: input.mediaType,
          sourceRunId: input.sourceRunId ?? null,
        }) ||
        existing.mediaType !== input.mediaType ||
        existing.sourceRunId !== (input.sourceRunId ?? null) ||
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
            visibility: input.visibility ?? "user",
            workspaceId,
            ownerId: actor.userId,
            creatorAgentId: actor.agentId,
            request: {
              title: input.title,
              type: input.type,
              labels: input.labels ?? [],
              projectId: input.projectId ?? null,
              visibility: input.visibility ?? "user",
              mediaType: input.mediaType,
              sourceRunId: input.sourceRunId ?? null,
            },
            objectKey: `${workspaceId}/${crypto.randomUUID()}/${sha256}`,
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
    await authorizeCreation(c);
    if (intent.state !== "saved")
      await c.tx
        .update(artifacts)
        .set({ state: "saved" })
        .where(eq(artifacts.id, intent.id));
    await advanceCursor(c);
    // Receipt uses immutable intent/input only: retries must not reveal later private metadata edits.
    if (actor.agentId)
      return {
        id: intent.id,
        ownerId: intent.ownerId,
        creatorAgentId: intent.creatorAgentId,
        sourceRunId: intent.sourceRunId,
        title: input.title,
        type: input.type,
        labels: input.labels ?? [],
        mediaType: intent.mediaType,
        byteLength: intent.byteLength,
        sha256: intent.sha256,
      };
    return getArtifact(c, intent.id);
  });

  async function authorizeCreation(c: Context) {
    requireWriter(c);
    if (input.projectId) await getProject(c, input.projectId, true);
    if (c.actor.agentId) {
      if (!input.sourceRunId || !authorizeRun)
        throw new DomainError("forbidden");
      const run = await getRun(c, input.sourceRunId);
      if (run.agentId !== c.actor.agentId || run.state !== "running")
        throw new DomainError("forbidden");
      await getConversation(c, run.conversationId, true);
      await authorizeRun(c, input.sourceRunId);
    }
    await requireSourceAudience(c, input);
  }
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
    visibility?: "user" | "workspace";
    projectId?: string;
  },
) {
  if (!input.sourceRunId) return;
  const source = await getRunAudience(c, input.sourceRunId);
  if (c.actor.agentId && !source.agents.includes(c.actor.agentId))
    throw new DomainError("forbidden", "Outside the saved source Run audience");
  const destination =
    (input.visibility ?? "user") === "user"
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
  const row = await getArtifact(c, id);
  if (row.projectId) await getProject(c, row.projectId, true);
  if (row.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  await c.tx.update(artifacts).set({ archived }).where(eq(artifacts.id, id));
  await advanceCursor(c);
}

/** Access-filtered keyset pagination for the workspace library or one authorized Project. */
export async function getArtifacts(
  c: Context,
  filter: {
    projectId?: string;
    after?: string;
    limit?: number;
    type?: string;
    query?: string;
    ownerId?: string;
    label?: string;
    archived?: boolean;
  },
) {
  const { limit } = parsePageOptions(filter);
  if (filter.projectId) await getProject(c, filter.projectId);
  const rows = await c.tx
    .select({
      id: artifacts.id,
      projectId: artifacts.projectId,
      ownerId: artifacts.ownerId,
      creatorAgentId: artifacts.creatorAgentId,
      title: artifacts.title,
      type: artifacts.type,
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
          : undefined,
        or(
          eq(artifacts.visibility, "workspace"),
          c.actor.agentId === undefined
            ? eq(artifacts.ownerId, c.actor.userId)
            : undefined,
        ),
        filter.after ? gt(artifacts.id, filter.after) : undefined,
        filter.type ? eq(artifacts.type, filter.type) : undefined,
        filter.ownerId ? eq(artifacts.ownerId, filter.ownerId) : undefined,
        filter.query
          ? sql`to_tsvector('simple', ${artifacts.title}) @@ plainto_tsquery('simple', ${filter.query})`
          : undefined,
        filter.label
          ? sql`${artifacts.labels} @> ${JSON.stringify([filter.label])}::jsonb`
          : undefined,
      ),
    )
    .orderBy(artifacts.id)
    .limit(limit + 1);
  return filterPage(
    getPage(rows, (row) => row.id, limit),
    async (row) => {
      await getArtifact(c, row.id);
      return row;
    },
  );
}

/** A skill may refer only to immutable bytes readable by its entire effective audience. */
export async function getSkillFileReference(
  c: Context,
  id: string,
  projectId: string | null,
  humans: string[],
) {
  const artifact = await requireArtifactAudience(c, id, humans);
  if (
    artifact.projectId !== projectId ||
    artifact.sourceRunId ||
    artifact.archived
  )
    throw new DomainError("forbidden", "Skill file scope mismatch");
  return {
    artifactId: id,
    sha256: artifact.sha256,
    byteLength: artifact.byteLength,
  };
}
export async function updateArtifact(
  c: Context,
  id: string,
  input: {
    title?: string;
    labels?: string[];
    visibility?: "user" | "workspace";
  },
) {
  requireHuman(c);
  requireWriter(c);
  const artifact = await getArtifact(c, id);
  if (artifact.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  if (artifact.projectId) await getProject(c, artifact.projectId, true);
  if (
    input.title === undefined &&
    input.labels === undefined &&
    input.visibility === undefined
  )
    throw new DomainError("invalid", "No editable fields");
  if (input.visibility !== undefined)
    await requireSourceAudience(c, {
      visibility: input.visibility,
      projectId: artifact.projectId ?? undefined,
      sourceRunId: artifact.sourceRunId ?? undefined,
    });
  await c.tx
    .update(artifacts)
    .set({
      title: input.title,
      labels: input.labels,
      visibility: input.visibility,
    })
    .where(eq(artifacts.id, id));
  await advanceCursor(c);
  return getArtifact(c, id);
}
/** Intentional public selection requires the human owner to pass current and saved source-Run access. */
export async function previewArtifact(c: Context, id: string) {
  requireHuman(c);
  requireWriter(c);
  const metadata = await getArtifact(c, id);
  if (metadata.projectId)
    await requireProjectMember(c, metadata.projectId, c.actor.userId, true);
  if (metadata.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  return {
    title: metadata.title,
    type: metadata.type,
    labels: metadata.labels,
    mediaType: metadata.mediaType,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
  };
}

export async function requireArtifactAudience(
  c: Context,
  id: string,
  humans: string[],
) {
  const artifact = await getArtifact(c, id);
  const members = artifact.projectId
    ? await getProjectAudience(c, artifact.projectId)
    : await getWorkspaceAudience(c);
  const audience =
    artifact.visibility === "user"
      ? members.filter((id) => id === artifact.ownerId)
      : members;
  if (humans.some((id) => !audience.includes(id)))
    throw new DomainError("forbidden", "Attachment audience mismatch");
  if (artifact.sourceRunId) {
    const source = await getRunAudience(c, artifact.sourceRunId);
    if (humans.some((id) => !source.humans.includes(id)))
      throw new DomainError("forbidden");
  }
  return artifact;
}
