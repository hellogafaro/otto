import {
  getSkillFileReference,
  requireArtifactAudience,
} from "@otto/artifacts";
import {
  archiveSkill,
  createSkill,
  exportSkill,
  getSkill,
  getSkillAudience,
  getSkillProposals,
  getSkills,
  importSkill,
  proposeSkillChange,
  resolveSkillProposal,
  setSkillFiles,
  updateSkill,
} from "@otto/skills";
import { Hono } from "hono";
import { z } from "zod";
import { type ApiEnv, recordId, transact } from "./http";
import { body, editToken, id, pageQuery, title, validate } from "./validation";

const visibility = z.enum(["user", "workspace"]);
export const skillsApi = new Hono<ApiEnv>()
  .post(
    "/workspaces/:workspaceId/skills",
    validate(
      "json",
      z
        .object({
          title,
          instructions: body,
          whenToUse: body.optional(),
          projectId: id.optional(),
          visibility: visibility.optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(await transact(c, (ctx) => createSkill(ctx, c.req.valid("json")))),
  )
  .get(
    "/workspaces/:workspaceId/skills",
    validate(
      "query",
      pageQuery
        .extend({
          projectId: id.optional(),
          archived: z
            .enum(["true", "false"])
            .transform((v) => v === "true")
            .optional(),
          query: z.string().max(200).optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => getSkills(ctx, c.req.valid("query")), false),
      ),
  )
  .post(
    "/workspaces/:workspaceId/skills/import",
    validate(
      "json",
      z
        .object({
          skillMd: body,
          projectId: id.optional(),
          visibility: visibility.optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(await transact(c, (ctx) => importSkill(ctx, c.req.valid("json")))),
  )
  .get("/workspaces/:workspaceId/skills/:id", async (c) =>
    c.json(await transact(c, (ctx) => getSkill(ctx, recordId(c)), false)),
  )
  .patch(
    "/workspaces/:workspaceId/skills/:id",
    validate(
      "json",
      z
        .object({
          title: title.optional(),
          instructions: body.optional(),
          whenToUse: body.optional(),
          visibility: visibility.optional(),
          editToken,
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          const skill = await updateSkill(
            ctx,
            recordId(c),
            c.req.valid("json"),
          );
          if (c.req.valid("json").visibility !== undefined) {
            const audience = await getSkillAudience(ctx, skill.id);
            for (const file of skill.supportingFiles)
              await requireArtifactAudience(ctx, file.artifactId, audience);
          }
          return skill;
        }),
      ),
  )
  .post(
    "/workspaces/:workspaceId/skills/:id/archive",
    validate("json", z.object({ archived: z.boolean(), editToken }).strict()),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          archiveSkill(
            ctx,
            recordId(c),
            c.req.valid("json").archived,
            c.req.valid("json").editToken,
          ),
        ),
      ),
  )
  .get("/workspaces/:workspaceId/skills/:id/export", async (c) =>
    c.json(await transact(c, (ctx) => exportSkill(ctx, recordId(c)), false)),
  )
  .put(
    "/workspaces/:workspaceId/skills/:id/files",
    validate(
      "json",
      z
        .object({
          editToken,
          files: z
            .array(
              z.object({ path: z.string().max(240), artifactId: id }).strict(),
            )
            .max(30),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          const skill = await getSkill(ctx, recordId(c), true);
          const audience = await getSkillAudience(ctx, skill.id);
          const files = [];
          for (const file of c.req.valid("json").files)
            files.push({
              path: file.path,
              ...(await getSkillFileReference(
                ctx,
                file.artifactId,
                skill.projectId,
                audience,
              )),
            });
          return setSkillFiles(
            ctx,
            skill.id,
            files,
            c.req.valid("json").editToken,
          );
        }),
      ),
  )
  .post(
    "/workspaces/:workspaceId/skills/:id/proposals",
    validate(
      "json",
      z.object({ title, instructions: body, editToken }).strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          proposeSkillChange(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .get(
    "/workspaces/:workspaceId/skills/:id/proposals",
    validate("query", pageQuery),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getSkillProposals(ctx, recordId(c), c.req.valid("query")),
          false,
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/skills/:id/proposals/:proposalId/resolve",
    validate("json", z.object({ accept: z.boolean() }).strict()),
    async (c) => {
      await transact(c, (ctx) =>
        resolveSkillProposal(
          ctx,
          recordId(c),
          id.parse(c.req.param("proposalId")),
          c.req.valid("json").accept,
        ),
      );
      return c.json({ ok: true });
    },
  );
