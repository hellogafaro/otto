---
name: github
description: Use with the git skill when the repository is on GitHub, to push, open a pull request, read checks and reviews, and reply, all with gh.
---

- Your git and gh login are set per turn for the person who asked, so commits and pull requests are theirs. If git or gh says you are not logged in, ask that person to connect GitHub in Settings → Integrations and stop there.
- gh comes installed with your login. Use it for GitHub work instead of calling the GitHub API by hand; install it only if it is still missing.
- Run every gh command without prompts: pass `--title` and `--body-file` instead of opening an editor, and read with `--json` when you need to parse the result.
- Before pushing to an existing pull request, check `gh pr view <n> --json state`. A merged or closed pull request is final: never push to it or reopen it; start a new branch and pull request instead.
- Push with `git push -u origin <branch>`.
- Open the pull request with `gh pr create --assignee @me --title "<title>" --body-file <file>`, written as the git skill describes. Open it as a draft only when the work is unfinished or the person asks. It belongs to the person who asked; request reviewers only when they name them.
- For dependent work, open one pull request per layer with `--base <branch-below>`, so each shows only its own diff, and name the pull request it builds on in its Notes.
- Post the pull request link in the chat or task where the work was asked.
- Before calling it ready, run `gh pr checks <n>`. For a failing check, run `gh run view --job <job-id> --log-failed`; the job id ends the check's link.
- Read feedback:
  - `gh pr view <n> --comments` for the conversation.
  - `gh api repos/<owner>/<repo>/pulls/<n>/comments` for line comments.
- Reply where the comment is: `gh api repos/<owner>/<repo>/pulls/<n>/comments/<id>/replies -f body="<reply>"` for a line comment, `gh pr comment <n> --body "<reply>"` for the conversation. Fix valid comments, and give every comment a short reply saying what you did or why not.
- To review someone's pull request, read it with `gh pr diff <n>` or `gh pr checkout <n>`, follow the review skill, then post your findings with `gh pr review <n> --comment --body-file <file>`. Never use `--approve`.
- If the push is refused because the app is not installed on the repository, give the person the link from `git config otto.installurl`.
- Never run `gh pr merge` or `gh stack merge`, and never enable auto-merge.
