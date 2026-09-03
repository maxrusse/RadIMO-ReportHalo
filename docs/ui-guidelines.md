# RadIMO – ReportHalo UI standard

## Direction

ReportHalo is one compact Halo Cub beside the active RIS, Word, or editor window. The closed state is icon-first and nearly text-free. Chat, Textquelle, Context, Review, and Account are attached panels in the same native window and move with the Cub.

## Stable 3×3 map

| Position | Function |
| --- | --- |
| top left | import copied text or accept a text drop |
| top middle | write clearly |
| top right | dictate |
| middle left | proofread |
| center | quiet status mark and native drag handle |
| middle right | copy result |
| bottom left | structure supplied text |
| bottom middle | add assessment |
| bottom right | review result |

The right edge opens Text & Chat or Context. The lower edge opens Chat. Right-clicking the core opens account, prompt settings, size, hide, and close. Right-clicking a prompt-bearing action opens that action's settings. No permanent header bar or second desktop workspace is used.

## Text source and DMO/RIS boundary

The top-left cell is a local text source, not a foreign-window selector. The supported cross-RIS workflow is:

1. Select the relevant text in DMO/RIS and press `Ctrl+C`.
2. Choose **Zwischenablage übernehmen**, or drop text on the top-left cell.
3. Run an action, review the complete local result, and edit it if needed.
4. Use **Für DMO/RIS kopieren** and paste with `Ctrl+V` in the intended target.

ReportHalo does not inspect, focus, inject into, or write to another process. It cannot validate that a foreign application accepted a paste; the target application and the reporting clinician remain authoritative. A direct vendor-specific integration would require a supported target-app/API contract and is outside this generic client.

## Result workflow

Correction, writing, and structure return one complete local text block. Lektorat changes only relevant spelling, grammar, punctuation, and clear dictation errors; existing headings and OPB remain unchanged. Changes, unclear points, and visible logical or medical concerns stay outside the text, below the result and in Chat. An incomplete correction is held for manual review.

Assessment keeps the original text visible and adds a labelled `Beurteilung: …` block. When copied, only that addendum is intended for appending below the existing report. A Chat proposal always opens in the local Text pane and never changes another application.

The result panel opens in editable Text view. Diff is optional and compares changed lines at character level with bounded alignment, which keeps small spelling edits readable even when text moved. The notes area and Chat contain the explanation; the text block stays suitable for direct reuse.

## Visual and performance rules

- Default closed Cub: 180 × 190 px with the 140 × 140 px board. The larger Cub is an optional size of the same window.
- Only the center is a native drag region. Buttons, inputs, panels, and text areas are `no-drag`.
- Native movement uses Electron window dragging; no renderer-side pointer-move loop is used.
- Panels use bounded native presets and remain connected to the Cub without covering the action board.
- Idle motion is minimal; one restrained working indicator is used and reduced-motion preferences are respected.
- Keep long explanations in Chat or attached panels. The closed Cub carries no long copy.

## Clinical boundary

The medical gate preserves facts, numbers, units, laterality, anatomy, negation, uncertainty, dates, temporal qualifiers, and recommendations. It does not invent unseen findings or clinical history. Every generated text is a draft for radiologist review, not a certified medical-device output or an autonomous clinical decision.
