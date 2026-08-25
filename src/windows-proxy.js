const { spawn } = require("node:child_process");

const POWERSHELL = `
$ErrorActionPreference = 'Stop'
$path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
$settings = Get-ItemProperty -Path $path
[ordered]@{
  enabled = ([int]$settings.ProxyEnable -eq 1)
  server = [string]$settings.ProxyServer
  autoConfigUrl = [string]$settings.AutoConfigURL
} | ConvertTo-Json -Compress
`;

function readWindowsInternetSettings() {
  if (process.platform !== "win32") return Promise.resolve(null);
  const encoded = Buffer.from(POWERSHELL, "utf16le").toString("base64");
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}");
        resolve({
          enabled: parsed.enabled === true,
          server: typeof parsed.server === "string" ? parsed.server.trim() : "",
          autoConfigUrl: typeof parsed.autoConfigUrl === "string" ? parsed.autoConfigUrl.trim() : "",
        });
      } catch {
        resolve(null);
      }
    });
  });
}

function proxyEndpointFromInternetSettings(settings) {
  if (!settings?.enabled || !settings.server) return null;
  const entries = settings.server.split(";").map((entry) => entry.trim()).filter(Boolean);
  const preferred = entries.find((entry) => /^https=/i.test(entry))
    || entries.find((entry) => /^http=/i.test(entry))
    || entries.find((entry) => /^socks5?=/i.test(entry))
    || entries[0];
  if (!preferred) return null;
  const value = preferred.includes("=") ? preferred.slice(preferred.indexOf("=") + 1).trim() : preferred;
  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  const scheme = /^socks/i.test(preferred) ? "socks5" : "http";
  return `${scheme}://${value}`;
}

module.exports = { proxyEndpointFromInternetSettings, readWindowsInternetSettings };
