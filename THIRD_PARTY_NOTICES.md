# Third-party notices

Otto includes third-party code, fonts, icons, and brand assets. The exact license files for redistributable components live in [`legal/licenses`](legal/licenses). Release builds copy this notice and that directory into the web, CLI, and desktop artifacts.

## Project origin

Otto is an independent fork of [Akeru Bot](https://github.com/opencoredev/akeru-bot), itself derived from [T3 Code](https://t3.codes). The root [`LICENSE`](LICENSE) preserves the original `Copyright (c) 2026 T3 Tools Inc.` notice as required by the MIT License. Neither upstream project maintains Otto.

## Code and SDKs

| Component                        | Use                                                              | License                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Mastra Code                      | Authentication and provider code adapted from `mastra-ai/mastra` | [Mastra Code terms](legal/licenses/Mastra-Code.txt) and [Apache License 2.0](legal/licenses/Apache-2.0.txt)  |
| Claude Agent SDK                 | Claude provider runtime                                          | [Anthropic Claude Agent SDK terms](legal/licenses/Anthropic-Claude-Agent-SDK.txt)                            |
| Pierre Trees and Diffs           | File trees, diffs, and generated file icons                      | [Apache License 2.0](legal/licenses/Apache-Pierre.txt) and [Pierre notice](legal/licenses/NOTICE-Pierre.txt) |
| Project Nayuki QR Code generator | QR code generation in `packages/shared/src/qr-code.ts`           | MIT text retained in the source file                                                                         |
| Khroma                           | Color utilities bundled through Mermaid                          | [MIT](legal/licenses/MIT-Khroma.txt)                                                                         |
| Beautiful UI                     | Chat loading state port                                          | [MIT](legal/licenses/MIT-Beautiful-UI.txt)                                                                   |

The "Drive" loading state from Beautiful UI by Shane Levine (<https://www.beautifului.dev/>) is
adapted in `apps/web/src/components/chat/response-loading-state.tsx`. The file records its source in a
header comment.

Mastra-derived source is under `apps/server/src/subscription-auth`. Its source references are:

- <https://github.com/mastra-ai/mastra/tree/main/mastracode/sdk/src/auth>
- <https://github.com/mastra-ai/mastra/pull/22427>
- <https://github.com/mastra-ai/mastra/pull/22428>

## Fonts and terminal code

| Component              | Distributed files                     | License                                                       |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Geist and Geist Mono   | Web fonts from `@fontsource-variable` | [SIL Open Font License 1.1](legal/licenses/OFL-1.1-Geist.txt) |
| Ghostty                | WebAssembly and headers               | [MIT](legal/licenses/MIT-Ghostty.txt)                         |
| Symbols Nerd Font Mono | Web terminal font                     | [MIT](legal/licenses/MIT-Symbols-Nerd-Font.txt)               |

The Ghostty web artifacts use revision `9f62873bf195e4d8a762d768a1405a5f2f7b1697` under the Ghostty MIT license included above.

## Icons and logos

| Component    | Use                                       | License                                                      |
| ------------ | ----------------------------------------- | ------------------------------------------------------------ |
| models.dev   | Provider icons                            | [MIT](legal/licenses/MIT-models.dev.txt)                     |
| vscode-icons | File icons adapted for Pierre-based views | [MIT](legal/licenses/MIT-vscode-icons.txt)                   |
| SVGL         | Selected plugin logos                     | [MIT](legal/licenses/MIT-SVGL.txt)                           |
| Simple Icons | Selected plugin logos                     | [CC0 1.0 Universal](legal/licenses/CC0-1.0-Simple-Icons.txt) |

Other plugin logos come from the product owner, Brand.dev, or VectorLogoZone. Each plugin manifest records its source. Those names and logos remain the property of their owners and identify the corresponding products. Their inclusion does not imply endorsement or affiliation.

## Dependency packages

JavaScript packages retain the license and notice files supplied by their publishers. The release process also places this checked-in notice bundle beside the bundled application code. Khroma's package metadata omits its license declaration, so its upstream MIT text is included above. A package with no declared license must not be treated as open source based on its presence in the dependency tree.

When a vendored component, generated asset, font, logo, or pinned revision changes, update its source record and license in the same change.
