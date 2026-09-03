const {
  focusSafeMappedField,
  readSafeFocusedField,
  scanSafeFieldWindow,
  writeSafeFocusedField,
} = require("./windows-safe-field-bridge");

// The product field path is deliberately limited to clipboard or the narrow
// UIA bridge. Native window injection, keystroke replay, and PowerShell
// execution-policy bypasses are not part of the released client.
async function readFocusedField(options = {}) {
  if (options.accessMode === "clipboard") return { ok: false, error: "clipboard-source-required", accessibility: "clipboard" };
  return readSafeFocusedField(options);
}

async function writeFocusedField(options = {}) {
  return writeSafeFocusedField(options);
}

async function scanFieldWindow(options = {}) {
  if (options.accessMode === "clipboard") return { ok: false, error: "clipboard-diagnostic-disabled", accessibility: "clipboard" };
  return scanSafeFieldWindow(options);
}

async function focusMappedField(options = {}) {
  if (options.accessMode === "clipboard") return { ok: false, verified: false, error: "clipboard-target-disabled", accessibility: "clipboard" };
  return focusSafeMappedField(options);
}

module.exports = { focusMappedField, readFocusedField, scanFieldWindow, writeFocusedField };
