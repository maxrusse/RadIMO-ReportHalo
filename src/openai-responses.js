const fs = require("node:fs/promises");
const { buildTurnInstructions } = require("./medical-gate");
const { API_PROVIDERS, normalizeEndpoint } = require("./agent-api-config");
const { tokenCount } = require("./usage-budget");

const DEFAULT_API_MAX_OUTPUT_TOKENS = 2_048;
const ACTION_API_MAX_OUTPUT_TOKENS = 4_096;
const MAX_HISTORY_ITEMS = 14;
const MAX_HISTORY_BYTES = 140_000;

function responseText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value.output_text === "string") return value.output_text;
  if (Array.isArray(value.output)) return value.output.map((item) => responseText(item)).filter(Boolean).join("");
  if (Array.isArray(value.content)) return value.content.map((item) => responseText(item)).filter(Boolean).join("");
  if (typeof value.text === "string") return value.text;
  return "";
}

function ssePayload(block) {
  const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  if (!data || data === "[DONE]") return null;
  try { return JSON.parse(data); } catch { return null; }
}

async function* readSseEvents(response) {
  if (!response.body?.getReader) {
    const body = await response.text();
    let parsedEvent = false;
    for (const block of body.split(/\r?\n\r?\n/)) {
      const payload = ssePayload(block);
      if (payload) {
        parsedEvent = true;
        yield payload;
      }
    }
    if (!parsedEvent) {
      try { yield { type: "response.completed", response: JSON.parse(body) }; } catch { /* the caller reports an empty response */ }
    }
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const payload = ssePayload(block);
      if (payload) yield payload;
    }
  }
  buffer += decoder.decode();
  const payload = ssePayload(buffer);
  if (payload) yield payload;
}

function filterTextModels(data) {
  const entries = Array.isArray(data) ? data : [];
  const excluded = /embedding|moderation|transcri|whisper|tts|audio|image|dall|realtime|search/i;
  const filtered = entries.filter((entry) => !excluded.test(String(entry?.id || entry?.model || entry?.name || "")));
  return filtered.length ? filtered : entries;
}

class OpenAIResponsesBackend {
  constructor({ getConfig, getCredential, clearCredential = async () => {}, fetchImpl, usageBudget, onNotification = () => {} } = {}) {
    if (typeof getConfig !== "function" || typeof getCredential !== "function" || typeof fetchImpl !== "function") throw new Error("API backend is missing its configuration or transport.");
    this.getConfig = getConfig;
    this.getCredential = getCredential;
    this.clearCredential = clearCredential;
    this.fetchImpl = fetchImpl;
    this.usageBudget = usageBudget;
    this.onNotification = onNotification;
    this.history = [];
    this.started = false;
  }

  async start() {
    this.started = true;
  }

  async authStatus() {
    const config = await this.getConfig();
    const credential = await this.getCredential(config);
    return {
      backend: "api",
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model,
      authMethod: credential ? (credential.authMode === "api-key" ? "api-key" : "bearer") : null,
      credentialSource: credential?.source || null,
      environmentLocked: Boolean(config.providerLocked || config.endpointLocked || config.modelLocked),
    };
  }

  async startBrowserLogin() {
    throw new Error("Die direkte API-Version verwendet keinen ChatGPT-Browser-Login. Bitte einen API-Key konfigurieren.");
  }

  async logout() {
    await this.clearCredential();
    this.resetConversation();
    return { ok: true };
  }

  async resetConversation() {
    this.history = [];
    return { ok: true };
  }

  async startThread() {
    return { thread: { id: "api-local" } };
  }

