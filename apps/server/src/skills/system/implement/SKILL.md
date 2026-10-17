---
name: implement
description: Use for authorized code changes, such as features, confirmed bug fixes, refactors and performance work, shipped as a pull request.
---

- Read the repo's instructions and the code on the affected path first. Follow its conventions.
- Make the smallest change that does the job. Reuse what the codebase, platform or installed dependencies already do.
- Bug: reproduce it, add a test that fails for that reason, fix it. Refactor: no behavior change. Performance: measure before and after the same way.
- Run the project's checks. Fix failures; never weaken or delete a test to pass.

- Ship it with the git skill: branch, commits, checks, pull request and link.
