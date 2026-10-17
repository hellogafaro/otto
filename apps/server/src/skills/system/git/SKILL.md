---
name: git
description: Use when working in a git repository on your computer, to branch, commit, describe a change, keep it current or read a diff for review, on any host.
---

Start

- Run `git status --short --branch` and `git remote -v`. On GitHub, also read the github skill. On any other host, use plain git, and that host's own tool only if it is installed and the person asked for it.
- Leave changes you did not make untouched unless the person asks you to include them.
- Branch from a fresh base: `git fetch origin`, then `git switch -c otto/<your-name>/<topic> origin/<default-branch>`. Never commit to the default branch.

Commit

- One logical change per commit. Stage only the files that belong to it, and check `git diff --staged` before each commit.
- Subject: short and imperative, with a prefix: `fix:`, `feat:`, `docs:`, `test:`, `refactor:` or `chore:`. For example `fix: preserve selected filters`.
- Add a body only when it explains an important why, risk, migration or breaking change. End every message with your co-author line from your instructions.
- Never commit secrets, tokens, .env files, private keys or credentials.
- Run the project's own checks (README, contributing guide, package scripts, CI config) before you push. Fix failures at their cause; never weaken, rename or delete a test to make it pass. If a hook fails, fix the cause and commit normally; never skip hooks.

Describe the change (pull request, merge request or patch)

- Read the final diff (`git diff origin/<default-branch>...HEAD`) and `git log --oneline -20` first.
- Title: short and specific, in the same prefix style as the commits.
- Body, from the actual diff and commits:

  ```md
  ## Summary

  - What changed, grouped by theme.

  ## QA

  - Each check you actually ran, and anything you could not verify.

  ## Notes

  - Caveats, screenshots for visible UI, migrations, rollback, or `None`.
  ```

- No commit list, no abandoned approaches, and no invented issue links, reviewers, labels or results.

Keep it current

- Bring in the base by merging: `git fetch origin && git merge origin/<default-branch>`. Rebase only when asked.
- If a push is rejected and you did not rewrite history, you are behind: merge `origin/<branch>` and push again.
- Never use a bare force push. After a rewrite, record the remote head first and push with `git push --force-with-lease=<branch>:<that-sha>`.

Dependent work

- When one change needs another to land first, split it into layers: foundational work at the bottom, code that uses it above, one concern per branch. Branch each layer from the one below it.
- To change a lower layer, switch to its branch, commit there, then merge it into each layer above. Never commit a lower layer's change on a higher branch.

Review a change

- Read the diff with `git diff <base>...HEAD` and the code around it, then follow the review skill.

Limits

- Never push to the default branch, never merge and never enable auto-merge, even when asked. Tell the person to merge.
- Never change git config, rewrite shared history or run a destructive command unless the person asks.
- If the host refuses a push, say why and stop; do not try another route. No access: ask the person for write access. Protected branch: say so.
