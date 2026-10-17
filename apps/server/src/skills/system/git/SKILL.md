---
name: git
description: Use when working in a git repository on your computer, to branch, commit, describe a change, keep it current or read a diff for review, on any host.
---

Start

- Find the host with `git remote -v`. On GitHub, also read the github skill. On any other host, use plain git, and that host's own tool only if it is installed and the person asked for it.
- Branch from a fresh base: `git fetch origin`, then `git switch -c otto/<your-name>/<topic> origin/<default-branch>`. Never commit to the default branch.

Commit

- Commit in small themed steps. Each message says what changed and why in plain words and ends with your co-author line from your instructions.
- Never commit secrets, tokens, .env files or credentials. Check `git diff --staged` before each commit.
- Run the project's own checks (README, contributing guide, package scripts, CI config) before you push. Fix failures at their cause; never weaken, rename or delete a test to make it pass.

Describe the change (pull request, merge request or patch)

- Read the final diff (`git diff origin/<default-branch>...HEAD`) and `git log --oneline -20` first, and match the repository's title style.
- Title: short and specific.
- Body: only the behaviour that ships, grouped by theme, and how you verified it, including anything you could not verify. No commit list, no abandoned approaches, no claim the diff does not support. Scale it to the change; add screenshots for visible UI changes.

Keep it current

- Bring in the base by merging: `git fetch origin && git merge origin/<default-branch>`. Rebase only when asked.
- If a push is rejected and you did not rewrite history, you are behind: merge `origin/<branch>` and push again.
- Never use a bare force push. After a rewrite, record the remote head first and push with `git push --force-with-lease=<branch>:<that-sha>`.

Review a change

- Read the diff with `git diff <base>...HEAD` and the code around it, then follow the review skill.

Limits

- Never push to the default branch, never merge and never enable auto-merge, even when asked. Tell the person to merge.
- If the host refuses a push, say why and stop; do not try another route. No access: ask the person for write access. Protected branch: say so.
