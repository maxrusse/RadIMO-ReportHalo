const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_TEMPLATE_BYTES = 256 * 1024;
const MAX_TEMPLATES = 100;

const GENERIC_TEMPLATES = Object.freeze([
  {
    id: "generic-befund",
    label: "Generic · Befund",
    mode: "correction",
    content: "Befund:\n\nFragestellung/Anforderung:\n\nVoraufnahmen zum Vergleich:\n\n",
    source: "generic",
  },
  {
    id: "generic-beurteilung",
    label: "Generic · Beurteilung",
    mode: "conclusion",
    content: "Beurteilung:\n- \n\nBei fehlender Sicherheit: Unsicherheit und gegebenenfalls fehlende Information ausdrücklich benennen.",
    source: "generic",
  },
  {
    id: "generic-differential",
    label: "Generic · Differentialdiagnose",
    mode: "differential",
    content: "Gegebene Befunde:\n\nFührende Differenzialdiagnosen:\n1. \n2. \n\nUnterscheidende Merkmale / fehlende Informationen:\n\n",
    source: "generic",
  },
]);

function parseFrontmatter(markdown, fallbackId) {
  const source = String(markdown || "");
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  const fields = {};
  if (!match) return { fields, content: source.trim() };
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { fields: { id: fields.id || fallbackId, ...fields }, content: match[2].trim() };
}

async function readTemplateFile(filePath, source) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_TEMPLATE_BYTES) return null;
  const parsed = parseFrontmatter(await fs.readFile(filePath, "utf8"), path.basename(filePath, path.extname(filePath)));
  return {
    id: parsed.fields.id,
    label: parsed.fields.label || parsed.fields.id,
    mode: parsed.fields.mode || "discussion",
    content: parsed.content,
    source,
    filePath,
  };
}

async function readTemplateDirectory(directory, source) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const templates = [];
    for (const entry of entries.filter((item) => item.isFile() && /\.md$/i.test(item.name)).slice(0, MAX_TEMPLATES)) {
      const template = await readTemplateFile(path.join(directory, entry.name), source);
      if (template?.content) templates.push(template);
    }
    return templates;
  } catch {
    return [];
  }
}

async function loadTemplateLibrary({ executablePath = process.execPath, resourcesPath = process.resourcesPath, appRoot, userDataPath, webServerEnabled = false, webServerUrl = null } = {}) {
  const candidates = [...new Set([
    path.join(path.dirname(executablePath), "guidance", "templates"),
    resourcesPath ? path.join(resourcesPath, "guidance", "templates") : null,
    userDataPath ? path.join(userDataPath, "guidance", "templates") : null,
    appRoot ? path.join(appRoot, "guidance", "templates") : null,
  ].filter(Boolean))];
  for (const directory of candidates) {
    const templates = await readTemplateDirectory(directory, "local");
    if (templates.length) return { source: "local", directory, templates };
  }
  if (webServerEnabled && webServerUrl) {
    // Reserved seam for a future local webserver. Intentionally no network call
    // is made until the feature is explicitly activated and implemented.
    return { source: "webserver-disabled", directory: null, webServerUrl, templates: [...GENERIC_TEMPLATES] };
  }
  return { source: "generic", directory: null, templates: [...GENERIC_TEMPLATES] };
}

function templateSummary(library) {
  return {
    source: library?.source || "generic",
    directory: library?.directory || null,
    webServerUrl: library?.webServerUrl || null,
    templates: (library?.templates || []).map(({ id, label, mode, source }) => ({ id, label, mode, source })),
  };
}

module.exports = { GENERIC_TEMPLATES, loadTemplateLibrary, templateSummary };
