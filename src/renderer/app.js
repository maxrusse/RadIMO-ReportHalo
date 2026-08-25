const state = {
  models: [],
  selectedModel: "gpt-5.6-luna",
  messages: [],
  loggedIn: false,
  contextReport: null,
  activities: [],
  lastAgentText: "",
  helperTask: "ask",
  focusedTarget: null,
  fieldLocked: false,
  assistantMode: "discussion",
  writingProfile: "german-radiology",
  referencePack: [],
  clinicCatalog: null,
  selectedClinicId: "",
  screenCapture: null,
  artifacts: [],
  helperFieldType: "befund",
  workflow: null,
};

const HELPER_FIELD_LABELS = {
  befund: "Befund",
  beurteilung: "Beurteilung / Zusammenfassung",
  fragestellung: "Fragestellung",
  anforderung: "Anforderung",
  sonstiges: "Sonstiger Text",
};

const MODE_DESCRIPTIONS = {
  discussion: "Diskussion",
  report: "Strukturieren",
  correction: "Lektorat",
  differential: "Differenzialdiagnose",
  conclusion: "Beurteilung",
};

const $ = (id) => document.getElementById(id);
const helperMode = new URLSearchParams(window.location.search).get("mode") === "helper";
if (helperMode) document.body.classList.add("helper-mode");

function applyGermanUi() {
  // The main shell is German-first in the markup. Keep this hook only for
  // runtime-created windows and avoid mutating the information architecture.
  document.documentElement.lang = "de";
  document.title = helperMode ? "RadimoAgent Helfer" : "RadimoAgent";
}

function nowLabel() {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 3400);
}

function setIslandState(label) {
  $("islandState").textContent = label;
  const phase = $("radarPhase");
  if (phase) phase.textContent = label;
}

function setStatus(online, label, detail) {
  $("statusDot").classList.toggle("online", online);
  $("statusText").textContent = label;
  $("accountText").textContent = detail;
}

function addActivity(label, detail, active = false) {
  state.activities.unshift({ label, detail, active, time: nowLabel() });
  state.activities = state.activities.slice(0, 7);
  const list = $("activityList");
  list.replaceChildren();
  for (const item of state.activities) {
    const node = document.createElement("div");
    node.className = `activity-item${item.active ? " active" : ""}`;
    node.innerHTML = `<i></i><div><strong></strong><small></small></div><span class="activity-time"></span>`;
    node.querySelector("strong").textContent = item.label;
    node.querySelector("small").textContent = item.detail;
    node.querySelector(".activity-time").textContent = item.time;
    list.append(node);
  }
}

function renderArtifacts() {
  const list = $("artifactList");
  if (!list) return;
  list.replaceChildren();
  if (!state.artifacts.length) {
    const empty = document.createElement("div");
    empty.className = "artifact-empty";
    empty.textContent = "Keine";
    list.append(empty);
    return;
  }
  for (const artifact of state.artifacts.slice(-5).reverse()) {
    const node = document.createElement("div");
    node.className = "artifact-item";
    node.innerHTML = "<strong></strong><small></small>";
    node.querySelector("strong").textContent = artifact.label;
    node.querySelector("small").textContent = artifact.detail;
    list.append(node);
  }
}

function applyWorkflowState(workflow) {
  if (!workflow) return;
  state.workflow = workflow;
  state.artifacts = Array.isArray(workflow.artifacts) ? workflow.artifacts : [];
  renderArtifacts();
  if ($("radarPhase")) $("radarPhase").textContent = workflow.phase === "ready" ? "Bereit" : workflow.phase;
  if ($("radarTarget")) $("radarTarget").textContent = workflow.fieldLabel ? `${workflow.target === "selected-field" ? "RIS · " : ""}${workflow.fieldLabel}` : "Kein RIS-Feld";
  if ($("radarMode")) $("radarMode").textContent = workflow.mode || "Diskussion";
  if (workflow.fieldType && $("helperFieldType")) setHelperFieldType(workflow.fieldType);
}

async function publishArtifact(label, detail, kind = "draft") {
  const text = state.lastAgentText.trim();
  if (!text || !window.radimoAgent.addWorkflowArtifact) return;
  try {
    const workflow = await window.radimoAgent.addWorkflowArtifact({
      kind,
      label,
      detail,
      text,
      source: helperMode ? "helper" : "desktop",
    });
    applyWorkflowState(workflow);
  } catch (error) {
    addActivity("Entwurf nicht gespeichert", error.message || "Lokaler Fallstatus nicht verfügbar", true);
  }
}

