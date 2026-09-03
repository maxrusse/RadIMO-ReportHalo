# RadIMO – ReportHalo UI standard

## Direction

RadIMO – ReportHalo is a compact **Halo Cub** beside the active RIS-, Word-, or editor window. It is not a second desktop app. The closed state is icon-first and nearly text-free; tooltips, accessible names, color, and motion carry the explanation.

There is one native product BrowserWindow. Chat, Textquelle, Context, Review, and Account are attached panels in that window. They expand the Orb temporarily and always move with it; the screen-region selector is only a temporary capture overlay.

## Stable 3×3 map

| Position | Function |
| --- | --- |
| top left | import the explicitly copied DMO/RIS text (experimental UIA targeting is separate) |
| top middle | write out |
| top right | dictate |
| middle left | correction |
| center | quiet signal-core ready state or restrained orbital working indicator |
| middle right | explicit insertion |
| bottom left | structure and complete |
| bottom middle | assessment |
| bottom right | review result |

The classic header bar is gone. The transparent Orb has no permanent top control row; account/settings and close are in the core's right-click menu, while the signal core shows online/offline state. The center signal core is the native drag region. The target cell's right-click menu exposes selection/copy/reset only when relevant. The right bar opens the combined Text & Chat workspace; the bottom Chat control opens the same workspace with chat focus. The left pane shows the current text context or a local proposal, the right pane holds the discussion. Context remains a separate panel. Clicking either Text or Chat while the workspace is active closes it; the action-settings panel additionally has a labelled close control. Right-clicking a prompt-bearing button opens that button's full prompt; the core menu opens the same settings panel with all prompt-bearing functions available.

## Aktive Arbeitsfläche auswählen

The top-left 3×3 target cell imports explicit text from the clipboard and accepts text drag-and-drop. The default DMO/RIS path is `mark in the source → Ctrl+C → import clipboard`; it does not inspect another process or silently consume stale clipboard data. Results are copied back for deliberate paste/check in the source application. UIA field capture is a separate developer-only diagnostic: the product builds exclude its bridge, and only the standalone Field Mapper with `RADIMO_ENABLE_EXPERIMENTAL_UIA=1` can run it. The target cell's right-click menu offers the same clipboard action and, in the experimental UIA mode, can request marked text. Its small X clears the target or text source.

The target identity includes process, native window, automation ID, control type, runtime ID, and name where Windows exposes them. The UIA bridge checks that identity again before insertion and only a verified `ValuePattern.SetValue` write is reported as committed. `ValuePattern` is preferred for complete editable values; `TextPattern.GetSelection()` is used for marked text and `TextPattern.DocumentRange` for readable document content. DMO/RIS controls may expose none of these patterns even while cursor-based dictation works. Drag-and-drop and explicit clipboard import are the supported text-source fallbacks; a write that cannot be read back is copied for a deliberate RIS paste/check.

Dictation stores the activated field's native control and returns to that control before inserting only in the experimental UIA mode. It never selects all or moves to the end: the transcript is inserted at the current cursor/selection position, then the complete resulting field is refreshed as context for subsequent actions. In the normal clipboard mode, `Einsetzen` copies the transcript and asks the user to paste it at the RIS cursor. Other write actions continue to use their explicit replace or append contract.

The standalone Field Mapper provides the read-only RIS Field Mapper as an experimental UIA diagnostic. The normal Codex and API products exclude its UIA/PowerShell bridge; their Context panel contains only the explicit clipboard workflow. A developer must launch the separate Field Mapper with `RADIMO_ENABLE_EXPERIMENTAL_UIA=1`. `Konfigurierte Felder lesen` reads only fields matching the configured label rules; `UIA-Felder prüfen` lists accessible text controls without reading their values. Matching uses accessible names, labels, help text, automation IDs, and parent container labels; class names alone are not sufficient. When no target is selected, the inspector is hidden briefly before scanning so focus stays with the RIS. Exclusions are applied before value reads, and the result is grouped into named context sections. No scan runs at startup, and the standalone utility has no AI or network path.

