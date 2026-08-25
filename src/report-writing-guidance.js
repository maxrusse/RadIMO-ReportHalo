const fs = require("node:fs/promises");
const path = require("node:path");

const PROFILE_ID = "german-radiology-befund";
const PROFILE_VERSION = 1;
const USER_PROFILE_NAME = "german-radiology-profile.md";
const MAX_PROFILE_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 1_200;
const MAX_COLLECTION_ITEMS = 200;
const MAX_PROMPT_CHARS = 12_000;

const DEFAULT_PROFILE = Object.freeze({
  version: PROFILE_VERSION,
  profileId: PROFILE_ID,
  label: "German / Latin Befundtexte",
  locale: "de-DE",
  purpose: "Conservative linguistic support for German radiology reports.",
  latinPolicy: "Preserve established anatomical and diagnostic Latin terms. Do not replace a department term merely for stylistic variety.",
  styleRules: [
    "Separate Fragestellung, Anforderung, Befund, and Beurteilung when those sections are present.",
    "In Lektorat mode, repair spelling, grammar, punctuation, dictation artifacts, and local readability only.",
    "Preserve every measurement, unit, side, anatomical location, negation, uncertainty marker, temporal qualifier, and comparison date.",
    "Do not add an unmentioned finding, diagnosis, recommendation, staging statement, or clinical history.",
    "Keep uncertainty proportional: use formulations such as 'vereinbar mit', 'am ehesten', or 'kann nicht ausgeschlossen werden' only when the source supports them.",
    "Prefer concise, unambiguous radiology report language and avoid decorative prose.",
    "If the source is ambiguous or internally inconsistent, flag it for radiologist review instead of silently resolving it.",
  ],
  terminology: [],
  phrasePatterns: [],
  examples: [],
});

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT_CHARS) : fallback;
}

function boundedList(value, mapper) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_COLLECTION_ITEMS).map(mapper).filter(Boolean);
}

function normalizeProfile(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const profile = {
    version: PROFILE_VERSION,
    profileId: PROFILE_ID,
    label: text(source.label, DEFAULT_PROFILE.label),
    locale: text(source.locale, DEFAULT_PROFILE.locale),
    purpose: text(source.purpose, DEFAULT_PROFILE.purpose),
    latinPolicy: text(source.latinPolicy, DEFAULT_PROFILE.latinPolicy),
    styleRules: boundedList(source.styleRules, (item) => text(item)).filter(Boolean),
    terminology: boundedList(source.terminology, (item) => {
      if (!item || typeof item !== "object") return null;
      const preferred = text(item.preferred);
      if (!preferred) return null;
      return { preferred, aliases: boundedList(item.aliases, (alias) => text(alias)).slice(0, 20), note: text(item.note) };
    }),
    phrasePatterns: boundedList(source.phrasePatterns, (item) => {
      if (!item || typeof item !== "object") return null;
      const phrase = text(item.phrase);
      if (!phrase) return null;
      return { label: text(item.label, "Department phrase"), phrase, section: text(item.section, "Befund/Beurteilung"), note: text(item.note) };
    }),
    examples: boundedList(source.examples, (item) => {
      if (!item || typeof item !== "object") return null;
      const input = text(item.input);
      const approved = text(item.approved);
      if (!input || !approved) return null;
      return { title: text(item.title, "Approved example"), input, approved, note: text(item.note) };
    }),
  };
  if (!profile.styleRules.length) profile.styleRules = [...DEFAULT_PROFILE.styleRules];
  return profile;
}

function unquote(value) {
  return String(value || "").trim().replace(/^`|`$/g, "").replace(/\\\|/g, "|");
}

function markdownSection(markdown, heading) {
  const lines = String(markdown || "").split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(line.trim()));
  if (start < 0) return "";
  const end = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line.trim()));
  return lines.slice(start + 1, end < 0 ? lines.length : start + 1 + end).join("\n").trim();
}

function markdownField(block, label) {
  const match = String(block || "").match(new RegExp(`^${label}:\\s*(.*)$`, "im"));
  return match ? unquote(match[1]) : "";
}

