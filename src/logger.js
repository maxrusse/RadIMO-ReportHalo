const fs = require("node:fs/promises");
const path = require("node:path");

let logPath = null;
let writeQueue = Promise.resolve();

function configure(directory) {
  logPath = path.join(directory, "radimoagent.log");
  writeQueue = writeQueue.then(() => fs.mkdir(directory, { recursive: true })).catch(() => {});
  return logPath;
}

function safeDetails(details) {
  if (details === undefined) return "";
  try {
    const text = typeof details === "string" ? details : JSON.stringify(details);
    return text
      .replace(/(authorization|token|access_token|refresh_token|api[_-]?key)\s*[:=]\s*[^,}\s]+/gi, "$1=<redacted>")
      .slice(0, 4000);
  } catch {
    return String(details).slice(0, 4000);
  }
}

function log(level, message, details) {
  if (!logPath) return;
  const suffix = safeDetails(details);
  const line = `${new Date().toISOString()} [${level}] ${message}${suffix ? ` ${suffix}` : ""}\n`;
  writeQueue = writeQueue
    .then(() => fs.appendFile(logPath, line, "utf8"))
    .catch(() => {});
}

async function readLog(maxBytes = 120000) {
  if (!logPath) return "Logging has not been initialized yet.";
  try {
    const content = await fs.readFile(logPath, "utf8");
    return content.length > maxBytes ? `[last ${maxBytes} characters]\n${content.slice(-maxBytes)}` : content;
  } catch (error) {
    return `Log file is not readable yet: ${error.message}`;
  }
}

function getLogPath() {
  return logPath;
}

module.exports = { configure, log, readLog, getLogPath };
