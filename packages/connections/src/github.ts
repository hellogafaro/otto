import { sign } from "node:crypto";
import { DomainError, parseInput } from "@otto/shared";

import { z } from "zod";
import { type HttpOptions, readJson, requestHttp } from "./http";
import type { ConnectionConfig, JsonValue } from "./types";

type GithubConfig = Extract<ConnectionConfig, { type: "github" }>;
export interface GithubAccess {
  token: string;
  expiresAt: Date;
  actions: string[];
  resources: string[];
}
export function githubAction(
  config: GithubConfig,
  action: string,
  target: string,
  args: Record<string, JsonValue>,
) {
  if (!config.repositories.some((repository) => repository.name === target))
    throw new DomainError("forbidden");
  switch (action) {
    case "repository.read":
      parseInput(z.object({}).strict(), args);
      return {
        method: "GET",
        path: `/repos/${target}`,
        body: undefined,
        isWrite: false,
      };
    case "issues.read": {
      const parsed = parseInput(
        z
          .object({ state: z.enum(["open", "closed", "all"]).default("open") })
          .strict(),
        args,
      );
      return {
        method: "GET",
        path: `/repos/${target}/issues?per_page=50&state=${parsed.state}`,
        body: undefined,
        isWrite: false,
      };
    }
    case "issues.create": {
      const parsed = parseInput(
        z
          .object({
            title: z.string().min(1).max(256),
            body: z.string().max(16000).optional(),
          })
          .strict(),
        args,
      );
      return {
        method: "POST",
        path: `/repos/${target}/issues`,
        body: JSON.stringify(parsed),
        isWrite: true,
      };
    }
    default:
      throw new DomainError("forbidden");
  }
}
export function createGithubClient(options: {
  endpoint?: string;
  http: HttpOptions;
}) {
  const endpoint = options.endpoint ?? "https://api.github.com";
  const call = (path: string, token: string, method = "GET", body?: string) =>
    requestHttp(
      new URL(path, endpoint),
      {
        method,
        body,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "Content-Type": "application/json",
        },
      },
      options.http,
      readJson,
    );
  return {
    async connect(
      config: GithubConfig,
      privateKey: string,
    ): Promise<GithubAccess> {
      const now = Math.floor(Date.now() / 1000);
      const encode = (data: unknown) =>
        Buffer.from(JSON.stringify(data)).toString("base64url");
      const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: config.appId })}`;
      let signature: string;
      try {
        signature = sign(
          "RSA-SHA256",
          Buffer.from(unsigned),
          privateKey,
        ).toString("base64url");
      } catch {
        throw new DomainError(
          "unavailable",
          "GitHub App credential unavailable",
        );
      }
      const jwt = `${unsigned}.${signature}`;
      const installation = z
        .object({
          id: z.number(),
          account: z.object({ id: z.number() }),
          repository_selection: z.literal("selected"),
        })
        .safeParse(
          await call(`/app/installations/${config.installationId}`, jwt),
        );
      if (
        !installation.success ||
        installation.data.id !== config.installationId ||
        installation.data.account.id !== config.accountId
      )
        throw new DomainError("forbidden", "GitHub installation scope changed");
      const token = z
        .object({
          token: z.string().min(1),
          expires_at: z.iso.datetime(),
          permissions: z.record(z.string(), z.string()),
        })
        .safeParse(
          await call(
            `/app/installations/${config.installationId}/access_tokens`,
            jwt,
            "POST",
            JSON.stringify({
              repository_ids: config.repositories.map(
                (repository) => repository.id,
              ),
              permissions: config.permissions,
            }),
          ),
        );
      if (!token.success) throw new DomainError("unavailable");
      const expiresAt = new Date(token.data.expires_at);
      if (
        expiresAt.getTime() <= Date.now() + 15000 ||
        expiresAt.getTime() > Date.now() + 3_660_000
      )
        throw new DomainError("unavailable", "GitHub credential expired");
      const repositories = z
        .object({
          total_count: z.number().max(50),
          repositories: z
            .array(z.object({ id: z.number(), full_name: z.string() }))
            .max(50),
        })
        .safeParse(
          await call(
            "/installation/repositories?per_page=100",
            token.data.token,
          ),
        );
      if (
        !repositories.success ||
        repositories.data.total_count !==
          repositories.data.repositories.length ||
        repositories.data.repositories.length !== config.repositories.length ||
        config.repositories.some(
          (selected) =>
            !repositories.data.repositories.some(
              (actual) =>
                actual.id === selected.id && actual.full_name === selected.name,
            ),
        )
      )
        throw new DomainError("forbidden", "GitHub repository scope changed");
      const actions = ["repository.read"];
      if (
        config.permissions.issues &&
        ["read", "write"].includes(token.data.permissions.issues ?? "")
      )
        actions.push("issues.read");
      if (
        config.permissions.issues === "write" &&
        token.data.permissions.issues === "write"
      )
        actions.push("issues.create");
      return {
        token: token.data.token,
        expiresAt,
        actions,
        resources: config.repositories.map((repository) => repository.name),
      };
    },
    async execute(
      config: GithubConfig,
      access: GithubAccess,
      action: string,
      target: string,
      args: Record<string, JsonValue>,
    ) {
      const request = githubAction(config, action, target, args);
      if (
        !access.actions.includes(action) ||
        !access.resources.includes(target) ||
        access.expiresAt.getTime() <= Date.now() + 1000
      )
        throw new DomainError("forbidden");
      const value = await call(
        request.path,
        access.token,
        request.method,
        request.body,
      );
      // Shape only the supported product result. Provider response metadata is not an Otto model.
      const issue = z.object({
        number: z.number().int(),
        title: z.string(),
        body: z.string().nullable().optional(),
        html_url: z.url(),
      });
      if (action === "repository.read") {
        const row = z
          .object({
            full_name: z.string(),
            html_url: z.url(),
            description: z.string().nullable(),
          })
          .parse(value);
        return {
          name: row.full_name,
          url: row.html_url,
          description: row.description,
        };
      }
      if (action === "issues.read")
        return z
          .array(issue)
          .max(50)
          .parse(value)
          .map((row) => ({
            number: row.number,
            title: row.title,
            body: row.body ?? null,
            url: row.html_url,
          }));
      const row = issue.parse(value);
      return { number: row.number, title: row.title, url: row.html_url };
    },
  };
}
