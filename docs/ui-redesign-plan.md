# RadIMO – ReportHalo UI plan

Status: the compact Halo Cub is the only product surface. Longer workflows open as connected panels inside the same movable window.

## Product decision

ReportHalo stays beside the RIS, Word, or another editor as one always-on-top Orb. There is no large desktop mode, second BrowserWindow, or permanent header bar. The foreign editor remains authoritative. ReportHalo works on text that the user explicitly imports or drops and returns a local result for deliberate paste-back.

## Orb map

| Position | Action |
| --- | --- |
| top left | text source |
| top middle | write clearly |
| top right | dictate |
| middle left | proofread |
| center | status and drag handle |
| middle right | copy result |
| bottom left | structure |
| bottom middle | add assessment |
| bottom right | review |

The right edge opens Text & Chat or Context. The bottom edge opens Chat. The core's context menu contains account, settings, size, hide, and close. Each prompt-bearing button can open its own editable prompt. No action is duplicated between the board and edge controls.

## Text and result flow

The source flow is `select → Ctrl+C → import → action → review → copy → Ctrl+V`. Dropped text and Text-pane edits follow the same local path. The app does not enumerate or manipulate controls in a foreign window, because a generic field name is not a reliable integration contract across RIS products.

Lektorat returns the complete corrected text block and lists changes separately. Existing headings and OPB remain unchanged. Visible medical or logical problems are listed but not corrected. Beurteilung keeps the original text visible and adds `Beurteilung: …`; when the user copies it, only that addendum is prepared for appending below the original. Chat can discuss the result or create a local proposal, but never writes another application.

The Review panel starts in editable Text view and offers a bounded character-level Diff for shifted text. A manual review setting can keep an action in the editor before it becomes copy-ready. Long explanations stay in Chat; the closed Cub stays quiet.

## Performance and safety

- Only the center is a native drag region; no renderer pointer-move loop is used.
- Panels use bounded native presets and stay connected to the Cub without covering the board.
- The closed Cub is 180 × 190 px by default; the larger Cub is an optional size of the same window.
- Idle motion is minimal and reduced-motion preferences are respected.
- No PowerShell/UI Automation field bridge, key simulation, or foreign-window write path is shipped.
- The medical gate preserves facts, numbers, units, laterality, anatomy, negation, uncertainty, dates, temporal qualifiers, and recommendations.

## Future integration

A direct RIS connection is deferred until a vendor-supported API or target-app integration contract is available. Such an adapter would be separately permissioned, reviewed, and tested; it would not be implemented as a generic desktop field scanner.
