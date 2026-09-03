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

module.exports = { EXPERIMENTAL_UIA_ENV, blockedFieldAccessResult, experimentalUiaEnabled };
