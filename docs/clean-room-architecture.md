# RadIMO – ReportHalo clean-room architecture

RadIMO – ReportHalo is authored as an independent desktop client. The previous executable is not a source dependency, and no legacy renderer, provider adapter, branding, or automation implementation is imported into this tree.

## Boundaries

- `src/main.js` owns the Electron window and safe local file dialogs.
- `src/preload.js` exposes a deliberately small IPC surface to the renderer.
- `src/agent-backend.js` selects one model-session adapter at runtime. `src/codex-app-server.js` speaks the local JSON-RPC app-server contract for the subscription build; `src/openai-responses.js` speaks the direct streaming Responses API for the small API build. Neither adapter exposes credentials to the renderer.
- `src/agent-api-config.js` owns provider/end-point/deployment configuration and encrypted API credentials. `src/usage-budget.js` owns the provisional local token guardrail and clearly marked cost estimate.
- `src/context-finder.js` is a standalone local-first beta for adjacent report context.
- `src/windows-field-bridge.js` exposes only the clipboard guard and a developer-only UIA path in `src/windows-safe-field-bridge.js`; normal releases keep that path disabled. Native code injection, keystroke replay, and execution-policy bypasses are not part of the product bridge. The default DMO/RIS source path is explicit clipboard transfer. `src/windows-field-mapper.js` owns the label-pattern profile, exclusion-first matching, parent-container label matching, and structured context serializer.
- `src/field-mapper-main.js` and its small renderer form the API-free standalone Field Mapper diagnostic build. It has no agent, credential, or network path, is gated by the same experimental UIA policy, and shares the same scanner contract with the integrated app.
- `src/renderer/` contains one compact Floating Orb and its attached panels; there is no separate desktop workspace window.
- The primary flow uses the 3×3 Orb and compact right/bottom edge controls. Secondary context, clinic sources, templates, and guidance remain behind the attached context panel.

## Source connector decision

The beta does not assume a Radcenter API, database, or permission model that is not available in this development workspace. It accepts a file exported from or mounted by the eventual source system. A future connector can replace the file-picker implementation behind the same context report shape after the source endpoint and access rules are confirmed.

## Context report shape

The beta report records the selected anchor, the same-folder natural ordering strategy, requested report sections, neighboring file paths, section-name hints, file sizes, and bounded text previews. Binary files remain references and are not parsed.

The Field Mapper report is separate from the file beta and is never started automatically. It records the target process and bounded UI Automation metadata for detected text controls only after an explicit diagnostic action in an experimental session. Configured label rules are matched against accessible names, labels, help text, automation IDs, and parent container names; class names alone are not treated as semantic labels. Exclusions and password controls are removed before values are read. Only matched values appear in named context groups. Unmatched controls retain metadata for local mapping diagnostics but their contents are not returned. A DMO/RIS installation may still expose no stable UIA metadata even though cursor-based dictation works, so the clipboard workflow remains the supported fallback.
