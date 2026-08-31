const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const manifest = require(path.resolve(__dirname, "..", "codex-runtime.json"));
const binary = path.resolve(__dirname, "..", "vendor", "codex", "win-x64", "codex.exe");
const hex = (value) => /^[0-9a-f]{64}$/i.test(String(value || ""));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !hex(manifest.sha256) || !/^https:\/\//i.test(manifest.downloadUrl) || !/^https:\/\//i.test(manifest.installerUrl) || !hex(manifest.installerSha256)) {
  console.error("Codex runtime manifest is incomplete or unsafe.");
  process.exit(1);
}

if (!fs.existsSync(binary)) {
  console.log(`Codex runtime ${manifest.version} is external; no vendored binary is required for this build.`);
  process.exit(0);
}

const stat = fs.statSync(binary);
if (!stat.isFile() || stat.size < 1024) {
  console.error(`Windows Codex development payload is not a valid-looking file: ${binary}`);
  process.exit(1);
}
const digest = crypto.createHash("sha256").update(fs.readFileSync(binary)).digest("hex");
if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
  console.error(`Windows Codex development payload SHA-256 mismatch: expected ${manifest.sha256}, got ${digest}`);
  process.exit(1);
}
console.log(`Verified optional Codex development payload: ${binary} (${stat.size} bytes, SHA-256 ${digest})`);
