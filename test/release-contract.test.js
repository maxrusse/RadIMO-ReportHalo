const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../package.json");
const runtimeManifest = require("../codex-runtime.json");
const { CODEX_RUNTIME, getCodexCandidates, resolveCodexBinaryInfo } = require("../src/codex-runtime");
const { normalizeEndpoint } = require("../src/agent-api-config");
const { estimateCostEur, UsageBudget } = require("../src/usage-budget");

test("release metadata is pinned and excludes the Codex payload from the app build", () => {
  assert.equal(packageJson.devDependencies.electron, "44.1.0");
  assert.equal(packageJson.devDependencies["electron-builder"], "26.15.3");
  assert.equal(packageJson.build.extraResources, undefined);
  assert.ok(packageJson.build.files.includes("codex-runtime.json"));
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