function parseTerminology(section) {
  return String(section || "").split(/\r?\n/).filter((line) => line.trim().startsWith("|")).slice(2).map((line) => {
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(unquote);
    if (!cells[0] || /^[-: ]+$/.test(cells[0])) return null;
    return { preferred: cells[0], aliases: (cells[1] || "").split(",").map((item) => item.trim()).filter(Boolean), note: cells[2] || "" };
  }).filter(Boolean);
}

function parseBlocks(section, fields) {
  const lines = String(section || "").split(/\r?\n/);
  const starts = lines.map((line, index) => /^###\s+(.+)\s*$/i.exec(line.trim()) ? index : -1).filter((index) => index >= 0);
  const blocks = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1] ?? lines.length;
    const heading = /^###\s+(.+)\s*$/i.exec(lines[start].trim());
    const body = lines.slice(start + 1, end).join("\n");
    const block = { [fields[0]]: unquote(heading[1]) };
    for (const field of fields.slice(1)) block[field] = markdownField(body, field[0].toUpperCase() + field.slice(1));
    blocks.push(block);
  }
  return blocks;
}

function parseGuidanceMarkdown(markdown) {
  const source = String(markdown || "");
  const heading = source.match(/^#\s+(.+)$/m);
  const profile = normalizeProfile({
    label: heading ? heading[1].trim() : DEFAULT_PROFILE.label,
    locale: markdownField(source, "Locale") || DEFAULT_PROFILE.locale,
    purpose: markdownField(source, "Purpose") || DEFAULT_PROFILE.purpose,
    latinPolicy: markdownField(source, "Latin policy") || DEFAULT_PROFILE.latinPolicy,
    styleRules: markdownSection(source, "Style rules").split(/\r?\n/).map((line) => line.replace(/^\s*[-*]\s+/, "").trim()).filter(Boolean),
    terminology: parseTerminology(markdownSection(source, "Department terminology")),
    phrasePatterns: parseBlocks(markdownSection(source, "Phrase patterns"), ["label", "phrase", "section", "note"]),
    examples: parseBlocks(markdownSection(source, "Approved examples"), ["title", "input", "approved", "note"]),
  });
  return profile;
}

function markdownCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function serializeGuidanceMarkdown(input) {
  const profile = normalizeProfile(input);
  const lines = [
    `# ${profile.label}`,
    "",
    "> Editable department guidance for German radiology `Befund` and `Beurteilung` text.",
    "> Keep additions reviewed and de-identified. These entries guide language and style; they are never case facts.",
    "",
    `Locale: ${profile.locale}`,
    `Purpose: ${profile.purpose}`,
    `Latin policy: ${profile.latinPolicy}`,
    "",
    "## Style rules",
    "",
    ...profile.styleRules.map((rule) => `- ${rule}`),
    "",
    "## Department terminology",
    "",
    "| Preferred | Aliases / avoid | Note |",
    "| --- | --- | --- |",
    ...profile.terminology.map((item) => `| ${markdownCell(item.preferred)} | ${markdownCell(item.aliases.join(", "))} | ${markdownCell(item.note)} |`),
    "",
    "## Phrase patterns",
    "",
  ];
  for (const item of profile.phrasePatterns) {
    lines.push(`### ${item.label}`, "", `Phrase: ${item.phrase}`, `Section: ${item.section}`, `Note: ${item.note}`, "");
  }
  lines.push("## Approved examples", "");
  for (const item of profile.examples) {
    lines.push(`### ${item.title}`, "", `Input: ${item.input}`, `Approved: ${item.approved}`, `Note: ${item.note}`, "");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function profileDirectory(userDataPath) {
  return path.join(userDataPath, "guidance");
}

function userProfilePath(userDataPath) {
  return path.join(profileDirectory(userDataPath), USER_PROFILE_NAME);
}

async function readMarkdownProfile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_PROFILE_BYTES) throw new Error("The guidance profile is missing, too large, or not a file.");
  return parseGuidanceMarkdown(await fs.readFile(filePath, "utf8"));
}

async function loadGuidanceProfile({ appRoot, executablePath = process.execPath, resourcesPath = process.resourcesPath, userDataPath } = {}) {
  const shippedPath = path.join(appRoot || path.join(__dirname, ".."), "guidance", USER_PROFILE_NAME);
  const localPath = userProfilePath(userDataPath || path.join(process.cwd(), ".radimoagent"));
  const candidates = [...new Set([
    path.join(path.dirname(executablePath), "guidance", USER_PROFILE_NAME),
    resourcesPath ? path.join(resourcesPath, "guidance", USER_PROFILE_NAME) : null,
    localPath,
    shippedPath,
  ].filter(Boolean))];
  for (const candidate of candidates) {
    try {
      return { profile: await readMarkdownProfile(candidate), source: candidate === shippedPath ? "shipped" : "local", sourcePath: candidate, userPath: localPath };
    } catch {
      // A missing or malformed override must never prevent the app from starting.
    }
  }
  return { profile: normalizeProfile(DEFAULT_PROFILE), source: "generic", sourcePath: null, userPath: localPath };
}

async function saveGuidanceProfile(userDataPath, input) {
  const profile = normalizeProfile(input);
  const target = userProfilePath(userDataPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, serializeGuidanceMarkdown(profile), { encoding: "utf8", mode: 0o600 });
  return { profile, source: "local", sourcePath: target, userPath: target };
}

function formatGuidancePrompt(profileInput = DEFAULT_PROFILE) {
  const profile = normalizeProfile(profileInput);
  const lines = [
    `REPORT WRITING PROFILE: ${profile.label} (${profile.locale})`,
    `Purpose: ${profile.purpose}`,
    `Latin terminology policy: ${profile.latinPolicy}`,
    "Apply this profile conservatively. It is a language and terminology aid, not a source of new clinical facts.",
    "If a profile rule conflicts with supplied source text, preserve the source meaning and flag the conflict.",
    "Style rules:",
    ...profile.styleRules.map((rule) => `- ${rule}`),
  ];
  if (profile.terminology.length) {
    lines.push("Department terminology (prefer only when semantically identical):");
    for (const item of profile.terminology) lines.push(`- ${item.preferred}${item.aliases.length ? ` (aliases: ${item.aliases.join(", ")})` : ""}${item.note ? ` — ${item.note}` : ""}`);
  }
  if (profile.phrasePatterns.length) {
    lines.push("Department-approved phrase patterns; adapt only to the supplied finding:");
    for (const item of profile.phrasePatterns) lines.push(`- [${item.section}] ${item.label}: ${item.phrase}${item.note ? ` — ${item.note}` : ""}`);
  }
  if (profile.examples.length) {
    lines.push("Approved examples are style references, not facts to copy into a new case:");
    for (const item of profile.examples) lines.push(`- ${item.title}: source: ${item.input} => approved: ${item.approved}${item.note ? ` — ${item.note}` : ""}`);
  }
  const prompt = lines.join("\n");
  return prompt.length > MAX_PROMPT_CHARS ? `${prompt.slice(0, MAX_PROMPT_CHARS - 80)}\n[Additional profile entries omitted at the prompt limit.]` : prompt;
}

function profileSummary(loaded) {
  const profile = loaded?.profile || normalizeProfile(DEFAULT_PROFILE);
  return {
    profileId: profile.profileId,
    label: profile.label,
    locale: profile.locale,
    version: profile.version,
    source: loaded?.source || "unknown",
    sourcePath: loaded?.sourcePath || null,
    userPath: loaded?.userPath || null,
    terminologyCount: profile.terminology.length,
    phraseCount: profile.phrasePatterns.length,
    exampleCount: profile.examples.length,
  };
}

module.exports = {
  DEFAULT_PROFILE,
  PROFILE_ID,
  USER_PROFILE_NAME,
  formatGuidancePrompt,
  loadGuidanceProfile,
  normalizeProfile,
  parseGuidanceMarkdown,
  profileDirectory,
  profileSummary,
  saveGuidanceProfile,
  serializeGuidanceMarkdown,
  userProfilePath,
};
