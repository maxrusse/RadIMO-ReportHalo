const PROXY_PROTOCOLS = new Set(["http:", "https:", "socks:", "socks4:", "socks5:", "socks5h:"]);

const PROXY_DIRECTIVE_SCHEMES = Object.freeze({
  HTTP: "http",
  PROXY: "http",
  HTTPS: "https",
  SOCKS: "socks5",
  SOCKS4: "socks4",
  SOCKS5: "socks5",
});

function isProxyDirective(value) {
  return Object.prototype.hasOwnProperty.call(PROXY_DIRECTIVE_SCHEMES, String(value || "").toUpperCase());
}

function normalizedProxyUrl(value, defaultScheme = "http") {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Proxy-Adresse fehlt.");
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${defaultScheme}://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Proxy muss als IP:Port, Hostname:Port oder URL angegeben werden.");
  }
  if (!PROXY_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) {
    throw new Error("Proxy unterstützt nur HTTP(S), SOCKS4 oder SOCKS5 und braucht einen Host.");
  }
  if (parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("Ein Proxy-Endpunkt darf keinen Pfad, Query-String oder Hash enthalten.");
  }
  return parsed.toString().replace(/\/$/, "");
}

function isProxyScriptUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return /(?:\.pac|\.dat)$/i.test(parsed.pathname) || /(?:^|[./])wpad(?:[./]|$)/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function parseProxyInput(value) {
  const raw = String(value || "").trim();
  if (!raw || /^system$/i.test(raw)) return { mode: "system", configured: false };
  if (/^direct(?::\/\/)?$/i.test(raw)) return { mode: "direct", configured: false };

  const pacMatch = raw.match(/^pac(?:\s*script)?\s*:\s*(.+)$/i);
  const pacCandidate = pacMatch ? pacMatch[1].trim() : raw;
  if (pacMatch || isProxyScriptUrl(pacCandidate)) {
    let pacUrl;
    try { pacUrl = new URL(pacCandidate); } catch { throw new Error("PAC-/Setup-Skript muss eine HTTP(S)-URL sein."); }
    if (!["http:", "https:"].includes(pacUrl.protocol) || pacUrl.username || pacUrl.password || pacUrl.hash) {
      throw new Error("PAC-/Setup-Skript muss eine HTTP(S)-URL ohne Zugangsdaten sein.");
    }
    return { mode: "pac_script", pacScript: pacUrl.toString(), configured: true };
  }

  const directiveMatch = raw.match(/^(PROXY|HTTP|HTTPS|SOCKS4|SOCKS5?|SOCKS)\s+(.+)$/i);
  const directive = directiveMatch?.[1]?.toUpperCase() || "HTTP";
  const endpoint = directiveMatch ? directiveMatch[2].trim() : raw;
  if (!isProxyDirective(directive)) throw new Error("Proxy-Regel wird nicht unterstützt.");
  const proxyRules = normalizedProxyUrl(endpoint, PROXY_DIRECTIVE_SCHEMES[directive]);
  return { mode: "fixed_servers", proxyRules, endpoint: proxyRules, configured: true };
}

function proxyEndpointFromRules(rules) {
  if (typeof rules !== "string") return null;
  for (const entry of rules.split(";")) {
    const item = entry.trim();
    const match = item.match(/^(PROXY|HTTP|HTTPS|SOCKS4|SOCKS5?|SOCKS)\s+(.+)$/i);
    if (!match) continue;
    const directive = match[1].toUpperCase();
    try { return normalizedProxyUrl(match[2], PROXY_DIRECTIVE_SCHEMES[directive]); } catch { /* try the next PAC fallback */ }
  }
  return null;
}

function proxyEndpointFromInternetSettings(settings) {
  if (!settings?.enabled || !settings.server) return null;
  const entries = String(settings.server).split(";").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const match = entry.match(/^(https?|socks4|socks5?|proxy)\s*=\s*(.+)$/i);
    if (!match) continue;
    try { return normalizedProxyUrl(match[2], PROXY_DIRECTIVE_SCHEMES[match[1].toUpperCase()] || "http"); } catch { /* try the next configured scheme */ }
  }
  return null;
}

function readWindowsInternetSettings() {
  // Electron's session.resolveProxy is the normal source of truth. The old
  // registry probe spawned hidden PowerShell during startup and was both
  // redundant and needlessly suspicious to endpoint protection.
  return Promise.resolve(null);
}

module.exports = {
  isProxyScriptUrl,
  normalizedProxyUrl,
  parseProxyInput,
  proxyEndpointFromInternetSettings,
  proxyEndpointFromRules,
  readWindowsInternetSettings,
};