function renderModels() {
  const select = $("modelSelect");
  select.replaceChildren();
  const models = state.models.length ? state.models : [
    { id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", inputModalities: ["text", "image"] },
    { id: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", inputModalities: ["text", "image"] },
    { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", inputModalities: ["text", "image"] },
  ];
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.displayName || model.id;
    option.selected = model.id === state.selectedModel;
    select.append(option);
  }
  if (![...select.options].some((option) => option.selected)) select.selectedIndex = 0;
  state.selectedModel = select.value;
  updateImageAttachmentCapability();
}

function selectedModelSupportsImage() {
  const model = state.models.find((entry) => entry.id === state.selectedModel || entry.model === state.selectedModel);
  return !model || !Array.isArray(model.inputModalities) || model.inputModalities.includes("image");
}

function updateImageAttachmentCapability() {
  const checkbox = $("useScreenCapture");
  if (!checkbox || !state.screenCapture) return;
  const supported = selectedModelSupportsImage();
  checkbox.disabled = !supported;
  if (!supported) {
    checkbox.checked = false;
    $("screenCaptureStatus").textContent = "Dieses Modell unterstützt keine Bilder; die Aufnahme kann nur kopiert werden.";
  }
}

function addMessage(role, text) {
  state.messages.push({ role, text });
  $("messages").querySelector(".empty-state")?.remove();
  const node = document.createElement("article");
  node.className = `message ${role}`;
  node.innerHTML = `<div class="message-label">${role === "user" ? "Du" : "RadimoAgent"}</div><div></div>`;
  node.lastElementChild.textContent = text;
  $("messages").append(node);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function openLogin() { $("loginModal").classList.remove("hidden"); $("loginStatus").textContent = ""; }
function closeLogin() { $("loginModal").classList.add("hidden"); }

async function refreshConnection() {
  try {
    const status = await window.radimoAgent.getStatus();
    state.loggedIn = Boolean(status?.authMethod);
    setStatus(state.loggedIn, state.loggedIn ? "Verbunden" : "Anmeldung erforderlich", state.loggedIn ? "ChatGPT über lokalen App-Server" : "Kein Konto verbunden");
    addActivity(state.loggedIn ? "Identität bereit" : "Warten auf Anmeldung", state.loggedIn ? "Lokale Kontositzung verfügbar" : "Kontomenü öffnen, um fortzufahren", !state.loggedIn);
  } catch (error) {
    setStatus(false, "Nicht verfügbar", error.message || "Lokaler App-Server nicht verfügbar");
    addActivity("Verbindung nicht verfügbar", "Der lokale App-Server konnte nicht erreicht werden", true);
  }
}

async function loadModels() {
  try {
    const result = await window.radimoAgent.listModels();
    state.models = result?.data || [];
    renderModels();
    addActivity("Modelle geladen", `${state.models.length || 3} verfügbar`, false);
  } catch {
    renderModels();
    addActivity("Standardmodell aktiv", "Modellliste noch nicht verfügbar", false);
  }
}

async function loginWith(startLogin, label) {
  $("loginStatus").textContent = label;
  addActivity("Anmeldung läuft", "Browser-Anmeldung geöffnet", true);
  try {
    const result = await startLogin();
    if (result?.authUrl) $("loginStatus").textContent = "Anmeldung im Browser gestartet. Danach hierher zurückkehren.";
    else $("loginStatus").textContent = "Anmeldung im Browser abschließen und hierher zurückkehren.";
  } catch (error) {
    const message = error.message || "Anmeldung konnte nicht gestartet werden.";
    $("loginStatus").textContent = message;
    try {
      const diagnostics = await window.radimoAgent.getDiagnostics();
      $("logPath").textContent = diagnostics.path ? `Log: ${diagnostics.path}` : "Logpfad noch nicht verfügbar.";
    } catch { /* the original login error is already useful */ }
    addActivity("Anmeldung fehlgeschlagen", message.split("\n")[0], true);
  }
}

function login() { return loginWith(() => window.radimoAgent.startBrowserLogin(), "Opening browser sign-in…"); }

async function logout() {
  try {
    await window.radimoAgent.logout();
    state.loggedIn = false;
    addActivity("Abgemeldet", "Lokale Sitzung beendet", false);
    await refreshConnection();
    $("loginStatus").textContent = "Abgemeldet.";
  } catch (error) {
    $("loginStatus").textContent = error.message || "Sign-out could not be completed.";
  }
}

function contextPrompt() {
  if (!state.contextReport || !$("useContext").checked) return "";
  const blocks = state.contextReport.items.map((item) => `### ${item.relation} · ${item.section} · ${item.name}\n${item.content || item.preview}`).join("\n\n");
  return `\n\n[Explicitly attached local context beta]\n${blocks}\n[/Explicitly attached local context beta]`;
}

function referencePrompt() {
  if (!state.referencePack.length || !$("useLocalReferences").checked) return "";
  const readable = state.referencePack.filter((item) => item.status === "ready" && item.content);
  if (!readable.length) return "";
  const blocks = readable.map((item) => item.sourceType === "clinic" && item.prompt ? item.prompt : [
    `### ${item.sourceType === "web" ? "LIVE WEB REFERENCE" : "LOCAL REFERENCE"} · ${item.name}`,
    item.sourceType === "web" ? `Source URL: ${item.url}` : `Source filename: ${item.name}`,
    item.content,
    `### END LOCAL REFERENCE · ${item.name}`,
  ].join("\n"));
  return `\n\n[EXPLICITLY ATTACHED LOCAL RADIOLOGY REFERENCE PACK]\nUse only the readable text below as local reference material. Cite the filename when relying on it. Do not claim to have read a metadata-only PDF or binary file.\n${blocks.join("\n\n")}\n[/EXPLICITLY ATTACHED LOCAL RADIOLOGY REFERENCE PACK]`;
}

function renderClinicCatalog(catalog) {
  state.clinicCatalog = catalog || { root: null, clinics: [] };
  const clinics = state.clinicCatalog.clinics || [];
  const select = $("clinicSelect");
  select.replaceChildren();
  for (const clinic of clinics) {
    const option = document.createElement("option");
    option.value = clinic.id;
    option.textContent = clinic.name;
    select.append(option);
  }
  if (clinics.length) {
    if (!clinics.some((clinic) => clinic.id === state.selectedClinicId)) state.selectedClinicId = clinics[0].id;
    select.value = state.selectedClinicId;
  } else {
    state.selectedClinicId = "";
  }
  $("clinicSourceBadge").textContent = clinics.length ? `${clinics.length} Klinik${clinics.length === 1 ? "" : "en"}` : "Keine";
  $("clinicRootStatus").textContent = state.clinicCatalog.root ? `Ordner: ${state.clinicCatalog.root}` : "Kein Klinikordner";
  const list = $("clinicSourceItems");
  list.replaceChildren();
  const clinic = clinics.find((item) => item.id === state.selectedClinicId);
  if (!clinic) {
    const empty = document.createElement("div");
    empty.className = "clinic-source-empty";
    empty.textContent = "Keine Klinik ausgewählt oder noch keine PDFs in sources/.";
    list.append(empty);
    return;
  }
  if (!clinic.sources.length) {
    const empty = document.createElement("div");
    empty.className = "clinic-source-empty";
    empty.textContent = "Keine PDFs in diesem Klinikordner.";
    list.append(empty);
    return;
  }
  for (const source of clinic.sources) {
    const node = document.createElement("article");
    node.className = "clinic-source-item";
    node.innerHTML = `<div class="clinic-source-item-head"><strong></strong><span class="reference-badge"></span></div><small></small><div class="clinic-source-item-actions"></div>`;
    node.querySelector("strong").textContent = source.name;
    node.querySelector(".reference-badge").textContent = source.status === "referenced" ? "Referenziert" : "Neu";
    node.querySelector("small").textContent = `${source.relativePath} · ${Math.round(source.size / 1024)} KB`;
    const actions = node.querySelector(".clinic-source-item-actions");
    const read = document.createElement("button");
    read.className = "secondary-button";
    read.type = "button";
    read.textContent = source.status === "referenced" ? "Erneut lesen" : "Neu lesen";
    read.addEventListener("click", () => readClinicSource(source));
    actions.append(read);
    const attach = document.createElement("button");
    attach.className = "secondary-button";
    attach.type = "button";
    attach.textContent = "Anhängen";
    attach.disabled = !state.referencePack.some((item) => item.sourceType === "clinic" && item.path === source.path && item.content);
    attach.addEventListener("click", () => {
      const item = state.referencePack.find((entry) => entry.sourceType === "clinic" && entry.path === source.path);
      if (!item) {
        showToast("PDF zuerst lesen.");
        return;
      }
      $("useLocalReferences").checked = true;
      updateEvidenceLedger();
      addActivity("Klinikquelle angehängt", source.name, false);
      showToast("Klinikquelle wird an die nächste Anfrage angehängt.");
    });
    actions.append(attach);
    list.append(node);
  }
}

async function loadClinicSources() {
  try {
    renderClinicCatalog(await window.radimoAgent.getClinicSources());
  } catch (error) {
    $("clinicRootStatus").textContent = error.message || "Klinikquellen nicht verfügbar";
  }
}

async function chooseClinicRoot() {
  try {
    const catalog = await window.radimoAgent.chooseClinicSourceRoot();
    if (catalog) {
      renderClinicCatalog(catalog);
      addActivity("Klinikordner gewählt", "PDFs liegen je Klinik in sources/", false);
      showToast("Klinikquellen aktualisiert.");
    }
  } catch (error) {
    $("clinicRootStatus").textContent = error.message || "Klinikordner konnte nicht gewählt werden.";
  }
}

async function openClinicRoot() {
  try {
    await window.radimoAgent.openClinicSourceRoot();
  } catch (error) {
    $("clinicRootStatus").textContent = error.message || "Klinikordner konnte nicht geöffnet werden.";
  }
}

async function readClinicSource(source) {
  $("clinicRootStatus").textContent = `${source.name} wird gelesen…`;
  try {
    const item = await window.radimoAgent.readClinicSource({ clinicId: state.selectedClinicId, sourcePath: source.path });
    if (item.status !== "ready" || !item.content) {
      addActivity("Klinikquelle nicht lesbar", `${source.name} · ${item.reason || "PDF-Text fehlt"}`, true);
      showToast("PDF konnte nicht als Text gelesen werden.");
      renderClinicCatalog(item.catalog);
      return;
    }
    state.referencePack = [...state.referencePack.filter((entry) => entry.path !== item.path), { ...item, sourceType: "clinic" }];
    renderReferences(state.referencePack);
    $("useLocalReferences").checked = true;
    renderClinicCatalog(item.catalog);
    addActivity("Klinikquelle gelesen", `${item.name} in AGENTS.md registriert`, false);
    showToast("Quelle gelesen und für die nächste Anfrage bereit.");
  } catch (error) {
    $("clinicRootStatus").textContent = error.message || "Klinikquelle konnte nicht gelesen werden.";
    addActivity("Klinikquelle fehlgeschlagen", $("clinicRootStatus").textContent, true);
  }
}

function renderReferences(pack) {
  state.referencePack = Array.isArray(pack) ? pack : [];
  const readable = state.referencePack.filter((item) => item.status === "ready" && item.content).length;
  $("useLocalReferences").disabled = readable === 0;
  $("clearReferences").disabled = state.referencePack.length === 0;
  if (!readable) $("useLocalReferences").checked = false;
  $("referenceBadge").textContent = state.referencePack.length ? `${readable} readable · ${state.referencePack.length - readable} trace-only` : "Not attached";
  $("referenceStatus").textContent = state.referencePack.length
    ? `${state.referencePack.length} local reference${state.referencePack.length === 1 ? "" : "s"} selected.`
    : "No local references selected.";
  const list = $("referenceItems");
  list.replaceChildren();
  for (const item of state.referencePack) {
    const node = document.createElement("article");
    node.className = `reference-item ${item.status}`;
    node.innerHTML = `<div class="reference-item-head"><strong></strong><span></span></div><small></small><div class="reference-preview"></div><div class="reference-item-actions"></div>`;
    node.querySelector("strong").textContent = item.sourceType === "web" ? item.url : item.name;
    node.querySelector("span").textContent = item.status === "ready" ? (item.sourceType === "web" ? "Web · verify" : "Readable") : "Trace only";
    node.querySelector("small").textContent = item.reason || `${item.size} bytes available to the local reference pack.`;
    node.querySelector(".reference-preview").textContent = item.preview || "No text attached; provide extracted text or an approved local PDF extractor before using it as evidence.";
    if (item.sourceType === "web" && item.url) {
      const open = document.createElement("button");
      open.className = "secondary-button reference-open-button";
      open.type = "button";
      open.textContent = "Open in browser";
      open.addEventListener("click", () => window.radimoAgent.openUrl(item.url));
      node.querySelector(".reference-item-actions").append(open);
    }
    list.append(node);
  }
  updateEvidenceLedger();
}

async function chooseReferences() {
  try {
    const pack = await window.radimoAgent.chooseReferences();
    if (!pack) return;
    renderReferences(pack);
    addActivity("Local references ready", `${pack.filter((item) => item.status === "ready").length} readable source(s) selected`, false);
    showToast("Local reference pack updated.");
  } catch (error) {
    $("referenceStatus").textContent = error.message || "Local references could not be selected.";
    addActivity("Reference selection failed", $("referenceStatus").textContent, true);
  }
}

async function fetchReferenceUrl() {
  const input = $("referenceUrl");
  const value = input.value.trim();
  if (!value) return;
  $("referenceStatus").textContent = "Fetching approved medical page locally…";
  try {
    const reference = await window.radimoAgent.fetchReferenceUrl(value);
    state.referencePack = [...state.referencePack, reference];
    renderReferences(state.referencePack);
    input.value = "";
    addActivity("Medical page fetched", `${reference.status} · ${reference.name}`, false);
    showToast(reference.status === "ready" ? "Medical reference attached." : "Reference URL recorded without readable text.");
  } catch (error) {
    $("referenceStatus").textContent = error.message || "Reference page could not be fetched.";
    addActivity("Reference fetch failed", $("referenceStatus").textContent, true);
  }
}

function clearReferences() {
  renderReferences([]);
  addActivity("Local references cleared", "No reference material will be attached", false);
}

async function captureScreen() {
  $("screenCaptureStatus").textContent = "Select a region on the screen…";
  try {
    const result = await window.radimoAgent.captureScreen();
    if (!result?.ok) {
      $("screenCaptureStatus").textContent = "Capture cancelled.";
      return;
    }
    state.screenCapture = result;
    $("screenCapturePreview").src = result.dataUrl;
    $("screenCapturePreview").classList.remove("hidden");
    $("copyScreenCapture").disabled = false;
    $("useScreenCapture").disabled = false;
    $("useScreenCapture").checked = false;
    updateImageAttachmentCapability();
    $("screenCaptureBadge").textContent = `${result.width} × ${result.height}`;
    $("screenCaptureStatus").textContent = "Captured locally. Review before copying or sending elsewhere.";
    addActivity("Screen region captured", `${result.width} × ${result.height} pixels`, false);
  } catch (error) {
    $("screenCaptureStatus").textContent = error.message || "Screen capture failed.";
    addActivity("Screen capture failed", $("screenCaptureStatus").textContent, true);
  }
}

async function copyScreenCapture() {
  if (!state.screenCapture?.dataUrl) return;
  try {
    await window.radimoAgent.copyScreenCapture(state.screenCapture.dataUrl);
    $("screenCaptureStatus").textContent = "Image copied to the clipboard.";
    showToast("Screen capture copied.");
  } catch (error) {
    $("screenCaptureStatus").textContent = error.message || "Image could not be copied.";
  }
}

function extractEvidenceSources(text) {
  const values = [];
  const add = (value) => { if (value && !values.includes(value)) values.push(value); };
  for (const match of String(text || "").matchAll(/https?:\/\/[^\s)<>]+/gi)) add(match[0].replace(/[.,;]+$/, ""));
  for (const match of String(text || "").matchAll(/\b10\.\d{4,9}\/[A-Za-z0-9][^\s)<>]+/gi)) add(`doi:${match[0].replace(/[.,;]+$/, "")}`);
  return values.slice(0, 12);
}

function updateEvidenceLedger(responseText = "") {
  const ledger = $("evidenceLedger");
  const localAttached = $("useLocalReferences").checked && state.referencePack.some((item) => item.status === "ready" && item.content);
  const liveRequested = $("evidenceMode").checked;
  const sources = [];
  if (localAttached) {
    for (const item of state.referencePack.filter((entry) => entry.status === "ready" && entry.content)) sources.push(item.sourceType === "web" ? item.url : `Local · ${item.name}`);
  }
  for (const source of extractEvidenceSources(responseText)) sources.push(source);
  const uniqueSources = [...new Set(sources)];
  if (liveRequested && !uniqueSources.length) {
    ledger.classList.remove("hidden");
    $("evidenceState").textContent = "Keine Quelle";
    $("evidenceSources").textContent = "Prüfung nötig";
    return;
  }
  if (uniqueSources.length) {
    ledger.classList.remove("hidden");
    $("evidenceState").textContent = `${uniqueSources.length} Quelle${uniqueSources.length === 1 ? "" : "n"}`;
    $("evidenceSources").replaceChildren();
    for (const source of uniqueSources) {
      const item = document.createElement("span");
      item.className = "evidence-source-chip";
      item.textContent = source;
      $("evidenceSources").append(item);
    }
    return;
  }
  $("evidenceState").textContent = "Keine";
  $("evidenceSources").textContent = "";
  ledger.classList.add("hidden");
}

function setAssistantMode(mode) {
  const next = MODE_DESCRIPTIONS[mode] ? mode : "discussion";
  state.assistantMode = next;
  $("assistantMode").value = next;
  $("modeDescription").textContent = MODE_DESCRIPTIONS[next];
  const placeholders = {
    discussion: "Frage zum Fall oder nächsten Denkschritt…",
    report: "Befund für Struktur und Beurteilung eingeben…",
    correction: "Befundtext für das Lektorat eingeben…",
    differential: "Befunde eingeben und Differenzialdiagnose anfordern…",
    conclusion: "Befunde eingeben und Beurteilung anfordern…",
  };
  $("composer").placeholder = placeholders[next];
  if ($("radarMode")) $("radarMode").textContent = $("assistantMode").selectedOptions[0]?.textContent || next;
}

function setWritingProfile(profile) {
  state.writingProfile = profile === "off" ? "off" : "german-radiology";
  $("writingProfile").value = state.writingProfile;
    addActivity("Profil", state.writingProfile === "off" ? "Original" : "Deutsch / Latein", false);
}

async function loadGuidanceStatus() {
  try {
    const status = await window.radimoAgent.getGuidanceStatus();
    $("guidanceBadge").textContent = status.source === "local" ? "Lokal" : "Standard";
    $("guidanceStatus").textContent = `${status.terminologyCount} Begriffe · ${status.phraseCount} Phrasen`;
  } catch (error) {
    $("guidanceBadge").textContent = "Fehler";
    $("guidanceStatus").textContent = error.message || "Nicht verfügbar";
  }
}

async function loadTemplateStatus() {
  try {
    const status = await window.radimoAgent.getTemplateStatus();
    const select = $("templateSelect");
    select.replaceChildren();
    for (const template of status.templates || []) {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.label;
      select.append(option);
    }
    $("templateStatus").textContent = `${status.source === "local" ? "Local templates" : "Generic templates"} · ${status.templates?.length || 0} available`;
  } catch (error) {
    $("templateStatus").textContent = error.message || "Templates unavailable.";
  }
}

async function insertTemplate() {
  const template = await window.radimoAgent.getTemplate($("templateSelect").value);
  if (!template?.content) return;
  const composer = $("composer");
  composer.value = [composer.value.trim(), template.content.trim()].filter(Boolean).join("\n\n");
  composer.dispatchEvent(new Event("input"));
  composer.focus();
  addActivity("Template inserted", `${template.label} · review before sending`, false);
}

async function importGuidance() {
  try {
    const status = await window.radimoAgent.importGuidanceProfile();
    if (!status) return;
    await loadGuidanceStatus();
    addActivity("Writing profile imported", `${status.terminologyCount} terms · ${status.phraseCount} phrases`, false);
    showToast("German radiology profile imported.");
  } catch (error) {
    $("guidanceStatus").textContent = error.message || "Profile import failed.";
    addActivity("Writing profile import failed", $("guidanceStatus").textContent, true);
  }
}

async function exportGuidance() {
  try {
    const result = await window.radimoAgent.exportGuidanceProfile();
    if (result?.filePath) showToast("Writing profile exported.");
  } catch (error) {
    $("guidanceStatus").textContent = error.message || "Profile export failed.";
  }
}

async function openGuidanceFolder() {
  try {
    await window.radimoAgent.openGuidanceFolder();
    showToast("Profile folder opened.");
  } catch (error) {
    $("guidanceStatus").textContent = error.message || "Profile folder could not be opened.";
  }
}

function contextReportText() {
  if (!state.contextReport) return "";
  const report = state.contextReport;
  const lines = [
    "RadimoAgent context finder beta report",
    `Generated: ${report.generatedAt}`,
    `Anchor: ${report.source.path}`,
    `Strategy: ${report.strategy}`,
    "",
    "Requested report context: Fragestellung, Anforderung, Befund, Beurteilung",
    "",
  ];
  for (const item of report.items) lines.push(`## ${item.relation} · ${item.section} · ${item.name}`, `Path: ${item.path}`, "", item.content || item.preview, "", "---", "");
  return lines.join("\n");
}

function correctionPrompt() {
  const selected = $("selectedField").value.trim();
  return `Correct this selected radiology/medical field for dictation artifacts, spelling, grammar, and clarity only. Preserve every medical fact, value, negation, uncertainty, and anatomical location. Do not add a diagnosis or recommendation. Return only the corrected field text, followed by one short review note if anything is ambiguous.\n\nSelected field:\n${selected}`;
}

async function startNewDiscussion() {
  try {
    await window.radimoAgent.newDiscussion({ model: state.selectedModel, medicalGate: $("medicalGate").checked, radiologyMode: $("radiologyMode").checked, writingProfile: state.writingProfile });
    if (window.radimoAgent.newWorkflowCase) {
      const workflow = await window.radimoAgent.newWorkflowCase({ origin: "desktop", fieldType: "befund", fieldLabel: "Befund" });
      applyWorkflowState(workflow);
    }
    state.messages = [];
    state.lastAgentText = "";
    $("messages").replaceChildren();
    $("messages").innerHTML = `<div class="empty-state"><strong>Fallfrage eingeben</strong></div>`;
    updateEvidenceLedger();
    setAssistantMode("discussion");
    setIslandState("Bereit");
    addActivity("Neuer Fall", "Diskussion ist bereit", false);
    showToast("Neuer Fall gestartet.");
  } catch (error) {
    addActivity("Fall konnte nicht starten", error.message || "Lokaler Agent nicht verfügbar", true);
    showToast(error.message || "Discussion could not start.");
  }
}

async function send() {
  const input = $("composer");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";
  addMessage("user", text);
  addMessage("agent", "Luna arbeitet…");
  state.lastAgentText = "";
  $("copyLastResponse").disabled = true;
  $("saveCorrectionDraft").disabled = true;
  setIslandState("Thinking");
  addActivity("Luna arbeitet", "Das gewählte Modell prüft die Anfrage", true);
  try {
    const attachedContext = contextPrompt();
    const attachedReferences = referencePrompt();
    const attachedImage = $("useScreenCapture").checked && state.screenCapture?.path ? state.screenCapture.path : null;
    if (attachedContext) addActivity("Kontext angehängt", "Ausgewählte Nachbarbefunde einbezogen", false);
    if (attachedReferences) addActivity("Quellen angehängt", "Nur lesbare, ausgewählte Texte einbezogen", false);
    if (attachedImage) addActivity("Bild angehängt", "Ausgewählte lokale Aufnahme gesendet", false);
    updateEvidenceLedger();
    await window.radimoAgent.sendTurn({
      text: `${text}${attachedContext}${attachedReferences}`,
      model: state.selectedModel,
      effort: "medium",
      medicalGate: $("medicalGate").checked,
      radiologyMode: $("radiologyMode").checked,
      evidenceMode: $("evidenceMode").checked,
      assistantMode: state.assistantMode,
      writingProfile: state.writingProfile,
      origin: "desktop",
      fieldType: state.workflow?.fieldType || "befund",
      fieldLabel: state.workflow?.fieldLabel || "Befund",
      imagePath: attachedImage,
    });
  } catch (error) {
    $("messages").lastElementChild.lastElementChild.textContent = error.message || "Anfrage konnte nicht gestartet werden.";
    setIslandState("Prüfen");
    addActivity("Anfrage fehlgeschlagen", error.message || "Anfrage konnte nicht gestartet werden", true);
  }
}

function renderContext(report) {
  state.contextReport = report;
  $("contextSource").textContent = report ? report.source.path : "The data connector is intentionally local-first until the source and permissions are confirmed.";
  $("saveContext").disabled = !report;
  $("copyContext").disabled = !report;
  $("useContext").disabled = !report;
  $("copySelectedField").disabled = !report?.items?.some((item) => item.relation === "selected" && item.content);
  $("prepareCorrection").disabled = !report?.items?.some((item) => item.relation === "selected" && item.content);
  const selected = report?.items?.find((item) => item.relation === "selected");
  $("selectedField").value = selected?.content || selected?.preview || "";
  if (!report) $("useContext").checked = false;
  const list = $("contextItems");
  list.replaceChildren();
  if (!report) return;
  for (const item of report.items) {
    const node = document.createElement("article");
    node.className = `context-item${item.relation === "selected" ? " selected" : ""}`;
    node.innerHTML = `<div class="context-item-head"><strong></strong><span></span></div><small></small><div class="context-preview"></div>`;
    node.querySelector("strong").textContent = `${item.relation} · ${item.section}`;
    node.querySelector("span").textContent = `${item.size} bytes`;
    node.querySelector("small").textContent = item.name;
    node.querySelector(".context-preview").textContent = item.preview;
    list.append(node);
  }
}

async function chooseContext() {
  $("contextStatus").textContent = "Quelldatei wählen…";
  addActivity("Kontextfinder geöffnet", "Warte auf Befunddatei", true);
  try {
    const report = await window.radimoAgent.chooseContextSource();
    if (!report) {
      $("contextStatus").textContent = "Keine Quelle gewählt.";
      return;
    }
    renderContext(report);
    $("contextStatus").textContent = `${report.items.length} nearby files collected.`;
    addActivity("Kontext gesammelt", "Zwei darüber · Auswahl · eine darunter", false);
    showToast("Kontext ist bereit.");
  } catch (error) {
    $("contextStatus").textContent = error.message || "Context scan failed.";
    addActivity("Context scan failed", $("contextStatus").textContent, true);
  }
}

async function saveContext() {
  if (!state.contextReport) return;
  try {
    const result = await window.radimoAgent.saveContextReport(state.contextReport);
    if (result?.filePath) {
      $("contextStatus").textContent = `Saved ${result.bytes} bytes.`;
      addActivity("Report captured", result.filePath, false);
      showToast("Context report saved.");
    }
  } catch (error) {
    $("contextStatus").textContent = error.message || "Report could not be saved.";
  }
}

async function copyContext() {
  if (!state.contextReport) return;
  try {
    await navigator.clipboard.writeText(contextReportText());
    $("contextStatus").textContent = "Report copied to clipboard.";
    addActivity("Report copied", "Context beta capture is ready to paste", false);
    showToast("Context report copied.");
  } catch (error) {
    $("contextStatus").textContent = error.message || "Report could not be copied.";
  }
}

async function copySelectedField() {
  const content = $("selectedField").value.trim();
  if (!content) return;
  try {
    await navigator.clipboard.writeText(content);
    $("contextStatus").textContent = "Selected field copied to clipboard.";
    showToast("Selected field copied.");
  } catch (error) {
    $("contextStatus").textContent = error.message || "Selected field could not be copied.";
  }
}

function prepareCorrection() {
  setAssistantMode("correction");
  $("composer").value = correctionPrompt();
  $("composer").focus();
  $("correctionStatus").textContent = "Correction prompt prepared; review it before sending.";
  addActivity("Correction prepared", "Selected field is ready for a guarded language correction", false);
}

async function copyLastResponse() {
  if (!state.lastAgentText.trim()) return;
  try {
    await navigator.clipboard.writeText(state.lastAgentText);
    $("correctionStatus").textContent = "Latest AI response copied. Review it before use.";
    showToast("AI response copied.");
  } catch (error) {
    $("correctionStatus").textContent = error.message || "AI response could not be copied.";
  }
}

async function saveCorrectionDraft() {
  if (!state.lastAgentText.trim() || !state.contextReport?.source?.path) return;
  try {
    const result = await window.radimoAgent.saveCorrectionDraft({ sourcePath: state.contextReport.source.path, content: state.lastAgentText });
    if (result?.filePath) {
      $("correctionStatus").textContent = `Reviewed draft saved: ${result.filePath}`;
      addActivity("Reviewed draft saved", "The source file was not overwritten", false);
      showToast("Reviewed draft saved.");
    }
  } catch (error) {
    $("correctionStatus").textContent = error.message || "Draft could not be saved.";
  }
}

async function copyDiagnostics() {
  try {
    const result = await window.radimoAgent.copyDiagnostics();
    $("logPath").textContent = result?.path ? `Copied. Local log: ${result.path}` : "Diagnostics copied.";
    showToast("Diagnostics copied to clipboard.");
  } catch (error) {
    $("loginStatus").textContent = error.message || "Diagnostics could not be copied.";
  }
}

async function testConnection() {
  $("loginStatus").textContent = "Checking Windows proxy and auth endpoint…";
  try {
    const result = await window.radimoAgent.testConnection();
    const status = result.authEndpoint?.reachable ? `HTTP ${result.authEndpoint.status}` : result.authEndpoint?.error || "unreachable";
    const override = result.proxyOverrideConfigured ? " · app proxy override: configured" : "";
    if (result.proxyEndpoint && !$("proxyOverride").value.trim()) $("proxyOverride").value = result.proxyEndpoint;
    const challenge = result.authEndpoint?.proxyAuthenticate ? ` · challenge: ${result.authEndpoint.proxyAuthenticate}` : "";
    $("loginStatus").textContent = `Proxy: ${result.proxyRules || "not reported"} · auth.openai.com: ${status}${challenge}${override}`;
  } catch (error) {
    $("loginStatus").textContent = error.message || "Connection test failed.";
  }
}

async function applyProxy() {
  const value = $("proxyOverride").value.trim();
  $("loginStatus").textContent = value ? "Applying proxy and restarting the login service…" : "Clearing proxy override and restarting…";
  try {
    const result = await window.radimoAgent.setProxy({
      url: value,
      username: $("proxyUsername").value,
      password: $("proxyPassword").value,
    });
    $("loginStatus").textContent = result.configured
      ? "Proxy applied. Click Open browser sign-in to retry."
      : "Proxy override cleared. Click Open browser sign-in to retry.";
  } catch (error) {
    $("loginStatus").textContent = error.message || "Proxy could not be applied.";
  }
}

function openContext() { $("contextDrawer").classList.remove("hidden"); }
function closeContext() { $("contextDrawer").classList.add("hidden"); }
function toggleMinimap() { $("minimap").classList.toggle("minimap-collapsed"); }

function helperFieldLabel() {
  return HELPER_FIELD_LABELS[state.helperFieldType] || HELPER_FIELD_LABELS.befund;
}

function setHelperFieldType(value) {
  state.helperFieldType = HELPER_FIELD_LABELS[value] ? value : "befund";
  $("helperFieldType").value = state.helperFieldType;
  $("helperTitle").textContent = helperFieldLabel();
  $("helperArtifactType").textContent = state.helperFieldType === "beurteilung" ? "Zusammenfassung" : HELPER_FIELD_LABELS[state.helperFieldType];
  if ($("helperCreateBeurteilung")) {
    const isFinding = state.helperFieldType === "befund";
    $("helperCreateBeurteilung").disabled = !isFinding;
    if (!isFinding) $("helperCreateBeurteilung").checked = false;
  }
}

function inferHelperFieldType(target) {
  const value = `${target?.title || ""} ${target?.controlType || ""}`.toLocaleLowerCase("de-DE");
  if (/beurteil|zusammenfass|impression|conclusion|assessment/.test(value)) return "beurteilung";
  if (/frage|question/.test(value)) return "fragestellung";
  if (/anforder|request|indication/.test(value)) return "anforderung";
  if (/befund|finding|report/.test(value)) return "befund";
  return "befund";
}

function extractHelperFieldText(text) {
  const source = String(text || "").trim();
  if (!source) return "";
  const label = state.helperFieldType;
  const headings = {
    befund: ["Befund", "Findings"],
    beurteilung: ["Beurteilung", "Zusammenfassung", "Impression", "Conclusion", "Assessment"],
    fragestellung: ["Fragestellung", "Clinical question"],
    anforderung: ["Anforderung", "Indikation", "Request"],
  }[label];
  let result = source;
  if (headings) {
    const headingPattern = headings.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const nextHeading = "Befund|Beurteilung|Zusammenfassung|Fragestellung|Anforderung|Findings|Impression|Conclusion|Assessment|Clinical question|Indication|Request";
    const match = source.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,4}\\s*)?(?:${headingPattern})\\s*:?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*#{0,4}\\s*(?:${nextHeading})\\s*:?(?:\\n|$)|$)`, "i"));
    if (match?.[1]?.trim()) result = match[1].trim();
  }
  if (state.helperTask === "correction") result = result.replace(/\n\s*(?:PRÜFNOTIZ|REVIEW NOTE)\s*:?\s*[\s\S]*$/i, "").trim();
  return result;
}