  #model(config, requested) {
    const requestedModel = String(requested || "").trim();
    if (config.provider === API_PROVIDERS.AZURE) return config.model || requestedModel;
    return requestedModel || config.model;
  }

  #url(config, resource) {
    const endpoint = normalizeEndpoint(config.provider, config.endpoint);
    if (!endpoint) {
      throw new Error("Für Azure OpenAI fehlen Endpunkt und Deployment. Setze AZURE_OPENAI_ENDPOINT und AZURE_OPENAI_DEPLOYMENT oder konfiguriere sie in den Einstellungen.");
    }
    return `${endpoint}/${resource.replace(/^\/+/, "")}`;
  }

  #headers(config, credential, json = true) {
    const headers = {};
    if (json) headers["content-type"] = "application/json";
    if (config.provider === API_PROVIDERS.AZURE && credential.authMode === "api-key") headers["api-key"] = credential.key;
    else headers.authorization = `Bearer ${credential.key}`;
    return headers;
  }

  async #credentialOrThrow(config) {
    const credential = await this.getCredential(config);
    if (!credential) throw new Error(config.provider === API_PROVIDERS.AZURE ? "Azure-Zugang fehlt. API-Key oder statischen Bearer-Token konfigurieren." : "OpenAI API-Key fehlt. In den Einstellungen speichern.");
    return credential;
  }

  async #requestModels(config, credential) {
    const response = await this.fetchImpl(this.#url(config, "models"), {
      method: "GET",
      headers: this.#headers(config, credential, false),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let message = body;
      try { message = JSON.parse(body)?.error?.message || body; } catch { /* keep plain response */ }
      const error = new Error(`${config.provider === API_PROVIDERS.AZURE ? "Azure OpenAI" : "OpenAI"} Modellliste fehlgeschlagen (${response.status}): ${String(message || response.statusText).slice(0, 300)}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async listModels() {
    const config = await this.getConfig();
    if (config.provider === API_PROVIDERS.AZURE && !config.model) return { data: [] };
    const credential = await this.getCredential(config);
    if (!credential) return config.model ? { data: [{ id: config.model, displayName: config.model, provider: config.provider }] } : { data: [] };
    try {
      const result = await this.#requestModels(config, credential);
      const data = filterTextModels(result?.data).map((entry) => ({ ...entry, provider: config.provider }));
      return { ...result, data: data.length ? data : (config.model ? [{ id: config.model, displayName: config.model, provider: config.provider }] : []) };
    } catch (error) {
      if (config.provider === API_PROVIDERS.AZURE && [404, 405].includes(error.status) && config.model) {
        return { object: "list", data: [{ id: config.model, displayName: config.model, provider: config.provider }] };
      }
      throw error;
    }
  }

  async testConnection() {
    const config = await this.getConfig();
    if (config.provider === API_PROVIDERS.AZURE && !config.model) throw new Error("Für Azure OpenAI ist ein Text-Deployment erforderlich.");
    const credential = await this.#credentialOrThrow(config);
    try {
      await this.#requestModels(config, credential);
      return { reachable: true, provider: config.provider, model: config.model || null, endpoint: config.endpoint };
    } catch (error) {
      if (config.provider === API_PROVIDERS.AZURE && [404, 405].includes(error.status) && config.model) {
        return { reachable: true, provider: config.provider, model: config.model, endpoint: config.endpoint, modelsEndpoint: "not-supported" };
      }
      throw error;
    }
  }

  #remember(userItem, output) {
    const next = [...this.history, userItem, ...(Array.isArray(output) ? output : [])];
    if (!Array.isArray(output) || !output.length) next.push({ role: "assistant", content: [{ type: "output_text", text: responseText(output) }] });
    this.history = next.slice(-MAX_HISTORY_ITEMS);
    while (Buffer.byteLength(JSON.stringify(this.history), "utf8") > MAX_HISTORY_BYTES && this.history.length > 2) this.history.splice(0, 2);
  }

  async sendTurn({ text, model, effort = "low", outputSchema = null, medicalGate = true, evidenceMode = false, radiologyMode = false, imagePath = null, assistantMode = "discussion", writingGuidance = "", fieldType = "befund", fieldLabel = "" } = {}) {
    const config = await this.getConfig();
    const credential = await this.#credentialOrThrow(config);
    const selectedModel = this.#model(config, model);
    if (!selectedModel) throw new Error("Für Azure OpenAI ist ein Deployment-Name erforderlich.");
    const instructions = buildTurnInstructions({ medicalGate, evidenceMode, radiologyMode, imageAttached: Boolean(imagePath), assistantMode, writingGuidance, fieldType, fieldLabel });
    const guardedText = instructions ? `[RadIMO ReportHalo safety instructions]\n${instructions}\n[/RadIMO ReportHalo safety instructions]\n\n${text}` : String(text || "");
    const content = [{ type: "input_text", text: guardedText }];
    if (imagePath) {
      const bytes = await fs.readFile(imagePath);
      content.push({ type: "input_image", image_url: `data:image/png;base64,${bytes.toString("base64")}`, detail: "high" });
    }
    const userItem = { role: "user", content };
    const historyUserItem = { role: "user", content: [{ type: "input_text", text: guardedText }] };
    const maxOutputTokens = outputSchema ? ACTION_API_MAX_OUTPUT_TOKENS : DEFAULT_API_MAX_OUTPUT_TOKENS;
    const input = [...this.history, userItem];
    // Base64 image bytes are transport data, not a useful text-token estimate.
    // Reserve a small fixed allowance until the provider reports actual usage.
    const estimatedInputTokens = tokenCount([...this.history, historyUserItem]) + (imagePath ? 1_024 : 0);
    let budgetReservationId = null;
    try {
      if (this.usageBudget) {
        const reservation = await this.usageBudget.check({ estimatedInputTokens, reservedOutputTokens: maxOutputTokens });
        budgetReservationId = reservation?.reservationId || null;
      }
    const body = {
      model: selectedModel,
      input,
      reasoning: { effort: effort || "low" },
      max_output_tokens: maxOutputTokens,
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      text: { verbosity: "low" },
    };
    if (outputSchema) body.text.format = { type: "json_schema", name: "radimo_action", strict: true, schema: outputSchema };
    this.onNotification({ method: "turn/started", params: { backend: "api", model: selectedModel } });
    let response;
    try {
      response = await this.fetchImpl(this.#url(config, "responses"), {
        method: "POST",
        headers: this.#headers(config, credential),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new Error(`${config.provider === API_PROVIDERS.AZURE ? "Azure OpenAI" : "OpenAI"} konnte nicht erreicht werden: ${error?.message || String(error)}`);
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      let message = bodyText;
      try { message = JSON.parse(bodyText)?.error?.message || bodyText; } catch { /* keep plain response */ }
      throw new Error(`${config.provider === API_PROVIDERS.AZURE ? "Azure OpenAI" : "OpenAI"} Anfrage fehlgeschlagen (${response.status}): ${String(message || response.statusText).slice(0, 400)}`);
    }

    let outputText = "";
    let completed = null;
    for await (const event of readSseEvents(response)) {
      const type = String(event?.type || "");
      if (type === "response.output_text.delta" || type === "response.refusal.delta") {
        const delta = String(event.delta || "");
        if (delta) {
          outputText += delta;
          this.onNotification({ method: "item/agentMessage/delta", params: { delta } });
        }
      } else if (type === "response.completed") {
        completed = event.response || event;
      } else if (type === "response.failed" || type === "response.incomplete" || type === "error") {
        const message = event.error?.message || event.response?.error?.message || "Die API-Antwort wurde nicht vollständig erzeugt.";
        throw new Error(message);
      }
    }
    if (!outputText && completed) {
      outputText = responseText(completed);
      if (outputText) this.onNotification({ method: "item/agentMessage/delta", params: { delta: outputText } });
    }
    if (!completed) throw new Error("Die API-Antwort wurde vor dem Abschluss unterbrochen. Nichts wurde übernommen.");
    if (!outputText.trim()) throw new Error("Die API hat keinen Text zurückgegeben.");
    const outputItems = Array.isArray(completed?.output) && completed.output.length
      ? completed.output
      : [{ role: "assistant", content: [{ type: "output_text", text: outputText }] }];
    const rememberedOutput = responseText(outputItems) ? outputItems : [...outputItems, { role: "assistant", content: [{ type: "output_text", text: outputText }] }];
    this.#remember(historyUserItem, rememberedOutput);
    let recordedUsage = null;
    if (this.usageBudget) {
      recordedUsage = await this.usageBudget.record({ model: selectedModel, usage: completed?.usage, estimatedInputTokens, estimatedOutputTokens: tokenCount(outputText), reservationId: budgetReservationId });
    }
    this.onNotification({ method: "turn/completed", params: { backend: "api", responseId: completed?.id || null, usage: completed?.usage || null, budget: recordedUsage } });
    return { ok: true, backend: "api", responseId: completed?.id || null, usage: completed?.usage || null };
    } catch (error) {
      if (this.usageBudget && budgetReservationId) await this.usageBudget.release(budgetReservationId);
      throw error;
    }
  }

  async usageStatus() {
    return this.usageBudget ? this.usageBudget.status() : { enabled: false };
  }

  close() {
    this.started = false;
    this.resetConversation();
  }
}

module.exports = { ACTION_API_MAX_OUTPUT_TOKENS, DEFAULT_API_MAX_OUTPUT_TOKENS, OpenAIResponsesBackend, readSseEvents, responseText };
