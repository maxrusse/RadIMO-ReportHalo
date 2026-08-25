# RadimoAgent

RadimoAgent is a clean-room Radimo desktop workspace for authenticated ChatGPT/Codex work. It has its own neutral naming, visual language, interaction model, and source tree.

## Product direction

- Windows desktop client first; Linux is the development and protocol-test host.
- ChatGPT account authentication through the local Codex app-server browser-login flow only. Device-code login is intentionally removed for corporate endpoint compatibility.
- No API key embedded in the desktop client.
- Live model discovery from Codex, with GPT-5.6 Luna as the initial cost-sensitive default and Terra/Sol available when the account exposes them.
- Local renderer and shell, so the usability design can evolve with the client release.
- No legacy provider UI or provider-specific branding in this new project.
- Context attachment is explicit: the user must enable `Include context` after selecting a local report neighborhood.
- The Context moon captures the selected text field and can copy it, prepare a guarded correction request, or save a reviewed AI result as a new draft without overwriting the source.
- The account dialog has `Copy diagnostics`; the local log is written to Electron's per-user logs directory and the copied bundle redacts token-like values.
- Medical gate is enabled by default. Evidence mode is a separate explicit opt-in and asks the model to cite exact URLs or DOIs, never claiming to have read a source that was not actually available.
- Full view has explicit radiology work modes: Open discussion, Lektorat (language-only), Differential diagnosis, and Beurteilung/conclusion. Radiology knowledge mode is visible and separate from live evidence/reference access.
- The selected `German / Latin Befund` writing profile adds a transparent, conservative language layer for report text. Its rules are shipped as editable Markdown in `guidance/german-radiology-profile.md`; reviewed department terminology, phrase patterns, and de-identified examples can accumulate there or in a user-local Markdown override through the profile import/export controls.
- The template library uses editable `*.md` files. It checks `guidance/templates/` beside the portable executable first, then local user-data templates, keeps the future local webserver source disabled, and finally falls back to generic built-in templates.
- Open discussion is a multi-turn case conversation with a clean “New discussion” action; it never writes back to another application automatically.
- The local radiology library can attach readable exported HTML/text/Markdown or extracted paper text to a turn without a Radimo server. PDFs are extracted locally only when a trusted `pdftotext` executable is available; otherwise they remain trace-only.
- The full view includes an evidence ledger that shows attached local filenames, extracted URLs/DOIs, or explicitly reports that no source was returned. Fetched medical pages can also be opened in the user's normal browser when an institutional browser proxy is required.
- The context drawer includes a local screen-region capture utility. It previews and copies the image, and now offers an explicit `Attach image to next turn` option using the current app-server `localImage` input shape. The image is sent only after that checkbox is selected and is deleted from the temporary folder after the turn completes.
- Image attachment is capability-aware: the checkbox is disabled when the selected model catalog entry does not advertise the `image` input modality.
- Full mode is a conventional desktop workspace. Helper mode is a separate always-on-top, transparent orb with edge moons, a bottom-center menu button, clipboard/UI Automation capture, a local Dictation Box, explicit field locking/transfer, dictation, and reviewed copy/write-back actions.
- German is the primary product language for the German-market workflow. The Helper supports `Diktieren → Bericht strukturieren → optionale Beurteilung → Desktop-Diskussion`; the desktop can then start a fresh case stream for medical/logical review, differential discussion, and explicitly enabled source-backed work.

## Development

The current source has no vendored Electron runtime or installed npm dependencies. The required release dependencies are pinned in `package.json`; installation is left to the isolated release environment.

```bash
npm run check
npm test
npm run smoke:app
```

The checked-in lockfile uses Electron `40.10.2` and electron-builder `25.1.8`, which run on the Node 20 development host. The production BrowserWindow remains sandboxed; the smoke scripts use an isolated test-only launch mode because this managed Linux host cannot start Chromium’s setuid sandbox.

On Linux, the Codex binary defaults to `/software/codex/bin/codex`. Override it for local testing with `RADIMOAGENT_CODEX_BIN`. On Windows, the release layout expects `resources/codex/codex.exe`; the same environment variable can point to a developer-installed binary.

The client starts:

```text
codex app-server --listen stdio://
```

It then initializes the JSON-RPC session, reads authentication status and the live model catalog, and uses the supported browser form of `account/login/start`. The returned `authUrl` is opened with the operating system's default browser; no device-code login path is exposed.

## Windows release shape

The configured portable release contains the Radimo-generated icon and:

```text
RadimoAgent.exe
resources/
  app.asar
  codex/codex.exe
```

Windows UI Automation and dictation remain explicit optional helper actions. They are isolated behind the main-process field bridge and are not coupled to the model provider or renderer.

## Current status

This is the first source baseline, not a finished signed installer. The app-server adapter, browser-login UI, live model picker, floating-island shell, context-finder beta, activity minimap, packaging configuration, and renderer/main-process security boundaries are in place. Windows smoke testing, signing, accessibility review, and any optional Windows automation module remain release work.

## Context finder beta

