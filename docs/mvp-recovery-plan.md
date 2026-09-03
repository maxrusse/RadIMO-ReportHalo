# RadIMO – ReportHalo recovery plan

## Product target

ReportHalo is a small Windows reporting companion for radiologists. The RIS, Word, or other editor remains authoritative. The product starts as one always-on-top, icon-first Cub with attached Text, Chat, Context, Review, and Account panels.

## Current baseline

- Compact 3×3 Cub with native dragging and an optional larger size.
- Explicit clipboard and drag-and-drop text input; no generic foreign-window field scanner.
- Codex subscription build and a direct OpenAI/Azure OpenAI API build with a shared action contract.
- Local audio recording and main-process transcription with protected API-key handling.
- Complete result text, optional character-level review diff, notes, local draft save, and deliberate paste-back.
- Correction is conservative; assessment is a labelled addendum; Chat is the only verbose surface.

## Field-access decision

The generic field-selector experiment is retired. DMO/RIS controls do not expose one dependable cross-vendor contract: a field may accept cursor dictation without exposing a readable or safely writable text control. Enumerating controls would also create an unnecessary security and anti-ransomware surface. ReportHalo therefore does not inspect, focus, inject into, or write to another process.

If a future RIS vendor supplies a supported integration contract, it should be added as a separate, reviewed adapter with explicit installation and permission boundaries. It must not silently become a generic scanner.

## Verification gates

- `npm run check` parses product and packaging source.
- `npm test` runs the release contract tests.
- `npm run release:gate` validates the clean tree, locked dependencies, runtime manifest, tests, syntax, and packaging contracts.
- Windows release builds contain the portable Codex ZIP, portable API executable, and per-user installer. None embeds the Codex executable; the installer helper performs a checksum-verified post-install when required.
- Manual acceptance must verify startup, native movement, attached-panel geometry, clipboard round-trip, complete correction output, assessment append behavior, and the absence of foreign-window automation.

## Deferred work

Vendor-supported RIS integration, signing/certification, real-time transcription, and production pricing remain separate projects. They require confirmed external contracts, security review, and clinical acceptance before entering the release path.
