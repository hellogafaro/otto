---
name: github
description: Use with the git skill when the repository is on GitHub, to push, open a pull request, read checks and reviews, and reply, all with gh.
---

- Your git and gh login are set per turn for the person who asked, so commits and pull requests are theirs. If git or gh says you are not logged in, ask that person to connect GitHub in Settings → Integrations and stop there.
- Install gh if it is missing.
- Push with `git push -u origin <branch>`.
- Open the pull request with `gh pr create --assignee @me --title "<title>" --body-file <file>`, written as the git skill describes. Open it as a draft only when the work is unfinished or the person asks. It belongs to the person who asked; request reviewers only when they name them.
- Post the pull request link in the chat or task where the work was asked.
- Read feedback:
  - `gh pr view <n> --comments` for the conversation.
  - `gh api repos/<owner>/<repo>/pulls/<n>/comments` for line comments.
  - `gh pr checks <n>`, then `gh run view --job <job-id> --log-failed` for a failing check; the job id ends the check's link.
- Reply where the comment is: `gh api repos/<owner>/<repo>/pulls/<n>/comments/<id>/replies -f body="<reply>"` for a line comment, `gh pr comment <n> --body "<reply>"` for the conversation.
- To review someone's pull request, read it with `gh pr diff <n>` or `gh pr checkout <n>`, follow the review skill, then post your findings with `gh pr review <n> --comment --body-file <file>`. Never use `--approve`.
- If the push is refused because the app is not installed on the repository, give the person the link from `git config otto.installurl`.
- Never run `gh pr merge` and never enable auto-merge.
