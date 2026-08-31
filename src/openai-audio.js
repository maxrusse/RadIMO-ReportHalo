const { assertSecureApiUrl } = require("./agent-api-config");

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const TRANSCRIPTION_PROMPT = [
  "German radiology dictation.",
  "Preserve measurements, units, laterality, negations, uncertainty, comparison dates, and established Latin anatomical terms.",
  "Transcribe only what was spoken; do not correct, interpret, or add clinical content.",
].join(" ");

const AUDIO_EXTENSIONS = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
]);

function baseMimeType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function normalizeAudioPayload(payload) {
  if (!payload || !(payload.bytes instanceof ArrayBuffer || ArrayBuffer.isView(payload.bytes))) {
    throw new Error("No audio recording was received.");
  }
  const bytes = Buffer.from(
    payload.bytes instanceof ArrayBuffer
      ? payload.bytes
      : payload.bytes.buffer.slice(payload.bytes.byteOffset, payload.bytes.byteOffset + payload.bytes.byteLength),
  );
  if (!bytes.length) throw new Error("The audio recording is empty.");
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error("The recording is too large. Keep one dictation segment below 20 MB.");
  const mimeType = baseMimeType(payload.mimeType);
  const extension = AUDIO_EXTENSIONS.get(mimeType);
  if (!extension) throw new Error(`Unsupported audio format: ${mimeType || "unknown"}.`);
  return { bytes, mimeType, extension };
}

function validateApiKey(value) {
  const key = String(value || "").trim();
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error("Enter a valid OpenAI API key.");
  return key;
}

function validateAzureCredential(value) {
  const credential = String(value || "").trim();
  if (!credential || /\s/.test(credential) || credential.length < 8) throw new Error("Enter a valid Azure OpenAI key or bearer token.");
  return credential;
}

function transcriptionForm(audio) {
  const form = new FormData();
  form.append("file", new Blob([audio.bytes], { type: audio.mimeType }), `radimoagent-dictation.${audio.extension}`);
  form.append("language", "de");
  form.append("prompt", TRANSCRIPTION_PROMPT);
  form.append("response_format", "json");
  return form;
}

async function probeTranscriptionModel({ apiKey, fetchImpl, model = DEFAULT_TRANSCRIPTION_MODEL } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("No OpenAI transport is available.");
  const key = validateApiKey(apiKey);
  const response = await fetchImpl(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let detail = body;
    try { detail = JSON.parse(body)?.error?.message || body; } catch { /* use plain response */ }
    const prefix = response.status === 401
      ? "OpenAI rejected the API key"
      : response.status === 403
        ? "The API project cannot access the transcription model"
        : response.status === 404
          ? "The transcription model is unavailable for this API project"
          : response.status === 429
            ? "The OpenAI project is rate- or spend-limited"
            : `OpenAI readiness check failed (${response.status})`;
    throw new Error(`${prefix}: ${String(detail || response.statusText).slice(0, 300)}`);
  }
  const result = await response.json();
  if (result?.id !== model) throw new Error("OpenAI returned an unexpected model response.");
  return { ok: true, model: result.id };
}

async function transcribeAudio({ payload, apiKey, fetchImpl, model = DEFAULT_TRANSCRIPTION_MODEL } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("No OpenAI transport is available.");
  const key = validateApiKey(apiKey);
  const audio = normalizeAudioPayload(payload);
  const form = transcriptionForm(audio);
  form.append("model", model);

  const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = body;
    try { message = JSON.parse(body)?.error?.message || body; } catch { /* use the plain response */ }
    throw new Error(`OpenAI transcription failed (${response.status}): ${String(message || response.statusText).slice(0, 300)}`);
  }
  const result = await response.json();
  const text = typeof result?.text === "string" ? result.text.trim() : "";
  if (!text) throw new Error("OpenAI returned an empty transcription.");
  return { text, model, bytes: audio.bytes.length };
}

function azureResourceEndpoint(endpoint) {
  const value = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!value) throw new Error("Azure OpenAI endpoint missing.");
  let url;
  try { url = new URL(value); } catch { throw new Error("Azure OpenAI endpoint is invalid."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Azure OpenAI endpoint must be a safe HTTP(S) address.");
  assertSecureApiUrl(url, "Azure OpenAI endpoint");
  url.pathname = url.pathname.replace(/\/openai\/v1$/i, "").replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

async function transcribeAzureAudio({ payload, apiKey, authMode = "api-key", endpoint, deployment, apiVersion = "2024-10-21", fetchImpl } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("No Azure OpenAI transport is available.");
  const credential = validateAzureCredential(apiKey);
  const audio = normalizeAudioPayload(payload);
  const deploymentName = String(deployment || "").trim();
  if (!deploymentName) throw new Error("Azure-Diktat benötigt ein Audio-Deployment.");
  const version = String(apiVersion || "2024-10-21").trim();
  const url = `${azureResourceEndpoint(endpoint)}/openai/deployments/${encodeURIComponent(deploymentName)}/audio/transcriptions?api-version=${encodeURIComponent(version)}`;
  const headers = authMode === "api-key" ? { "api-key": credential } : { Authorization: `Bearer ${credential}` };
  const form = transcriptionForm(audio);
  form.append("model", deploymentName);
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = body;
    try { message = JSON.parse(body)?.error?.message || body; } catch { /* use the plain response */ }
    throw new Error(`Azure OpenAI transcription failed (${response.status}): ${String(message || response.statusText).slice(0, 300)}`);
  }
  const result = await response.json();
  const text = typeof result?.text === "string" ? result.text.trim() : typeof result === "string" ? result.trim() : "";
  if (!text) throw new Error("Azure OpenAI returned an empty transcription.");
  return { text, model: deploymentName, bytes: audio.bytes.length, provider: "azure" };
}

module.exports = {
  DEFAULT_TRANSCRIPTION_MODEL,
  MAX_AUDIO_BYTES,
  TRANSCRIPTION_PROMPT,
  normalizeAudioPayload,
  probeTranscriptionModel,
  transcribeAzureAudio,
  transcribeAudio,
  validateAzureCredential,
  validateApiKey,
};
