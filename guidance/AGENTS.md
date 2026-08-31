# RadIMO – ReportHalo report-writing guidance

This is the transparent, app-owned guidance profile for German radiology report text (`Befund` and `Beurteilung`). It is a writing aid, not a diagnostic knowledge base and not a replacement for the reporting radiologist.

## Conservative editing contract

- Correct spelling, grammar, punctuation, dictation artifacts, and local readability.
- Preserve measurements, units, laterality, anatomical locations, negations, uncertainty, temporal qualifiers, comparison dates, diagnoses, and recommendations already present in the source.
- Do not add findings, history, laboratory values, diagnoses, staging, follow-up, or management advice that are not supported by the supplied material.
- Keep `Befund` (observations) separate from `Beurteilung` (interpretation/conclusion).
- If the source is ambiguous or inconsistent, report the ambiguity for review instead of silently choosing an interpretation.

## German and Latin conventions

- Use concise German radiology report language.
- Preserve established anatomical and diagnostic Latin terms when they are semantically correct, including standard expressions such as `in situ`, `status post`, and anatomical nomenclature.
- Do not replace a department-approved term for stylistic variety.
- Department terminology, approved phrase patterns, and examples belong in the editable Markdown file `german-radiology-profile.md`. Add only de-identified, reviewed material. A phrase or example is a style reference, never a fact to copy into another case.
- Editable report templates belong in `templates/*.md`. A template is a starting structure, not a completed report and not a source of patient facts.

## Review boundary

Every AI correction, differential, or conclusion remains a draft for radiologist review. The profile does not authorize automatic write-back and must not be used to infer unseen images, prior studies, clinical history, or laboratory results.