function helperTransferText() {
  return extractHelperFieldText($("helperResult").value);
}

function helperSetStatus(message, stateLabel = "Bereit") {
  $("helperStatus").textContent = message;
  $("helperState").textContent = stateLabel;
  $("helperCoreStatus").textContent = stateLabel;
}

function updateFieldLockUi() {
  const target = state.focusedTarget;
  const locked = Boolean(state.fieldLocked && target?.windowHandle);
  $("helperLockStatus").textContent = locked ? `Gesperrt · ${target.title || target.controlType || "aktives Feld"}` : "Kein Feld gesperrt";
  $("helperLockField").disabled = locked;
  $("helperReleaseField").disabled = !locked;
  $("helperTransfer").disabled = !locked || !$("helperInput").value.trim();
  $("helperWriteBack").disabled = !$("helperResult").value.trim() || !target?.windowHandle;
  if ($("radarTarget")) $("radarTarget").textContent = locked ? (target.title || target.controlType || "RIS-Feld gesperrt") : "Kein RIS-Feld gesperrt";
  if ($("navTarget")) $("navTarget").textContent = locked ? (target.title || target.controlType || "RIS-Feld gesperrt") : "RIS-Feld · manuell";
}

async function lockFocusedField() {
  $("helperCard").classList.add("helper-card-open");
  await window.radimoAgent.setHelperFocusable(false);
  try {
    const focused = await window.radimoAgent.readFocusedField({ selectionOnly: true });
    if (!focused?.ok || !focused.windowHandle) {
      helperSetStatus("Kein bearbeitbares Feld gefunden. Cursor in das Befundfeld setzen und erneut versuchen.", "Nicht gesperrt");
      return;
    }
    state.focusedTarget = { ...focused, replaceAll: false };
    setHelperFieldType(inferHelperFieldType(focused));
    state.fieldLocked = true;
    updateFieldLockUi();
    helperSetStatus("Feld gesperrt. Im Diktierfeld sprechen und bearbeiten; Übertragung bleibt ausdrücklich.", "Feld gesperrt");
  } catch (error) {
    helperSetStatus(error.message || "Das Feld konnte nicht gesperrt werden.", "Nicht gesperrt");
  } finally {
    await window.radimoAgent.setHelperFocusable(true);
  }
}

