const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const packageLock = require(path.join(root, "package-lock.json"));
const runtimeManifest = require(path.join(root, "codex-runtime.json"));
const allowDirty = process.argv.includes("--allow-dirty");
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function requireFile(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`missing ${relativePath}`);
}

function commandSpec(command, args) {
  if (process.platform !== "win32" || command !== "npm") return { executable: command, args, options: {} };
  const commandLine = ["npm.cmd", ...args].map((value) => {
    const text = String(value);
    return /^[A-Za-z0-9_.:/=-]+$/.test(text) ? text : `"${text.replaceAll('"', '\\"')}"`;
  }).join(" ");
  return { executable: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", commandLine], options: {} };
}

function run(command, args, label) {
  const spec = commandSpec(command, args);
  const result = spawnSync(spec.executable, spec.args, { cwd: root, stdio: "inherit", env: process.env, ...spec.options });
  if (result.error || result.status !== 0) fail(`${label} failed${result.error ? `: ${result.error.message}` : ` with exit code ${result.status}`}`);
  else pass(label);
}

function capture(command, args) {
  const spec = commandSpec(command, args);
  const result = spawnSync(spec.executable, spec.args, { cwd: root, encoding: "utf8", env: process.env, ...spec.options });
  return result.error ? `ERROR: ${result.error.message}` : String(result.stdout || "");
}

function validateManifest() {
  if (!/^\d+\.\d+\.\d+$/.test(runtimeManifest.version)) fail("Codex runtime version is not pinned to a stable semantic version");
  for (const [field, value] of [["sha256", runtimeManifest.sha256], ["installerSha256", runtimeManifest.installerSha256]]) {
    if (!/^[0-9a-f]{64}$/i.test(String(value || ""))) fail(`Codex runtime ${field} is not a SHA-256 digest`);
  }
  for (const field of ["downloadUrl", "installerUrl"]) {
    try {
      const url = new URL(runtimeManifest[field]);
      if (url.protocol !== "https:") fail(`Codex runtime ${field} is not HTTPS`);
      if (url.hostname !== "github.com") fail(`Codex runtime ${field} is not pinned to github.com`);
    } catch {
      fail(`Codex runtime ${field} is not a valid URL`);
    }
  }
  if (runtimeManifest.asset !== `codex-${runtimeManifest.target}.exe`) fail("Codex runtime asset does not match its target");
}

function validateBuildContract() {
  const files = Array.isArray(packageJson.build?.files) ? packageJson.build.files : [];
  if (packageJson.build?.extraResources) fail("the app build still embeds extra resources");
  if (files.some((entry) => /vendor\/codex|docs\/\*\*\/\*|(^|\/)AGENTS\.md$/.test(entry))) fail("internal or vendored Codex content is still included in the app build");
  if (!files.includes("codex-runtime.json")) fail("codex-runtime.json is not included in the app build");
  if (packageJson.scripts?.["dist:selfextract"]) fail("obsolete selfextract build script is still present");
  if (fs.existsSync(path.join(root, "scripts", "win-selfextract-config.json"))) fail("obsolete selfextract configuration is still present");
  if (!packageJson.scripts?.test || !packageJson.scripts?.["release:gate"] || !packageJson.scripts?.["release:artifacts"] || !packageJson.scripts?.["dist:installer"]) fail("release scripts are incomplete");
  for (const configName of ["scripts/win-api-config.json", "scripts/win-installer-config.json"]) {
    const config = JSON.parse(fs.readFileSync(path.join(root, configName), "utf8"));
    if (JSON.stringify(config).includes("extraResources")) fail(`${configName} still embeds extra resources`);
  }
  if (packageLock.packages?.[""]?.devDependencies?.electron !== packageJson.devDependencies?.electron) fail("package-lock Electron spec does not match package.json");
  if (packageLock.packages?.[""]?.devDependencies?.["electron-builder"] !== packageJson.devDependencies?.["electron-builder"]) fail("package-lock electron-builder spec does not match package.json");
}

function validateInstallerContract() {
  const installer = fs.readFileSync(path.join(root, "scripts", "install-codex.ps1"), "utf8");
  if (!installer.includes("installerSha256") || !installer.includes("CODEX_RELEASE") || !installer.includes("Get-FileHash")) fail("Codex post-install helper does not verify and pin the official installer");
  for (const relativePath of ["codex-runtime.json", "scripts/install-codex.ps1", "THIRD-PARTY-NOTICES.md", "LICENSES/Apache-2.0.txt"]) requireFile(relativePath);
}

function validateOptionalPayload() {
  const binary = path.join(root, "vendor", "codex", "win-x64", "codex.exe");
  if (!fs.existsSync(binary)) {
    pass(`optional local Codex payload is absent; ${runtimeManifest.version} will be installed externally`);
    return;
  }
  const digest = crypto.createHash("sha256").update(fs.readFileSync(binary)).digest("hex");
  if (digest.toLowerCase() !== String(runtimeManifest.sha256).toLowerCase()) fail(`optional local Codex payload hash mismatch: ${digest}`);
  else pass("optional local Codex payload matches the pinned SHA-256");
}

validateManifest();
validateBuildContract();
validateInstallerContract();
validateOptionalPayload();

const status = capture("git", ["status", "--porcelain"]);
if (status.startsWith("ERROR:")) fail(status);
else if (status.trim() && !allowDirty) fail("working tree is not clean; run the gate from the committed release tree");
else if (status.trim()) console.warn("WARN: working tree is dirty (--allow-dirty); CI/release tags must run clean");
else pass("working tree is clean");

run("git", ["diff", "--check"], "git whitespace check");
run("npm", ["test"], "focused regression tests");
run("npm", ["run", "check"], "JavaScript syntax check");
run("npm", ["run", "preflight:win"], "Codex runtime manifest preflight");
run("npm", ["audit", "--audit-level=high"], "dependency security audit");

if (failures.length) {
  console.error(`\nRELEASE GATE: RED (${failures.length} failure${failures.length === 1 ? "" : "s"})`);
  process.exitCode = 1;
} else {
  console.log("\nRELEASE GATE: GREEN");
}
