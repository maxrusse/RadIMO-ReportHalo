const {
  focusSafeMappedField,
  readSafeFocusedField,
  scanSafeFieldWindow,
  writeSafeFocusedField,
} = require("./windows-safe-field-bridge");
const { blockedFieldAccessResult, experimentalUiaEnabled } = require("./field-access-policy");

// The product field path is deliberately limited to clipboard or the narrow
// UIA bridge. Native window injection, keystroke replay, and PowerShell
// execution-policy bypasses are not part of the released client.
async function readFocusedField(options = {}) {
  const mode = options.accessMode;
  if (mode !== "uia") return blockedFieldAccessResult({ operation: "field-read", clipboard: mode === "clipboard" });
  if (!experimentalUiaEnabled()) return blockedFieldAccessResult({ operation: "field-read" });
  return readSafeFocusedField(options);
}

async function writeFocusedField(options = {}) {
  const mode = options.accessMode || options.target?.accessMode;
  if (mode !== "uia") return blockedFieldAccessResult({ operation: "field-write", clipboard: mode === "clipboard" });
  if (!experimentalUiaEnabled()) return blockedFieldAccessResult({ operation: "field-write" });
  return writeSafeFocusedField(options);
}

async function scanFieldWindow(options = {}) {
  const mode = options.accessMode;
  if (mode !== "uia") return blockedFieldAccessResult({ operation: "field-scan", clipboard: mode === "clipboard" });
  if (!experimentalUiaEnabled()) return blockedFieldAccessResult({ operation: "field-scan" });
  return scanSafeFieldWindow(options);
}

async function focusMappedField(options = {}) {
  const mode = options.accessMode || options.target?.accessMode;
  if (mode !== "uia") return blockedFieldAccessResult({ operation: "field-focus", clipboard: mode === "clipboard" });
  if (!experimentalUiaEnabled()) return blockedFieldAccessResult({ operation: "field-focus" });
  return focusSafeMappedField(options);
}

module.exports = { focusMappedField, readFocusedField, scanFieldWindow, writeFocusedField };
