# RadIMO – ReportHalo

RadIMO – ReportHalo is a small Windows companion for radiology reporting. It stays beside the RIS, Word, or editor where the report is written. The source application remains authoritative: bring text in deliberately, review the complete result, and paste it back deliberately. ReportHalo does not inspect or control foreign windows.

<p align="center">
  <img src="docs/assets/reporthalo-orb-real.png" alt="RadIMO ReportHalo Orb" width="520">
</p>

*Anonymized screenshot of the closed Orb.*

## Mission

Keep report assistance close to the existing work surface without creating a second document application. The compact 3×3 Halo Cub provides dictation, language cleanup, text organization, assessment drafts, review, and chat. It is a drafting aid, not a medical device or a substitute for radiologist judgment.

## Current release shape

- Windows x64 portable Codex build, direct API build, and per-user installer
- Codex subscription path through the official local Codex installation, or a smaller OpenAI/Azure OpenAI Responses API path
- Compact 180 × 190 px Orb by default; an optional larger floating Cub is still the same window
- Attached Text & Chat, Review, Context, and Account panels
- No embedded Codex executable and no generic RIS field scanner

## The 3×3 controls

| Position | Function | Purpose |
| --- | --- | --- |
| Top left | **Text source** | Import copied DMO/RIS text or drop text here. |
| Top middle | **Write clearly** | Rephrase existing text without adding facts. |
| Top right | **Dictate** | Record, transcribe, and prepare a short dictation. |
| Middle left | **Proofread** | Correct relevant spelling, grammar, punctuation, and dictation artifacts. |
| Center | **Agent core** | Shows status and is the native drag handle. Right-click opens settings and close. |
| Middle right | **Copy result** | Copy the reviewed result for deliberate paste-back. |
| Bottom left | **Structure** | Reorder supplied text without inventing missing content. |
| Bottom middle | **Add assessment** | Add a labelled `Beurteilung: …` draft below the supplied text. |
| Bottom right | **Review result** | Edit the complete result, inspect a character-level diff, and copy or save it. |

The right edge opens the shared Text & Chat or Context panel. The lower edge opens Chat. Function prompts can be edited per user from the core menu or a button's right-click menu. The `{{TEXT_BLOCK}}` token controls where the current text is placed in a custom prompt.

## Text workflow and safety

For DMO/RIS, select the relevant text, press `Ctrl+C`, and choose **Zwischenablage übernehmen**. Text can also be dropped onto the top-left cell or edited in the local Text pane. Results are complete local drafts. Lektorat replaces the local text block; Beurteilung keeps the supplied text visible and creates a `Beurteilung: …` addendum. Changes, unclear points, and possible medical or logical issues stay outside the text and are shown below it and in Chat. No result is written into a foreign application or described as RIS-validated.

The medical gate preserves numbers, units, laterality, anatomy, negations, uncertainty, dates, temporal qualifiers, and recommendations. Results must be checked against the original report and clinical context before use. ReportHalo is not a certified medical device.

## Run and build

```bash
npm ci
npm run check
npm start                 # Codex subscription path
npm run start:api         # direct OpenAI/Azure OpenAI path
npm run release:gate
```

`npm run dist:codex` creates the portable Codex ZIP and executable. `npm run dist:api` creates the API-only executable. `npm run dist:installer` creates the per-user Windows installer. Release binaries are published as draft assets in [GitHub Releases](https://github.com/maxrusse/RadIMO-ReportHalo/releases); Codex is installed separately when needed through the checksum-verified release helper.

API credentials stay in the Electron main process and use encrypted local storage. The API build supports OpenAI and Azure OpenAI, local conversation history, streaming responses, and provisional daily/monthly token limits. Azure pricing is not inferred as a billing amount.

## Links and license

- [Product page](https://maxrusse.github.io/RadIMO-ReportHalo/)
- [UI standard](docs/ui-guidelines.md)
- [End-user license agreement](EULA.txt)
- [Public repository](https://github.com/maxrusse/RadIMO-ReportHalo)

The project uses the proprietary, revocable licensing model used by RadIMO Cortex. `LICENSES/Apache-2.0.txt` applies only to the external Codex notice.
