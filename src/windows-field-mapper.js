const fs = require("node:fs/promises");
const path = require("node:path");

const FIELD_MAPPER_CONFIG_NAME = "field-mapper.json";
const FIELD_MAPPER_SCHEMA = "reporthalo.field-map.v1";
const MAX_PROFILE_CHARS = 24_000;
const MAX_RULES = 32;
const MAX_PATTERNS_PER_RULE = 24;
const MAX_PATTERN_CHARS = 160;
const MAX_FIELDS = 250;
const MAX_VALUES_PER_GROUP = 8;
const MAX_VALUE_CHARS = 20_000;
const MAX_CONTEXT_CHARS = 80_000;

const DEFAULT_INCLUDE_RULES = [
  { key: "clinical_question", label: "Fragestellung", patterns: ["*fragestellung*", "*frage*", "*anforderung*"] },
  { key: "lab", label: "Labor", patterns: ["*labor*"] },
  { key: "contrast", label: "Kontrast", patterns: ["*kontrast*"] },
  { key: "report", label: "Befund", patterns: ["*befund*"] },
  { key: "summary", label: "Beurteilung", patterns: ["*beurteilung*", "*impression*"] },
  { key: "clinical_info", label: "Klinische Angaben", patterns: ["*klinische angabe*", "*anamnese*", "*indikation*"] },
  { key: "referrer_notes", label: "Zuweiserangaben", patterns: ["*zuweis*", "*überweisung*", "*refer*"] },
];

const DEFAULT_EXCLUDE_PATTERNS = [
  "*patient*",
  "*geburtsdatum*",
  "*geburt*",
  "*adresse*",
  "*telefon*",
  "*versicherung*",
  "*fallnummer*",
  "*patienten-id*",
  "*patientennummer*",
  "*versichertennummer*",
];

const DEFAULT_INCLUDE_TEXT = DEFAULT_INCLUDE_RULES
  .map((rule) => `${rule.key} = ${rule.patterns.join(" | ")}`)
  .join("\n");
const DEFAULT_EXCLUDE_TEXT = DEFAULT_EXCLUDE_PATTERNS.join("\n");

function cleanText(value, max = MAX_PATTERN_CHARS) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeKey(value) {
  return cleanText(value, 80)
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "context";
}

function humanizeKey(value) {
  const key = normalizeKey(value);
  const known = {
    clinical_question: "Fragestellung",
    lab: "Labor",
    contrast: "Kontrast",
    report: "Befund",
    summary: "Beurteilung",
    clinical_info: "Klinische Angaben",
    referrer_notes: "Zuweiserangaben",
  };
  return known[key] || key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("de-DE"));
}

function normalizePattern(value) {
  return cleanText(value, MAX_PATTERN_CHARS).toLocaleLowerCase("de-DE");
}

function normalizePatterns(value) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split("|") : [];
  return [...new Set(values.map(normalizePattern).filter(Boolean))].slice(0, MAX_PATTERNS_PER_RULE);
}

function normalizeIncludeRules(value) {
  const values = Array.isArray(value) ? value : [];
  return values.slice(0, MAX_RULES).map((rule) => {
    const key = normalizeKey(rule?.key);
    return {
      key,
      label: cleanText(rule?.label, 100) || humanizeKey(key),
      patterns: normalizePatterns(rule?.patterns),
      enabled: rule?.enabled !== false,
      optional: rule?.optional !== false,
      maxChars: Math.max(256, Math.min(MAX_VALUE_CHARS, Number(rule?.maxChars) || MAX_VALUE_CHARS)),
    };
  }).filter((rule) => rule.enabled && rule.patterns.length);
}

function normalizeExcludePatterns(value) {
  const values = Array.isArray(value)
    ? value.flatMap((item) => typeof item === "string" ? [item] : item?.patterns || [])
    : typeof value === "string" ? value.split("|") : [];
  return [...new Set(values.map(normalizePattern).filter(Boolean))].slice(0, MAX_RULES * MAX_PATTERNS_PER_RULE);
}

