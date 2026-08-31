# RadIMO – ReportHalo

RadIMO – ReportHalo is a clean-room Windows companion for authenticated ChatGPT/Codex work. It has its own visual language, interaction model, and source tree.

The [product page](docs/index.html) is a static, GitHub-Pages-ready overview with UI previews and no external tracking. The application is distributed under the proprietary, revocable [EULA](EULA.txt), following the licensing model used by RadIMO Cortex; `LICENSES/Apache-2.0.txt` applies only to the external Codex notice.

## Product direction

- Windows desktop client first; Linux is the development and protocol-test host.
- ChatGPT account authentication through the local Codex app-server browser-login flow only. Device-code login is intentionally removed for corporate endpoint compatibility.
- No API key is embedded in the desktop client. Optional microphone transcription uses a user-supplied OpenAI API key encrypted through Electron `safeStorage`; the key stays in the main process and is never exposed to renderer JavaScript.
- The product has two runtime/build variants: the default Codex subscription path (`npm start`, `npm run dist:codex`) and a smaller direct Responses API path (`npm run start:api`, `npm run dist:api`) that excludes the Codex source/payload. The API path supports OpenAI and Azure OpenAI v1 deployments, local encrypted credentials, streaming, and local manual conversation history with `store: false`.
- The direct API path applies provisional local guardrails of 250,000 tokens per day and 2,000,000 tokens per month. It displays an estimate in EUR from response usage and the known model price table; Azure contract pricing is not inferred as an invoice. The constants live in `src/usage-budget.js` until a tested user-facing budget screen exists.
- Live model discovery from Codex. The helper prefers `gpt-5.3-codex-spark` only when the backend advertises it and otherwise uses `gpt-5.6-luna`; every helper turn uses low reasoning effort.
- Local renderer and shell, so the usability design can evolve with the client release.
- No legacy provider UI or provider-specific branding in this new project.
- Context attachment is explicit: the user must enable `Include context` after selecting a local report neighborhood.
- The Context action opens an attached panel for nearby reports, selected fields, guarded correction, and reviewed draft saving without overwriting the source.
- The account dialog has `Copy diagnostics`; the local log is written to Electron's per-user logs directory and the copied bundle redacts token-like values.
- Medical gate is enabled by default. The mini actions use compact, existing-text-first prompts; external references are attached only through the explicit context/reference controls.
- There is no large desktop mode. Task-specific prompts run from the Orb; source management stays in the attached context panel and an open side panel closes when its side action is clicked again.
- The selected `German / Latin Befund` writing profile adds a transparent, conservative language layer for report text. Its rules are shipped as editable Markdown in `guidance/german-radiology-profile.md`; reviewed department terminology, phrase patterns, and de-identified examples can accumulate there or in a user-local Markdown override through the profile import/export controls.
- The template library uses editable `*.md` files. It checks `guidance/templates/` beside the portable executable first, then local user-data templates, keeps the future local webserver source disabled, and finally falls back to generic built-in templates.
- Open discussion is a multi-turn case conversation with a clean “New discussion” action. Chat is the only verbose surface and never writes its answer to another application.
- Clinic sources are secondary and reusable: put PDFs under `guidance/clinics/<clinic>/sources/`. `Neu lesen` extracts a PDF locally, keeps a SHA-256 text cache, and registers it in that clinic's `AGENTS.md`; `Anhängen` is required before the PDF enters the next turn.
- The context drawer includes a local screen-region capture utility. It previews and copies the image, and now offers an explicit `Attach image to next turn` option using the current app-server `localImage` input shape. The image is sent only after that checkbox is selected and is released from the temporary folder after the turn finishes or fails.
- Image attachment is capability-aware: the checkbox is disabled when the selected model catalog entry does not advertise the `image` input modality.
- The product is a single always-on-top Floating Orb for the active external field. It uses an icon-first 3×3 matrix, puts target activation and clearing into the top-left cell, records dictation, opens attached Chat/Context/Review panels plus a no-target text source, and replaces AI results directly in the explicitly activated external field after identity validation.
- German is the primary product language for the German-market workflow. The Mini Orb records microphone audio, transcribes it through OpenAI, keeps the transcript pending, and offers explicit correction, write-out, structure/complete, assessment, and discussion actions.

