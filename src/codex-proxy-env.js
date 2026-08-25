function isOpenAiNoProxyEntry(entry) {
  const normalized = entry.trim().toLowerCase().replace(/^\*\./, ".");
  const host = normalized.replace(/^\./, "").split(":")[0];
  return normalized === "*" || host === "openai.com" || host.endsWith(".openai.com");
}

function applyCodexProxy(environment, proxy) {
  const env = environment;
  env.HTTPS_PROXY = proxy;
  env.https_proxy = proxy;
  env.HTTP_PROXY = proxy;
  env.http_proxy = proxy;
  const existing = typeof env.NO_PROXY === "string" ? env.NO_PROXY : env.no_proxy;
  if (typeof existing !== "string") return false;
  const filtered = existing.split(/[;,\s]+/).filter(Boolean).filter((entry) => !isOpenAiNoProxyEntry(entry));
  const cleaned = filtered.join(",");
  env.NO_PROXY = cleaned;
  env.no_proxy = cleaned;
  return cleaned !== existing;
}

module.exports = { applyCodexProxy, isOpenAiNoProxyEntry };