function defaultFieldMapperProfile() {
  return {
    version: 1,
    schema: FIELD_MAPPER_SCHEMA,
    include: DEFAULT_INCLUDE_RULES.map((rule) => ({ ...rule, patterns: [...rule.patterns] })),
    exclude: [...DEFAULT_EXCLUDE_PATTERNS],
    limits: {
      maxFields: MAX_FIELDS,
      maxValueChars: MAX_VALUE_CHARS,
      maxContextChars: MAX_CONTEXT_CHARS,
    },
  };
}

function normalizeFieldMapperProfile(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallback = defaultFieldMapperProfile();
  const include = normalizeIncludeRules(source.include);
  const exclude = normalizeExcludePatterns(source.exclude);
  return {
    version: 1,
    schema: FIELD_MAPPER_SCHEMA,
    include: Array.isArray(source.include) ? include : fallback.include,
    exclude: Array.isArray(source.exclude) ? exclude : fallback.exclude,
    limits: {
      maxFields: Math.max(20, Math.min(MAX_FIELDS, Number(source.limits?.maxFields) || MAX_FIELDS)),
      maxValueChars: Math.max(256, Math.min(MAX_VALUE_CHARS, Number(source.limits?.maxValueChars) || MAX_VALUE_CHARS)),
      maxContextChars: Math.max(2_000, Math.min(MAX_CONTEXT_CHARS, Number(source.limits?.maxContextChars) || MAX_CONTEXT_CHARS)),
    },
  };
}

function parseRuleText(includeText, excludeText) {
  const include = [];
  for (const rawLine of String(includeText || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line || line.startsWith("//")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const patterns = line.slice(separator + 1).split("|").map((item) => item.trim()).filter(Boolean);
    include.push({ key, label: humanizeKey(key), patterns });
  }
  const exclude = String(excludeText || "")
    .split(/\r?\n|\|/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line && !line.startsWith("//"));
  return normalizeFieldMapperProfile({ include, exclude });
}

function serializeRuleText(profileValue) {
  const profile = normalizeFieldMapperProfile(profileValue);
  return {
    includeText: profile.include.map((rule) => `${rule.key} = ${rule.patterns.join(" | ")}`).join("\n"),
    excludeText: profile.exclude.join("\n"),
  };
}

function configPath(userDataPath) {
  return path.join(userDataPath, FIELD_MAPPER_CONFIG_NAME);
}

async function loadFieldMapperProfile(userDataPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(userDataPath), "utf8"));
    return normalizeFieldMapperProfile(parsed);
  } catch {
    return defaultFieldMapperProfile();
  }
}

