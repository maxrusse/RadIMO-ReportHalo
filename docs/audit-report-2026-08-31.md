# RadIMO – ReportHalo audit report — 2026-08-31

## Scope

Three independent, read-only review passes were run before remediation:

- Kant — runtime, startup, drag performance, streaming, and lifecycle.
- Archimedes — Orb layout, panel geometry, focus, drag/drop, and interaction semantics.
- Faraday — provider separation, credentials, external-field writes, privacy, and workflow gates.

The retired smoke-test files were not restored, per the current product decision. Validation uses syntax checks, focused module smokes, packaging checks, and fresh executable starts.

## Findings fixed in this pass

- Removed the renderer recursion in `syncMiniEditorMode`, which could cause stack overflow during panel opening.
- Removed the Codex payload from the portable and installer app builds. The runtime manifest pins the official Codex release, the app detects official installer layouts, and the release ZIP/installer carry a SHA-256-verifying post-install helper.
- Kept GPU compositing on the normal transparent-window path; software rendering is now an explicit compatibility fallback.
- Replaced FIFO panel resizing with latest-request-wins epochs and request IDs.
- Throttled streamed chat DOM updates to animation frames and bounded visible chat/input sizes.
- Released screen captures on replacement, clear, failed/successful turns, and awaited shutdown cleanup. Captures can only be sent or released when owned by the current app session.
- Added trusted helper/snip WebContents checks to every IPC handler.
- Revalidated selected-text content hashes before external writes, in addition to window/control identity checks.
- Added Azure API-Key/Bearer-Token selection and persisted the selected auth mode without exposing credentials to the renderer.
- Made Azure environment precedence provider-specific so OpenAI endpoint variables cannot silently override an Azure endpoint.
- Added serialized usage-budget reservations, including a bounded estimate for direct-API dictation.
- Added Codex initialize/request timeouts and cleanup after failed initialization.
- Added approved-host redirect validation for online references and bounded prefix reads for adjacent context.
- Switched clinic PDF hashing to chunked reads and capped workflow artifact text.
- Changed backend startup so the Orb can render immediately while Codex/API initialization continues in the background.

## Validation

Passed:

- `npm run check`
- `git diff --check`
- Azure config/auth-mode persistence smoke
- concurrent usage-budget reservation smoke
- approved and rejected reference-redirect smoke
- bounded context/artifact smoke
- Azure bearer-header and streaming Responses smoke
- fresh Codex executable start: payload found, initialized, 7 models loaded, no startup errors
- fresh API executable start: 1 model loaded, no startup errors

The generated `dist/` and `dist-api/` folders are ignored build outputs. A clean future build creates app-only portable artifacts plus a separate Codex installer path; the API build remains Codex-free.

## Deliberately open release risks

- Portable executables are unsigned; SmartScreen and enterprise deployment acceptance still need signing and a release certificate.
- Direct replacement remains an explicit user-triggered action because it is part of the requested workflow; medical review remains the product responsibility, and the per-action editor gate is available for teams that require it.
- Azure text/audio behavior still needs live acceptance against the intended tenant, deployment names, API versions, and Entra token lifecycle.
- Existing older running processes can still own global shortcuts and make manual testing appear inconsistent; they were not terminated during this audit.
- The optional local Codex development payload and downloaded installer are SHA-256 checked. Production app signing and live clinical acceptance remain operational release tasks.
