# Agent output and retained skill access

A new production-domain test reproduced the blocked agent output before the change: `createArtifact` threw `forbidden` from `requireHuman`, despite a matching running Run. The test uses private PostgreSQL with TCP disabled and real pg-boss admission; Run execution state, attempt authorization and object bytes are explicitly controlled fixtures, not native provider or Garage qualification.

The corrected operation requires an agent's source Run, matching running agent, current Conversation writer permission, saved audience and a trusted authorization callback. That callback runs inside both workspace transactions, before storage and before publication. Human ownership stays separate from nullable `creatorAgentId`. A successful agent call returns an immutable creation receipt; ordinary restricted reads remain forbidden and retries reveal neither subsequent human title/label edits nor reader/writer grants.

Five focused scenarios exercise successful creation and duplicate retry; missing callback/source, wrong agent, viewer participant, inactive Run and wider destination audience denial before storage; a changed attempt fence during I/O leaving durable pending intent; participant revocation during I/O preventing publication; and archived skill source access remaining authorized while new selection is denied and source permission revocation still takes effect. The skill test also retains the restricted multi-agent audience denial.

Commands:

```sh
bun --bun vitest run tests/agent-content.test.ts -t 'publishes for the exact agent'
bun --bun vitest run tests/agent-content.test.ts
bun --bun vitest run
bun run check
bun run typecheck
bun run check:boundaries
bun run build
```

The initial focused reproduction failed at the original human-only gate. After the correction, all five focused scenarios passed under Bun. The full suite passed 72 tests in 9 files under Bun. Biome, TypeScript, the 14-package boundary check and build passed; the focused suite passed again after final source cleanup.
