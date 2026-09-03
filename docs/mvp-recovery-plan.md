# RadIMO – ReportHalo recovery plan

## Product target

RadIMO – ReportHalo is a small Windows reporting companion for radiologists. The RIS, Word, or other foreign editor remains the authoritative report surface. RadIMO – ReportHalo starts as one always-on-top, icon-first Floating Orb and does not open a second work surface.

The Orb uses a 3×3 action matrix with compact right/bottom controls. The top-left cell identifies the active field when an explicit UIA attempt succeeds, accepts a text drop, and shows the target's lock/clear state. The supported DMO/RIS fallback is to copy the marked text and import it explicitly from the clipboard. Chat, Textquelle, Context, Review, and Account panels are part of the same native window, so they move with the Orb. Only a verified UIA target may receive direct replacement; otherwise the result stays local and is prepared for deliberate paste/check.

## Audit findings on 2026-08-25

- The shipped self-extracting build bundled Codex CLI `0.101.0`. Its model parser rejects the current catalog value `max`, so model loading fails even though browser authentication succeeds. Codex CLI `0.149.0` is installed locally and parses the current protocol.
- The renderer now resolves the requested fast model from the live catalog, prefers `gpt-5.3-codex-spark` when advertised, and falls back to the supported `gpt-5.6-luna` with low reasoning effort.
- The helper's `Diktieren` action relied on Chromium's optional `SpeechRecognition` interface. The packaged Electron runtime does not provide a dependable transcription service, so the control commonly reported that dictation was unavailable.
- The old helper and desktop exposed many overlapping element IDs, modes, and transfer routes. The 0.2.10 pass removes the visible large desktop surface, keeps one action path per function, and attaches temporary panels to the Orb.
- Active-field capture has an explicit clipboard-first default. The opt-in UIA path can use the focused or cursor-point element, prefers `ValuePattern`, uses `TextPattern` for explicit selection or document text, and preserves the target identity for guarded write-back. Native window injection and keystroke-replay fallbacks are not included.
- The previous automated test and smoke harness was too brittle for the current UI iteration. It is retired for now and stored outside the repository in `work/_archive/radimoagent_cleanup_20260826/tests-retired-20260826/` so it can be revisited without remaining part of the release check.

## Current architecture

- Keep ChatGPT browser authentication and the local Codex app-server for text correction, assessment, and discussion.
- Use the official Codex CLI as an external runtime. Prefer the live `gpt-5.3-codex-spark` entry when advertised and use the documented `gpt-5.6-luna` fallback if discovery is unavailable. The runtime version and installer digest are pinned in `codex-runtime.json`; the app detects an official installation and `Install-Codex.ps1` performs a verified post-install when it is absent.
- Record microphone audio in the local renderer with `MediaRecorder`. Send the completed audio buffer to the Electron main process.
- Transcribe in the main process through `POST /v1/audio/transcriptions` with `gpt-4o-transcribe` and a German radiology vocabulary prompt. A standard API key is never exposed to renderer JavaScript; it is encrypted with the operating-system-backed Electron `safeStorage` API.
- Keep raw transcription separate from AI correction. The transcript stays pending in the Orb until the user chooses the explicit insert action. Correction, write-out, and structure return complete replacement text; assessment returns a labelled `Beurteilung: …` addendum. Only the intended text reaches a locked target, while the metadata goes to Chat. Discussion stays Chat-only and never writes to a foreign field.
- Preserve explicit target activation and verified transfer. AI results may replace only the explicitly locked target; stale clipboard contents are never treated as the active field implicitly.

## Iterations

### Iteration 1 — reliable baseline

Status: implemented and packaged in `0.2.0`; live startup and model discovery were verified on Windows.

- Replace the stale packaged Codex payload.
- Add push-to-talk recording and OpenAI file transcription.
- Add secure API-key configuration and clear connection status.
- Remove invented model fallbacks and surface backend failures.
- Keep the Orb centered on field selection, dictation, focused AI actions, output, copy, and guarded transfer.

### Iteration 2 — native floating behavior

Status: implemented through the 0.2.10 design pass.

- Use native frameless-window dragging and bounded position persistence; avoid renderer drag loops.
- Keep one compact startup surface with a fixed base size and panel-specific native expansion.
- Provide clipboard import as the dependable cross-RIS path, plus opt-in focused-field capture, explicit selection capture, target identity, safe UIA value writes, clipboard fallback, and read-back verification.
- Keep visible recording level, elapsed time, cancellation, and segmented long-dictation handling.
- Attach Chat, Textquelle, Context, Review, and Account surfaces to the Orb instead of creating a second window; active side buttons close their own panel.
- Show the last result as complete editable Text with an optional character-level before/after Diff; assessment keeps the source visible and appends only its labelled `Beurteilung: …` addendum.
- Use the IP-neutral signal-core SVG as the Orb's ready indicator and one slow, restrained orbital motion while working.
- Remove duplicate renderer controls, duplicate IPC routes, stale large-surface styles, and retired test harness files from the active repository.

### Iteration 3 — clinical workflow hardening

Status: the medical-gate prompts and optional attached review boundary remain part of the compact Orb flow; an unused deterministic parser was removed during the deep cleanup.

- Correction, structuring, and assessment use dedicated prompts with separate report-task boundaries.
- The medical gate preserves numeric values, measurements and units, dates, laterality, negation, uncertainty, temporal qualifiers, and recommendation markers.
- Output remains visible for optional manual review; with an explicitly locked and revalidated target it is transferred automatically.
- Realtime/WebRTC dictation remains deferred until the file-transcription path is stable; if introduced later, use server-minted ephemeral credentials rather than a standard API key in the renderer.

## Verification gates

The active validation is intentionally lightweight while the UI is being redesigned:

- `npm run check` parses the product source and packaging helpers.
- `npm run release:gate` runs the clean-tree, dependency, runtime-manifest, test, syntax, and packaging-contract checks. `npm run dist:codex` creates the portable ZIP, while `npm run dist:installer` creates the per-user Windows installer. Neither embeds Codex; the release includes the verified post-install helper.
- A manual packaged-start check confirms that the new build opens only the compact Orb, that panels stay attached while moving the native window, and that no large desktop surface is created.
- Manual clinical acceptance remains required for the actual production RIS control. Field capture and write-back must preserve identity, laterality, numbers, units, negation, uncertainty, and review boundaries.

The retired UI harness remains recoverable in the cleanup archive. The current release workflow runs focused contract tests instead of the old brittle UI harness.

## Iteration 4 — provider split and bounded direct API

Status: implemented as the first two-build foundation; live Azure tenant acceptance and production pricing configuration remain release work.

- Keep the ChatGPT subscription/Codex path as the default because it matches the expected user login flow.
- Add a direct Responses API path with SSE output streaming, `store: false`, local bounded history, and the same compact JSON action envelope used by Codex.
- Keep Codex-only source and the vendored executable out of the API portable build.
- Support OpenAI and Azure OpenAI v1. Azure uses the deployment name as the model identifier, and the account panel has a provider switch. Text, image input, streaming, structured actions, local conversation history, and guarded UI workflows share the same adapter surface. Azure audio uses its separate deployment route and API version when configured; a separate OpenAI transcription key remains the fallback. Static environment-supplied bearer tokens are supported, while token refresh is deliberately not bundled into this small adapter.
- Enforce provisional local budgets before a request and record provider-reported input/output usage afterward. The EUR amount is an estimate from the local price table and an explicit exchange-rate constant, not a billing statement.
- Keep transcription on the existing direct OpenAI audio route. An Azure text credential therefore does not silently become an OpenAI transcription credential.