## Development

The current source has no vendored Electron runtime or installed npm dependencies. The required release dependencies are pinned in `package.json`; installation is left to the isolated release environment.

```bash
npm run check
```

The checked-in lockfile uses Electron `44.1.0` and electron-builder `26.15.3`, which run on the Node 20 development host. The only production window is the always-on-top Orb with context isolation and no Node integration; the release package is covered by focused contract tests, syntax checks, and artifact verification.

On Linux, the Codex binary defaults to `/software/codex/bin/codex`. Override it for local testing with `RADIMOAGENT_CODEX_BIN`. On Windows, the client first uses an explicitly configured binary, then a portable-adjacent runtime, then the official Codex installer layout (`%USERPROFILE%\\.codex\\packages\\standalone\\current\\bin\\codex.exe` or `%LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin\\codex.exe`). If no runtime is found, run `Install-Codex.ps1` from the release folder. The same environment variable can point to a developer-installed binary.

The API variant can be switched between OpenAI and Azure OpenAI in the account panel or configured with environment variables. OpenAI uses `RADIMOAGENT_API_KEY` or `OPENAI_API_KEY`; Azure uses `RADIMOAGENT_API_PROVIDER=azure`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY`. The Azure account panel explicitly selects `API-Key` or `Bearer-Token`; a static Azure Entra bearer token can be supplied with `RADIMOAGENT_AZURE_BEARER_TOKEN` and the UI choice can be fixed with `RADIMOAGENT_AZURE_AUTH_MODE=bearer`. Token refresh is intentionally outside this small first adapter. Azure text requests use the deployment name as the Responses API `model` value. Azure audio can use a separate `AZURE_OPENAI_AUDIO_DEPLOYMENT` (and optional `AZURE_OPENAI_AUDIO_API_VERSION`, default `2024-10-21`) through the Azure deployment audio route; an OpenAI transcription key remains available as a fallback.

The client starts:

```text
codex app-server --listen stdio://
```

It then initializes the JSON-RPC session, reads authentication status and the live model catalog, and uses the supported browser form of `account/login/start`. The returned `authUrl` is opened with the operating system's default browser; no device-code login path is exposed.

## Windows release shape

The configured portable release contains the RadIMO-generated icon and the application only:

```text
RadIMO-ReportHalo.exe
Install-Codex.ps1
codex-runtime.json
```

Codex is an external official runtime. This keeps the application payload small, lets an existing official Codex installation be reused, and avoids shipping an untracked binary inside the RadIMO repository. The release ZIP includes a verified post-install helper; it downloads the pinned Codex installer over HTTPS and verifies its SHA-256 before execution. The direct API build does not use Codex at all.

Windows UI Automation and dictation remain explicit optional helper actions. UI Automation is isolated behind the main-process field bridge. Microphone audio is recorded in the local renderer and sent to the main process for OpenAI transcription; the renderer never receives the API key.

## Current status

This is an unsigned release candidate build until a production certificate and live RIS acceptance are completed. The recovery iteration adds real push-to-talk transcription, encrypted API-key storage, automatic model fallback, global helper shortcuts, mini-helper position persistence, RIS-specific transfer checks, and a mini-only Orb workflow. See the release gate and acceptance checklist before clinical deployment.

The UI follows the repository's [RadIMO – ReportHalo UI standard](docs/ui-guidelines.md): a mini-only field palette, attached movable panels, Fluent 2-based spacing and interaction rules, WCAG AA targets, explicit dictation insertion, and responsive compact layouts.

## Context finder beta

The Context action opens a local-first beta. Select a report file from an exported or mounted data folder; the beta collects two sibling files above it and one below it in natural filename order. It labels likely `Fragestellung`, `Anforderung`, `Befund`, and `Beurteilung` files from their names, shows short previews for text formats, and can copy or save a Markdown capture report.

## Logs and correction workflow

On Windows, use `Connect your ChatGPT account → Copy diagnostics` to copy a shareable technical bundle to the clipboard. The dialog also shows the exact local log path. The app records startup, app-server, authentication, context, and turn events, while redacting token-like values.

If the connection test reports HTTP 407, the proxy requires authentication. The sign-in dialog can apply a proxy endpoint with optional proxy username/password; those credentials remain in memory for the current app session and are excluded from diagnostics.

The Orb can capture a selected field from a chosen local source file or the currently focused editable control in another Windows application. `Prepare correction` creates a prompt that preserves medical facts, values, negations, and uncertainty. Once an external field is explicitly activated, AI output replaces that field directly after the bridge revalidates its identity; each AI action can instead be configured to open the result in the editor first. `Zur Prüfung` moves the manually revised text into the review panel, and only the deliberate `Übernehmen` action writes it. Without an active target the result remains available in the attached result panel and can be copied or saved as a `*.radimoagent-draft.*` file.

## Radiology assistance boundary

The app distinguishes four tasks. `Lektorat` is constrained to spelling, grammar, dictation artifacts, and report style. `Differential diagnosis` asks for ranked possibilities, discriminating features, missing information, and uncertainty. `Beurteilung / conclusion` asks for a concise draft grounded in the supplied findings. `Open discussion` supports free-form, multi-turn reasoning and clarifying questions. The radiology knowledge prompt always tells the model to separate observations from interpretation and never infer unseen images, history, laboratory values, or prior examinations.

The German/Latin writing profile is deliberately not a hidden medical knowledge base. It preserves the supplied facts, measurements, negations, uncertainty, laterality, anatomy, and temporal qualifiers; it separates `Befund` from `Beurteilung`; and it asks the model to flag ambiguity rather than resolve it silently. Department additions are stored as editable Markdown under the app user-data folder, can be imported/exported from the context drawer, and should contain only reviewed, de-identified style material.

For medical reasoning, the internal prompt prefers Radiopaedia, PubMed/PMC-indexed peer-reviewed literature, journal/DOI pages, and professional guidelines. It must show exact URLs or DOIs for sources actually accessed and say when none were accessed. This is a decision-support and drafting aid for a reporting radiologist; the radiologist remains responsible for the final report and clinical decision.

The `guidance/clinics/` library is a secondary local path, not part of the main frontend. Each clinic owns `sources/*.pdf` and an editable `AGENTS.md`. The app never invents a citation from a filename: it extracts only locally readable text, caches it by hash, and sends it only after explicit attachment.

When live evidence is requested, the prompt requires a `SOURCES USED` section. The renderer displays returned URLs/DOIs as unverified source entries; it does not imply that a citation is correct merely because a URL appeared in model output.

The screen capture utility is a clean-room local parity feature inspired by the old snip workflow. It captures the selected region through Electron, keeps a temporary PNG for the explicit image turn, and only copies it after an explicit button press. The visual-review prompt tells the model that a screenshot is not a substitute for the original DICOM/PACS study.

At startup, RadIMO – ReportHalo asks Electron for the Windows system proxy rules for `auth.openai.com` and passes a resolved proxy to the Codex child process. If the organization uses a proxy that is not visible to Windows system proxy resolution, set `RADIMOAGENT_HTTPS_PROXY` to an `http://host:port` or `socks5://host:port` value before starting the portable app. The login dialog's `Test connection` button reports the detected rule and endpoint result without exposing credentials.

## Helper mode and cross-application fields

Right-clicking the center or any Orb action opens a small local quick menu. It can run the action, open Prompt & Anzeige for configurable AI actions, toggle their visibility in the 3×3, or open account/settings. Custom prompts are additive instructions; the medical safety rules and existing-text-first boundary remain active.

The `Minihelfer` is the only product window: an always-on-top transparent Floating Orb that moves from its center signal core. `Ctrl+Shift+Space` shows or hides it globally, `Ctrl+Shift+D` shows it and starts or stops dictation, and `Ctrl+Shift+G` captures the focused field without taking focus first. The Orb has a fixed 3×3 icon map: target activation/clear, write-out, dictation, correction, working indicator, replace, structure/complete, assessment, and result review. The top-left target cell also accepts explicit text drag-and-drop. Its right edge opens the combined Text & Chat workspace (text left, chat right); the lower Chat edge button opens the same workspace with chat focus, while Context remains separate. Captured field text and local text are automatically discussion context, so no copy step is needed. The target cell's right-click menu exposes selection/copy/reset only when relevant. Re-clicking Text or Chat closes the workspace; action settings also have an explicit close control. The Orb remains text-free in its closed state; labels are supplied by tooltips and accessible names. Field capture keeps it non-focusable while it reads the focused editable control through a clean-room PowerShell/UI Automation bridge; stale clipboard content is not used as an implicit field. Dictation records up to two minutes with a visible level meter and cancellation, then sends the completed audio to OpenAI transcription; the transcript remains pending until the explicit insert action. Non-chat actions request one compact JSON envelope: only `text` is eligible for field transfer, while `changes`, `unclear`, `logicIssues`, and `medicalIssues` are shown as a concise Chat message. Chat can also create a local draggable proposal in the Text pane; proposals never write to another application. With a locked external target, correction, write-out, and structure replace that field directly after the bridge rechecks the saved top-level window and control identity; an assessment is appended below the existing field content. The last result opens as a right-side before/after diff with a separate editable text view. Chat is the only verbose surface and never writes its answer to another application. The account/settings and close actions are available from the Orb's right-click menu; the account dialog reports shortcut conflicts and can retry registration after the conflicting application is closed.

The Orb opens at 360 × 380 px. The combined Text & Chat workspace expands as a 980 × 640 px connected right-side blob; Text is left, Chat is right, and narrow surfaces stack Chat above Text. Review, Context, and Account use their own connected panels. The native window bounds expansion, and all panels move with the Orb because they share the same native window; the mini board and edge controls never create horizontal scrolling.

Correction, structuring, and assessment use short, dedicated medical-gate prompts that operate on existing text first. The prompt preserves numeric values, measurements and units, dates, laterality, negation, uncertainty, temporal qualifiers, and recommendation markers. With an explicitly locked target, correction and structure replace the external field directly, while an assessment is appended below the existing content; the attached review panel remains available for inspection or editing, while an unselected target never receives a write.

The old portable executable was inspected only as a behavioral reference. Its packaged payload confirms that the legacy app used a UI Automation sidecar and native Windows bindings, but its implementation is not reused in this source tree.

## Windows build

The release configuration targets a portable x64 Windows build and does not embed Codex. Run `npm ci`, then `npm run release:gate`, and package with `npm run dist:codex`. The resulting ZIP contains the launcher, the pinned runtime manifest, `Install-Codex.ps1`, checksums, guidance, and third-party notices. An existing official Codex installation is reused automatically; otherwise run the helper after unpacking.

Use `npm run dist:installer` for the ordinary per-user Windows installer. It installs RadIMO and places the same explicit Codex post-install helper next to the application. The installer does not silently execute network downloads; if Codex is absent, run `Install-Codex.ps1` once after installation.

Use `npm run dist:api` for the smaller direct-API portable build. It writes to `dist-api/`, excludes the Codex adapter/source and `vendor/` payload, and supports OpenAI and Azure OpenAI.
