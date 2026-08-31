# RadIMO – ReportHalo

RadIMO – ReportHalo is a Windows-only floating companion for radiology reporting. It stays beside the RIS, Word, or another editor and applies short, existing-text-first actions to the active report field. The source application remains authoritative: a foreign field must be explicitly activated, and its identity is checked again before text is written back. Chat is the only verbose surface.

<p align="center">
  <img src="docs/assets/reporthalo-orb-real.png" alt="RadIMO ReportHalo Mini Orb" width="520">
</p>

*Current anonymized Mini Orb renderer capture.*

## Mission

Keep the reporting workflow in the window where the report is already being written. ReportHalo provides a quiet 3×3 Orb for dictation, language cleanup, text preparation, assessment, and review. It is a small field tool, not a second desktop application and not a replacement for radiologist judgement.

## Release shape

| Area | Current direction |
| --- | --- |
| UI | Mini-only, always-on-top Floating Orb; base window 360 × 380 px |
| Panels | Attached Text & Chat workspace, Review, Context, and Account panels; panels move with the Orb |
| AI paths | Codex subscription through the official local runtime, or a smaller direct Responses API build for OpenAI/Azure OpenAI |
| Packaging | Windows x64 portable build and per-user installer; Codex is not embedded in the app |
| Data boundary | API credentials stay in the Electron main process and use encrypted local storage; direct API conversations use local manual history |
| Status | Unsigned release candidate; not a certified medical device and never the sole basis for a clinical decision |

## The 3×3 Orb

The current German labels are the primary workflow; the icon and tooltip remain available when the Orb is closed.

| Position | Function | What it does |
| --- | --- | --- |
| Top left | **Arbeitsfeld** | Locks the focused external field, or accepts explicitly dropped text. The small X releases the field or clears the local source. |
| Top middle | **Ausformulieren** | Makes existing report text clearer without adding unsupported facts. |
| Top right | **Diktat** | Records a short dictation, transcribes it, and keeps the transcript pending until insertion is requested. |
| Middle left | **Lektorat** | Repairs spelling, grammar, punctuation, dictation artifacts, and report style. Medical or logical concerns are reported in Chat, not silently changed. |
| Center | **Agent-Kern** | Shows ready, working, or offline state and is the drag area for moving the Orb. Right-click opens settings, account, per-action prompts, and close. |
| Middle right | **Einsetzen** | Applies a reviewed result to the explicitly activated field after the target is revalidated. |
| Bottom left | **Strukturieren** | Organizes and completes supplied text while preserving measurements, negations, uncertainty, and other report facts. |
| Bottom middle | **Beurteilung ergänzen** | Adds a draft assessment below the existing content; it does not replace the report. |
| Bottom right | **Ergebnis prüfen** | Opens a before/after diff and an editable result view. Copy, save, manual revision, and deliberate transfer are available there. |

The right edge opens **Text & Chat** or **Kontext**. The lower edge opens Chat directly. Captured external text is automatically discussion context; a proposal created by Chat starts in the local Text pane and never writes to the foreign field by itself.

## Safety boundary

Lektorat is conservative. ReportHalo preserves numbers, units, laterality, anatomy, negations, uncertainty, dates, temporal qualifiers, and recommendations. Non-chat actions return a compact result: only `text` can be transferred, while `changes`, unclear points, and possible logical or medical issues stay in Chat. Manual review can be required per action. The RIS or editor remains the authoritative record.

## Run and build

```bash
npm ci
npm run check
npm start                 # Codex subscription path
npm run start:api         # direct OpenAI/Azure OpenAI path
```

For a release check, run `npm run release:gate`. The Codex build reuses an existing official installation or the pinned, checksum-verified installer helper included with the release. `npm run dist:api` creates the smaller API-only package without the Codex source or payload.

## Links and license

- [Product page](https://maxrusse.github.io/RadIMO-ReportHalo/)
- [UI standard](docs/ui-guidelines.md)
- [End-user license agreement](EULA.txt)
- [Public repository](https://github.com/maxrusse/RadIMO-ReportHalo)

The project uses the proprietary, revocable licensing model used by RadIMO Cortex. `LICENSES/Apache-2.0.txt` applies only to the external Codex notice.
