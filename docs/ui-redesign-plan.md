# RadimoAgent UI redesign plan

Status: Phase 1 implemented; workflow/artifact hardening remains

## Product decision

RadimoAgent should have two coordinated surfaces:

1. **Helper**: the primary RIS-side surface for capture, dictation, structuring, artifact review, and transfer.
2. **Desktop**: a calm discussion workspace for medical/logical review, differential discussion, evidence, and case history. The RIS remains the report editor.

The Helper and Desktop share one case/workflow state. They are not two independent chats.

## Naming

- Desktop activity minimap → **Arbeitsradar**
- Helper central status area → **Radimo Helfer**
- A generated result → **Artefakt**
- A selected external field → **Zielbindung**
- A fresh independent conversation → **Neuer Fall**

## Simplifications

Remove from the primary desktop flow:

- six orbiting moon controls;
- ambiguous `Explore`, `Assist`, and decorative action buttons;
- duplicated context/reference/capture surfaces shown at the same time;
- unrestricted automatic write-back;
- the assumption that the complete conversation is the thing returned to a clinical field.

Keep the existing capabilities, but put them behind clear sections and explicit actions.

## Helper structure

The Helper is a narrow vertical panel:

1. **Header**: RadimoAgent, current case, close/minimize.
2. **Arbeitskern**: mode, target, and truthful live phase.
3. **Primary action**: `Bericht diktieren` or `Feld erfassen`.
4. **Zielbindung**: `Befund`, `Beurteilung`, or no target; lock/release.
5. **Artefakte**: `Befund`, `Beurteilung`, `Korrektur`, `Diskussion`.
6. **Next actions**: `Strukturieren`, `Im Desktop diskutieren`, `Übernehmen`, `Kopieren`.

No moon navigation is needed in this surface. The current state and the next safe action should be visible without opening another menu.

## Desktop structure

Use a three-column layout:

- **Navigation**: Fälle, Bericht, Diskussion, Quellen, Aktivität, Einstellungen.
- **Primary workspace**: open case discussion; selected report artifacts remain separate from the RIS.
- **Arbeitsradar**: current workflow phase, artifacts, target lock, source status, and recent actions.

The default desktop screen should show one task, one primary action, and one clear safety state. Advanced reference/context tools open as secondary panels instead of competing with the report.

## Workflow state

Every workflow carries:

```text
caseId
origin: helper | desktop
mode: dictate | structure | correction | discussion | differential | conclusion
target: none | Befund | Beurteilung | selected-field
targetIdentity: process/window/control identity when external
artifacts: raw-dictation, Befund-draft, Beurteilung-draft, correction, discussion, sources
phase: idle | capturing | structuring | reviewing | ready | transferring | blocked
```

The model may create artifacts, but only the user can approve a transfer. A transfer always selects one artifact and one target. The complete chat is never pasted into a clinical field.

## Live status

Use event-driven phases, not invented percentages:

- `Diktat wird erfasst`
- `Befund wird strukturiert`
- `Beurteilung wird geprüft`
- `Kontext wird gelesen`
- `Differenzialdiagnose wird vorbereitet`
- `Quellen werden geprüft`
- `Entwurf bereit`

The Arbeitskern can use a restrained pulse/orbit animation during an active phase, but must stop animating when the turn ends or fails.

## Implementation phases

### Phase 1 — visual foundation — implemented

- Replace moon layout with the Helper panel and three-column Desktop shell.
- Establish German-first typography, spacing, state colors, buttons, tabs, and panels.
- Keep existing IPC and model behavior behind the new layout.
- Use short German-first labels and remove moon controls from both surfaces.
- Use a vertical helper by default, with a compact Mini view.

### Phase 2 — workflow and artifacts — in progress

- Add one shared workflow state in the main process. **Implemented in memory:** case ID, origin, field type, mode, phase, target, and named artifacts are broadcast to both windows.
- Store local Markdown artifacts with a small manifest.
- Add artifact-specific copy, discussion, save, and transfer actions. **Current implementation:** field-specific copy/write-back and helper-to-desktop discussion handoff; explicit disk persistence remains.

### Phase 3 — safe transfer

- Add explicit target section detection or user selection.
- Revalidate the latest locked window/control before transfer.
- Show a before/after diff for Befund and Beurteilung.
- Stop transfer when target identity or section has changed.

### Phase 4 — review workspace

- Keep report editing in the RIS; use the desktop for discussion and selected artifact review.
- Add discussion, differential, and source panels as secondary views.
- Add `Neuer Fall` to clear the conversation while retaining optional saved artifacts.

### Phase 5 — validation

- Renderer smoke tests for both surfaces.
- Workflow transition tests.
- Artifact isolation tests proving that full chat cannot be written to a field.
- Target identity and changed-window tests.
- German UI text and Markdown guidance checks.

## Design rule

Every screen should answer three questions immediately:

1. What am I doing now?
2. What text or field is the current target?
3. What is the one safe next action?
