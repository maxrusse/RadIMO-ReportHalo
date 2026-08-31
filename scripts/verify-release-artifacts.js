const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const version = packageJson.version;
const dist = path.join(root, "dist");
const apiDist = path.join(root, "dist-api");
const installerDist = path.join(root, "dist-installer");
const folderName = `RadIMO-ReportHalo-${version}-win-x64`;
const zipPath = path.join(dist, `${folderName}.zip`);
const expectedZipFiles = new Set([
  "RadIMO-ReportHalo.exe",
  "Install-Codex.ps1",
  "codex-runtime.json",
  "THIRD-PARTY-NOTICES.md",
  "EULA.txt",
  "LICENSES/Apache-2.0.txt",
]);

function fail(message) {
  throw new Error(`Release artifact verification failed: ${message}`);
}

function requireFile(filePath, minimumBytes = 1) {
  if (!fs.existsSync(filePath)) fail(`missing ${path.relative(root, filePath)}`);
  const size = fs.statSync(filePath).size;
  if (size < minimumBytes) fail(`file is unexpectedly small: ${path.relative(root, filePath)}`);
}

function findSevenZip() {
  for (const candidate of ["7z.exe", "7z"]) {
    try {
      execFileSync(process.platform === "win32" ? "where.exe" : "which", [candidate], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next executable name.
    }
  }
  fail("7-Zip is required to inspect the generated ZIP");
}

function zipEntries(archiver) {
  const output = execFileSync(archiver, ["l", "-slt", zipPath], { encoding: "utf8" });
  return [...output.matchAll(/^Path = (.+)$/gm)]
    .map((match) => match[1].trim().replaceAll("\\", "/"))
    .filter((entry) => entry !== zipPath.replaceAll("\\", "/"));
}

function zipChecksums(archiver) {
  return execFileSync(archiver, ["x", "-so", zipPath, `${folderName}/SHA256SUMS.txt`], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/i);
      if (!match) fail(`invalid SHA256SUMS line: ${line}`);
      return { digest: match[1].toLowerCase(), relativePath: match[2].replaceAll("\\", "/") };
    });
}

function verifyZip(archiver) {
  requireFile(zipPath, 1_000_000);
  const entries = zipEntries(archiver);
  if (entries.some((entry) => /(^|\\|\/)codex(\\|\/|$)|codex\.exe$/i.test(entry))) fail("the ZIP contains an embedded Codex path");
  const actualFiles = new Set(entries.filter((entry) => entry.startsWith(`${folderName}/`)).map((entry) => entry.slice(folderName.length + 1)).filter((entry) => !entry.endsWith("/")));
  const checksums = zipChecksums(archiver);
  const checksumFiles = new Set(checksums.map((item) => item.relativePath));
  for (const required of expectedZipFiles) {
    if (!actualFiles.has(required)) fail(`ZIP is missing ${required}`);
    if (!checksumFiles.has(required)) fail(`SHA256SUMS.txt is missing ${required}`);
    const filePath = path.join(dist, folderName, ...required.split("/"));
    requireFile(filePath);
    const actualDigest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    const expectedDigest = checksums.find((item) => item.relativePath === required)?.digest;
    if (actualDigest !== expectedDigest) fail(`checksum mismatch for ${required}`);
  }
  if (checksumFiles.size !== expectedZipFiles.size) fail("SHA256SUMS.txt contains an unexpected file list");
}

function verifyUnpackedPayloads() {
  for (const relativePath of [
    "dist/win-unpacked/resources/app.asar",
    "dist-api/win-unpacked/resources/app.asar",
    "dist-installer/win-unpacked/resources/app.asar",
    "dist-installer/win-unpacked/Install-Codex.ps1",
    "dist-installer/win-unpacked/EULA.txt",
  ]) requireFile(path.join(root, relativePath), 1_000);
  requireFile(path.join(root, "dist-installer/win-unpacked/codex-runtime.json"), 100);
  for (const relativePath of [
    "dist/win-unpacked/resources/codex",
    "dist-api/win-unpacked/resources/codex",
    "dist-installer/win-unpacked/resources/codex",
  ]) if (fs.existsSync(path.join(root, relativePath))) fail(`unpacked app unexpectedly contains ${relativePath}`);
}

requireFile(path.join(dist, `RadIMO-ReportHalo-${version}-win-x64.exe`), 1_000_000);
requireFile(path.join(apiDist, `RadIMO-ReportHalo-${version}-win-x64-api.exe`), 1_000_000);
requireFile(path.join(installerDist, `RadIMO-ReportHalo-${version}-win-x64-setup.exe`), 1_000_000);
verifyUnpackedPayloads();
verifyZip(findSevenZip());
console.log("Release artifacts verified: app-only portable ZIP, API portable EXE, and Codex post-install NSIS installer.");
