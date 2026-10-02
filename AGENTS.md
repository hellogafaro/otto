# Otto contributor guide

This is a fresh Otto Bun monorepo. Read docs/otto/README.md, plan.md, code-principles.md and relevant research before nontrivial work. The historical Buzz checkout and history live outside this repository; do not restore its toolchain or protocol.

Use Bun, strict TypeScript, Hono/RPC, Zod, PostgreSQL/Drizzle, Better Auth, pg-boss and Pino. Web uses React/Vite/Tailwind/shadcn. Preserve preset bIkg4yR and the generated packages/ui placement. Use Biome and Vitest explicitly under Bun. No pnpm, npm lock, Turbo, contracts framework or empty domain packages.

Every install, generator or package mutation must use this explicit repository working directory and check package.json name is otto first. Secrets live in Infisical: read the secrets skill and use its wrapper before credential operations. Never write secret values to files, messages or logs. Test-only PostgreSQL must use a private disposable data directory and socket, never a shared database.

Keep domain operations cohesive and transports thin. Human task ownership, human-only authorized Done, Conversation participants, private Session context, individual Run attempts, atomic Run/job admission, bounded resources, stale-attempt fencing and explicit uncertain outcomes are required. No compute provider is selected. A worktree or host subprocess is not an isolated computer. No subscription/account fallback.

Run applicable formatting, type, build and integration checks. Tests must bind production seams. Open visible changes in a browser and retain evidence. Report verified, failed and unverified checks honestly. No deployment, remote creation or push without explicit instruction. Commits use git commit -s and require staged-content inspection. Otto/internal work is tracked in repository docs and BB, not Notion.
