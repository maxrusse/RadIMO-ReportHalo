# RadIMO ReportHalo release checklist

This checklist separates automated repository gates from the checks that require a real Windows desktop and a clinical test environment.

## Automated gate

Run from the repository root:

```powershell
npm ci
npm run release:gate
npm run dist:codex
npm run dist:api
npm run dist:installer
npm run release:artifacts
```

The gate verifies the pinned external Codex installer metadata, secure endpoint rules, package contents, lockfile consistency, focused regression tests, syntax, Windows preflight, and high-severity npm advisories. Artifact verification confirms that the three Windows delivery paths do not embed a Codex executable and that the portable package checksums are complete.

## Manual Windows acceptance

- Start the portable Codex-mode executable with a fresh `--user-data-dir`; confirm that an existing official Codex installation is discovered without downloading another copy.
- On a clean machine without Codex, run `Install-Codex.ps1` from the release folder or use the NSIS installer, then confirm the same startup path works.
- Start the API-mode executable and verify OpenAI and Azure configuration separately, using HTTPS endpoints and a small non-PHI test document.
- Exercise capture, active-window context, chat, Lektorat, Beurteilung, copy/paste proposal mode, movable panels, right-click settings, and graceful close.
- Check that edits preserve numbers, units, laterality, negations, uncertainty, and dates; review flags must remain separate from replacement text.
- Confirm the app remains responsive while dragging and while a model request is running.

## Before a public production release

- Sign all Windows executables with the project certificate and verify the signature on a clean machine.
- Record the exact release version, commit, SHA256SUMS, and Codex runtime manifest.
- Complete live RIS/window-capture and Azure acceptance in the intended deployment environment.
- Review the OpenAI and Codex terms, model availability, API pricing, retention, and organization login policy for the release date.
- Create a version tag matching `package.json` (for example `v0.2.11`) only after the manual acceptance checks are green.
