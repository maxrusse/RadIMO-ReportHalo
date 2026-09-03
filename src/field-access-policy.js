const EXPERIMENTAL_UIA_ENV = "RADIMO_ENABLE_EXPERIMENTAL_UIA";

function experimentalUiaEnabled(env = process.env) {
  return String(env?.[EXPERIMENTAL_UIA_ENV] || "") === "1";
}

function blockedFieldAccessResult({ operation = "field-access", clipboard = false } = {}) {
  return {
    ok: false,
    verified: false,
    error: clipboard ? `${operation}-clipboard-mode` : "uia-disabled-by-policy",
    accessibility: clipboard ? "clipboard" : "uia-disabled",
    strategy: clipboard ? "clipboard-only" : "experimental-uia-disabled",
  };
}

function unavailableFieldAccessResult({ operation = "field-access" } = {}) {
  return {
    ok: false,
    verified: false,
    error: "experimental-uia-bridge-unavailable",
    accessibility: "uia-unavailable",
    strategy: "experimental-uia-missing",
    operation,
  };
}

module.exports = { EXPERIMENTAL_UIA_ENV, blockedFieldAccessResult, experimentalUiaEnabled, unavailableFieldAccessResult };
