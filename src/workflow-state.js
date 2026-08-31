const crypto = require("node:crypto");

const FIELD_TYPES = new Set(["befund", "beurteilung", "fragestellung", "anforderung", "sonstiges"]);
const MODES = new Set(["dictate", "structure", "correction", "discussion", "differential", "conclusion", "proposal"]);
const PHASES = new Set(["idle", "capturing", "structuring", "reviewing", "ready", "transferring", "blocked"]);
const MAX_ARTIFACT_CHARS = 30_000;

function text(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeFieldType(value) {
  return FIELD_TYPES.has(value) ? value : "befund";
}

function normalizeMode(value) {
  return MODES.has(value) ? value : "discussion";
}

function normalizePhase(value) {
  return PHASES.has(value) ? value : "idle";
}

function createWorkflowState({ id = crypto.randomUUID(), fieldType = "befund", fieldLabel = "Befund" } = {}) {
  return {
    caseId: id,
    origin: "helper",
    mode: "discussion",
    fieldType: normalizeFieldType(fieldType),
    fieldLabel: text(fieldLabel, "Befund"),
    phase: "idle",
    target: "none",
    targetIdentity: null,
    artifacts: [],
    updatedAt: new Date().toISOString(),
  };
}

function copyState(state) {
  return JSON.parse(JSON.stringify(state));
}

function createWorkflowStore({ idFactory = () => crypto.randomUUID(), clock = () => new Date() } = {}) {
  let current = createWorkflowState({ id: idFactory() });
  const stamp = () => clock().toISOString();

  return {
    get() {
      return copyState(current);
    },
    startCase({ fieldType = "befund", fieldLabel = "Befund" } = {}) {
      current = createWorkflowState({ id: idFactory(), fieldType, fieldLabel });
      current.updatedAt = stamp();
      return this.get();
    },
    patch({ mode, fieldType, fieldLabel, phase, target, targetIdentity } = {}) {
      if (mode !== undefined) current.mode = normalizeMode(mode);
      if (fieldType !== undefined) current.fieldType = normalizeFieldType(fieldType);
      if (fieldLabel !== undefined) current.fieldLabel = text(fieldLabel, current.fieldLabel);
      if (phase !== undefined) current.phase = normalizePhase(phase);
      if (target !== undefined) current.target = text(target, "none");
      if (targetIdentity !== undefined) current.targetIdentity = targetIdentity || null;
      current.updatedAt = stamp();
      return this.get();
    },
    addArtifact({ kind = "draft", label = "Entwurf", detail = "Arbeitskopie", text: content = "" } = {}) {
      const value = text(content).trim().slice(0, MAX_ARTIFACT_CHARS);
      if (!value) return this.get();
      current.artifacts.push({
        id: idFactory(),
        kind: text(kind, "draft"),
        label: text(label, "Entwurf"),
        detail: text(detail, "Arbeitskopie"),
        source: "helper",
        text: value,
        createdAt: stamp(),
      });
      current.artifacts = current.artifacts.slice(-8);
      current.phase = "ready";
      current.updatedAt = stamp();
      return this.get();
    },
  };
}

module.exports = {
  FIELD_TYPES,
  MODES,
  PHASES,
  MAX_ARTIFACT_CHARS,
  createWorkflowState,
  createWorkflowStore,
};
