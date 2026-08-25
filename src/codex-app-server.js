const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { version: packageVersion } = require("../package.json");
const { resolveCodexBinary } = require("./platform");
const { buildTurnInstructions } = require("./medical-gate");

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

    await this.request("initialize", {
      clientInfo: { name: "radimoagent-desktop", title: "RadimoAgent", version: packageVersion },
      capabilities: { experimentalApi: true },
    });
    this.#notify("initialized", {});
    this.initialized = true;
  }

  request(method, params) {
    if (!this.child || this.closed) return Promise.reject(new Error("Codex app-server is not running"));
    const id = this.nextId++;
    const message = JSON.stringify({ method, id, params }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(message, (error) => {
        if (error) {
          this.pending.delete(id);
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

  async sendTurn({ threadId, text, model, effort, medicalGate = true, evidenceMode = false, radiologyMode = false, imagePath = null, assistantMode = "discussion", writingGuidance = "", fieldType = "befund", fieldLabel = "" }) {
    const instructions = buildTurnInstructions({ medicalGate, evidenceMode, radiologyMode, imageAttached: Boolean(imagePath), assistantMode, writingGuidance, fieldType, fieldLabel });
    const guardedText = instructions ? `[RadimoAgent safety instructions]\n${instructions}\n[/RadimoAgent safety instructions]\n\n${text}` : text;
    const input = [{ type: "text", text: guardedText, text_elements: [] }];
    if (imagePath) input.push({ type: "localImage", path: imagePath, detail: "high" });
    return this.request("turn/start", {
      threadId,
      input,
      model: model || null,
      effort: effort || null,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: Boolean(evidenceMode) },
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
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

module.exports = { CodexAppServer };
