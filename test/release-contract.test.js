const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../package.json");
const runtimeManifest = require("../codex-runtime.json");
const { CODEX_RUNTIME, getCodexCandidates, resolveCodexBinaryInfo } = require("../src/codex-runtime");
const { normalizeEndpoint } = require("../src/agent-api-config");
const { MAX_TRANSCRIPTION_PROMPT_CHARS, TRANSCRIPTION_PROMPT, normalizeTranscriptionPrompt } = require("../src/openai-audio");
const { estimateCostEur, UsageBudget } = require("../src/usage-budget");
const {
  buildFieldMapReport,
  defaultFieldMapperProfile,
  matchContextFields,
  parseRuleText,
} = require("../src/windows-field-mapper");

test("release metadata is pinned and excludes the Codex payload from the app build", () => {
  assert.equal(packageJson.name, "radimo-reporthalo-desktop");
  assert.equal(packageJson.homepage, "https://maxrusse.github.io/RadIMO-ReportHalo/");
  assert.equal(packageJson.repository.url, "https://github.com/maxrusse/RadIMO-ReportHalo.git");
  assert.equal(packageJson.devDependencies.electron, "44.1.0");
  assert.equal(packageJson.devDependencies["electron-builder"], "26.15.3");
  assert.match(packageJson.scripts["dist:win"], /--publish never/);
  assert.match(packageJson.scripts["dist:api"], /--publish never/);
  assert.match(packageJson.scripts["dist:installer"], /--publish never/);
  assert.equal(packageJson.build.extraResources, undefined);
  assert.ok(packageJson.build.files.includes("codex-runtime.json"));
  assert.ok(packageJson.build.files.includes("EULA.txt"));
  assert.match(runtimeManifest.sha256, /^[0-9a-f]{64}$/);
  assert.match(runtimeManifest.installerSha256, /^[0-9a-f]{64}$/);
  assert.ok(runtimeManifest.downloadUrl.startsWith("https://"));
  assert.ok(runtimeManifest.installerUrl.startsWith("https://"));
  assert.equal(CODEX_RUNTIME.version, runtimeManifest.version);
});

test("Windows Codex resolution prefers a portable runtime and detects the official installer layout", () => {
  const portableEnv = {
    PORTABLE_EXECUTABLE_DIR: "C:\\RadIMO",
    USERPROFILE: "C:\\Users\\Tester",
    LOCALAPPDATA: "C:\\Users\\Tester\\AppData\\Local",
    Path: "C:\\Windows\\System32",
  };
  const portableFs = { existsSync: (value) => value === "C:\\RadIMO\\codex\\codex.exe" };
  assert.equal(resolveCodexBinaryInfo({ platform: "win32", env: portableEnv, resourcesPath: "C:\\RadIMO\\resources", executablePath: "C:\\RadIMO\\RadIMO.exe", filesystem: portableFs }).source, "portable-adjacent");

  const officialPath = "C:\\Users\\Tester\\.codex\\packages\\standalone\\current\\bin\\codex.exe";
  const officialFs = { existsSync: (value) => value === officialPath };
  const candidates = getCodexCandidates({ platform: "win32", env: portableEnv, resourcesPath: "C:\\RadIMO\\resources", executablePath: "C:\\RadIMO\\RadIMO.exe", filesystem: officialFs });
  assert.equal(candidates.find((item) => item.present)?.source, "official-installer");
  assert.equal(resolveCodexBinaryInfo({ platform: "win32", env: portableEnv, resourcesPath: "C:\\RadIMO\\resources", executablePath: "C:\\RadIMO\\RadIMO.exe", filesystem: officialFs }).path, officialPath);

  const managedRoot = "C:\\Users\\Tester\\AppData\\Local\\OpenAI\\Codex\\bin";
  const managedPath = `${managedRoot}\\f022bde1137dbb75\\codex.exe`;
  const managedFs = {
    existsSync: (value) => value === managedPath,
    readdirSync: (directory) => directory === managedRoot ? [{ name: "f022bde1137dbb75", isDirectory: () => true }] : [],
  };
  const managedInfo = resolveCodexBinaryInfo({ platform: "win32", env: portableEnv, resourcesPath: "C:\\RadIMO\\resources", executablePath: "C:\\RadIMO\\RadIMO.exe", filesystem: managedFs });
  assert.equal(managedInfo.source, "official-installer-managed");
  assert.equal(managedInfo.path, managedPath);
});

test("remote API endpoints require HTTPS while local development endpoints may use HTTP", () => {
  assert.equal(normalizeEndpoint("openai", "https://api.example.test"), "https://api.example.test/v1");
  assert.equal(normalizeEndpoint("openai", "http://127.0.0.1:4310"), "http://127.0.0.1:4310/v1");
  assert.throws(() => normalizeEndpoint("openai", "http://api.example.test"), /HTTPS/);
  assert.throws(() => normalizeEndpoint("azure", "http://tenant.openai.azure.com"), /HTTPS/);
});

