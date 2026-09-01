# RadIMO – ReportHalo clean-room architecture

RadIMO – ReportHalo is authored as an independent desktop client. The previous executable is not a source dependency, and no legacy renderer, provider adapter, branding, or automation implementation is imported into this tree.

## Boundaries

- `src/main.js` owns the Electron window and safe local file dialogs.
- `src/preload.js` exposes a deliberately small IPC surface to the renderer.
- `src/agent-backend.js` selects one model-session adapter at runtime. `src/codex-app-server.js` speaks the local JSON-RPC app-server contract for the subscription build; `src/openai-responses.js` speaks the direct streaming Responses API for the small API build. Neither adapter exposes credentials to the renderer.
- `src/agent-api-config.js` owns provider/end-point/deployment configuration and encrypted API credentials. `src/usage-budget.js` owns the provisional local token guardrail and clearly marked cost estimate.
- `src/context-finder.js` is a standalone local-first beta for adjacent report context.
- `src/renderer/` contains one compact Floating Orb and its attached panels; there is no separate desktop workspace window.
- The primary flow uses the 3×3 Orb and compact right/bottom edge controls. Secondary context, clinic sources, templates, and guidance remain behind the attached context panel.

## Source connector decision

The beta does not assume a Radcenter API, database, or permission model that is not available in this development workspace. It accepts a file exported from or mounted by the eventual source system. A future connector can replace the file-picker implementation behind the same context report shape after the source endpoint and access rules are confirmed.

## Context report shape

The beta report records the selected anchor, the same-folder natural ordering strategy, requested report sections, neighboring file paths, section-name hints, file sizes, and bounded text previews. Binary files remain references and are not parsed.