function releaseFocusedField() {
  state.fieldLocked = false;
  state.focusedTarget = null;
  updateFieldLockUi();
  helperSetStatus("Feld freigegeben. Das Diktierfeld bleibt lokal.", "Freigegeben");
}

function discardDictationBox() {
  $("helperInput").value = "";
  updateFieldLockUi();
  helperSetStatus("Diktierfeld geleert.", "Verworfen");
}

async function transferDictationBox() {
  const text = $("helperInput").value.trim();
  if (!text || !state.fieldLocked || !state.focusedTarget?.windowHandle) return;
  helperSetStatus("Diktat wird in das gesperrte Feld übertragen…", "Übertragung");
  try {
    const response = await window.radimoAgent.writeFocusedField({ text, target: { ...state.focusedTarget, replaceAll: false } });
    if (response?.ok) helperSetStatus("Text übertragen. Das Diktierfeld bleibt bis zum Verwerfen erhalten.", "Übertragen");
    else helperSetStatus(`Übertragung gestoppt: ${response?.error || "Ziel geändert"}. Feld erneut sperren.`, "Prüfung nötig");
  } catch (error) {
    helperSetStatus(error.message || "Diktatübertragung fehlgeschlagen.", "Prüfung nötig");
  }
}

async function helperCapture() {
  $("helperCard").classList.add("helper-card-open");
  // Keep the orb click from taking keyboard focus away from the source app.
  await window.radimoAgent.setHelperFocusable(false);
  try {
    const focused = await window.radimoAgent.readFocusedField({ selectionOnly: true });
    if (focused?.ok && typeof focused.text === "string" && focused.text.trim()) {
      state.focusedTarget = focused;
      setHelperFieldType(inferHelperFieldType(focused));
      $("helperInput").value = focused.text;
      state.helperTask = "ask";
      $("helperWriteBack").disabled = !focused.windowHandle;
      updateFieldLockUi();
      helperSetStatus(`Fokussiertes Feld über ${focused.strategy} erfasst. Vor der Anfrage prüfen.`, "Feld erfasst");
      return;
    }
    const text = (await window.radimoAgent.readClipboard()).trim();
    if (!text) {
      helperSetStatus("Zwischenablage leer. Text in der anderen Anwendung markieren, Strg+C drücken und dann Erfassen wählen.", "Warten");
      return;
    }
    $("helperInput").value = text;
    state.helperTask = "ask";
    helperSetStatus(`${text.length} Zeichen aus der Zwischenablage erfasst.`, "Erfasst");
  } catch (error) {
    helperSetStatus(error.message || "Zwischenablage konnte nicht gelesen werden.", "Prüfung nötig");
  }
}