test("unknown model prices are reported as unknown instead of borrowing another model's price", () => {
  const unknown = estimateCostEur({ model: "gpt-5.3-codex-spark", inputTokens: 1000, outputTokens: 500 });
  assert.equal(unknown.pricingKnown, false);
  assert.equal(unknown.eur, null);
  const known = estimateCostEur({ model: "gpt-5.6-luna", inputTokens: 1000, outputTokens: 500 });
  assert.equal(known.pricingKnown, true);
  assert.ok(known.eur > 0);
});

test("usage budget exposes unknown pricing without blocking token accounting", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radimo-release-contract-"));
  try {
    const budget = new UsageBudget({ filePath: path.join(tempDir, "usage.json") });
    const reservation = await budget.check({ estimatedInputTokens: 4, reservedOutputTokens: 4 });
    const result = await budget.record({ model: "gpt-5.3-codex-spark", usage: { input_tokens: 4, output_tokens: 4 }, reservationId: reservation.reservationId });
    assert.equal(result.pricingKnown, false);
    assert.equal((await budget.status()).pricingKnown, false);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("GitHub Pages product page is self-contained and brand-aligned", async () => {
  const page = await fs.readFile(path.join(__dirname, "..", "docs", "index.html"), "utf8");
  assert.match(page, /RadIMO – ReportHalo/);
  assert.match(page, /lang="en"/);
  assert.match(page, /reporthalo-orb-real\.png/);
  assert.match(page, /reporthalo-workspace-real\.png/);
  assert.doesNotMatch(page, /reporthalo-(orb|workspace)-preview\.svg/);
  assert.doesNotMatch(page, /<script\b/i);
  for (const relativePath of ["docs/.nojekyll", "docs/assets/site.css", "docs/assets/reporthalo-orb-real.png", "docs/assets/reporthalo-workspace-real.png"]) {
    await fs.access(path.join(__dirname, "..", relativePath));
  }
});

test("the closed Halo Cub stays compact while attached panels keep their native presets", async () => {
  const main = await fs.readFile(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const app = await fs.readFile(path.join(__dirname, "..", "src", "renderer", "app.js"), "utf8");
  const renderer = await fs.readFile(path.join(__dirname, "..", "src", "renderer", "index.html"), "utf8");
  const styles = await fs.readFile(path.join(__dirname, "..", "src", "renderer", "styles.css"), "utf8");
  const docs = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "README.md"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "docs", "index.html"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "docs", "ui-guidelines.md"), "utf8"),
  ]);
  assert.match(main, /compact:[\s\S]*?size: \{ width: 180, height: 190 \}/);
  assert.match(main, /standard:[\s\S]*?size: \{ width: 360, height: 380 \}/);
  assert.match(main, /chatMainHeight: 182/);
  assert.match(styles, /--orb-track: 172px/);
  assert.match(styles, /--board-size: 140px/);
  assert.match(styles, /grid-template-columns: var\(--main-column-width\) minmax\(0, 1fr\)/);
  assert.match(styles, /grid-template-rows: var\(--chat-main-height\) minmax\(0, 1fr\)/);
  assert.match(main, /chat: \{ width: 680, height: 820 \}/);
  assert.match(main, /workspace: \{ width: 980, height: 640 \}/);
  assert.match(main, /ui:set-helper-cube-mode/);
  assert.match(app, /CUBE_MODE_STORAGE_KEY/);
  assert.match(renderer, /miniContextCubeSize/);
  assert.match(styles, /--panel-overlap: 0px/);
  assert.doesNotMatch(renderer, /Minihelfer|Mini-only|Mini Orb/i);
  assert.doesNotMatch(main, /Minihelfer|Mini-only|Mini Orb/i);
  for (const document of docs) assert.doesNotMatch(document, /Minihelfer|Mini-only|Mini Orb/i);
});

