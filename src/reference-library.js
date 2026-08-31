const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".html", ".htm", ".json", ".csv", ".xml"]);
const MAX_REFERENCE_BYTES = 2_000_000;
const MAX_REFERENCE_CHARS = 40_000;
const MAX_REFERENCE_REDIRECTS = 3;
const execFileAsync = promisify(execFile);
const APPROVED_REFERENCE_HOSTS = new Set([
  "radiopaedia.org",
  "pubmed.ncbi.nlm.nih.gov",
  "pmc.ncbi.nlm.nih.gov",
  "europepmc.org",
  "doi.org",
  "ncbi.nlm.nih.gov",
  "pubs.rsna.org",
  "ajronline.org",
  "academic.oup.com",
  "link.springer.com",
  "jamanetwork.com",
  "bmj.com",
]);

function htmlToText(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value, extension) {
  const text = extension === ".html" || extension === ".htm" ? htmlToText(value) : value;
  return text.replace(/\u0000/g, "").trim();
}

function pdfTextCandidates() {
  const candidates = [];
  if (process.env.RADIMOAGENT_PDFTOTEXT) candidates.push(process.env.RADIMOAGENT_PDFTOTEXT);
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "pdf", process.platform === "win32" ? "pdftotext.exe" : "pdftotext"));
  candidates.push(process.platform === "win32" ? "pdftotext.exe" : "pdftotext");
  return [...new Set(candidates)];
}

async function extractPdfText(filePath) {
  for (const command of pdfTextCandidates()) {
    try {
      const result = await execFileAsync(command, ["-layout", "-enc", "UTF-8", filePath, "-"], {
        timeout: 15_000,
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true,
      });
      const content = String(result.stdout || "").replace(/\u0000/g, "").trim().slice(0, MAX_REFERENCE_CHARS);
      if (content) return { content, command };
    } catch {
      // Optional local capability: keep trying candidates, then remain trace-only.
    }
  }
  return { content: "", command: null };
}

function validateReferenceUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("Reference URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("Reference URL must use HTTPS.");
  const hostname = parsed.hostname.toLowerCase();
  const approved = [...APPROVED_REFERENCE_HOSTS].some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (!approved) throw new Error("For safety, use a Radiopaedia, PubMed/PMC, Europe PMC, DOI, or approved journal URL.");
  return parsed.toString();
}

async function readReferenceUrl(value, fetchImpl = globalThis.fetch) {
  let url = validateReferenceUrl(value);
  if (typeof fetchImpl !== "function") throw new Error("No local HTTPS fetch capability is available.");
  let response;
  for (let redirect = 0; redirect <= MAX_REFERENCE_REDIRECTS; redirect += 1) {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirect === MAX_REFERENCE_REDIRECTS) throw new Error("Reference URL redirected too many times.");
    const location = response.headers?.get?.("location");
    if (!location) throw new Error("Reference redirect did not provide a destination.");
    url = validateReferenceUrl(new URL(location, url).toString());
  }
  if (!response.ok) throw new Error(`Reference returned HTTP ${response.status}.`);
  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (declaredLength > MAX_REFERENCE_BYTES) throw new Error("Reference page is too large for the local evidence pack.");
  if (contentType.includes("pdf")) {
    return {
      name: new URL(url).hostname,
      path: url,
      url,
      extension: ".pdf",
      size: declaredLength || 0,
      sourceType: "web",
      status: "metadata-only",
      reason: "The URL returned a PDF. Download it and use local PDF extraction before relying on its text.",
      content: "",
      preview: "PDF reference URL recorded; no PDF bytes were silently interpreted.",
    };
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_REFERENCE_BYTES) throw new Error("Reference page is too large for the local evidence pack.");
  const content = normalizeText(raw, ".html").slice(0, MAX_REFERENCE_CHARS);
  return {
    name: new URL(url).hostname,
    path: url,
    url,
    extension: ".html",
    size: Buffer.byteLength(raw),
    sourceType: "web",
    status: content ? "ready" : "empty",
    reason: content ? "Fetched locally; verify the page and citation before relying on it." : "The page contained no readable text.",
    content,
    preview: content.slice(0, 420),
  };
}

async function readReferenceFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const stat = await fs.stat(absolutePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const isPdf = extension === ".pdf";
  const readable = (TEXT_EXTENSIONS.has(extension) || isPdf) && stat.size <= MAX_REFERENCE_BYTES;
  let content = "";
  let status = "metadata-only";
  let reason = "This file type needs text extraction before it can be used as evidence.";
  if (readable && isPdf) {
    const extracted = await extractPdfText(absolutePath);
    content = extracted.content;
    status = content ? "ready" : "metadata-only";
    reason = content
      ? "Text extracted locally; review the source before relying on it."
      : "No local PDF text extractor was available or the PDF contains no extractable text.";
  } else if (readable) {
    content = normalizeText(await fs.readFile(absolutePath, "utf8"), extension).slice(0, MAX_REFERENCE_CHARS);
    status = content ? "ready" : "empty";
    reason = content ? null : "The file contains no readable text.";
  } else if (!TEXT_EXTENSIONS.has(extension) && !isPdf) {
    reason = "Binary files are listed for traceability but are not read by this local-only beta.";
  } else if (stat.size > MAX_REFERENCE_BYTES) {
    reason = `The file is larger than ${MAX_REFERENCE_BYTES} bytes and was not read.`;
  }
  return {
    name: path.basename(absolutePath),
    path: absolutePath,
    sourceType: "local",
    extension,
    size: stat.size,
    status,
    reason,
    content,
    preview: content.slice(0, 420),
  };
}

async function readReferencePack(filePaths) {
  const uniquePaths = [...new Set((filePaths || []).filter((value) => typeof value === "string" && value.trim()))];
  return Promise.all(uniquePaths.slice(0, 12).map(readReferenceFile));
}

function formatReferencePack(pack) {
  const readable = (pack || []).filter((item) => item.status === "ready" && item.content);
  if (!readable.length) return "";
  const blocks = readable.map((item) => [
    `### LOCAL REFERENCE · ${item.name}`,
    `Source filename: ${item.name}`,
    item.content,
    `### END LOCAL REFERENCE · ${item.name}`,
  ].join("\n"));
  return [
    "[EXPLICITLY ATTACHED LOCAL RADIOLOGY REFERENCE PACK]",
    "Use only the readable text below as local reference material. Cite the filename when relying on it. Do not claim to have read a metadata-only PDF or binary file.",
    blocks.join("\n\n"),
    "[/EXPLICITLY ATTACHED LOCAL RADIOLOGY REFERENCE PACK]",
  ].join("\n");
}

module.exports = {
  MAX_REFERENCE_BYTES,
  MAX_REFERENCE_CHARS,
  MAX_REFERENCE_REDIRECTS,
  APPROVED_REFERENCE_HOSTS,
  extractPdfText,
  validateReferenceUrl,
  readReferenceUrl,
  readReferenceFile,
  readReferencePack,
  formatReferencePack,
};