async function saveFieldMapperProfile(userDataPath, profileValue) {
  const profile = normalizeFieldMapperProfile(profileValue);
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(configPath(userDataPath), `${JSON.stringify(profile, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return profile;
}

function toGlobRegExp(pattern) {
  const value = normalizePattern(pattern);
  let source = "^";
  for (const character of value) {
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else source += character.replace(/[\\^$+.()|{}[\]]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "iu");
}

function fieldIdentities(field) {
  const values = [
    ...(Array.isArray(field?.identities) ? field.identities : []),
    field?.label,
    field?.name,
    field?.automationId,
    field?.helpText,
    field?.labeledBy,
    field?.className,
  ];
  return [...new Set(values.map((value) => cleanText(value, MAX_PATTERN_CHARS)).filter(Boolean))];
}

function matchesAnyPattern(values, patterns) {
  const regexes = patterns.map(toGlobRegExp);
  return values.some((value) => regexes.some((regex) => regex.test(value)));
}

function matchContextFields(fields, profileValue) {
  const profile = normalizeFieldMapperProfile(profileValue);
  return (Array.isArray(fields) ? fields : []).slice(0, profile.limits.maxFields).map((field, index) => {
    const identities = fieldIdentities(field);
    const excluded = Boolean(field?.isPassword) || matchesAnyPattern(identities, profile.exclude);
    const matches = excluded ? [] : profile.include.filter((rule) => matchesAnyPattern(identities, rule.patterns)).map((rule) => ({ key: rule.key, label: rule.label, maxChars: rule.maxChars }));
    return {
      ...field,
      index,
      identities,
      excluded,
      matches,
      matched: matches.length > 0,
    };
  });
}

function truncateValue(value, maxChars) {
  const normalized = String(value || "").replace(/\r\n/g, "\n").trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}\n… [field truncated]` : normalized;
}

function sourceSummary(scan) {
  return {
    windowHandle: String(scan?.windowHandle || ""),
    processId: Number(scan?.processId) || 0,
    processName: cleanText(scan?.processName, 160),
    frameworkId: cleanText(scan?.frameworkId, 80),
    controlType: cleanText(scan?.controlType, 100),
  };
}

function safeFieldSummary(field, windowHandle = "") {
  return {
    index: Number(field?.index) || 0,
    label: cleanText(field?.label || field?.name || field?.labeledBy, 180) || "Unbenanntes Textfeld",
    name: cleanText(field?.name, 180),
    automationId: cleanText(field?.automationId, 160),
    helpText: cleanText(field?.helpText, 180),
    labeledBy: cleanText(field?.labeledBy, 180),
    className: cleanText(field?.className, 160),
    frameworkId: cleanText(field?.frameworkId, 80),
    controlType: cleanText(field?.controlType, 100),
    isReadOnly: field?.isReadOnly === true,
    isPassword: field?.isPassword === true,
    supportsValue: field?.supportsValue === true,
    supportsText: field?.supportsText === true,
    readStrategy: cleanText(field?.readStrategy, 80),
    hasValue: typeof field?.value === "string" && Boolean(field.value.trim()),
    valueChars: typeof field?.value === "string" ? field.value.length : Number(field?.valueChars) || 0,
    windowHandle: String(field?.windowHandle || windowHandle || "").slice(0, 32),
    processId: Number(field?.processId) || 0,
    nativeWindowHandle: Number(field?.nativeWindowHandle) || 0,
    runtimeId: cleanText(field?.runtimeId, 180),
    excluded: field?.excluded === true,
    matches: Array.isArray(field?.matches) ? field.matches.map((match) => ({ key: match.key, label: match.label })) : [],
  };
}

function buildFieldMapReport(scan, profileValue, { readValues = false } = {}) {
  const profile = normalizeFieldMapperProfile(profileValue);
  const matchedFields = matchContextFields(scan?.fields, profile);
  const groups = profile.include.map((rule) => ({
    key: rule.key,
    label: rule.label,
    values: [],
    fieldCount: 0,
    empty: true,
  }));
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  for (const field of matchedFields) {
    for (const match of field.matches) {
      const group = groupByKey.get(match.key);
      if (!group) continue;
      group.fieldCount += 1;
      const value = readValues ? truncateValue(field.value, match.maxChars || MAX_VALUE_CHARS) : "";
      if (value && group.values.length < MAX_VALUES_PER_GROUP && !group.values.includes(value)) group.values.push(value);
      group.empty = group.values.length === 0;
    }
  }
  const fields = matchedFields.map((field) => safeFieldSummary(field, scan?.windowHandle));
  const selectedGroups = groups.filter((group) => group.values.length);
  const missing = groups.filter((group) => !group.values.length).map((group) => group.key);
  const diagnostics = {
    scanned: Number(scan?.diagnostics?.scanned) || matchedFields.length,
    textFields: matchedFields.length,
    matchedFields: matchedFields.filter((field) => field.matched).length,
    excludedFields: matchedFields.filter((field) => field.excluded).length,
    readableFields: matchedFields.filter((field) => field.hasValue || (typeof field.value === "string" && field.value.length > 0)).length,
    inaccessibleFields: Number(scan?.diagnostics?.inaccessibleFields) || 0,
    truncated: Boolean(scan?.diagnostics?.truncated),
    durationMs: Number(scan?.diagnostics?.durationMs) || 0,
    readValues: Boolean(readValues),
    strategy: cleanText(scan?.diagnostics?.strategy, 80),
    patterns: cleanText(scan?.diagnostics?.patterns, 180),
  };
  const report = {
    ok: scan?.ok !== false,
    schema: FIELD_MAPPER_SCHEMA,
    generatedAt: scan?.generatedAt || new Date().toISOString(),
    source: sourceSummary(scan),
    groups: selectedGroups.map((group) => ({ ...group })),
    configuredGroups: groups.map(({ key, label, fieldCount, empty }) => ({ key, label, fieldCount, empty })),
    missing,
    fields,
    diagnostics,
    profile: serializeRuleText(profile),
    error: scan?.error || null,
  };
  report.prompt = formatFieldMapPrompt(report);
  report.reportText = formatFieldMapReport(report);
  return report;
}

function formatFieldMapPrompt(reportValue, selectedKeys = null) {
  const report = reportValue || {};
  const selected = new Set(Array.isArray(selectedKeys) ? selectedKeys : (report.groups || []).map((group) => group.key));
  const groups = (report.groups || []).filter((group) => selected.has(group.key) && Array.isArray(group.values) && group.values.length);
  if (!groups.length) return "";
  const blocks = groups.map((group) => `${group.label}:\n${group.values.join("\n\n")}`);
  return [
    "[EXPLICITLY ATTACHED READ-ONLY RIS CONTEXT]",
    "The following values were read from configured text fields of the active application. Use them only as case context. Do not infer missing values and do not treat field labels as findings.",
    blocks.join("\n\n"),
    "[/EXPLICITLY ATTACHED READ-ONLY RIS CONTEXT]",
  ].join("\n");
}

function formatFieldMapReport(reportValue) {
  const report = reportValue || {};
  const lines = [
    "ReportHalo Field Mapper report",
    `Generated: ${report.generatedAt || new Date().toISOString()}`,
    `Application process: ${report.source?.processName || "unknown"}`,
    `Process ID: ${report.source?.processId || "unknown"}`,
    "",
    "Configured context fields:",
  ];
  for (const group of report.groups || []) {
    lines.push(`## ${group.label}`);
    lines.push(...group.values, "");
  }
  if (report.missing?.length) lines.push(`Missing or empty groups: ${report.missing.join(", ")}`, "");
  lines.push("Field diagnostics:", JSON.stringify(report.diagnostics || {}, null, 2));
  return lines.join("\n").slice(0, MAX_CONTEXT_CHARS);
}

function profileSummary(profileValue, userDataPath = "") {
  const profile = normalizeFieldMapperProfile(profileValue);
  const text = serializeRuleText(profile);
  return {
    schema: profile.schema,
    version: profile.version,
    include: profile.include,
    exclude: profile.exclude,
    includeText: text.includeText,
    excludeText: text.excludeText,
    configPath: userDataPath ? configPath(userDataPath) : null,
  };
}

module.exports = {
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_INCLUDE_RULES,
  DEFAULT_EXCLUDE_TEXT,
  DEFAULT_INCLUDE_TEXT,
  FIELD_MAPPER_CONFIG_NAME,
  FIELD_MAPPER_SCHEMA,
  buildFieldMapReport,
  configPath,
  defaultFieldMapperProfile,
  formatFieldMapPrompt,
  formatFieldMapReport,
  loadFieldMapperProfile,
  matchContextFields,
  normalizeFieldMapperProfile,
  parseRuleText,
  profileSummary,
  saveFieldMapperProfile,
  serializeRuleText,
};