## Attached panel rules

- Panels live in a panel deck inside the Orb's native window.
- Opening Text & Chat, Review, Context, or Account grows a connected right-side blob. Text is on the left and the larger Chat pane on the right; on a narrow surface Chat moves above Text. Each state uses a bounded native preset and stays open until its opener is clicked again; action settings can also be closed from within the panel. The captured external text is automatically discussion context and is not copied through the UI. A Chat `Vorschlag ins Textfeld` request creates a local, draggable proposal; it never writes to the captured field. An AI action may be configured with `Vor Übernahme im Editor prüfen`: its result opens as complete text in the same Text pane, `Zur Prüfung` moves the edited text into Review, and only `Übernehmen` writes to the explicitly locked external field. Assessment keeps the complete original text visible and uses a labelled `Beurteilung: …` addendum; an unchanged result appends only that addendum.
- The closed Halo Cub is 180 × 190 px by default, with a 140 × 140 px 3×3 board and 28 px edge controls. Right-clicking the core toggles a 360 × 380 px standard floating Cub; this is still the same single-window companion, not a desktop workspace. Attached panels keep their existing native sizes and begin outside the outer edge controls.
- Only the center signal core is a `-webkit-app-region: drag` zone. Buttons, inputs, panels, and text areas are `no-drag`; no renderer pointer-move loop is used.
- The panel deck is a separate grid track in normal layout flow; it never covers or squeezes the 3×3 board with an unrelated absolute overlay.
- Action settings expose the complete per-user function prompt. Text actions include the `{{TEXT_BLOCK}}` template token; the current workfield is inserted there, or appended as a clearly delimited block when a custom prompt omits it. Chat receives the current workfield and the latest action notes; an explicitly requested reusable correction may return a structured `text` block, while discussion-only replies stay plain and concise.

## Visual system

- Use the dark teal surface, cyan accent, amber processing state, red recording state, and blue source state.
- Follow a 4-px spacing rhythm, strong focus rings, and compact but touchable controls. Use neutral dark fills for inactive surfaces; reserve red for recording/failure and amber for processing or review warnings.
- Keep the center calm when idle. It shows an IP-neutral signal-core mark; only while the LLM is working does one slow, restrained orbital indicator appear.
- Keep all long messages in accessible live regions or attached panels; the closed Orb stays visually quiet. The last result opens in the right panel as editable complete Text by default, with an optional character-level before/after Diff for shifted text and a separate notes area for changes and clinical/logical review points.

## Clinical safety

The RIS remains authoritative. Correction may repair language and dictation artifacts only. Structure and assessment use supplied content and mark missing basis rather than inventing it. Preserve facts, numbers, units, laterality, anatomy, negation, uncertainty, dates, temporal qualifiers, and recommendations. Non-chat actions return one compact envelope: only `text` is eligible for field transfer; changes and possible logical/medical problems stay outside the field in Chat and below the result text, and are never silently changed. The default workflow imports the explicitly copied source text and copies the complete result back for deliberate paste/check; only the separate experimental UIA diagnostic may attempt direct replacement after target identity validation and verified read-back. Assessment appends the labelled `Beurteilung: …` addendum below the existing content. A proposal requested from Chat is always manual and starts in the local Text pane. Manual review can be required per action before either replacement or append. Chat is the only verbose surface and never writes back.

## References

The experimental UIA path follows [IUIAutomation::GetFocusedElement](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomation-getfocusedelement), [Obtaining UI Automation Elements](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-obtainingelements), [TextPattern.GetSelection](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.textpattern.getselection), and [UI Automation TextPattern](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-textpattern-overview). The Field Mapper scans the application subtree rather than the whole desktop, following [IUIAutomationElement::FindAll](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationelement-findall). The default DMO/RIS path is explicit clipboard import. Native movement and bounded panel resizing follow Electron's [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) and [Window Customization](https://www.electronjs.org/docs/latest/tutorial/window-customization) guidance. General spacing and accessibility follow Fluent 2 and WCAG 2.1 AA.
