# Otto identity on the Akeru foundation

The imported source revision is `020a7b5c9630fa7a2a603771cca25128b3cacc15`. The authorized change replaces the former implementation rather than composing two runtimes. Root `AGENTS.md`, `DESIGN.md` and the retained Otto artwork are preserved byte-for-byte.

Otto replaces first-party product labels, package/import namespaces, CLI identities, tool identifiers, event/service names, configuration prefixes, storage keys, native application identifiers and source filenames. Distinct inherited compatibility identifiers remain distinct under Otto legacy names so collapsing two namespaces cannot change precedence or create duplicate fields. Historical source citations, copyright notices, dependency identities and third-party provider marks remain factual.

The existing Otto symbol and application artwork replace the upstream wordmark, splash, favicons and desktop icons. The shared wordmark uses the symbol in the current foreground color and the display name Otto. Upstream layout, controls and behaviors otherwise remain intact; this does not apply the former Otto shell redesign to the new foundation.

The marketing application is removed, including its package, scripts, CI and release-smoke job. Product clients remain. Desktop consumers use the shared `assets/prod/otto-app-1024.png` rather than reaching into a website package. Privacy and license links reference repository documents instead of the removed site; these source links are not a claim that this unpushed revision is already published. Hosted release infrastructure remains unconfigured.

No npm distribution is configured. Pairing/service instructions use the local CLI, and manual update UI no longer offers an unowned registry package. Default SSH bootstrap requires an installed Otto CLI or an explicit node-script path rather than silently downloading a similarly named package. Explicit package overrides remain supported and fixture-tested; no real remote installation was qualified.

This phase does not implement multiplayer accounts, new room semantics, project management, time tracking or saved-database conversion. Their earlier implementation and acceptance remain in the private recovery copy, not in the running application. Real provider execution, remote accounts, computer isolation and packaged native applications require separate qualification.
