const fs = require("node:fs/promises");
const path = require("node:path");

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".xml", ".html", ".htm"]);

function sectionHint(name) {
  const value = name.toLocaleLowerCase("de-DE");
  if (/frage|fragestell/.test(value)) return "Fragestellung";
  if (/anforder|auftrag/.test(value)) return "Anforderung";
  if (/befund|finding|result/.test(value)) return "Befund";
  if (/beurteil|assessment|impression/.test(value)) return "Beurteilung";
  return "Kontext";
}

function sortNaturally(left, right) {
  return left.localeCompare(right, "de-DE", { numeric: true, sensitivity: "base" });
}

async function readPreview(filePath) {
  const extension = path.extname(filePath).toLocaleLowerCase("de-DE");
  if (!TEXT_EXTENSIONS.has(extension)) return "Binary or unsupported preview; file is kept as a context reference.";
  try {
    const content = await fs.readFile(filePath, "utf8");
    const normalized = content.replace(/\r\n/g, "\n").trim();
    return normalized.length > 1200 ? `${normalized.slice(0, 1200)}\n…` : normalized || "Empty text file.";
  } catch (error) {
    return `Preview unavailable: ${error.message}`;
  }
}

async function readSelectedContent(filePath) {
  const extension = path.extname(filePath).toLocaleLowerCase("de-DE");
  if (!TEXT_EXTENSIONS.has(extension)) return null;
  try {
    const content = (await fs.readFile(filePath, "utf8")).replace(/\r\n/g, "\n");
    return content.length > 20000 ? `${content.slice(0, 20000)}\n… [selected field truncated]` : content;
  } catch {
    return null;
  }
}

async function findAdjacentContext(sourcePath) {
  const source = path.resolve(sourcePath);
  const sourceStat = await fs.stat(source);
  if (!sourceStat.isFile()) throw new Error("Choose a file as the context anchor.");

  const directory = path.dirname(source);
  const entries = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort(sortNaturally);
  const index = entries.indexOf(path.basename(source));
  const anchorIndex = index >= 0 ? index : entries.length;
  const selectedNames = entries.slice(Math.max(0, anchorIndex - 2), Math.min(entries.length, anchorIndex + 2));
  if (!selectedNames.includes(path.basename(source))) selectedNames.push(path.basename(source));

  const items = [];
  for (const name of selectedNames) {
    const filePath = path.join(directory, name);
    const entryIndex = entries.indexOf(name);
    const relation = name === path.basename(source) ? "selected" : entryIndex < anchorIndex ? `${anchorIndex - entryIndex} up` : "1 down";
    const stat = name === path.basename(source) ? sourceStat : await fs.stat(filePath);
    items.push({
      name,
      path: filePath,
      relation,
      section: sectionHint(name),
      size: stat.size,
      preview: await readPreview(filePath),
      content: name === path.basename(source) ? await readSelectedContent(filePath) : null,
    });
  }

  return {
    beta: true,
    generatedAt: new Date().toISOString(),
    source: { name: path.basename(source), path: source, directory },
    strategy: "Same-folder natural filename order: two files above, selected file, one file below.",
    requestedSections: ["Fragestellung", "Anforderung", "Befund", "Beurteilung"],
    items,
  };
}

function formatContextReport(report) {
  const lines = [
    "RadimoAgent context finder beta report",
    `Generated: ${report.generatedAt}`,
    `Anchor: ${report.source.path}`,
    `Strategy: ${report.strategy}`,
    "",
    "Requested report context: Fragestellung, Anforderung, Befund, Beurteilung",
    "",
  ];
  for (const item of report.items) {
    lines.push(`## ${item.relation} · ${item.section} · ${item.name}`);
    lines.push(`Path: ${item.path}`);
    lines.push("");
    lines.push(item.preview);
    lines.push("", "---", "");
  }
  return lines.join("\n");
}

module.exports = { findAdjacentContext, formatContextReport };