function helperPrepareFix() {
  state.helperTask = "correction";
  $("helperCard").classList.add("helper-card-open");
  window.radimoAgent.setHelperFocusable(true);
  helperSetStatus("Lektorat aktiviert: nur Sprache und Diktatfehler; medizinische Bedeutung bleibt unverändert.", "Lektorat aktiv");
  $("helperInput").focus();
}

function helperPrepareContext() {
  state.helperTask = "context";
  $("helperCard").classList.add("helper-card-open");
  window.radimoAgent.setHelperFocusable(true);
  helperSetStatus("Kontextmodus aktiviert: Luna trennt Beobachtung, Interpretation und Unsicherheit.", "Kontext");
  $("helperInput").focus();
}

function helperStartDictation() {
  state.helperTask = "report";
  $("helperCard").classList.add("helper-card-open");
  window.radimoAgent.setHelperFocusable(true);
  helperSetStatus("Diktat aktiv. Danach prüfen und den Befund strukturieren.", "Diktat aktiv");
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    helperSetStatus("Diktat ist in dieser Windows-Laufzeit nicht verfügbar. Feld kopieren und Erfassen verwenden oder Windows-Diktat nutzen.", "Nicht verfügbar");
    return;
  }
  const recognition = new Recognition();
  recognition.lang = document.documentElement.lang === "de" ? "de-DE" : "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onstart = () => helperSetStatus("Höre zu…", "Aufnahme");
  recognition.onerror = (event) => helperSetStatus(`Diktatfehler: ${event.error}`, "Prüfung nötig");
  recognition.onresult = (event) => {
    const finalTranscript = [...event.results].filter((result) => result.isFinal).map((result) => result[0].transcript).join(" ").trim();
    if (finalTranscript) $("helperInput").value = `${$("helperInput").value} ${finalTranscript}`.trim();
    updateFieldLockUi();
  };
  recognition.onend = () => helperSetStatus("Diktat erfasst. Jetzt prüfen und strukturieren.", "Erfasst");
  recognition.start();
}

