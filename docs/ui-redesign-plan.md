# RadIMO – ReportHalo UI redesign plan

Status: 0.2.11 uses the compact Halo Cub as its only product window; longer workflows open as attached panels inside that same movable window.

## Product decision

RadIMO – ReportHalo stays beside the RIS, Word, or another Windows editor as one always-on-top Orb. There is no large desktop mode, no second product BrowserWindow, and no visible mode selector. The temporary screen-region selector is an implementation overlay, not a second product surface. The foreign editor remains authoritative; after the user explicitly locks a target, correction and structure replace that field directly after identity validation, while assessment appends below the existing content. Without a locked target, the complete result opens in the attached Text & Chat workspace for discussion and deliberate local editing.

## Orb map

The central 3×3 board remains spatially stable:

| Position | Action |
| --- | --- |
| top left | activate the focused external field |
| top middle | write out / formulate |
| top right | dictate |
| middle left | correct text |
| center | quiet signal-core ready state / restrained orbital working indicator |
| middle right | replace the active external field with the result |
| bottom left | structure and complete from supplied text |
| bottom middle | create assessment |
| bottom right | open the attached review panel |

The classic header bar is removed. The transparent Orb has no permanent top control row; account/settings and close live in the core's right-click menu, while the center signal core is the native drag region. The target cell's right-click menu exposes selection, copy, and reset only when relevant. The right edge opens the combined Text & Chat workspace, and the lower Chat edge control opens the same workspace with chat focus. The workspace keeps the text/context pane left and the larger discussion pane right; on narrow surfaces it stacks Chat above Text. Context remains separate. Clicking either active workspace opener closes it. No action is duplicated between board and bars.

## Attached panels

Right-click on the core or a function opens a compact local menu. The core menu exposes account/settings and action configuration; configurable AI functions expose their prompt and 3×3 visibility controls. The menu is an interaction layer, not a second permanent toolbar.

Chat, Textquelle, Context, Review, and Account are rendered inside the Orb's single BrowserWindow. Text & Chat, Review, Context, and Account use a connected right-side track; the combined workspace is the only shared discussion surface and is never an independent popup. Opening a panel grows the native window in that direction and leaves it open until its opener is clicked again; the center core remains the drag handle, so every panel moves with the Orb and never loses its owner.

The compact base is 180 × 190 px, with a 140 × 140 px 3×3 board. Right-clicking the core toggles the persistent 360 × 380 px standard floating Cub; this remains one movable companion window and never becomes a separate desktop workspace. Panel presets are bounded and selected by the main process (`workspace`, `review`, `context`, `settings`); the workspace uses a 980 × 640 px connected right-side track while preserving the Cub column and its outer controls. Position persistence stores only the closed Cub geometry, so a previous expanded panel cannot turn startup into a large app.

## Active Arbeitsfläche auswählen

The top-left 3×3 target cell is both the compact status surface and a text drop target. In the default clipboard mode it opens the explicit DMO/RIS copy workflow; only the developer-enabled experimental UIA mode can activate the focused or cursor-point field without taking focus from it. Its X clears the target or local source. The target cell's right-click menu reads marked text only when selection capture is requested. Dropped text becomes a local source and never silently becomes a foreign-app write target.

The main-process bridge uses this order:

1. Explicit clipboard import as the default DMO/RIS path; a developer-only Windows UI Automation `FocusedElement` or cursor-point lookup with a short retry for a control that disappears during a redraw.
2. The focused element's stable identity (`ProcessId`, `AutomationId`, control type, runtime ID, and name), plus its top-level native window resolved from `NativeWindowHandle` with the foreground window as fallback.
3. `ValuePattern` for a complete readable field.
4. `TextPattern.GetSelection()` for an explicit selection, or `TextPattern.DocumentRange` for the complete text.
5. No implicit clipboard read. The user explicitly invokes clipboard import; drag-and-drop remains an explicit text fallback.

Selection capture does not silently degrade to the whole field when no text is selected. Before insertion, the bridge rechecks the saved top-level window and process/control/runtime identity and verifies the result when the control is readable.

## AI and insertion flow

Correction, write-out, structure/complete, and assessment return a compact JSON envelope: `text` is the complete action result for replacement actions and the addendum for assessment; `changes`, `unclear`, `logicIssues`, and `medicalIssues` are short metadata lists. Only `text` can reach the external field. Captured field text and local Text content are automatically included as discussion context when available; clipboard import is explicit when UIA is unavailable. Chat can remain conversational, or `Vorschlag ins Textfeld` can request a proposal envelope. A proposal is always opened in the local Text pane, can be edited or dragged as a local source, and never changes the foreign field. On completion, a verified UIA target may receive correction and structure as replacements, while assessment is appended as a labelled `Beurteilung: …` addendum below existing content; otherwise the complete result opens locally in Text & Chat and is prepared for deliberate RIS paste/check. A per-action `Vor Übernahme im Editor prüfen` setting diverts the result into the same Text pane without touching the foreign field; `Zur Prüfung` then opens the manually revised text in Review, and `Übernehmen` performs the final replacement or append. Metadata is posted into the Chat pane and shown below the result text, where the user can continue the discussion. Chat is the only verbose surface and never writes its answer to a foreign field. The center is status-only: it shows an IP-neutral signal-core mark when ready and one slow, restrained orbital indicator while the agent works. Without a target, no foreign field is touched.

## Performance and safety

- Use only the center core as the `-webkit-app-region: drag` area. Buttons, inputs, panels, and text areas are `no-drag`.
- Do not run renderer `pointermove` loops for native window movement.
- Select the backend lazily so the API build does not load the Codex adapter or payload; keep direct API conversation history bounded and stream response text as it arrives.
- Keep panel geometry fixed and bounded, reconcile panel changes as latest-request-wins, and schedule connector recalculation with `requestAnimationFrame` only after the native layout response.
- Debounce persisted Orb-position writes and reserve animation for the active working state; honor `prefers-reduced-motion`.
- Keep the helper non-focusable while reading a foreign field; enable focus only for attached inputs and settings.
- Never treat stale clipboard content as the active field.
- Preserve numbers, units, laterality, anatomy, negation, uncertainty, dates, temporal qualifiers, and recommendations in radiology text.
- Keep target activation opt-in and verify every automatic foreign-field replacement where the Windows control permits read-back.
- Show the last result as complete editable Text by default; offer an optional character-level before/after Diff so moved text does not create misleading whole-line highlights. Keep changes and clinical/logical review points in the notes and Chat surfaces. Assessment keeps the original text visible and transfers only its labelled `Beurteilung: …` addendum.

## Implementation cleanup

The 0.2.10 pass removes the desktop shell, desktop-only target/composer/canvas code, duplicate main-window IPC bridges, duplicated settings/context buttons, legacy visible mode controls, and the old renderer-side popup overlays. Retired test harnesses are archived outside the active repository; the release package now uses focused contract tests, syntax validation, and verified packaging commands.

## References

The experimental active-field pattern follows Microsoft's UI Automation guidance for retrieving the focused element and using control patterns, especially `FocusedElement`, `TextPattern.GetSelection()`, and `ValuePattern`. The default DMO/RIS text path is explicit clipboard import. Native movement follows Electron's frameless `app-region: drag`, `setSize`, and `setFocusable` model. General visual spacing continues to follow Fluent 2 and WCAG 2.1 AA.
