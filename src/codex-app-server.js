const { spawn } = require("node:child_process");
const fs = require("node:fs");
const readline = require("node:readline");
const { version: packageVersion } = require("../package.json");
const { CODEX_RUNTIME, resolveCodexBinary, resolveCodexBinaryInfo } = require("./platform");
const { buildTurnInstructions } = require("./medical-gate");
const { TEXT_ACTION_OUTPUT_SCHEMA } = require("./text-contract");

const REQUEST_TIMEOUT_MS = 120_000;
const INITIALIZE_TIMEOUT_MS = 30_000;

class CodexAppServer {
  constructor({ bin = resolveCodexBinary(), cwd = process.cwd(), env = process.env, onNotification = () => {} } = {}) {
    this.bin = bin;
    this.cwd = cwd;
    this.env = env;
    this.onNotification = onNotification;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.initialized = false;
    this.closed = false;
  }

  async start() {
    if (this.child) return;
    if (process.platform === "win32" && (!this.bin || !fs.existsSync(this.bin))) {
      const info = resolveCodexBinaryInfo();
      throw new Error(`Codex ${CODEX_RUNTIME.version} wurde nicht gefunden. Installiere den offiziellen Codex-Installer oder setze RADIMOAGENT_CODEX_BIN. Erwarteter Pfad: ${info.path || "nicht verfügbar"}`);
    }
    this.closed = false;
    this.initialized = false;
    this.child = spawn(this.bin, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.#handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      this.onNotification({ method: "radimoagent/stderr", params: { text: String(chunk).trim() } });
    });
    this.child.on("error", (error) => this.#failAll(error));
    this.child.on("exit", (code, signal) => {
      this.closed = true;
      this.child = null;
      this.initialized = false;
      this.#failAll(new Error(`Codex app-server exited (${code ?? "?"}, ${signal ?? "no signal"})`));
      this.onNotification({ method: "radimoagent/closed", params: { code, signal } });
    });

    try {
      await this.request("initialize", {
          clientInfo: { name: "radimo-reporthalo", title: "RadIMO - ReportHalo", version: packageVersion },
        capabilities: { experimentalApi: true },
      }, { timeoutMs: INITIALIZE_TIMEOUT_MS });
    } catch (error) {
      this.close();
      throw error;
    }
    this.#notify("initialized", {});
    this.initialized = true;
  }

  request(method, params, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (!this.child || this.closed) return Promise.reject(new Error("Codex app-server is not running"));
    const id = this.nextId++;
    const message = JSON.stringify({ method, id, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out (${method}).`));
      }, Math.max(1_000, Number(timeoutMs) || REQUEST_TIMEOUT_MS));
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(message, (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async authStatus() {
    return this.request("getAuthStatus", { includeToken: false, refreshToken: false });
  }

  async startBrowserLogin() {
    return this.request("account/login/start", { type: "chatgpt" });
  }

  async logout() {
    return this.request("account/logout", {});
  }

  async listModels() {
    return this.request("model/list", { includeHidden: false });
  }

  async startThread({ cwd, model, baseInstructions, medicalGate = true, evidenceMode = false, radiologyMode = false, imageAttached = false, assistantMode = "discussion", writingGuidance = "", fieldType = "befund", fieldLabel = "" } = {}) {
    return this.request("thread/start", {
      cwd: cwd || process.cwd(),
      model: model || null,
      modelProvider: "openai",
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions: baseInstructions || buildTurnInstructions({ medicalGate, evidenceMode, radiologyMode, imageAttached, assistantMode, writingGuidance, fieldType, fieldLabel }) || null,
      threadSource: "app",
      ephemeral: false,
    });
  }

  async sendTurn({ threadId, text, model, effort, summary = "none", outputSchema = null, medicalGate = true, evidenceMode = false, radiologyMode = false, imagePath = null, assistantMode = "discussion", writingGuidance = "", fieldType = "befund", fieldLabel = "" }) {
    const instructions = buildTurnInstructions({ medicalGate, evidenceMode, radiologyMode, imageAttached: Boolean(imagePath), assistantMode, writingGuidance, fieldType, fieldLabel });
    const guardedText = instructions ? `[RadIMO ReportHalo safety instructions]\n${instructions}\n[/RadIMO ReportHalo safety instructions]\n\n${text}` : text;
    const input = [{ type: "text", text: guardedText, text_elements: [] }];
    if (imagePath) input.push({ type: "localImage", path: imagePath, detail: "high" });
    return this.request("turn/start", {
      threadId,
      input,
      model: model || null,
      effort: effort || null,
      summary: summary || "none",
      ...(outputSchema ? { outputSchema } : {}),
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: Boolean(evidenceMode || (radiologyMode && assistantMode !== "correction")) },
    });
  }

  close() {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
    this.closed = true;
    this.initialized = false;
  }

  #handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.onNotification({ method: "radimoagent/protocol-error", params: { text: line.slice(0, 500) } });
      return;
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || "Codex request failed"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) this.onNotification(message);
  }

  #notify(method, params) {
    this.onNotification({ method, params });
  }

  #failAll(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
}

module.exports = { CodexAppServer, TEXT_ACTION_OUTPUT_SCHEMA };
