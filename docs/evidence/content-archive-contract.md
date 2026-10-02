# Archive access and control regression

The canonical plan (line 226) says archive hides records, preserves access and links, and blocks new launches. Stop and schedule pause remain explicit. The production permission checks therefore must not interpret archive as access revocation.

Before the correction, three transport scenarios failed against the committed content implementation. Posting an authorized message to an archived Conversation returned 409. Capturing a Task in an archived Project returned 403. Most importantly, after HTTP Run admission and Project/Conversation archival, the sponsor's explicit Stop request returned `{error:"forbidden"}` instead of `{stopped:true}`. The reproduction used Better Auth, Hono over an actual Bun HTTP listener, private PostgreSQL and pg-boss.

The correction removes the Conversation archive gate from `createMessage` and the Project archive gate from `getProject`. Membership and writer checks remain. The same scenarios then pass: archiving leaves the queued Run unchanged, explicit Stop interrupts it, an exact admission retry returns the same attempt, message retries return the same saved message, direct reads and restore work, and a viewer still cannot write to the archived Conversation.

Commands:

```sh
bun --bun vitest run tests/content-transport.test.ts -t 'Conversation role|Project defaults|explicit Stop'
bun --bun vitest run
bun run check
bun run typecheck
bun run check:boundaries
bun run build
```

The focused reproduction failed 3 tests before the correction and passed all 3 afterward. The full Vitest suite passed 67 tests in 8 files under Bun (27.60 seconds). Biome, TypeScript, the 14-package boundary check and the existing application build also passed. This fixture exercises queue admission and control; it does not launch a native provider or qualify real compute termination.