function helperPrepareReport() {
  state.helperTask = "report";
  $("helperCard").classList.add("helper-card-open");
  window.radimoAgent.setHelperFocusable(true);
  helperSetStatus("Befundarbeit aktiv: Befund strukturieren und optional Beurteilung entwerfen.", "Befundarbeit");
  $("helperInput").focus();
}

async function helperSend() {
  const input = $("helperInput").value.trim();
  if (!input) {
    helperSetStatus("Zuerst ein Feld erfassen oder eine kurze Anweisung eingeben.", "Warten");
    return;
  }
  const fieldLabel = helperFieldLabel();
  const fieldContext = `Arbeitsfeld: ${fieldLabel}. Beziehe dich nur auf den gelieferten Text.\n\n`;
  const taskPrompt = state.helperTask === "report" && state.helperFieldType === "beurteilung"
    ? `Erstelle eine knappe Beurteilung/Zusammenfassung für diesen radiologischen Befund. Nenne nur das, was aus dem Text folgt. Bewahre Unsicherheit und wichtige Negativa. Keine neuen Befunde, Empfehlungen oder Diagnosen ergänzen. Ergebnis als Entwurf zur radiologischen Prüfung markieren.\n\n${fieldContext}`
    : state.helperTask === "report"
    ? `Strukturiere diesen diktierten radiologischen Befund konservativ. Verwende klare Überschriften für Fragestellung/Anforderung, Befund und ${$("helperCreateBeurteilung").checked ? "einen optionalen Beurteilungsentwurf" : "keine Beurteilung"}. Bewahre alle gelieferten Fakten, Zahlen, Einheiten, Negationen, Seitenangaben, Unsicherheiten und zeitlichen Angaben. Erfinde keine Befunde oder Empfehlungen. Kennzeichne das Ergebnis als Entwurf zur radiologischen Prüfung.\n\n${fieldContext}`
    : state.helperTask === "correction"
    ? `Korrigiere das medizinisch-radiologische Feld „${fieldLabel}“ ausschließlich hinsichtlich Rechtschreibung, Grammatik und Diktatfehlern. Bewahre alle Fakten, Zahlen, Negationen, Unsicherheiten und anatomischen Angaben. Gib nur den korrigierten Feldtext zurück. Falls etwas unklar ist, setze danach eine separate Zeile „PRÜFNOTIZ:“ hinzu.\n\n${fieldContext}`
    : state.helperTask === "context"
      ? `Prüfe das erfasste Feld „${fieldLabel}“ mit medizinischem Sicherheitsrahmen. Trenne Beobachtung, Interpretation, Unsicherheit und offene Punkte. Erfinde keine fehlenden Befunde.\n\n${fieldContext}`
      : `Hilf bei diesem Feld („${fieldLabel}"). Sei präzise, bewahre die Bedeutung und benenne Unsicherheit statt zu raten.\n\n${fieldContext}`;
  $("helperResult").value = "";
  $("helperCopyResult").disabled = true;
  helperSetStatus("Luna arbeitet…", "Denken");
  state.lastAgentText = "";
  try {
    const assistantMode = state.helperTask === "report" ? (state.helperFieldType === "beurteilung" ? "conclusion" : "report") : state.helperTask === "correction" ? "correction" : state.helperTask === "context" ? "discussion" : "discussion";
    await window.radimoAgent.sendTurn({ text: `${taskPrompt}${input}`, model: state.selectedModel, effort: "medium", medicalGate: true, radiologyMode: true, evidenceMode: false, assistantMode, writingProfile: "german-radiology", origin: "helper", fieldType: state.helperFieldType, fieldLabel: helperFieldLabel() });
  } catch (error) {
    helperSetStatus(error.message || "Die Helferanfrage ist fehlgeschlagen.", "Prüfung nötig");
  }
}

