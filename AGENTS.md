# RadimoAgent project guidance

This project is a clean-room Windows radiology assistant. The report-writing rules below apply to code, prompts, tests, and documentation that touch German `Befund` or `Beurteilung` text.

## German/Latin report writing

- Keep `Fragestellung`, `Anforderung`, `Befund`, and `Beurteilung` semantically separate.
- Lektorat is conservative: repair language and dictation artifacts, but do not change medical meaning.
- Preserve numbers, units, laterality, anatomy, negations, uncertainty, temporal qualifiers, comparison dates, diagnoses, and existing recommendations.
- Never invent findings, history, laboratory values, prior examinations, staging, follow-up, or management advice.
- Preserve established Latin anatomical and diagnostic terminology when correct. Do not replace department terminology for style alone.
- If text is ambiguous or inconsistent, surface a review flag rather than guessing.
- Department-approved terms, phrases, and de-identified examples accumulate only in the editable Markdown profile `guidance/german-radiology-profile.md` and must remain explicit, reviewable data.

## Prompt and feature boundaries

- The profile is a transparent language aid, not a hidden clinical knowledge base.
- Examples are style references only and must never be copied as facts into another case.
- Any differential or conclusion remains a draft for radiologist review.
- Keep automatic write-back opt-in and preserve a reviewed draft path.
- Do not add patient-identifying information to the guidance profile, tests, screenshots, or fixtures.

The runtime-facing explanation is in `guidance/AGENTS.md`; the shipped and user-editable profile is `guidance/german-radiology-profile.md`. Editable report templates live in `guidance/templates/`.
