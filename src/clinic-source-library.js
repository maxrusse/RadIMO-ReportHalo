const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { readReferenceFile } = require("./reference-library");

const CLINIC_CONFIG_NAME = "clinic-sources.json";
const CLINIC_ROOT_NAME = "clinics";
const SOURCE_FOLDER_NAME = "sources";
const CACHE_FOLDER_NAME = ".radimoagent/source-cache";
const AGENTS_FILE_NAME = "AGENTS.md";
const SOURCE_MARKER_START = "<!-- RADIMOAGENT CLINIC SOURCE REFERENCES -->";
const SOURCE_MARKER_END = "<!-- END RADIMOAGENT CLINIC SOURCE REFERENCES -->";

async function sha256File(filePath) {
  const handle = await fs.open(filePath, "r");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  try {
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      hash.update(buffer.subarray(0, result.bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

function clinicConfigPath(userDataPath) {
  return path.join(userDataPath, CLINIC_CONFIG_NAME);
}

function clinicRoots({ appRoot, executablePath = process.execPath, resourcesPath, userDataPath } = {}) {
  return [...new Set([
    path.join(path.dirname(executablePath), "guidance", CLINIC_ROOT_NAME),
    resourcesPath ? path.join(resourcesPath, "guidance", CLINIC_ROOT_NAME) : null,
    appRoot ? path.join(appRoot, "guidance", CLINIC_ROOT_NAME) : null,
    userDataPath ? path.join(userDataPath, "guidance", CLINIC_ROOT_NAME) : null,
  ].filter(Boolean))];
}

async function exists(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function readConfig(userDataPath) {
  try {
    const config = JSON.parse(await fs.readFile(clinicConfigPath(userDataPath), "utf8"));
    return typeof config.root === "string" ? path.resolve(config.root) : null;
  } catch {
    return null;
  }
}

async function saveClinicRoot(userDataPath, root) {
  const absolute = path.resolve(root);
  if (!(await exists(absolute))) throw new Error("Der Klinikquellen-Ordner wurde nicht gefunden.");
  await fs.mkdir(path.dirname(clinicConfigPath(userDataPath)), { recursive: true });
  await fs.writeFile(clinicConfigPath(userDataPath), `${JSON.stringify({ root: absolute }, null, 2)}\n`, "utf8");
  return absolute;
}

function safeChild(parent, candidate) {
  const base = path.resolve(parent);
  const target = path.resolve(candidate);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("Die Quelle liegt nicht im Klinikquellen-Ordner.");
  return target;
}

function clinicId(name) {
  return String(name).trim().toLocaleLowerCase("de-DE").replace(/[^a-z0-9äöüß]+/gi, "-").replace(/^-+|-+$/g, "") || "klinik";
}

function relativeSourcePath(clinic, sourcePath) {
  return path.relative(clinic.path, sourcePath).split(path.sep).join("/");
}

function cachePath(clinic, hash) {
  return path.join(clinic.path, CACHE_FOLDER_NAME, `${hash}.txt`);
}

async function readClinicAgents(clinic) {
  try {
    return await fs.readFile(clinic.agentsPath, "utf8");
  } catch {
    return "";
  }
}

function referencedHash(agents, relativePath) {
  const escaped = relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(agents).match(new RegExp(`Source:\\s*${escaped}[\\s\\S]*?SHA-256:\\s*([a-f0-9]{64})`, "i"));
  return match?.[1] || null;
}

function sourceEntry(source, relativePath, hash, readStatus, cache) {
  const date = new Date().toISOString().slice(0, 10);
  return [
    `### ${source.name}`,
    "",
    `Source: ${relativePath}`,
    `SHA-256: ${hash}`,
    `Last read: ${date}`,
    `Read status: ${readStatus}`,
    `Cache: ${cache}`,
    "Use this entry as a source register only. The PDF is not patient data and must not be treated as a case fact.",
    "",
  ].join("\n");
}

async function updateAgentsReference(clinic, source, hash, readStatus, cache) {
  const existing = await readClinicAgents(clinic);
  const relativePath = relativeSourcePath(clinic, source.path);
  const newEntry = sourceEntry(source, relativePath, hash, readStatus, cache);
  const markerStart = existing.indexOf(SOURCE_MARKER_START);
  const markerEnd = existing.indexOf(SOURCE_MARKER_END, markerStart + SOURCE_MARKER_START.length);
  let content;
  if (markerStart >= 0 && markerEnd >= 0) {
    const section = existing.slice(markerStart, markerEnd);
    const escapedPath = relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const entryPattern = new RegExp(`### [^\\n]+\\n\\nSource:\\s*${escapedPath}[\\s\\S]*?(?=\\n### |$)`, "m");
    const updatedSection = entryPattern.test(section) ? section.replace(entryPattern, newEntry.trimEnd()) : `${section.trimEnd()}\n\n${newEntry}`;
    content = `${existing.slice(0, markerStart)}${updatedSection}\n${existing.slice(markerEnd)}`;
  } else {
    const withoutSources = existing.replace(/\s+$/, "");
    const section = [SOURCE_MARKER_START, "", "## Reusable clinic sources", "", newEntry, SOURCE_MARKER_END, ""].join("\n");
    content = `${withoutSources ? `${withoutSources}\n\n` : ""}${section}`;
  }
  await fs.mkdir(path.dirname(clinic.agentsPath), { recursive: true });
  await fs.writeFile(clinic.agentsPath, content, "utf8");
  return clinic.agentsPath;
}

async function inspectClinic(clinicPath, name = path.basename(clinicPath)) {
  const absolute = path.resolve(clinicPath);
  const sourceDir = path.join(absolute, SOURCE_FOLDER_NAME);
  const clinic = {
    id: clinicId(name),
    name,
    path: absolute,
    sourceDir,
    agentsPath: path.join(absolute, AGENTS_FILE_NAME),
    sources: [],
  };
  if (!(await exists(sourceDir))) return clinic;
  const agents = await readClinicAgents(clinic);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isFile() && path.extname(item.name).toLowerCase() === ".pdf").sort((a, b) => a.name.localeCompare(b.name, "de-DE", { numeric: true }))) {
    const filePath = path.join(sourceDir, entry.name);
    const stat = await fs.stat(filePath);
    const hash = referencedHash(agents, relativeSourcePath(clinic, filePath));
    const currentHash = await sha256File(filePath);
    clinic.sources.push({
      name: entry.name,
      path: filePath,
      relativePath: relativeSourcePath(clinic, filePath),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      status: hash && hash === currentHash ? "referenced" : "new",
      referencedHash: hash,
      sha256: currentHash,
      cachePath: cachePath(clinic, currentHash),
    });
  }
  return clinic;
}

async function discoverClinics(root) {
  if (!(await exists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const clinics = [];
  for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith("."))) clinics.push(await inspectClinic(path.join(root, entry.name), entry.name));
  return clinics.sort((a, b) => a.name.localeCompare(b.name, "de-DE", { sensitivity: "base" }));
}

async function loadClinicSourceLibrary({ appRoot, executablePath = process.execPath, resourcesPath, userDataPath } = {}) {
  const configured = await readConfig(userDataPath);
  const candidates = [...new Set([configured, ...clinicRoots({ appRoot, executablePath, resourcesPath, userDataPath })].filter(Boolean))];
  let resolvedRoot = configured || candidates[0] || path.join(userDataPath, "guidance", CLINIC_ROOT_NAME);
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      resolvedRoot = candidate;
      break;
    }
  }
  return { root: resolvedRoot, configuredRoot: configured, clinics: await discoverClinics(resolvedRoot), configPath: clinicConfigPath(userDataPath), userDataPath };
}

function clinicSummary(library) {
  return {
    root: library?.root || null,
    configuredRoot: library?.configuredRoot || null,
    configPath: library?.configPath || null,
    clinics: (library?.clinics || []).map((clinic) => ({
      id: clinic.id,
      name: clinic.name,
      path: clinic.path,
      agentsPath: clinic.agentsPath,
      sourceDir: clinic.sourceDir,
      sources: clinic.sources.map(({ path: sourcePath, ...source }) => ({ ...source, path: sourcePath })),
    })),
  };
}

async function readClinicSource(library, clinicIdValue, sourcePath) {
  const clinic = (library?.clinics || []).find((item) => item.id === clinicIdValue);
  if (!clinic) throw new Error("Die Klinikquelle wurde nicht gefunden.");
  const source = safeChild(clinic.sourceDir, sourcePath);
  const catalogItem = clinic.sources.find((item) => item.path === source);
  if (!catalogItem) throw new Error("Die PDF liegt nicht im Quellen-Unterordner der Klinik.");
  const sha256 = await sha256File(source);
  const cachedPath = cachePath(clinic, sha256);
  let item;
  try {
    const cachedContent = (await fs.readFile(cachedPath, "utf8")).trim();
    item = { name: path.basename(source), path: source, sourceType: "local", extension: ".pdf", size: catalogItem.size, status: cachedContent ? "ready" : "empty", reason: "Lokaler Textcache der bereits gelesenen Klinikquelle.", content: cachedContent, preview: cachedContent.slice(0, 420) };
  } catch {
    item = await readReferenceFile(source);
    if (item.status === "ready" && item.content) {
      await fs.mkdir(path.dirname(cachedPath), { recursive: true });
      await fs.writeFile(cachedPath, item.content, "utf8");
    }
  }
  await updateAgentsReference(clinic, item, sha256, item.status, path.relative(clinic.path, cachedPath).split(path.sep).join("/"));
  return { ...item, clinicId: clinic.id, clinicName: clinic.name, relativePath: catalogItem.relativePath, sha256, agentsPath: clinic.agentsPath, referenced: true };
}

function formatClinicSourcePrompt(item) {
  if (!item?.content || item.status !== "ready") return "";
  return [
    "[EXPLICITLY ATTACHED REUSABLE CLINIC SOURCE]",
    `Clinic: ${item.clinicName}`,
    `Source: ${item.relativePath}`,
    `Registered in: ${item.agentsPath}`,
    `SHA-256: ${item.sha256}`,
    "Use this source only as background evidence. Cite the relative path when relying on it, separate source-supported claims from synthesis, and never copy source text as patient facts.",
    item.content,
    "[/EXPLICITLY ATTACHED REUSABLE CLINIC SOURCE]",
  ].join("\n");
}

module.exports = {
  AGENTS_FILE_NAME,
  CLINIC_ROOT_NAME,
  formatClinicSourcePrompt,
  clinicConfigPath,
  clinicSummary,
  discoverClinics,
  loadClinicSourceLibrary,
  readClinicSource,
  saveClinicRoot,
};
