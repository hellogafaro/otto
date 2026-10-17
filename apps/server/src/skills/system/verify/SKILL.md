---
name: verify
description: Use before calling work done or when a result is disputed, to test the real result and report passed, failed and unverified checks.
---

- Check the result people will use, not a draft, a mock or another agent's report.
- Pick the checks that could prove it wrong: replay the original failure, use the real user path, confirm side effects (the row saved, the file written, the message posted).
- Mark each check passed, failed or unverified, with why and how to verify it. Never call an unrun check passed.
- After any further change, rerun the affected checks.
- When a person rejects a result, recheck before answering, fix the actual cause and say what changed. If a skill's steps caused it, propose a fix with skill_update.