The Context moon opens a local-first beta. Select a report file from an exported or mounted data folder; the beta collects two sibling files above it and one below it in natural filename order. It labels likely `Fragestellung`, `Anforderung`, `Befund`, and `Beurteilung` files from their names, shows short previews for text formats, and can copy or save a Markdown capture report. PDF and other binary files remain references until a dedicated parser is added.

## Logs and correction workflow

On Windows, use `Connect your ChatGPT account → Copy diagnostics` to copy a shareable technical bundle to the clipboard. The dialog also shows the exact local log path. The app records startup, app-server, authentication, context, and turn events, while redacting token-like values.

If the connection test reports HTTP 407, the proxy requires authentication. The sign-in dialog can apply a proxy endpoint with optional proxy username/password; those credentials remain in memory for the current app session and are excluded from diagnostics.

The full app can capture a selected field from a chosen local source file. Helper mode can also capture the currently focused editable control in another Windows application without requiring a source file. `Prepare correction` creates a prompt that preserves medical facts, values, negations, and uncertainty. AI output can be copied, explicitly written back to the captured field, or saved as a `*.radimoagent-draft.*` file for review; the original source is never overwritten automatically.

## Radiology assistance boundary

The app distinguishes four tasks. `Lektorat` is constrained to spelling, grammar, dictation artifacts, and report style. `Differential diagnosis` asks for ranked possibilities, discriminating features, missing information, and uncertainty. `Beurteilung / conclusion` asks for a concise draft grounded in the supplied findings. `Open discussion` supports free-form, multi-turn reasoning and clarifying questions. The radiology knowledge prompt always tells the model to separate observations from interpretation and never infer unseen images, history, laboratory values, or prior examinations.

The German/Latin writing profile is deliberately not a hidden medical knowledge base. It preserves the supplied facts, measurements, negations, uncertainty, laterality, anatomy, and temporal qualifiers; it separates `Befund` from `Beurteilung`; and it asks the model to flag ambiguity rather than resolve it silently. Department additions are stored as editable Markdown under the app user-data folder, can be imported/exported from the context drawer, and should contain only reviewed, de-identified style material.

`Use references` is an explicit opt-in. When the connected agent can access sources, it should prefer Radiopaedia, PubMed-indexed peer-reviewed literature, journal/DOI pages, and professional guidelines, and show exact URLs or DOIs. Without source access, the app must say so rather than implying that a page was read. This is a decision-support and drafting aid for a reporting radiologist; the radiologist remains responsible for the final report and clinical decision.

The `Local radiology library` is a separate explicit attachment path. It reads only user-selected text-like files (HTML, TXT, Markdown, JSON, CSV, XML) and, when an approved local `pdftotext` executable exists, extracts PDF text locally with a timeout and size cap. It includes only readable text in the next turn; unsupported or unextractable binaries remain visible as trace-only entries.

When live evidence is requested, the prompt requires a `SOURCES USED` section. The renderer displays returned URLs/DOIs as unverified source entries; it does not imply that a citation is correct merely because a URL appeared in model output.

The screen capture utility is a clean-room local parity feature inspired by the old snip workflow. It captures the selected region through Electron, keeps a temporary PNG for the explicit image turn, and only copies it after an explicit button press. The visual-review prompt tells the model that a screenshot is not a substitute for the original DICOM/PACS study.

At startup, RadimoAgent asks Electron for the Windows system proxy rules for `auth.openai.com` and passes a resolved proxy to the Codex child process. If the organization uses a proxy that is not visible to Windows system proxy resolution, set `RADIMOAGENT_HTTPS_PROXY` to an `http://host:port` or `socks5://host:port` value before starting the portable app. The login dialog's `Test connection` button reports the detected rule and endpoint result without exposing credentials.

## Helper mode and cross-application fields

The `Helper` button opens a separate always-on-top window. Full mode remains a conventional desktop workspace; helper mode is the small Clippy-style orb only. Its edge moons can be clicked or dragged, and the bottom-center square opens the helper card. In Windows, `Grab` keeps the orb non-focusable while it reads the currently focused editable control through a clean-room PowerShell/UI Automation bridge, so the source application can remain the active foreground application. If that is unavailable, it falls back to the clipboard: select text in the other application, press `Ctrl+C`, then press `Grab`. `Lock field` anchors the current field target and keeps speech in the local Dictation Box; `Transfer to field` is explicit and retains the box until `Discard box`. Before transfer, the bridge restores the target window and checks the captured process/control identity; if the target changed, it stops and asks for a new lock. The captured target window is also retained for an explicit `Write AI result` action after the user reviews Luna's result. The helper never writes without an explicit button press.

The old portable executable was inspected only as a behavioral reference. Its packaged payload confirms that the legacy app used a UI Automation sidecar and native Windows bindings, but its implementation is not reused in this source tree.

## Windows build

The release configuration targets a portable x64 Windows build. Before packaging, place the approved Windows Codex binary at:

```text
vendor/codex/win-x64/codex.exe
```

Then run `npm run dist:win`. The build places it in `resources/codex/codex.exe`, which is the path resolved by the Windows client. Electron and electron-builder are declared in `package.json`; dependency installation is intentionally left to the release environment.