async function helperCopyResult() {
  $("helperCard").classList.add("helper-card-open");
  const result = helperTransferText();
  if (!result) return;
  await window.radimoAgent.writeClipboard(result);
  helperSetStatus(`${helperFieldLabel()} kopiert. Vor dem Einfügen prüfen.`, "Kopiert");
}

async function helperOpenDesktop() {
  const result = helperTransferText() || $("helperInput").value.trim();
  if (!result) {
    helperSetStatus("Zuerst einen Befund erfassen oder strukturieren.", "Warten");
    return;
  }
  helperSetStatus("Frische Desktop-Falldiskussion wird geöffnet…", "Desktop wird geöffnet");
  await window.radimoAgent.openMainWithDraft({
    text: `Diskutiere dieses Arbeitsfeld (${helperFieldLabel()}) auf medizinische und logische Unstimmigkeiten. Besprich fehlende Informationen, Differenzialdiagnosen und Unsicherheiten. Bevorzuge bei medizinischer Begründung peer-reviewte oder autoritative radiologische Quellen, sofern der Onlinezugriff verfügbar ist; nenne nur tatsächlich verwendete Quellen.\n\n${result}`,
    mode: "discussion",
    fresh: true,
    fieldType: state.helperFieldType,
    fieldLabel: helperFieldLabel(),
  });
}

async function helperWriteBack() {
  const result = helperTransferText();
  if (!result || !state.focusedTarget?.windowHandle) return;
  helperSetStatus(`${helperFieldLabel()} wird ins RIS geschrieben…`, "Schreiben");
  try {
    const response = await window.radimoAgent.writeFocusedField({ text: result, target: state.focusedTarget });
    if (response?.ok) helperSetStatus(`${helperFieldLabel()} übertragen. Text im RIS prüfen.`, "Geschrieben");
    else helperSetStatus(`Feld konnte nicht beschrieben werden: ${response?.error || "unbekannter Fehler"}. Ergebnis stattdessen kopieren.`, "Prüfung nötig");
  } catch (error) {
    helperSetStatus(error.message || "Feld konnte nicht beschrieben werden.", "Prüfung nötig");
  }
}

function helperToggleCard() {
  $("helperInput").focus();
  window.radimoAgent.setHelperFocusable(true);
}

function setHelperView(view) {
  const mini = view === "mini";
  document.body.classList.toggle("helper-mini", mini);
  $("helperVerticalMode").classList.toggle("active", !mini);
  $("helperMiniMode").classList.toggle("active", mini);
  window.localStorage?.setItem("radimo-helper-view", mini ? "mini" : "vertical");
}

function enableHelperDragging() {
  for (const moon of document.querySelectorAll(".helper-moon")) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originX = Number(moon.dataset.translateX || 0);
    let originY = Number(moon.dataset.translateY || 0);
    moon.addEventListener("pointerdown", (event) => {
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      originX = Number(moon.dataset.translateX || 0);
      originY = Number(moon.dataset.translateY || 0);
      moon.setPointerCapture(event.pointerId);
    });
    moon.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      moved ||= Math.hypot(dx, dy) > 5;
      if (moved) {
        moon.dataset.translateX = String(originX + dx);
        moon.dataset.translateY = String(originY + dy);
        moon.style.translate = `${originX + dx}px ${originY + dy}px`;
      }
    });
    const finishDrag = () => {
      dragging = false;
      if (moved) {
        moon.dataset.dragged = "true";
        window.setTimeout(() => { moon.dataset.dragged = "false"; }, 350);
      }
    };
    moon.addEventListener("pointerup", finishDrag);
    moon.addEventListener("pointercancel", finishDrag);
    moon.addEventListener("click", (event) => {
      if (moon.dataset.dragged === "true") {
        event.preventDefault();
        event.stopImmediatePropagation();
        moon.dataset.dragged = "false";
      }
    }, true);
  }
}

