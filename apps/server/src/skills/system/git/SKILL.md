---
name: git
description: Use for any work in a git repository in your computer, from branch to pull request, review fixes and updates.
---

- Your git login and author are set per turn for the person who asked. If git or gh says you are not logged in to GitHub, ask that person to connect GitHub (Customize → Integrations → Yours → Connect GitHub) and stop there.
- Branch from a fresh base: `git fetch origin`, then `git switch -c otto/<your-name>/<topic> origin/<default-branch>`. Never commit to the default branch.
- Commit in small themed steps with clear messages, saying what changed and why in plain words. End every message with your co-author line from your instructions.
- Never commit secrets, tokens, .env files or credentials. Check `git diff --staged` before each commit.
- Run the project's own checks (README, contributing guide, package scripts, CI config) before pushing. Fix failures; never weaken a test to pass.
- Push with `git push -u origin <branch>`. Install gh if it is missing.
- Open the pull request with `gh pr create --assignee @me`:
  - A concise title.
  - A body describing only the shipped behaviour and how you verified it, including anything you could not verify.
  - The pull request belongs to the person who asked. Request other reviewers only when they name them.
- Post the pull request link in the chat or task where the work was asked.
- Update a branch by merging the base in: `git fetch origin && git merge origin/<default-branch>`. Rebase only when asked. Never use a bare force push; when a rewrite is needed, use `git push --force-with-lease=<branch>:<expected-sha>`.
- Read feedback with gh:
  - `gh pr view <n> --comments` for the conversation.
  - `gh api repos/<owner>/<repo>/pulls/<n>/comments` for line comments.
  - `gh pr checks <n>`, then `gh run view <run-id> --log-failed`, for CI.
  - Fix the cause, push, and reply to every review comment with what you changed or why not.
- If the push is refused, say why and stop; do not try another route:
  - no access: ask the person to get write access;
  - the app is not installed on the repo: give them the install link from your instructions;
  - protected branch: say so.
- Never push to the default branch, never merge, and never enable auto-merge, even when asked. Tell the person to merge.
