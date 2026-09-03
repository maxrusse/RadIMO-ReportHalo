# RadIMO – ReportHalo clean-room architecture

ReportHalo is an independent Windows desktop client. It does not import the previous executable, renderer, provider adapter, branding, or foreign-window automation implementation.

## Boundaries

- `src/main.js` owns the Electron window, local dialogs, clipboard, and IPC validation.
- `src/preload.js` exposes the small renderer API. Credentials never enter renderer JavaScript.
- `src/agent-backend.js` selects the Codex app-server adapter or the direct streaming Responses API adapter.
- `src/agent-api-config.js` owns OpenAI/Azure endpoint and credential configuration. `src/usage-budget.js` owns provisional local token limits and estimates.
- `src/context-finder.js` is a local-first adjacent-report context helper. It only reads files explicitly selected by the user.
- `src/renderer/` contains one compact Cub and its attached panels. There is no second desktop workspace window.

## External text boundary

ReportHalo deliberately treats DMO, RIS, Word, and other editors as foreign applications. The generic client does not enumerate their controls, read their accessibility tree, move their focus, simulate keystrokes, or write into them. The supported boundary is explicit text transfer through the clipboard or drag-and-drop:

`select → Ctrl+C → import → review → copy → Ctrl+V`

This avoids guessing which control is a report field and avoids presenting an unverified foreign-app write as successful. A future direct integration would need a vendor-supported target-app/API contract and its own security review.

## Context report shape

The local context report records the selected anchor, same-folder ordering, requested report sections, neighboring paths, section hints, file sizes, and bounded previews. Binary files remain references and are not parsed.

## Text result contract

Non-chat actions return a compact JSON envelope with `text`, `changes`, `unclear`, `logicIssues`, and `medicalIssues`. For correction, writing, and structure, `text` is the complete local replacement block. Assessment keeps the source visible and produces a labelled `Beurteilung: …` addendum. Explanations and safety notes never enter the reusable text block.

The medical gate preserves numbers, units, laterality, anatomy, negations, uncertainty, dates, temporal qualifiers, and recommendations. It flags ambiguity rather than inventing facts. The RIS/editor remains the authoritative record.