$("modelSelect").addEventListener("change", (event) => { state.selectedModel = event.target.value; updateImageAttachmentCapability(); addActivity("Model selected", state.selectedModel, false); });
$("assistantMode").addEventListener("change", (event) => { setAssistantMode(event.target.value); addActivity("Work mode selected", event.target.options[event.target.selectedIndex].textContent, false); });
$("writingProfile").addEventListener("change", (event) => setWritingProfile(event.target.value));
$("evidenceMode").addEventListener("change", () => updateEvidenceLedger());
$("useLocalReferences").addEventListener("change", () => updateEvidenceLedger());
$("newDiscussion").addEventListener("click", startNewDiscussion);
$("sendButton").addEventListener("click", send);
$("composer").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } });
$("composer").addEventListener("input", (event) => { event.target.style.height = "auto"; event.target.style.height = `${Math.min(event.target.scrollHeight, 130)}px`; });
$("accountButton").addEventListener("click", openLogin);
$("closeLogin").addEventListener("click", closeLogin);
$("loginButton").addEventListener("click", login);
$("logoutButton").addEventListener("click", logout);
$("refreshButton").addEventListener("click", refreshConnection);
$("contextMoon").addEventListener("click", openContext);
$("closeContext").addEventListener("click", closeContext);
$("chooseContext").addEventListener("click", chooseContext);
$("chooseClinicRoot").addEventListener("click", chooseClinicRoot);
$("openClinicRoot").addEventListener("click", openClinicRoot);
$("clinicSelect").addEventListener("change", (event) => { state.selectedClinicId = event.target.value; renderClinicCatalog(state.clinicCatalog); });
$("chooseReferences").addEventListener("click", chooseReferences);
$("clearReferences").addEventListener("click", clearReferences);
$("fetchReferenceUrl").addEventListener("click", fetchReferenceUrl);
$("importGuidance").addEventListener("click", importGuidance);
$("exportGuidance").addEventListener("click", exportGuidance);
$("openGuidanceFolder").addEventListener("click", openGuidanceFolder);
$("insertTemplate").addEventListener("click", insertTemplate);
$("captureScreen").addEventListener("click", captureScreen);
$("copyScreenCapture").addEventListener("click", copyScreenCapture);
$("saveContext").addEventListener("click", saveContext);
$("copyContext").addEventListener("click", copyContext);
$("copySelectedField").addEventListener("click", copySelectedField);
$("prepareCorrection").addEventListener("click", prepareCorrection);
$("copyLastResponse").addEventListener("click", copyLastResponse);
$("saveCorrectionDraft").addEventListener("click", saveCorrectionDraft);
$("copyDiagnostics").addEventListener("click", copyDiagnostics);
$("testConnection").addEventListener("click", testConnection);
$("applyProxy").addEventListener("click", applyProxy);
$("helperToggle").addEventListener("click", () => window.radimoAgent.toggleHelper());
$("activityMoon").addEventListener("click", toggleMinimap);
$("chatMoon").addEventListener("click", () => { $("composer").focus(); addActivity("Conversation ready", "The island is ready for your next prompt", false); });
$("focusMoon").addEventListener("click", () => { $("composer").focus(); setIslandState("Focused"); addActivity("Focus mode", "Composer is ready", false); });
$("exploreMoon").addEventListener("click", () => openContext());
$("automateMoon").addEventListener("click", () => showToast("Vorlagen und Schreibregeln findest du im Kontextfinder."));
$("helperCaptureMoon").addEventListener("click", helperCapture);
$("helperLockField").addEventListener("click", lockFocusedField);
$("helperReleaseField").addEventListener("click", releaseFocusedField);
$("helperTransfer").addEventListener("click", transferDictationBox);
$("helperDiscard").addEventListener("click", discardDictationBox);
$("helperInput").addEventListener("input", updateFieldLockUi);
$("helperFieldType").addEventListener("change", (event) => { setHelperFieldType(event.target.value); helperSetStatus(`${helperFieldLabel()} ausgewählt.`, "Ziel gewählt"); });
$("helperFixMoon").addEventListener("click", helperPrepareFix);
$("helperStructure").addEventListener("click", () => { helperPrepareReport(); helperSend(); });
$("helperDictateMoon").addEventListener("click", helperStartDictation);
$("helperContextMoon").addEventListener("click", helperPrepareContext);
$("helperCopyMoon").addEventListener("click", helperCopyResult);
$("helperCopyResult").addEventListener("click", helperCopyResult);
$("helperWriteBack").addEventListener("click", helperWriteBack);
$("helperOpenMain").addEventListener("click", helperOpenDesktop);
$("helperActivityMoon").addEventListener("click", helperToggleCard);
$("helperMenu").addEventListener("click", helperToggleCard);
$("helperVerticalMode").addEventListener("click", () => setHelperView("vertical"));
$("helperMiniMode").addEventListener("click", () => setHelperView("mini"));
$("helperClose").addEventListener("click", () => { window.radimoAgent.setHelperFocusable(false); window.radimoAgent.hideHelper(); });
// The desktop hand-off is handled by helperOpenDesktop so a structured report
// starts a fresh case stream instead of merely revealing the old conversation.
$("helperSend").addEventListener("click", helperSend);
for (const button of document.querySelectorAll("[data-prompt]")) button.addEventListener("click", () => {
  if (button.dataset.mode) setAssistantMode(button.dataset.mode);
  $("composer").value = button.dataset.prompt;
  $("composer").focus();
});

window.radimoAgent.onEvent((event) => {
  if (event.method === "account/updated" || event.method === "account/login/completed") {
    if (event.method === "account/updated" || event.params?.success === true) closeLogin();
    addActivity(event.params?.success === false ? "Sign-in incomplete" : "Identity updated", "Account state changed", event.params?.success === false);
    refreshConnection();
  }
  if (event.method === "item/agentMessage/delta") {
    const message = $("messages").lastElementChild;
    if (message?.classList.contains("agent")) {
      state.lastAgentText = (state.lastAgentText === "Working…" ? "" : state.lastAgentText) + (event.params?.delta || "");
      message.lastElementChild.textContent = state.lastAgentText;
      $("copyLastResponse").disabled = !state.lastAgentText.trim();
      $("saveCorrectionDraft").disabled = !state.lastAgentText.trim() || !state.contextReport?.source?.path;
    }
    if (helperMode) {
      $("helperResult").value = state.lastAgentText;
      $("helperCopyResult").disabled = !state.lastAgentText.trim();
      $("helperWriteBack").disabled = !state.lastAgentText.trim() || !state.focusedTarget?.windowHandle;
    }
  }
  if (event.method === "turn/started") { setIslandState("Denken"); addActivity("Turn gestartet", "Anfrage vom lokalen App-Server angenommen", true); }
  if (event.method === "item/started") addActivity("Kontext wird gelesen", "Der Agent prüft die aktuelle Aufgabe", true);
  if (event.method === "turn/completed") { setIslandState("Bereit"); addActivity("Bereit", "Die Antwort ist vollständig", false); updateEvidenceLedger(state.lastAgentText); const ownsTurn = state.workflow?.origin === (helperMode ? "helper" : "desktop"); if (ownsTurn && state.lastAgentText.trim()) void publishArtifact(helperMode ? "Helfergebnis" : "Antwortentwurf", helperMode ? "Prüfen · kopieren oder ins RIS schreiben" : "Arbeitskopie · nicht automatisch ins RIS geschrieben", helperMode ? "helper-result" : "discussion"); if ($("useScreenCapture").checked) { $("useScreenCapture").checked = false; $("useScreenCapture").disabled = true; $("screenCaptureStatus").textContent = "Bild gesendet; für ein weiteres Bild erneut erfassen."; } if (helperMode) helperSetStatus("Ergebnis bereit. Prüfen und gezielt verwenden.", "Bereit"); refreshConnection(); }
  if (event.method === "radimoagent/stderr") addActivity("Lokales Signal", event.params?.text || "", false);
});
window.radimoAgent.onReady(() => { addActivity("Arbeitsbereich bereit", "Lokaler App-Server verbunden", false); refreshConnection(); loadModels(); loadClinicSources(); });
window.radimoAgent.onError((error) => { setStatus(false, "Nicht verfügbar", error.message || "Startfehler"); addActivity("Startproblem", error.message || "Startfehler", true); });
window.radimoAgent.onWorkflowState((workflow) => applyWorkflowState(workflow));
window.radimoAgent.getWorkflowState().then((workflow) => applyWorkflowState(workflow)).catch(() => {});
window.radimoAgent.onWorkflow(async (payload) => {
  if (!payload?.text) return;
  if (payload.fresh) {
    state.messages = [];
    state.lastAgentText = "";
    $("messages").replaceChildren();
    $("messages").innerHTML = `<div class="empty-state"><strong>Fallfrage eingeben</strong></div>`;
  }
  setAssistantMode(payload.mode || "discussion");
  if (payload.fieldType) {
    const label = HELPER_FIELD_LABELS[payload.fieldType] || payload.fieldLabel || "Befund";
    $("radarTarget").textContent = `Diskussion · ${label}`;
    addActivity("Arbeitsfeld übernommen", label, false);
  }
  $("composer").value = payload.text;
  $("composer").dispatchEvent(new Event("input"));
  $("composer").focus();
  addActivity("Desktop-Fallstream bereit", "Frischer Befunddialog aus dem Helfer geladen", false);
  showToast("Frischer Desktop-Fallstream bereit.");
});

addActivity("Arbeitsbereich startet", "Lokale Oberfläche wird vorbereitet", true);
applyGermanUi();
renderModels();
setAssistantMode(state.assistantMode);
setWritingProfile(state.writingProfile);
loadGuidanceStatus();
loadTemplateStatus();
updateEvidenceLedger();
renderArtifacts();
setHelperFieldType(state.helperFieldType);
updateFieldLockUi();
if (helperMode) {
  document.title = "RadimoAgent Helfer";
  helperSetStatus("", "Bereit");
  setHelperView(window.localStorage?.getItem("radimo-helper-view") || "vertical");
  enableHelperDragging();
}
