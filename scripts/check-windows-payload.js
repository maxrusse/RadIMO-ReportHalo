const fs = require("node:fs");
const path = require("node:path");

const binary = path.resolve(__dirname, "..", "vendor", "codex", "win-x64", "codex.exe");
if (!fs.existsSync(binary)) {
  console.error(`Missing Windows Codex payload: ${binary}`);
  console.error("Place the approved Windows Codex CLI binary there before building the portable client.");
  process.exit(1);
}

const stat = fs.statSync(binary);
if (!stat.isFile() || stat.size < 1024) {
  console.error(`Windows Codex payload is not a valid-looking file: ${binary}`);
  process.exit(1);
}
console.log(`Windows Codex payload ready: ${binary} (${stat.size} bytes)`);
