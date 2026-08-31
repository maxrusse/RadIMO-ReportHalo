const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const dist = path.join(root, "dist");
const artifactName = `RadIMO-ReportHalo-${packageJson.version}-win-x64.exe`;
const folderName = `RadIMO-ReportHalo-${packageJson.version}-win-x64`;
const exePath = path.join(dist, artifactName);
const stagingPath = path.join(dist, folderName);
const zipPath = path.join(dist, `${folderName}.zip`);

function hasCommand(command) {
  try {
    execFileSync(process.platform === "win32" ? "where.exe" : "which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function createZip() {
  if (hasCommand("zip")) {
    execFileSync("zip", ["-q", "-r", "-X", zipPath, folderName], { cwd: dist, stdio: "inherit" });
    return;
  }
  const sevenZip = process.platform === "win32" && hasCommand("7z.exe") ? "7z.exe" : hasCommand("7z") ? "7z" : null;
  if (sevenZip) {
    execFileSync(sevenZip, ["a", "-tzip", "-mx=5", zipPath, folderName], { cwd: dist, stdio: "inherit" });
    return;
  }
  throw new Error("No zip-compatible archiver found. Install zip or 7-Zip before packaging the Windows ZIP.");
}

async function main() {
  await fs.access(exePath);
  await fs.rm(stagingPath, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
  await fs.mkdir(stagingPath, { recursive: true });
  await fs.copyFile(exePath, path.join(stagingPath, "RadIMO-ReportHalo.exe"));
  await fs.copyFile(path.join(root, "scripts", "install-codex.ps1"), path.join(stagingPath, "Install-Codex.ps1"));
  await fs.copyFile(path.join(root, "codex-runtime.json"), path.join(stagingPath, "codex-runtime.json"));
  await fs.copyFile(path.join(root, "THIRD-PARTY-NOTICES.md"), path.join(stagingPath, "THIRD-PARTY-NOTICES.md"));
  await fs.mkdir(path.join(stagingPath, "LICENSES"), { recursive: true });
  await fs.copyFile(path.join(root, "LICENSES", "Apache-2.0.txt"), path.join(stagingPath, "LICENSES", "Apache-2.0.txt"));
  await fs.cp(path.join(root, "guidance"), path.join(stagingPath, "guidance"), { recursive: true });
  await fs.copyFile(path.join(root, "README-DE.md"), path.join(stagingPath, "README-DE.md"));
  const digestFiles = [
    "RadIMO-ReportHalo.exe",
    "Install-Codex.ps1",
    "codex-runtime.json",
    "THIRD-PARTY-NOTICES.md",
    "LICENSES/Apache-2.0.txt",
  ];
  const digests = [];
  for (const relativePath of digestFiles) {
    const digest = crypto.createHash("sha256").update(await fs.readFile(path.join(stagingPath, relativePath))).digest("hex");
    digests.push(`${digest}  ${relativePath}`);
  }
  await fs.writeFile(path.join(stagingPath, "SHA256SUMS.txt"), `${digests.join("\n")}\n`, "utf8");
  createZip();
  const stat = await fs.stat(zipPath);
  console.log(`Windows ZIP ready: ${zipPath} (${stat.size} bytes)`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