test("function prompts are user-editable and preserve reusable chat text", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "src", "renderer", "app.js"), "utf8");
  const renderer = await fs.readFile(path.join(__dirname, "..", "src", "renderer", "index.html"), "utf8");
  const audio = await fs.readFile(path.join(__dirname, "..", "src", "openai-audio.js"), "utf8");
  assert.match(app, /ACTION_PROMPT_DEFAULTS/);
  assert.match(app, /ACTION_SETTINGS_STORAGE_KEY = "radimoagent\.action-settings\.v2"/);
  assert.match(app, /TEXT_BLOCK_TOKEN = "\{\{TEXT_BLOCK\}\}"/);
  assert.match(app, /miniChatToggle: \{ label: "Chat", task: "discussion"/);
  assert.match(app, /miniChatPropose: \{ label: "Vorschlag ins Textfeld", task: "proposal"/);
  assert.match(app, /function recentDiscussionContext\(\)/);
  assert.match(app, /function parseChatResult\(raw\)/);
  assert.match(renderer, /Vollständiger Funktionsprompt/);
  assert.match(renderer, /id="miniConfigPrompt"[^>]*maxlength="8000"/);
  assert.match(audio, /function normalizeTranscriptionPrompt\(value\)/);
  assert.equal(normalizeTranscriptionPrompt(""), TRANSCRIPTION_PROMPT);
  assert.equal(normalizeTranscriptionPrompt("x".repeat(MAX_TRANSCRIPTION_PROMPT_CHARS + 100)).length, MAX_TRANSCRIPTION_PROMPT_CHARS);
});

test("field mapper applies label rules before reading and keeps the context structured", () => {
  const profile = parseRuleText([
    "clinical_question = *frage*",
    "report = *befund*",
  ].join("\n"), "*patient*\n*geburtsdatum*");
  const fields = [
    { name: "Edit1", labeledBy: "Fragestellung", value: "CT Thorax", supportsValue: true },
    { name: "Edit2", label: "Befund", value: "Kein Erguss.", supportsValue: true },
    { name: "Edit3", label: "Patient", value: "Max Mustermann", supportsValue: true },
    { name: "Edit4", label: "Interne Notiz", value: "nicht zugeordnet", supportsValue: true },
  ];
  const matched = matchContextFields(fields, profile);
  assert.equal(matched[0].matches[0].key, "clinical_question");
  assert.equal(matched[1].matches[0].key, "report");
  assert.equal(matched[2].excluded, true);
  assert.equal(matched[3].matched, false);
  const report = buildFieldMapReport({
    ok: true,
    processName: "ris.exe",
    processId: 42,
    windowHandle: "123",
    fields,
    diagnostics: { scanned: 4, textFields: 4 },
  }, profile, { readValues: true });
  assert.deepEqual(report.groups.map((group) => group.key), ["clinical_question", "report"]);
  assert.match(report.prompt, /CT Thorax/);
  assert.doesNotMatch(report.prompt, /Max Mustermann|nicht zugeordnet/);
  assert.ok(report.fields.some((field) => field.excluded));
  assert.equal(defaultFieldMapperProfile().schema, "reporthalo.field-map.v1");
});

test("field mapper is available in the integrated and standalone Windows builds", async () => {
  const packageJsonText = await fs.readFile(path.join(__dirname, "..", "package.json"), "utf8");
  const main = await fs.readFile(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const preload = await fs.readFile(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  const bridge = await fs.readFile(path.join(__dirname, "..", "src", "windows-field-bridge.js"), "utf8");
  const app = await fs.readFile(path.join(__dirname, "..", "src", "renderer", "app.js"), "utf8");
  const renderer = await fs.readFile(path.join(__dirname, "..", "src", "renderer", "index.html"), "utf8");
  const styles = await fs.readFile(path.join(__dirname, "..", "src", "renderer", "styles.css"), "utf8");
  const standalone = await fs.readFile(path.join(__dirname, "..", "src", "field-mapper-main.js"), "utf8");
  const config = await fs.readFile(path.join(__dirname, "..", "scripts", "win-field-mapper-config.json"), "utf8");
  assert.match(packageJsonText, /dist:field-mapper/);
  assert.match(main, /field-mapper:set-config/);
  assert.match(main, /field:focus-mapped/);
  assert.match(preload, /focusMappedField/);
  assert.match(main, /field:scan-window/);
  assert.match(bridge, /RADIMO_FIELD_INSERT_AT_CURSOR/);
  assert.match(bridge, /actualTextBase64/);
  assert.match(app, /insertAtCursor/);
  assert.match(app, /readFocusedField\(\{[\s\S]*?vollständige Feldinhalt/);
  assert.match(renderer, /scanFieldMapper/);
  assert.match(renderer, /fieldMapperInclude/);
  assert.match(renderer, /miniContextAutoSelect/);
  assert.match(renderer, /fieldMapperAutoTarget/);
  assert.match(styles, /target-drop-pulse/);
  assert.match(styles, /\.mini-target-cell\.is-auto-target/);
  assert.match(standalone, /RadIMO - ReportHalo Field Mapper/);
  assert.match(standalone, /field-mapper:scan/);
  assert.match(config, /field-mapper-main\.js/);
  assert.doesNotMatch(config, /codex|agent-backend|openai/i);
});

test("GitHub Pages deployment uses the docs site without a build-time dependency", async () => {
  const workflow = await fs.readFile(path.join(__dirname, "..", ".github", "workflows", "pages.yml"), "utf8");
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /path:\s+\.\/docs/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});
