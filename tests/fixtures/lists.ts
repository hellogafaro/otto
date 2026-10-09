import { createApp } from "../../apps/server/src/app";
import { createAuth } from "../../apps/server/src/auth";
import { startQueue } from "../../apps/server/src/queue";
import { createCursorCodec } from "../../packages/db/src";
import {
  createProject,
  upsertProjectMember,
} from "../../packages/projects/src";
import { claimInstallation, inWorkspace } from "../../packages/workspaces/src";
import { members } from "../../packages/workspaces/src/schema";
import { startPostgres } from "../postgres";
import { fixtureStorage } from "./storage";

export const LIST_SECRET = "disposable-list-test-secret-0123456789abcdef";
export type Human = { id: string; cookie: string };
export type Json = Record<string, unknown>;
export const uuid = (n: number, prefix = "00000000-0000-4000-8000") =>
  `${prefix}-${String(n).padStart(12, "0")}`;

/** Real PostgreSQL, Better Auth and the real Hono app over HTTP, with explicit disposable cursor secrets. */
export async function startListHarness(secret = LIST_SECRET) {
  const database = await startPostgres();
  const boss = await startQueue(database.db, database.pool, {
    workers: false,
    install: true,
  });
  const objects = new Map<string, Uint8Array>();
  const storage = fixtureStorage({
    async put(key, bytes) {
      if (!objects.has(key)) objects.set(key, bytes.slice());
    },
    async get(key) {
      const value = objects.get(key);
      if (!value) throw new Error("Missing fixture bytes");
      return value.slice();
    },
  });
  let app: ReturnType<typeof createApp>;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => app.fetch(request),
  });
  const origin = server.url.origin;
  const auth = createAuth(
    database.db,
    crypto.randomUUID() + crypto.randomUUID(),
    origin,
  );
  const options = {
    db: database.db,
    boss,
    auth,
    origin,
    storage,
  };
  app = createApp({ ...options, cursors: createCursorCodec(secret) });
  /** Another server instance over the same database: a restart, a rotated secret, or no cursor secret at all. */
  const instance = (cursorSecret?: string) => {
    const other = createApp({
      ...options,
      ...(cursorSecret ? { cursors: createCursorCodec(cursorSecret) } : {}),
    });
    return (path: string, cookie: string) =>
      other.fetch(
        new Request(`${origin}/api${path}`, { headers: { cookie, origin } }),
      );
  };
  const signup = async (label: string, http = false): Promise<Human> => {
    const body = {
      name: label,
      email: `${label}@lists.test`,
      password: crypto.randomUUID() + crypto.randomUUID(),
    };
    const response = http
      ? await fetch(`${origin}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      : await auth.api.signUpEmail({ body, asResponse: true });
    const cookie = response.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    if (!session) throw new Error("Missing authenticated fixture");
    return { id: session.user.id, cookie };
  };
  const owner = await signup("owner", true);
  const alice = await signup("alice");
  const bob = await signup("bob");
  const outsider = await signup("outsider");
  const workspaceId = (await claimInstallation(database.db, owner.id, "Lists"))
    .id;
  await database.db.insert(members).values(
    [alice, bob].map((human) => ({
      workspaceId,
      userId: human.id,
      role: "contributor" as const,
    })),
  );
  const scope = <T>(
    human: Human,
    work: Parameters<typeof inWorkspace<T>>[3],
    write = true,
  ) => inWorkspace(database.db, workspaceId, { userId: human.id }, work, write);
  /** A Project the whole fixture team belongs to (or only its owner when `shared` is false). */
  const project = async (title: string, shared = true) =>
    scope(owner, async (c) => {
      const created = await createProject(c, { title });
      if (shared)
        for (const human of [alice, bob])
          await upsertProjectMember(c, created.id, human.id, "contributor");
      return created.id;
    });
  const request = (
    path: string,
    init: { cookie?: string; method?: string; json?: unknown } = {},
  ) =>
    fetch(`${origin}/api${path}`, {
      method: init.method ?? "GET",
      headers: {
        cookie: init.cookie ?? owner.cookie,
        origin,
        "content-type": "application/json",
      },
      ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
    });
  const api = async (
    path: string,
    init: { cookie?: string; method?: string; json?: unknown } = {},
  ) => {
    const response = await request(path, init);
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Keep the raw text for assertions on error bodies.
    }
    return { status: response.status, text, body };
  };
  /** Statements the database sees while one piece of work runs (connection-level, including BEGIN/COMMIT). */
  let counted = 0;
  const pool = database.pool as unknown as {
    connect: (...args: unknown[]) => Promise<unknown>;
  };
  const connect = pool.connect.bind(pool);
  pool.connect = (...args: unknown[]) => {
    if (typeof args[0] === "function") return connect(...args);
    return connect(...args).then((client) => {
      const wrapped = client as {
        query: (...args: unknown[]) => unknown;
        counting?: boolean;
      };
      if (!wrapped.counting) {
        wrapped.counting = true;
        const query = wrapped.query.bind(wrapped);
        wrapped.query = (...queryArgs: unknown[]) => {
          counted++;
          return query(...queryArgs);
        };
      }
      return client;
    });
  };
  async function countStatements(work: () => Promise<unknown>) {
    counted = 0;
    await work();
    return counted;
  }
  const base = `/workspaces/${workspaceId}`;
  type Page = { items: Json[]; next: string | number | null };
  /** Follow `next` to the end, keeping every raw response body for leak checks. */
  async function walk(
    path: string,
    params: Record<string, string | number>,
    cookie = owner.cookie,
  ) {
    const bodies: string[] = [];
    const pages: Page[] = [];
    let after: string | undefined;
    for (let guard = 0; guard < 400; guard++) {
      const query = new URLSearchParams(
        Object.entries({ ...params, ...(after ? { after } : {}) }).map(
          ([key, value]) => [key, String(value)],
        ),
      );
      const result = await api(`${path}?${query}`, { cookie });
      if (result.status !== 200)
        throw new Error(
          `GET ${path}?${query} -> ${result.status} ${result.text}`,
        );
      bodies.push(result.text);
      const page = result.body as Page;
      pages.push(page);
      if (page.next === null) break;
      after = String(page.next);
    }
    return {
      pages,
      bodies,
      items: pages.flatMap((page) => page.items),
      ids: pages.flatMap((page) => page.items.map((item) => String(item.id))),
    };
  }
  return {
    database,
    boss,
    origin,
    secret,
    owner,
    alice,
    bob,
    outsider,
    workspaceId,
    base,
    scope,
    project,
    request,
    api,
    walk,
    signup,
    instance,
    countStatements,
    async stop() {
      await server.stop(true);
      await boss.stop();
      await database.stop();
    },
  };
}
export type ListHarness = Awaited<ReturnType<typeof startListHarness>>;
