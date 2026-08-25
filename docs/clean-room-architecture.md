# RadimoAgent clean-room architecture

RadimoAgent is authored as an independent desktop client. The previous executable is not a source dependency, and no legacy renderer, provider adapter, branding, or automation implementation is imported into this tree.

## Boundaries

- `src/main.js` owns the Electron window and safe local file dialogs.
- `src/preload.js` exposes a deliberately small IPC surface to the renderer.
- `src/codex-app-server.js` is the only model-session adapter. It speaks the local JSON-RPC app-server contract and never exposes credentials to the renderer.
- `src/context-finder.js` is a standalone local-first beta for adjacent report context.
- `src/renderer/` contains the Radimo interaction model: one central island, orbiting action moons, and an activity minimap.
- `assets/moonlets-sprite.png` is a newly generated visual asset used by the moon controls.

## Source connector decision

The beta does not assume a Radcenter API, database, or permission model that is not available in this development workspace. It accepts a file exported from or mounted by the eventual source system. A future connector can replace the file-picker implementation behind the same context report shape after the source endpoint and access rules are confirmed.

## Context report shape

The beta report records the selected anchor, the same-folder natural ordering strategy, requested report sections, neighboring file paths, section-name hints, file sizes, and bounded text previews. Binary files remain references and are not parsed.
