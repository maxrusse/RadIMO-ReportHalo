const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const dist = path.join(root, "dist");
const artifactName = `RadimoAgent-${packageJson.version}-win-x64.exe`;
const folderName = `RadimoAgent-${packageJson.version}-win-x64`;
const exePath = path.join(dist, artifactName);
const codexPath = path.join(root, "vendor", "codex", "win-x64", "codex.exe");
const stagingPath = path.join(dist, folderName);
const zipPath = path.join(dist, `${folderName}.zip`);

async function main() {
  await fs.access(exePath);
  await fs.rm(stagingPath, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
  await fs.mkdir(stagingPath, { recursive: true });
  await fs.copyFile(exePath, path.join(stagingPath, "RadimoAgent.exe"));
  await fs.mkdir(path.join(stagingPath, "codex"), { recursive: true });
  await fs.copyFile(codexPath, path.join(stagingPath, "codex", "codex.exe"));
  await fs.cp(path.join(root, "guidance"), path.join(stagingPath, "guidance"), { recursive: true });
  await fs.copyFile(path.join(root, "README-DE.md"), path.join(stagingPath, "README-DE.md"));
  const exeDigest = crypto.createHash("sha256").update(await fs.readFile(exePath)).digest("hex");
  const codexDigest = crypto.createHash("sha256").update(await fs.readFile(codexPath)).digest("hex");
  await fs.writeFile(path.join(stagingPath, "SHA256SUMS.txt"), `${exeDigest}  RadimoAgent.exe\n${codexDigest}  codex/codex.exe\n`, "utf8");
  execFileSync("zip", ["-q", "-r", "-X", zipPath, folderName], { cwd: dist, stdio: "inherit" });
  const stat = await fs.stat(zipPath);
  console.log(`Windows ZIP ready: ${zipPath} (${stat.size} bytes)`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
