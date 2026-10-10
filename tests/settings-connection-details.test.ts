import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createConnection,
  getConnectionDetails,
  updateConnection,
} from "../packages/connections/src";
import { connections } from "../packages/connections/src/schema";
import { nativeActionInput } from "../packages/runs/src/action-schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, users, workspaces } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

describe("human cached Connection details", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let workspaceId: string;
  let connectionId: string;
  const scope = <T>(
    work: Parameters<typeof inWorkspace<T>>[3],
    userId = "details-owner",
  ) => inWorkspace(database.db, workspaceId, { userId }, work);
  beforeAll(async () => {
    database = await startPostgres();
    await database.db.insert(users).values(
      [
        "details-owner",
        "details-viewer",
        "details-admin",
        "details-foreign",
      ].map((id) => ({
        id,
        name: id,
        email: `${id}@fixture.example.test`,
        emailVerified: false,
      })),
    );
    workspaceId = (
      await claimInstallation(database.db, "details-owner", "Cached details")
    ).id;
    await database.db.insert(members).values([
      { workspaceId, userId: "details-viewer", role: "viewer" },
      { workspaceId, userId: "details-admin", role: "admin" },
    ]);
    connectionId = await scope(async (c) => {
      const connection = await createConnection(c, {
        title: "Saved scope",
        type: "mcp",
        accountRef: "private-account-reference",
        visibility: "workspace",
      });
      await updateConnection(c, connection.id, {
        editToken: connection.editToken,
        credentialRef: "private-credential-reference",
        config: {
          type: "mcp",
          authentication: "none",
          endpoint: "https://docs.example.test/mcp?secret=endpoint-token",
          tools: [{ name: "search", targetArgument: "query", readOnly: true }],
          resources: [
            "Cloudflare Workers serverless platform overview",
            "https://user:password@example.test/docs?token=private-query#private-fragment",
            "https://[malformed.example/path?secret=malformed-token#fragment",
            "https//broken.example/?api_key=another-token",
          ],
        },
      });
      return connection.id;
    });
    await database.db
      .update(connections)
      .set({
        discovery: {
          actions: ["tool.search"],
          resources: [
            "https://example.test/result?key=discovery-token#fragment",
          ],
        },
      })
      .where(eq(connections.id, connectionId));
  });
  afterAll(async () => {
    await database?.stop();
    expect(existsSync(database.directory)).toBe(false);
  });

  it("projects only cached metadata and sanitized configured/discovered scope", async () => {
    const details = await scope((c) => getConnectionDetails(c, connectionId));
    expect(details.observation).toBe("cached");
    expect(details.connected).toBe(false);
    expect(details.scope).toEqual({
      type: "mcp",
      authentication: "none",
      tools: [{ name: "search", targetArgument: "query", readOnly: true }],
      resources: [
        "Cloudflare Workers serverless platform overview",
        "https://example.test/docs",
        "[redacted target]",
        "[redacted target]",
      ],
    });
    expect(details.discovery).toEqual({
      actions: ["tool.search"],
      resources: ["https://example.test/result"],
    });
    const text = JSON.stringify(details);
    for (const secret of [
      "private-account-reference",
      "private-credential-reference",
      "endpoint-token",
      "private-query",
      "private-fragment",
      "malformed-token",
      "another-token",
      "discovery-token",
    ])
      expect(text).not.toContain(secret);
    expect(details).not.toHaveProperty("config");
    expect(details).not.toHaveProperty("endpoint");
    expect(details).not.toHaveProperty("grants");
    const [saved] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.id, connectionId));
    expect(saved?.config?.type === "mcp" && saved.config.endpoint).toContain(
      "endpoint-token",
    );
    expect(saved?.connected).toBe(false);
  });
  it("lets current human viewers inspect workspace rows without mutation authority", async () => {
    expect(
      (
        await scope(
          (c) => getConnectionDetails(c, connectionId),
          "details-viewer",
        )
      ).id,
    ).toBe(connectionId);
    await expect(
      scope(
        (c) => updateConnection(c, connectionId, { title: "Forbidden" }),
        "details-viewer",
      ),
    ).rejects.toThrow();
  });
  it("keeps creator-only private visibility even for admins and rejects model actors", async () => {
    const privateConnection = await scope((c) =>
      createConnection(c, {
        title: "Private",
        type: "mcp",
        accountRef: "private",
        visibility: "user",
      }),
    );
    await expect(
      scope(
        (c) => getConnectionDetails(c, privateConnection.id),
        "details-admin",
      ),
    ).rejects.toThrow();
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: "details-owner", agentId: crypto.randomUUID() },
        (c) => getConnectionDetails(c, connectionId),
        false,
      ),
    ).rejects.toThrow();
  });
  it("rejects foreign workspace identities and revoked members", async () => {
    const [foreign] = await database.db
      .insert(workspaces)
      .values({ title: "Foreign" })
      .returning();
    if (!foreign) throw new Error("Missing fixture workspace");
    await database.db.insert(members).values({
      workspaceId: foreign.id,
      userId: "details-foreign",
      role: "owner",
    });
    await expect(
      inWorkspace(
        database.db,
        foreign.id,
        { userId: "details-foreign" },
        (c) => getConnectionDetails(c, connectionId),
        false,
      ),
    ).rejects.toThrow();
    await database.db
      .delete(members)
      .where(eq(members.userId, "details-admin"));
    await expect(
      scope((c) => getConnectionDetails(c, connectionId), "details-admin"),
    ).rejects.toThrow();
  });
  it("aligns native Skill whenToUse with the existing UTF-8 byte bound without truncation", () => {
    const value = "é".repeat(50000);
    for (const type of ["skill.create", "skill.update"] as const) {
      const input =
        type === "skill.create"
          ? {
              type,
              title: "Skill",
              instructions: "Fixture",
              visibility: "user",
              whenToUse: value,
            }
          : { type, id: crypto.randomUUID(), editToken: 0, whenToUse: value };
      expect(nativeActionInput.parse(input).type).toBe(type);
      expect(
        nativeActionInput.safeParse({ ...input, whenToUse: `${value}é` })
          .success,
      ).toBe(false);
    }
  });
});
