const state = {
  models: [],
  selectedModel: "",
  backend: "codex",
  apiProvider: "openai",
  apiConfigLocks: { provider: false, authMode: false, endpoint: false, model: false, audioDeployment: false },
  loggedIn: false,
  contextReport: null,
  fieldMapperProfile: null,
  fieldMapReport: null,
  fieldMapSelectedKeys: new Set(),
  fieldMapperAutoTarget: false,
  fieldMapperAutoSelection: null,
  fieldMapperAutoSelecting: false,
  fieldMapperBusy: false,
  fieldAccessMode: "clipboard",
  focusedTarget: null,
  fieldLocked: false,
  helperFieldType: "befund",
  helperSourceText: "",
  pendingDictationText: "",
  lastAgentText: "",
  workflow: null,
  referencePack: [],
  clinicCatalog: null,
  selectedClinicId: "",
  screenCapture: null,
  writingProfile: "german-radiology",
  recording: null,
  working: false,
  activePanel: "",
  activeTask: "",
  lastSourceText: "",
  lastAgentResult: "",
  lastResultInsertText: "",
  lastResultTask: "",
  lastAgentMeta: { changes: [], unclear: [], logicIssues: [], medicalIssues: [] },
  lastResultApplied: false,
  lastResultTarget: null,
  lastChatResultTarget: null,
  transferNeedsReview: null,
  manualReviewPending: false,
  transferInFlight: false,
  pendingDictationTarget: null,
  chatMessages: [],
  chatAssistantNode: null,
  chatUnread: false,
  workspaceFocus: "chat",
  reviewMode: "text",
  editorMode: "source",
  actionSettings: {},
  contextMenuTarget: "",
  configTask: "correction",
  settingsOpen: false,
  dialogReturnFocus: null,
  panelReturnFocus: null,
  contextMenuReturnFocus: null,
  connectionOnline: false,
  experimentalUia: false,
  cubeMode: "compact",
};

const HELPER_FIELD_LABELS = {
  befund: "Befund",
  beurteilung: "Beurteilung",
  fragestellung: "Fragestellung",
  anforderung: "Anforderung",
  sonstiges: "Text",
};

const $ = (id) => document.getElementById(id);
const on = (id, event, handler) => { const node = $(id); if (node) node.addEventListener(event, handler); };
const text = (id, value) => { const node = $(id); if (node) node.textContent = value; };
const PANEL_IDS = ["miniEditorDrawer", "miniConfigDrawer", "miniChatDrawer", "miniReviewDrawer", "contextDrawer", "loginModal"];
const PANEL_KEYS = { miniWorkspaceDrawer: "workspace", miniEditorDrawer: "editor", miniConfigDrawer: "config", miniChatDrawer: "chat", miniReviewDrawer: "review", contextDrawer: "context", loginModal: "settings" };
const DEFAULT_HELPER_MODEL = "gpt-5.6-luna";
const SPARK_MODEL_ID = "gpt-5.3-codex-spark";
const HELPER_REASONING_EFFORT = "low";
const MAX_CHAT_MESSAGES = 40;
const MAX_CHAT_MESSAGE_CHARS = 24_000;
const MAX_ACTION_PROMPT_CHARS = 8_000;
const TEXT_BLOCK_TOKEN = "{{TEXT_BLOCK}}";
const ACTION_SETTINGS_STORAGE_KEY = "radimoagent.action-settings.v2";
const CUBE_MODE_STORAGE_KEY = "radimoagent.cube-size.v1";
const FIELD_MAPPER_PREFERENCE_STORAGE_KEY = "radimoagent.field-mapper-preferences.v1";
const FIELD_ACCESS_STORAGE_KEY = "radimoagent.field-access.v1";
const FIELD_MAPPER_DEFAULT_INCLUDE = [
  "clinical_question = *fragestellung* | *frage* | *anforderung*",
  "lab = *labor*",
  "contrast = *kontrast*",
  "report = *befund*",
  "summary = *beurteilung* | *impression*",
  "clinical_info = *klinische angabe* | *anamnese* | *indikation*",
  "referrer_notes = *zuweis* | *überweisung* | *einweiser* | *referenten*",
].join("\n");
const FIELD_MAPPER_DEFAULT_EXCLUDE = [
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
  "*patientenname*",
  "*patname*",
  "*nachname*",
  "*vorname*",
].join("\n");
const ACTION_PROMPT_DEFAULTS = {
  write: `Formuliere nur den vorhandenen Text klarer. Keine neuen Informationen und keine inhaltlichen Ergänzungen. Gib in text den vollständigen Textblock zurück; er ist für die Ersetzung des aktiven Feldes bestimmt.\n\nARBEITSTEXT:\n${TEXT_BLOCK_TOKEN}`,
  correction: `Medizinisches Lektorat. Korrigiere und ersetze ausschließlich relevante Rechtschreib-, Grammatik-, Interpunktions- und erkennbare Diktatfehler im vorhandenen Text. Überschriften und OPB, sofern vorhanden, unverändert belassen. Keine neuen Inhalte, keine stilistische Umdeutung und keine Bedeutungsänderung. Medizinische oder logische Auffälligkeiten ausschließlich unter dem Text als Hinweise nennen; nicht korrigieren. Gib in text ausschließlich den vollständigen korrigierten Textblock zurück: jeden Absatz, jede Überschrift und alle unveränderten Stellen mit ausgeben, niemals nur Änderungen, Ausschnitte, eine Zusammenfassung oder Auslassungspunkte. Wenn keine Korrektur nötig ist, gib den vollständigen Originaltext unverändert zurück und setze changes auf []. Keine Zusatzformatierung und keine Hinweise innerhalb von text; Änderungen und Hinweise stehen nur in den Metadaten.\n\nARBEITSTEXT:\n${TEXT_BLOCK_TOKEN}`,
  structure: `Ordne nur den vorhandenen Text besser. Nichts ergänzen und keine fehlenden Bausteine erfinden. Gib in text den vollständigen neu geordneten Textblock zurück; er ist für die Ersetzung des aktiven Feldes bestimmt.\n\nARBEITSTEXT:\n${TEXT_BLOCK_TOKEN}`,
  assessment: `Fasse nur die vorhandenen Aussagen knapp als Beurteilung. Unsicherheiten und Lücken bleiben sichtbar. Gib in text nur den ergänzenden Inhalt ohne Überschrift zurück; ReportHalo setzt beim Übernehmen die klare Kennzeichnung "Beurteilung: " davor und hängt ihn unterhalb des vorhandenen Textes an.\n\nARBEITSTEXT:\n${TEXT_BLOCK_TOKEN}`,
  discussion: `Chat: Antworte knapp in 1–4 kurzen Absätzen oder höchstens fünf Stichpunkten. Erkläre, frage nach und diskutiere nur anhand des vorhandenen Textes. Du schreibst nie in ein externes Feld. Wenn der Nutzer ausdrücklich einen korrigierten, umformulierten oder wiederverwendbaren Text verlangt, gib ein JSON-Objekt mit answer, text, changes, unclear, logicIssues und medicalIssues zurück; text ist dann der vollständige Textblock zur späteren Übernahme. Bei reiner Diskussion antworte als normalen kurzen Text.\n\nARBEITSTEXT:\n${TEXT_BLOCK_TOKEN}`,
  proposal: `Vorschlag: Erstelle aus dem Arbeitsfeld und der Anweisung einen kurzen, bearbeitbaren Textentwurf. Der Entwurf darf die gewünschte Zielsektion (zum Beispiel Befund oder Beurteilung) abbilden, aber keine neuen medizinischen Fakten ergänzen. Gib in text den vollständigen lokalen Entwurf zurück. Schreibe nie in ein externes Feld.\n\nARBEITSTEXT:\n${TEXT_BLOCK_TOKEN}`,
  dictation: "German radiology dictation. Preserve measurements, units, laterality, negations, uncertainty, comparison dates, and established Latin anatomical terms. Transcribe only what was spoken; do not correct, interpret, or add clinical content.",
};
const ACTION_SETTING_DEFAULTS = Object.fromEntries(Object.keys(ACTION_PROMPT_DEFAULTS).map((task) => [task, {
  visible: true,
  prompt: "",
  manualReview: false,
}]));

const FIELD_ACCESS_MODES = {
  clipboard: {
    label: "Zwischenablage · DMO/RIS",
    description: "Im DMO/RIS Text markieren, Strg+C drücken und anschließend hier übernehmen. Ergebnisse werden kopiert und im Zielprogramm bewusst mit Strg+V eingefügt.",
  },
  uia: {
    label: "UIA-Feldzugriff · experimentell",
    description: "Nur auf ausdrücklichen Klick: der Helper wird kurz ausgeblendet und liest ausschließlich ValuePattern/TextPattern des fokussierten UIA-Elements. Nicht jedes DMO-/RIS-Feld stellt diesen Zugriff bereit.",
  },
};
const panelLayoutEpoch = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let panelLayoutRequest = 0;
let chatAssistantRenderFrame = 0;
let pendingChatAssistantText = "";
const MINI_ACTIONS = {
  miniCore: { label: "ReportHalo", kind: "core" },
  miniTargetCell: { label: "Arbeitsfeld", run: true },
  miniWrite: { label: "Klarer formulieren", task: "write", run: true, configurable: true, hideable: true, manualReview: true },
  miniDictate: { label: "Diktat", task: "dictation", run: true, configurable: true },
  miniCorrection: { label: "Lektorat", task: "correction", run: true, configurable: true, hideable: true, manualReview: true },
  miniInsert: { label: "Ergebnis anwenden", run: true },
  miniStructure: { label: "Strukturieren", task: "structure", run: true, configurable: true, hideable: true, manualReview: true },
  miniAssessment: { label: "Beurteilung ergänzen", task: "assessment", run: true, configurable: true, hideable: true, manualReview: true },
  miniReview: { label: "Ergebnis prüfen", run: true, hideable: false },
  miniEditorToggle: { label: "Textquelle", run: true },
  miniContextToggle: { label: "Kontext", run: true },
  miniChatToggle: { label: "Chat", task: "discussion", run: true, configurable: true },
  miniEditorSend: { label: "Chat fragen", task: "discussion", configurable: true },
  miniChatSend: { label: "Chat senden", task: "discussion", configurable: true },
  miniChatPropose: { label: "Vorschlag ins Textfeld", task: "proposal", configurable: true },
};

function modelId(model) {
  return String(model?.id || model?.model || "").trim();
}

function preferredModelId(models) {
  const entries = (Array.isArray(models) ? models : [])
    .map((entry) => ({
      entry,
      id: modelId(entry),
      label: String(entry?.displayName || entry?.name || ""),
    }))
    .filter(({ id }) => id);
  const spark = entries.find(({ id, label }) => id.toLowerCase() === SPARK_MODEL_ID || `${id} ${label}`.toLowerCase().includes("spark"));
  const luna = entries.find(({ id }) => id.toLowerCase() === DEFAULT_HELPER_MODEL);
  return spark?.id || luna?.id || entries[0]?.id || DEFAULT_HELPER_MODEL;
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 3400);
}

function loadActionSettings() {
  let stored = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(ACTION_SETTINGS_STORAGE_KEY) || "{}");
  } catch {
    stored = {};
  }
  state.actionSettings = Object.fromEntries(Object.entries(ACTION_SETTING_DEFAULTS).map(([task, defaults]) => {
    const value = stored?.[task] || {};
    return [task, {
      visible: value.visible !== false,
      prompt: typeof value.prompt === "string" ? value.prompt.trim().slice(0, MAX_ACTION_PROMPT_CHARS) : defaults.prompt,
      manualReview: value.manualReview === true,
    }];
  }));
}

function saveActionSettings() {
  try {
    window.localStorage.setItem(ACTION_SETTINGS_STORAGE_KEY, JSON.stringify(state.actionSettings));
  } catch {
    // A non-persistent profile should not block the helper.
  }
}

function normalizeCubeMode(value) {
  return value === "standard" ? "standard" : "compact";
}

function syncCubeModeControl() {
  const toggle = $("miniContextCubeSize");
  if (!toggle) return;
  const nextLabel = state.cubeMode === "compact" ? "Größere Cub-Ansicht" : "Kompakte Cub-Ansicht";
  toggle.textContent = nextLabel;
  toggle.setAttribute("aria-label", nextLabel);
  toggle.title = nextLabel;
}

function loadCubeMode() {
  let stored = "compact";
  try {
    stored = window.localStorage.getItem(CUBE_MODE_STORAGE_KEY) || stored;
  } catch {
    stored = "compact";
  }
  state.cubeMode = normalizeCubeMode(stored);
  document.body.dataset.cubeSize = state.cubeMode;
  syncCubeModeControl();
}

function setCubeMode(mode, { persist = true } = {}) {
  const nextMode = normalizeCubeMode(mode);
  state.cubeMode = nextMode;
  document.body.dataset.cubeSize = nextMode;
  syncCubeModeControl();
  if (persist) {
    try {
      window.localStorage.setItem(CUBE_MODE_STORAGE_KEY, nextMode);
    } catch {
      // A non-persistent profile should not block the helper.
    }
  }
  return window.radimoAgent.setHelperCubeMode(nextMode).then((layout) => {
    if (layout?.mode) {
      state.cubeMode = normalizeCubeMode(layout.mode);
      document.body.dataset.cubeSize = state.cubeMode;
      syncCubeModeControl();
    }
    syncPanelConnector();
    return layout;
  });
}

function toggleCubeMode() {
  closeMiniContextMenu();
  void setCubeMode(state.cubeMode === "compact" ? "standard" : "compact").catch((error) => {
    helperSetStatus(error?.message || "Cub-Ansicht konnte nicht geändert werden.", "Prüfung nötig");
  });
}

function renderActionVisibility() {
  for (const [id, config] of Object.entries(MINI_ACTIONS)) {
    if (!config.hideable || !config.task) continue;
    $(id)?.classList.toggle("hidden", state.actionSettings?.[config.task]?.visible === false);
  }
}

function defaultActionPrompt(task) {
  return ACTION_PROMPT_DEFAULTS[task] || "Bearbeite nur den bereitgestellten Text und halte offene Punkte sichtbar.";
}

function configuredActionPrompt(task) {
  const value = state.actionSettings?.[task]?.prompt?.trim();
  return value || defaultActionPrompt(task);
}

function configTaskIsValid(task) {
  return Object.prototype.hasOwnProperty.call(ACTION_SETTING_DEFAULTS, task);
}

function configurableActionDefinitions() {
  const seen = new Set();
  return Object.values(MINI_ACTIONS).filter((definition) => {
    if (!definition.task || !definition.configurable || seen.has(definition.task)) return false;
    seen.add(definition.task);
    return configTaskIsValid(definition.task);
  });
}

function syncMiniConfigActionOptions() {
  const select = $("miniConfigAction");
  if (!select) return;
  const selectedTask = state.configTask;
  select.replaceChildren();
  for (const definition of configurableActionDefinitions()) {
    const option = document.createElement("option");
    option.value = definition.task;
    option.textContent = definition.label;
    select.append(option);
  }
  if (configTaskIsValid(selectedTask)) select.value = selectedTask;
}

function syncMiniConfigPanel() {
  const task = configTaskIsValid(state.configTask) ? state.configTask : "correction";
  state.configTask = task;
  const definition = Object.values(MINI_ACTIONS).find((item) => item.task === task);
  const settings = state.actionSettings[task] || ACTION_SETTING_DEFAULTS[task];
  syncMiniConfigActionOptions();
  text("miniConfigTitle", definition?.label || "Aktion");
  const visible = $("miniConfigVisible");
  if (visible) visible.checked = settings.visible !== false;
  const manualReview = $("miniConfigManualReview");
  if (manualReview) manualReview.checked = settings.manualReview === true;
  const prompt = $("miniConfigPrompt");
  if (prompt) prompt.value = settings.prompt || defaultActionPrompt(task);
  const visibilityRow = $("miniConfigVisibleRow");
  visibilityRow?.classList.toggle("hidden", !definition?.hideable);
  const manualReviewRow = $("miniConfigManualReviewRow");
  manualReviewRow?.classList.toggle("hidden", !definition?.manualReview);
  const promptHint = task === "dictation"
    ? "Dieser Prompt wird zusammen mit der Audiodatei an die Transkription gesendet."
      : settings.prompt
        ? "Eigener vollständiger Prompt. Der Arbeitsfeld-Text wird automatisch als Textblock mitgegeben."
      : `Standardvorlage mit ${TEXT_BLOCK_TOKEN}. Der Arbeitsfeld-Text wird an dieser Stelle eingefügt; ohne Token wird er automatisch angehängt.`;
  text("miniConfigPromptHint", promptHint);
  text("miniConfigNote", task === "dictation"
    ? "Das Diktat wird nur transkribiert; Lektorat und medizinische Prüfung bleiben separate Schritte."
    : `Der Arbeitsfeld-Text wird automatisch als Textblock mitgegeben. Mit ${TEXT_BLOCK_TOKEN} kannst du den Block im Prompt an einer eigenen Stelle einsetzen.${definition?.manualReview ? " Bei aktivierter manueller Prüfung wird nichts automatisch ins Zielfeld geschrieben." : ""}`);
}

function openMiniConfig(task = state.configTask) {
  closeMiniContextMenu();
  if (configTaskIsValid(task)) state.configTask = task;
  syncMiniConfigPanel();
  if (state.activePanel !== "miniConfigDrawer") openPanel("miniConfigDrawer");
}

function saveMiniConfig() {
  const task = configTaskIsValid(state.configTask) ? state.configTask : "correction";
  const definition = Object.values(MINI_ACTIONS).find((item) => item.task === task);
  const previous = state.actionSettings[task] || ACTION_SETTING_DEFAULTS[task];
  const enteredPrompt = String($("miniConfigPrompt")?.value || "").trim().slice(0, MAX_ACTION_PROMPT_CHARS);
  state.actionSettings[task] = {
    visible: definition?.hideable ? Boolean($("miniConfigVisible")?.checked) : previous.visible !== false,
    prompt: enteredPrompt === defaultActionPrompt(task) ? "" : enteredPrompt,
    manualReview: definition?.manualReview ? Boolean($("miniConfigManualReview")?.checked) : previous.manualReview === true,
  };
  saveActionSettings();
  renderActionVisibility();
  syncMiniConfigPanel();
  helperSetStatus((definition?.label || "Aktion") + " gespeichert.", "Gespeichert");
}

function resetMiniConfig() {
  const task = configTaskIsValid(state.configTask) ? state.configTask : "correction";
  state.actionSettings[task] = { ...ACTION_SETTING_DEFAULTS[task] };
  saveActionSettings();
  renderActionVisibility();
  syncMiniConfigPanel();
  helperSetStatus("Aktion auf Standard zurückgesetzt.", "Gespeichert");
}

function isVisibleFocusable(node) {
  return Boolean(node?.isConnected && !node.disabled && !node.closest?.(".hidden"));
}

function closeMiniContextMenu({ restoreFocus = true } = {}) {
  $("miniContextMenu")?.classList.add("hidden");
  $(state.contextMenuTarget || "miniCore")?.setAttribute("aria-expanded", "false");
  const returnFocus = state.contextMenuReturnFocus;
  state.contextMenuTarget = "";
  state.contextMenuReturnFocus = null;
  if (restoreFocus && isVisibleFocusable(returnFocus)) returnFocus.focus();
}

function runMiniContextTarget(targetId) {
  closeMiniContextMenu();
  switch (targetId) {
    case "miniTargetCell":
      void miniCaptureField();
      break;
    case "miniWrite":
      void runAgentAction("write");
      break;
    case "miniDictate":
      void miniStartDictation();
      break;
    case "miniCorrection":
      void runAgentAction("correction");
      break;
    case "miniInsert":
      void (state.pendingDictationText.trim() ? insertPendingDictation() : insertReviewResult());
      break;
    case "miniStructure":
      void runAgentAction("structure");
      break;
    case "miniAssessment":
      void runAgentAction("assessment");
      break;
    case "miniReview":
      if (state.lastAgentResult.trim() || $("miniReviewText")?.value.trim()) openPanel("miniReviewDrawer");
      else helperSetStatus("Noch kein Ergebnis zum Prüfen vorhanden.", "Leer");
      break;
    case "miniEditorToggle":
      openPanel("miniEditorDrawer");
      break;
    case "miniContextToggle":
      openContext();
      break;
    case "miniChatToggle":
      openPanel("miniChatDrawer");
      break;
    default:
      break;
  }
}

function showMiniContextMenu(event, targetId = "miniCore") {
  const menu = $("miniContextMenu");
  const definition = MINI_ACTIONS[targetId] || MINI_ACTIONS.miniCore;
  if (!menu) return;
  event?.preventDefault();
  event?.stopPropagation();
  const invoker = targetId === "miniTargetCell" ? $("miniCapture") : event?.currentTarget?.nodeType === Node.ELEMENT_NODE ? event.currentTarget : $(targetId) || document.activeElement;
  state.contextMenuReturnFocus = isVisibleFocusable(invoker) ? invoker : null;
  state.contextMenuTarget = targetId;
  $(targetId)?.setAttribute("aria-haspopup", "menu");
  $(targetId)?.setAttribute("aria-controls", "miniContextMenu");
  $(targetId)?.setAttribute("aria-expanded", "true");
  text("miniContextMenuTitle", definition.label);
  const run = $("miniContextRun");
  if (run) {
    run.classList.toggle("hidden", !definition.run);
    run.textContent = targetId === "miniTargetCell" && !usesExperimentalFieldAccess()
      ? "Zwischenablage übernehmen"
      : definition.task ? "Ausführen" : definition.label + " öffnen";
  }
  const targetMenu = targetId === "miniTargetCell";
  const selection = $("miniContextSelection");
  if (selection) selection.classList.toggle("hidden", !targetMenu || !usesExperimentalFieldAccess());
  const copy = $("miniContextCopy");
  if (copy) copy.classList.toggle("hidden", !targetMenu || !Boolean(currentHelperText() || reviewText()));
  const clipboard = $("miniContextClipboard");
  if (clipboard) clipboard.classList.toggle("hidden", !targetMenu);
  const reset = $("miniContextReset");
  if (reset) {
    const canReset = hasLockedTarget() || Boolean(currentHelperText() || state.lastAgentResult.trim() || $("miniReviewText")?.value.trim());
    reset.classList.toggle("hidden", !targetMenu || !canReset);
    reset.textContent = hasLockedTarget() ? "Arbeitsfeld lösen" : "Textquelle leeren";
  }
  const autoSelect = $("miniContextAutoSelect");
  if (autoSelect) {
    autoSelect.classList.toggle("hidden", !targetMenu || !usesExperimentalFieldAccess());
    autoSelect.textContent = `${fieldMapperTargetLabel()} automatisch wählen`;
    autoSelect.title = "Eine eindeutig passende, konfigurierte Textfeldregel als Ziel verwenden";
  }
  const configure = $("miniContextConfigure");
  const canConfigure = definition.kind === "core" || Boolean(definition.configurable);
  if (configure) {
    configure.classList.toggle("hidden", !canConfigure);
    configure.textContent = definition.kind === "core" ? "Alle Funktionsprompts" : "Button-Einstellungen";
  }
  const visibility = $("miniContextVisibility");
  const canToggle = Boolean(definition.hideable && definition.task);
  if (visibility) {
    visibility.classList.toggle("hidden", !canToggle);
    visibility.textContent = state.actionSettings?.[definition.task]?.visible === false ? "Aktion einblenden" : "Aktion ausblenden";
  }
  const quit = $("miniContextQuit");
  if (quit) quit.classList.toggle("hidden", definition.kind !== "core");
  const cubeSize = $("miniContextCubeSize");
  if (cubeSize) cubeSize.classList.toggle("hidden", definition.kind !== "core");
  const fieldMapper = $("miniContextFieldMapper");
  if (fieldMapper) fieldMapper.classList.toggle("hidden", !usesExperimentalFieldAccess());
  syncCubeModeControl();
  menu.classList.remove("hidden");
  const core = $("miniCore");
  const fallback = core?.getBoundingClientRect();
  const x = Number.isFinite(event?.clientX) ? event.clientX : (fallback ? fallback.right + 8 : 8);
  const y = Number.isFinite(event?.clientY) ? event.clientY : (fallback ? fallback.top + 8 : 8);
  const menuRect = menu.getBoundingClientRect();
  const width = Math.min(214, Math.max(176, menuRect.width || window.innerWidth - 16));
  menu.style.left = String(Math.max(8, Math.min(x, window.innerWidth - width - 8))) + "px";
  menu.style.top = String(Math.max(8, y)) + "px";
  const placed = menu.getBoundingClientRect();
  menu.style.left = String(Math.max(8, Math.min(x, window.innerWidth - placed.width - 8))) + "px";
  menu.style.top = String(Math.max(8, Math.min(y, window.innerHeight - placed.height - 8))) + "px";
  [run, selection, copy, clipboard, reset, autoSelect, configure, cubeSize, $("miniContextFieldMapper"), $("miniContextSettings"), $("miniContextClose"), quit]
    .find((node) => node && !node.classList.contains("hidden"))?.focus();
}

function handleMiniContextMenuKeydown(event) {
  const menu = $("miniContextMenu");
  if (!menu || menu.classList.contains("hidden")) return false;
  const items = [...menu.querySelectorAll('[role="menuitem"]')].filter((node) => !node.classList.contains("hidden") && !node.disabled);
  if (!items.length) return false;
  const current = items.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    closeMiniContextMenu();
    return true;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    closeMiniContextMenu();
    return true;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
    return true;
  }
  if ((event.key === "Enter" || event.key === " ") && current >= 0) {
    event.preventDefault();
    items[current].click();
    return true;
  }
  return false;
}

function toggleMiniContextVisibility() {
  const definition = MINI_ACTIONS[state.contextMenuTarget];
  if (!definition?.task || !definition.hideable) return;
  const settings = state.actionSettings[definition.task] || { ...ACTION_SETTING_DEFAULTS[definition.task] };
  settings.visible = settings.visible === false;
  state.actionSettings[definition.task] = settings;
  saveActionSettings();
  renderActionVisibility();
  closeMiniContextMenu();
  helperSetStatus(settings.visible ? definition.label + " eingeblendet." : definition.label + " ausgeblendet.", "Gespeichert");
}

function applyGermanUi() {
  document.documentElement.lang = "de";
  document.title = "RadIMO – ReportHalo";
}

function helperFieldLabel() {
  return HELPER_FIELD_LABELS[state.helperFieldType] || HELPER_FIELD_LABELS.befund;
}

function setHelperFieldType(value) {
  state.helperFieldType = HELPER_FIELD_LABELS[value] ? value : "befund";
}

function inferHelperFieldType(target) {
  const value = `${target?.title || ""} ${target?.controlType || ""}`.toLocaleLowerCase("de-DE");
  if (/beurteil|zusammenfass|impression|conclusion|assessment/.test(value)) return "beurteilung";
  if (/frage|question/.test(value)) return "fragestellung";
  if (/anforder|request|indication/.test(value)) return "anforderung";
  if (/befund|finding|report/.test(value)) return "befund";
  return "befund";
}

function currentHelperText() {
  return String(state.helperSourceText || state.pendingDictationText || "").trim();
}

function normalizeFieldAccessMode(value) {
  return value === "uia" && state.experimentalUia ? "uia" : "clipboard";
}

function fieldAccessMode() {
  return normalizeFieldAccessMode(state.fieldAccessMode);
}

function fieldAccessDescription(mode = fieldAccessMode()) {
  return FIELD_ACCESS_MODES[normalizeFieldAccessMode(mode)]?.description || FIELD_ACCESS_MODES.clipboard.description;
}

function usesExperimentalFieldAccess() {
  return state.experimentalUia && fieldAccessMode() === "uia";
}

function fieldCaptureLabel() {
  return usesExperimentalFieldAccess() ? "Externes Arbeitsfeld aktivieren" : "Text aus der Zwischenablage übernehmen";
}

function updateFieldAccessUi() {
  const fieldButton = $("miniCaptureFromField");
  if (fieldButton) {
    fieldButton.classList.toggle("hidden", !state.experimentalUia);
    fieldButton.disabled = !state.experimentalUia;
    fieldButton.textContent = "UIA-Feld aktivieren";
    fieldButton.title = "Nur im ausdrücklich gestarteten UIA-Entwicklertest verwenden";
  }
  document.querySelector(".field-mapper-details")?.classList.toggle("hidden", !state.experimentalUia);
  const workflowNote = $("fieldAccessWorkflowNote");
  if (workflowNote) workflowNote.textContent = usesExperimentalFieldAccess()
    ? "UIA ist nur für einen ausdrücklich gestarteten Entwicklertest aktiv. DMO-/RIS-Felder können trotz funktionierendem Diktat keinen lesbaren UIA-Text bereitstellen."
    : "Der sichere Standardweg startet keine Fremdfenster-Automation. DMO-Diktat- und unbekannte Felder bleiben im DMO-Workflow; ReportHalo übernimmt Text ausdrücklich aus der Zwischenablage.";
  const clipboardButton = $("miniClipboardCapture");
  if (clipboardButton) {
    clipboardButton.textContent = "Zwischenablage übernehmen";
    clipboardButton.title = "Markierten DMO-/RIS-Text aus der Zwischenablage übernehmen";
  }
  renderMiniTarget();
}

function releaseUiaTargetForClipboard() {
  state.fieldAccessMode = "clipboard";
  state.focusedTarget = null;
  state.fieldLocked = false;
  state.transferNeedsReview = null;
  state.lastResultApplied = false;
  state.fieldMapperAutoSelection = null;
  state.fieldMapperAutoTarget = false;
  saveFieldMapperPreferences();
  renderFieldMapperReport(null);
  void window.radimoAgent.patchWorkflow({ phase: "idle", target: "text", targetIdentity: null });
  syncDiscussionScope();
}

function hasLockedTarget() {
  return Boolean(state.fieldLocked && state.focusedTarget?.windowHandle);
}

function sameTargetIdentity(left, right) {
  if (!left?.windowHandle || !right?.windowHandle || String(left.windowHandle) !== String(right.windowHandle)) return false;
  for (const key of ["processId", "controlWindowHandle", "automationId", "controlType", "runtimeId"]) {
    if (left[key] && right[key] && String(left[key]) !== String(right[key])) return false;
  }
  return true;
}

function targetSnapshot() {
  return hasLockedTarget() ? { ...state.focusedTarget } : null;
}

function setMiniWorkingState(working) {
  state.working = Boolean(working);
  const core = $("miniCore");
  core?.classList.toggle("is-working", state.working);
  core?.setAttribute("aria-label", state.working ? "ReportHalo arbeitet · hier zum Verschieben ziehen" : state.connectionOnline ? "ReportHalo bereit · hier zum Verschieben ziehen" : "ReportHalo offline · hier zum Verschieben ziehen");
  core?.setAttribute("title", state.working ? "ReportHalo arbeitet · zum Verschieben ziehen" : "ReportHalo verschieben");
  text("miniCoreStatus", state.working ? "ReportHalo arbeitet. Zum Verschieben am Kern ziehen." : "ReportHalo ist bereit. Zum Verschieben am Kern ziehen.");
  document.body.dataset.miniState = state.working ? "working" : "ready";
}

function setMiniConnectionState(online) {
  state.connectionOnline = Boolean(online);
  const core = $("miniCore");
  core?.classList.toggle("is-online", state.connectionOnline);
  core?.classList.toggle("is-offline", !state.connectionOnline);
  if (!state.working) {
    core?.setAttribute("aria-label", state.connectionOnline ? "ReportHalo bereit · hier zum Verschieben ziehen" : "ReportHalo offline · hier zum Verschieben ziehen");
    core?.setAttribute("title", state.connectionOnline ? "ReportHalo verschieben" : "ReportHalo offline · Einstellungen öffnen");
    text("miniCoreStatus", state.connectionOnline ? "ReportHalo ist bereit. Zum Verschieben am Kern ziehen." : "ReportHalo ist offline. Einstellungen über das Schnellmenü öffnen.");
  }
}

function helperSetStatus(message, stateLabel = "Bereit") {
  text("miniHelperStatus", stateLabel);
  text("miniHelperHint", message || "Arbeitsfeld aktivieren.");
  text("miniPreview", state.pendingDictationText.trim() || currentHelperText() || "Arbeitsfeld aktivieren.");
  const tone = /denken|aufnahme|transkription|ersetzen|ergänzen|einfügen/i.test(stateLabel) ? "working" : /text bereit|einfügen bereit/i.test(stateLabel) ? "source" : /verifiziert|gespeichert|kopiert|chat|bereit/i.test(stateLabel) ? "success" : /prüfung|fehlt|unklar|keine auswahl|kein text|eingang|anmeldung|nicht verfügbar/i.test(stateLabel) ? "warning" : "ready";
  const feedback = $("miniFeedback");
  feedback?.setAttribute("data-state", stateLabel);
  feedback?.setAttribute("data-tone", tone);
  document.body.dataset.miniStatus = tone;
  renderMiniTarget();
  setMiniInsertState();
}

function panelKey(panelId) {
  return panelId ? (PANEL_KEYS[panelId] || "base") : "base";
}

function isWorkspacePanel(panelId = state.activePanel) {
  return panelId === "miniWorkspaceDrawer";
}

function isChatVisible(panelId = state.activePanel) {
  return isWorkspacePanel(panelId) || panelId === "miniChatDrawer";
}

function normalizedPanelId(panelId) {
  return panelId === "miniEditorDrawer" || panelId === "miniChatDrawer" ? "miniWorkspaceDrawer" : panelId;
}

const PANEL_CONTROL_IDS = {
  editor: "miniEditorToggle",
  context: "miniContextToggle",
  chat: "miniChatToggle",
  review: "miniReview",
};

function syncPanelControls() {
  const activeKey = panelKey(state.activePanel);
  const workspaceOpen = isWorkspacePanel();
  const labels = { editor: "Textquelle", context: "Kontext", chat: "Chat", review: "Ergebnis" };
  for (const [key, id] of Object.entries(PANEL_CONTROL_IDS)) {
    const button = $(id);
    if (!button) continue;
    const active = workspaceOpen ? key === "editor" || key === "chat" : activeKey === key;
    const label = labels[key] || key;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-expanded", String(active));
    button.title = `${label} ${active ? "schließen" : "öffnen"}`;
    button.setAttribute("aria-label", button.title);
  }
}

function syncPanelConnector() {
  const deck = $("miniPanelDeck");
  const core = $("miniCore");
  if (!deck || !core || !state.activePanel) return;
  const deckRect = deck.getBoundingClientRect();
  const coreRect = core.getBoundingClientRect();
  if (!deckRect.width || !deckRect.height || !coreRect.width || !coreRect.height) return;
  const panel = panelKey(state.activePanel);
  if (panel === "chat") {
    const x = coreRect.left + coreRect.width / 2 - deckRect.left - 15;
    deck.style.setProperty("--connector-x", `${Math.max(18, Math.min(deckRect.width - 48, x))}px`);
    return;
  }
  const y = coreRect.top + coreRect.height / 2 - deckRect.top - 5;
  deck.style.setProperty("--connector-y", `${Math.max(18, Math.min(deckRect.height - 28, y))}px`);
}

function setPanel(panelId = "") {
  const workspaceOpen = isWorkspacePanel(panelId);
  for (const id of PANEL_IDS) {
    const visible = workspaceOpen ? id === "miniEditorDrawer" || id === "miniChatDrawer" : id === panelId;
    $(id)?.classList.toggle("hidden", !visible);
    $(id)?.setAttribute("aria-hidden", String(!visible));
  }
  state.activePanel = panelId;
  document.body.dataset.miniPanel = panelId ? panelKey(panelId) : "none";
  if (!panelId) {
    document.body.dataset.miniPanelSide = "right";
    document.body.dataset.miniPanelVertical = "bottom";
  }
  syncPanelControls();
  const requestedPanel = panelId;
  const focusable = Boolean(panelId) || state.settingsOpen;
  const requestId = ++panelLayoutRequest;
  window.radimoAgent.setHelperPanel(panelKey(requestedPanel), { requestId, epoch: panelLayoutEpoch }).then((layout) => {
    if (requestId !== panelLayoutRequest || state.activePanel !== requestedPanel || layout?.stale) return;
    if (layout) {
      document.body.dataset.miniPanelSide = layout.side || "right";
      document.body.dataset.miniPanelVertical = layout.vertical || "bottom";
    }
    syncPanelConnector();
    return window.radimoAgent.setHelperFocusable(focusable).then(() => {
      if (requestId !== panelLayoutRequest || state.activePanel !== requestedPanel) return;
      window.requestAnimationFrame(syncPanelConnector);
      const focusTarget = requestedPanel === "miniWorkspaceDrawer" ? (state.workspaceFocus === "editor" ? $("miniEditorText") : $("miniChatComposer"))
        : requestedPanel === "miniReviewDrawer" ? (state.reviewMode === "text" ? $("miniReviewText") : $("miniReviewDiffToggle"))
            : requestedPanel === "miniConfigDrawer" ? $("miniConfigAction")
              : requestedPanel === "contextDrawer" ? $("chooseContext")
            : requestedPanel === "loginModal" ? $("closeLogin") : null;
      if (isVisibleFocusable(focusTarget)) focusTarget.focus();
    });
  }).catch((error) => {
    if (requestId !== panelLayoutRequest || state.activePanel !== requestedPanel) return;
    helperSetStatus(error.message || "Arbeitsbereich konnte nicht geöffnet werden.", "Prüfung nötig");
  });
}

function closeAttachedPanels({ restoreFocus = true } = {}) {
  const returnFocus = state.panelReturnFocus;
  setPanel("");
  state.panelReturnFocus = null;
  state.editorMode = "source";
  if (restoreFocus && isVisibleFocusable(returnFocus)) returnFocus.focus();
}

function openPanel(panelId) {
  const requestedPanel = normalizedPanelId(panelId);
  if (requestedPanel === "miniReviewDrawer" && state.manualReviewPending) {
    helperSetStatus("Den Entwurf zuerst im Editor prüfen.", "Manuell prüfen");
    return;
  }
  if (state.activePanel === requestedPanel && requestedPanel !== "loginModal") {
    closeAttachedPanels();
    return;
  }
  const activePanel = state.activePanel;
  if (!state.panelReturnFocus || (activePanel && !document.activeElement?.closest?.(`#${activePanel}`))) {
    const invoker = document.activeElement;
    if (isVisibleFocusable(invoker)) state.panelReturnFocus = invoker;
  }
  const switching = state.activePanel !== requestedPanel;
  if (panelId === "miniEditorDrawer") state.workspaceFocus = "editor";
  if (panelId === "miniChatDrawer") state.workspaceFocus = "chat";
  if (switching && requestedPanel === "miniWorkspaceDrawer") {
    $("miniEditorText").value = state.editorMode === "result" ? (state.lastAgentResult || $("miniReviewText")?.value || "") : currentHelperText();
    syncMiniEditorMode();
  }
  if (switching && panelId === "miniReviewDrawer") {
    $("miniReviewText").value = state.lastAgentResult || $("miniReviewText").value;
    renderReviewDiff(state.lastSourceText, $("miniReviewText").value);
    setReviewMode(state.reviewMode);
  }
  state.settingsOpen = requestedPanel === "loginModal";
  if (requestedPanel === "miniWorkspaceDrawer") {
    state.chatUnread = false;
    updateChatBadge();
    syncDiscussionScope();
  }
  setPanel(requestedPanel);
}

function openSettings() {
  state.dialogReturnFocus = document.activeElement;
  state.settingsOpen = true;
  openPanel("loginModal");
  text("loginStatus", "");
  void refreshOpenAIStatus();
  void refreshShortcutStatus();
}

function closeSettings() {
  state.settingsOpen = false;
  setPanel("");
  if (isVisibleFocusable(state.dialogReturnFocus)) state.dialogReturnFocus.focus();
  state.dialogReturnFocus = null;
}

function handleDialogKeydown(event) {
  const backdrop = $("loginModal");
  if (!backdrop || backdrop.classList.contains("hidden")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSettings();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...backdrop.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")]
    .filter((node) => !node.closest(".hidden"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function renderMiniTarget() {
  const cell = $("miniTargetCell");
  if (!cell) return;
  const hasTarget = hasLockedTarget();
  const hasText = Boolean(state.helperSourceText || state.pendingDictationText);
  const editor = $("miniEditorText");
  if (editor && state.editorMode === "source") {
    const source = currentHelperText();
    if (editor.value !== source) editor.value = source;
  }
  cell.classList.toggle("is-ready", hasTarget);
  cell.classList.toggle("is-auto-target", hasTarget && Boolean(state.focusedTarget?.fieldMapperKey));
  cell.classList.toggle("has-text", !hasTarget && hasText);
  cell.classList.toggle("is-empty", !hasTarget && !hasText);
  const uia = usesExperimentalFieldAccess();
  cell.setAttribute("aria-label", hasTarget ? `Externes Feld aktiv: ${helperFieldLabel()}` : hasText ? "Textquelle bereit" : uia ? "Externes Arbeitsfeld oder Textquelle" : "Textquelle aus Zwischenablage oder Drag-and-drop");
  cell.title = hasTarget ? `${state.focusedTarget?.fieldMapperLabel ? `${state.focusedTarget.fieldMapperLabel} · ` : ""}Externes Feld aktiv · Rechtsklick für Auto-Ziel · X löst das Zielfeld` : hasText ? "Textquelle bereit · X leert den Text" : uia ? "Externes Arbeitsfeld aktivieren oder Text hierher ziehen · Rechtsklick für Auto-Ziel" : "Text aus der Zwischenablage übernehmen oder hierher ziehen";
  const targetIcon = $("miniTargetIcon");
  if (targetIcon) targetIcon.setAttribute("href", hasTarget ? "#icon-lock" : hasText ? "#icon-edit" : "#icon-target");
  const capture = $("miniCapture");
  capture?.classList.toggle("is-active", hasTarget);
  capture?.setAttribute("aria-label", hasTarget ? `Arbeitsfeld erneut lesen: ${helperFieldLabel()}` : hasText ? uia ? "Textquelle durch externes Arbeitsfeld ersetzen" : "Zwischenablage erneut übernehmen" : fieldCaptureLabel());
  capture?.setAttribute("title", hasTarget ? "Arbeitsfeld erneut lesen" : hasText ? uia ? "Externes Arbeitsfeld aktivieren" : "Zwischenablage erneut übernehmen" : fieldCaptureLabel());
  text("miniTargetCellStatus", hasTarget ? `Externes Feld aktiv: ${helperFieldLabel()}` : hasText ? "Textquelle bereit" : uia ? "Feld wählen" : "Zwischenablage übernehmen");
  const clear = $("miniTargetClear");
  if (clear) clear.disabled = !hasTarget && !hasText;
  if (clear) clear.title = hasTarget ? "Arbeitsfeld lösen" : "Textquelle leeren";
  setMiniEditorAvailability();
}

function setMiniEditorAvailability() {
  const resultMode = state.editorMode === "result" && Boolean(state.lastAgentResult.trim() || $("miniEditorText")?.value.trim());
  const sourceReadOnly = hasLockedTarget() && !resultMode;
  const toggle = $("miniEditorToggle");
  if (toggle) {
    toggle.classList.remove("hidden");
    toggle.disabled = false;
    toggle.title = resultMode ? "Ergebnis im Editor bearbeiten" : sourceReadOnly ? "Arbeitsfeld und Chat öffnen" : "Textquelle und Chat öffnen";
    toggle.setAttribute("aria-label", toggle.title);
  }
  const use = $("miniEditorUse");
  if (use) {
    use.disabled = sourceReadOnly;
    use.title = resultMode ? "Manuelle Änderungen zur Prüfung übernehmen" : sourceReadOnly ? "Aktives Arbeitsfeld ist eine schreibgeschützte Kontextansicht" : "Textquelle übernehmen";
    use.setAttribute("aria-label", use.title);
  }
}

function syncMiniEditorMode() {
  const resultMode = state.editorMode === "result";
  const sourceReadOnly = hasLockedTarget() && !resultMode;
  const use = $("miniEditorUse");
  const send = $("miniEditorSend");
  const editor = $("miniEditorText");
  text("miniEditorEyebrow", resultMode ? "MANUELL PRÜFEN" : sourceReadOnly ? "ARBEITSFELD" : "TEXTQUELLE");
  text("miniEditorTitle", resultMode ? "Entwurf bearbeiten" : sourceReadOnly ? `${helperFieldLabel()} · Kontext` : "Textquelle");
  text("miniEditorModeNote", resultMode ? "AI-Entwurf · nichts wird ins Zielfeld geschrieben, bevor du ihn prüfst." : sourceReadOnly ? "Automatisch aus dem aktiven Feld gelesen · wird nur als Chatkontext verwendet." : "Lokale Textquelle · wird nicht automatisch in ein externes Feld geschrieben.");
  if (editor) {
    editor.readOnly = sourceReadOnly;
    editor.setAttribute("aria-readonly", String(sourceReadOnly));
  }
  if (use) {
    use.querySelector("span")?.replaceChildren(document.createTextNode(resultMode ? "Zur Prüfung" : "Übernehmen"));
    use.classList.toggle("is-primary", resultMode);
    use.title = resultMode ? "Manuelle Änderungen zur Prüfung übernehmen" : "Textquelle übernehmen";
    use.setAttribute("aria-label", use.title);
  }
  if (send) {
    send.classList.toggle("is-primary", !resultMode);
    send.title = resultMode ? "Ergebnis im Chat besprechen" : sourceReadOnly ? "Arbeitsfeld im Chat besprechen" : "Text im Chat prüfen";
    send.setAttribute("aria-label", send.title);
  }
  setMiniEditorAvailability();
  syncDiscussionScope();
}

function setMiniInsertState() {
  const button = $("miniInsert");
  const icon = $("miniInsertIcon");
  if (!button || !icon) return;
  const hasPending = Boolean(state.pendingDictationText.trim());
  const hasReview = Boolean($("miniReviewText")?.value.trim() || state.lastAgentResult.trim());
  const reviewTransfer = state.lastResultTask === "assessment" ? assessmentTransferPlan(reviewText()) : null;
  const hasTarget = hasLockedTarget();
  const readOnly = hasTarget && state.focusedTarget?.supportsWrite === false;
  const transferBlocked = Boolean(state.transferNeedsReview);
  const reviewInsertable = !reviewTransfer || Boolean(reviewTransfer.text);
  const ready = hasTarget && !readOnly && !transferBlocked && reviewInsertable && !state.manualReviewPending && !state.transferInFlight && !state.activeTask && !state.lastResultApplied && (hasPending || hasReview);
  const review = $("miniReview");
  if (review) {
    review.classList.toggle("is-ready", hasReview);
    review.title = state.manualReviewPending ? "Entwurf zuerst im Editor prüfen" : transferBlocked ? "Übertragung im RIS prüfen" : hasReview ? "Ergebnis prüfen" : "Ergebnis prüfen · noch kein Ergebnis";
    review.setAttribute("aria-label", review.title);
  }
  const resultTargetChanged = Boolean(state.lastResultTarget?.windowHandle && (!hasTarget || !sameTargetIdentity(state.focusedTarget, state.lastResultTarget)));
  const selectionTarget = hasTarget && state.focusedTarget?.selectionOnly === true;
  const resultTransferLabel = selectionTarget ? "Markierte Auswahl wird nicht als Vollfeld überschrieben" : reviewTransfer?.fullReplacement ? "Vollständiger bearbeiteter Text wird ersetzt" : state.lastResultTask === "assessment" ? "Beurteilung wird ergänzt" : "Ergebnis ersetzt";
  text("miniReviewTarget", resultTargetChanged ? "Zielfeld geändert · Ergebnis nicht automatisch übernehmen." : hasTarget ? `${resultTransferLabel} · Zielfeld: ${helperFieldLabel()}` : "Kein aktives Zielfeld · Ergebnis bleibt lokal.");
  const reviewInsert = $("miniReviewInsert");
  const reviewReady = hasReview && reviewInsertable && hasTarget && !readOnly && !transferBlocked && !resultTargetChanged && !state.manualReviewPending && !state.transferInFlight && !state.activeTask && !state.lastResultApplied;
  if (reviewInsert) {
    reviewInsert.disabled = !reviewReady;
    reviewInsert.title = resultTargetChanged ? "Zielfeld geändert · Aktion erneut starten" : transferBlocked ? "Übertragung im RIS prüfen oder Zielfeld neu aktivieren" : readOnly ? "Zielfeld ist schreibgeschützt" : state.manualReviewPending ? "Zuerst den Entwurf im Editor prüfen" : selectionTarget ? "Ergebnis kopieren und an der markierten RIS-Auswahl einfügen" : "Geprüftes Ergebnis ins Zielfeld übernehmen";
    reviewInsert.setAttribute("aria-label", reviewInsert.title);
  }
  button.disabled = !ready;
  button.classList.toggle("is-ready", ready);
  button.title = transferBlocked ? "Übertragung im RIS prüfen oder Zielfeld neu aktivieren" : readOnly ? "Zielfeld ist schreibgeschützt" : state.manualReviewPending ? "Nach manueller Prüfung ins Zielfeld übernehmen" : selectionTarget ? "Ergebnis kopieren und an der markierten RIS-Auswahl einfügen" : hasPending ? "Diktat ins Arbeitsfeld einsetzen" : state.lastResultTask === "assessment" ? "Beurteilung im Arbeitsfeld ergänzen" : "Geprüftes Ergebnis im Arbeitsfeld anwenden";
  button.setAttribute("aria-label", button.title);
  const use = icon.querySelector("use");
  if (use) use.setAttribute("href", "#icon-insert");
  const copy = $("miniReviewCopy");
  if (copy) copy.disabled = !hasReview;
  const save = $("saveCorrectionDraft");
  if (save) save.disabled = !hasReview || !state.contextReport?.source?.path;
}

function rememberFocusedField(focused, { preserveFieldMap = false, accessMode = fieldAccessMode() } = {}) {
  if (focused?.ok === false || !focused?.windowHandle || state.working || state.transferInFlight) return null;
  state.focusedTarget = {
    ...focused,
    accessMode: normalizeFieldAccessMode(accessMode),
    expectedFieldHash: focused.hash || null,
    replaceAll: focused.strategy !== "TextPattern.Selection",
    selectionOnly: focused.strategy === "TextPattern.Selection",
  };
  state.fieldLocked = true;
  setHelperFieldType(inferHelperFieldType(focused));
  state.helperSourceText = typeof focused.text === "string" ? focused.text.trim() : "";
  state.pendingDictationText = "";
  state.pendingDictationTarget = null;
  state.transferNeedsReview = null;
  if (!preserveFieldMap) renderFieldMapperReport(null);
  void window.radimoAgent.patchWorkflow({
    fieldType: state.helperFieldType,
    fieldLabel: helperFieldLabel(),
    phase: "capturing",
    target: "selected-field",
    targetIdentity: state.focusedTarget,
  });
  renderMiniTarget();
  syncDiscussionScope();
  setMiniInsertState();
  return state.focusedTarget;
}

async function captureWorkingField({ selectionOnly = false, point = null } = {}) {
  if (state.working || state.transferInFlight) {
    helperSetStatus("Das Arbeitsfeld kann während einer laufenden Aktion nicht gewechselt werden.", "Bitte warten");
    return null;
  }
  if (fieldAccessMode() === "clipboard") {
    const value = await captureClipboardSource();
    if (!value) openPanel("contextDrawer");
    return value;
  }
  await window.radimoAgent.setHelperFocusable(false);
  try {
    const focused = await window.radimoAgent.readFocusedField({
      selectionOnly,
      accessMode: fieldAccessMode(),
      pointX: Number.isFinite(point?.x) ? point.x : "",
      pointY: Number.isFinite(point?.y) ? point.y : "",
    });
    const target = rememberFocusedField(focused);
    if (target) {
      const label = selectionOnly ? "Textauswahl im externen Feld aktiv" : "Externes Feld aktiv";
      helperSetStatus(state.helperSourceText ? `${label} · ${state.helperSourceText.length} Zeichen.` : `${label} · Cursor bleibt im Zielprogramm.`, label);
      return target;
    }
    const message = focused?.error === "no-selection"
      ? "Keine Textauswahl gefunden. Text markieren und Auswahl erneut aktivieren."
      : focused?.error === "helper-focused"
        ? "Das ReportHalo-Fenster ist noch aktiv. Cursor im Zielprogramm setzen und Feld erneut aktivieren."
      : focused?.error === "accessibility-unavailable" || focused?.error === "target-control-unavailable" || focused?.error === "window-not-accessible"
        ? "Dieses DMO/RIS-Feld stellt keinen lesbaren UIA-Text bereit. Text markieren, Strg+C drücken und über die Zwischenablage übernehmen."
      : "Kein unterstütztes externes Textfeld gefunden. Text kann hierher gezogen werden.";
    helperSetStatus(message, focused?.error === "no-selection" ? "Keine Auswahl" : focused?.accessibility === "not-exposed" ? "UIA nicht verfügbar" : "Feld fehlt");
    return null;
  } catch (error) {
    helperSetStatus(error.message || "Arbeitsfeld konnte nicht aktiviert werden.", "Prüfung nötig");
    return null;
  } finally {
    void window.radimoAgent.setHelperFocusable(Boolean(state.activePanel) || state.settingsOpen);
  }
}

async function miniCaptureField({ point = null } = {}) {
  return captureWorkingField({ selectionOnly: false, point });
}

async function miniCaptureSelection({ point = null } = {}) {
  return captureWorkingField({ selectionOnly: true, point });
}

function adoptTextSource(value) {
  state.focusedTarget = null;
  state.fieldLocked = false;
  state.helperSourceText = String(value || "").trim();
  state.pendingDictationText = "";
  state.pendingDictationTarget = null;
  state.transferNeedsReview = null;
  state.lastSourceText = "";
  state.lastAgentText = "";
  state.lastAgentResult = "";
  state.lastResultInsertText = "";
  state.lastResultTask = "";
  state.lastResultTarget = null;
  state.lastChatResultTarget = null;
  state.lastResultApplied = false;
  state.manualReviewPending = false;
  state.lastAgentMeta = emptyAgentMeta();
  state.editorMode = "source";
  const review = $("miniReviewText");
  if (review) review.value = "";
  renderReviewDiff("", "");
  renderAgentNotes(state.lastAgentMeta);
  renderFieldMapperReport(null);
  void window.radimoAgent.patchWorkflow({ phase: "idle", target: "text", targetIdentity: null });
  syncDiscussionScope();
  renderMiniTarget();
}

async function captureClipboardSource() {
  if (state.working || state.transferInFlight) {
    helperSetStatus("Die laufende Aktion zuerst abwarten.", "Bitte warten");
    return null;
  }
  try {
    const value = String(await window.radimoAgent.readClipboard() || "").trim();
    if (!value) {
      helperSetStatus("Die Zwischenablage enthält keinen Text. Im DMO/RIS markieren und Strg+C drücken.", "Kein Text");
      return null;
    }
    adoptTextSource(value);
    helperSetStatus(`${value.length} Zeichen aus der Zwischenablage übernommen.`, "Text bereit");
    return value;
  } catch (error) {
    helperSetStatus(error.message || "Zwischenablage konnte nicht gelesen werden.", "Prüfung nötig");
    return null;
  }
}

function handleMiniTargetDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  if (state.working || state.transferInFlight) {
    helperSetStatus("Eine laufende Aktion zuerst abwarten.", "Bitte warten");
    return;
  }
  const dropped = event.dataTransfer?.getData("text/plain")?.trim();
  if (!dropped) {
    helperSetStatus("Nur Text kann als Arbeitsgrundlage übernommen werden.", "Kein Text");
    return;
  }
  adoptTextSource(dropped);
  helperSetStatus(`${dropped.length} Zeichen als Textquelle übernommen. Ergebnisse werden kopiert und im RIS/DMO mit Strg+V eingefügt.`, "Text bereit");
}

async function ensureSource({ allowEmpty = false } = {}) {
  const source = currentHelperText();
  return source || allowEmpty ? source : "";
}

async function ensureWorkflow(mode) {
  if (!state.workflow || state.workflow.origin !== "helper") {
    const workflow = await window.radimoAgent.newWorkflowCase({ fieldType: state.helperFieldType, fieldLabel: helperFieldLabel() });
    state.workflow = workflow;
  }
  const workflow = await window.radimoAgent.patchWorkflow({
    mode,
    phase: "reviewing",
    target: state.focusedTarget?.windowHandle ? "selected-field" : "text",
    targetIdentity: state.focusedTarget || null,
  });
  state.workflow = workflow || state.workflow;
}

function actionPrompt(task) {
  return configuredActionPrompt(task);
}

function promptWithTextBlock(prompt, sourceBlock) {
  const configured = String(prompt || "");
  if (configured.includes(TEXT_BLOCK_TOKEN)) return configured.split(TEXT_BLOCK_TOKEN).join(sourceBlock);
  return [configured, sourceBlock].filter(Boolean).join("\n\n");
}

function recentDiscussionContext() {
  const current = currentHelperText().trim();
  const result = state.lastAgentResult.trim();
  const sections = [
    ["Geändert", state.lastAgentMeta?.changes],
    ["Unklar", state.lastAgentMeta?.unclear],
    ["Logisch prüfen · nicht geändert", state.lastAgentMeta?.logicIssues],
    ["Medizinisch prüfen · nicht geändert", state.lastAgentMeta?.medicalIssues],
  ].filter(([, items]) => Array.isArray(items) && items.length);
  if (!result && !sections.length) return "";
  const blocks = ["[LETZTER REPORTHALO-ARBEITSSCHRITT]"];
  if (result && result !== current) blocks.push(`[LETZTES ERGEBNIS]\n${result}\n[/LETZTES ERGEBNIS]`);
  for (const [label, items] of sections) blocks.push(`${label}:\n${items.map((item) => `- ${item}`).join("\n")}`);
  blocks.push("Nutze diesen Abschnitt nur als Gesprächskontext. Ändere offene logische oder medizinische Punkte nicht stillschweigend.", "[/LETZTER REPORTHALO-ARBEITSSCHRITT]");
  return blocks.join("\n\n").slice(0, 12_000);
}

const TEXT_ACTION_OUTPUT_CONTRACT = [
  "FELDAKTION: Gib ausschließlich das vollständige JSON-Ergebnis im vorgegebenen Schema zurück.",
  "text ist bei Lektorat, Formulierung und Strukturierung ausschließlich der vollständige Textblock und der vollständige Ersatztext für das lokale Textfeld. Bei Lektorat muss text den gesamten Ausgangstext enthalten, mit jedem Absatz und jeder unveränderten Stelle, auch wenn nur ein Wort geändert wurde; niemals nur Ausschnitte, eine Zusammenfassung oder Auslassungspunkte. Bei keiner Änderung ist text eine unveränderte Kopie. Bei Beurteilung ist text ausschließlich der ergänzende Inhalt; die Oberfläche kennzeichnet ihn als Beurteilung und hängt ihn unterhalb an. Keine Markdown-Zäune, keine Einleitung und keine Änderungslisten innerhalb von text. changes nennt nur tatsächlich vorgenommene Sprach-, Rechtschreib-, Grammatik- oder Lektoratsänderungen; unclear, logicIssues und medicalIssues sind kurze Hinweise zum Ausgangstext und werden nicht geändert. Keine neuen medizinischen Fakten.",
].join(" ");

const PROPOSAL_OUTPUT_CONTRACT = [
  "VORSCHLAG: Gib ausschließlich das vollständige JSON-Ergebnis im vorgegebenen Schema zurück.",
  "text ist ein bearbeitbarer Textvorschlag für die gewünschte Zielsektion. Er darf den vorhandenen Text verbessern oder knapp neu fassen, aber keine neuen medizinischen Fakten, Diagnosen, Zahlen, Empfehlungen oder Gewissheiten erfinden.",
  "changes nennt höchstens drei kurze Hinweise zum Vorschlag; unclear, logicIssues und medicalIssues nennen offene Punkte, die nicht stillschweigend geändert wurden. Keine Einleitung, kein Markdown.",
].join(" ");

function emptyAgentMeta() {
  return { changes: [], unclear: [], logicIssues: [], medicalIssues: [] };
}

function normalizeMetaList(value) {
  const values = Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : [];
  return values.map((item) => String(item).trim()).filter(Boolean).slice(0, 3).map((item) => item.slice(0, 180));
}

function diffLineRows(before, after) {
  const oldText = String(before || "");
  const newText = String(after || "");
  const oldLines = oldText ? oldText.split(/\r?\n/) : [];
  const newLines = newText ? newText.split(/\r?\n/) : [];
  if (!oldLines.length && !newLines.length) return [];
  const rows = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      rows.push({ type: "same", before: oldLines[oldIndex], after: newLines[newIndex] });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    const nextOld = newIndex < newLines.length ? oldLines.indexOf(newLines[newIndex], oldIndex + 1) : -1;
    const nextNew = oldIndex < oldLines.length ? newLines.indexOf(oldLines[oldIndex], newIndex + 1) : -1;
    if (nextOld >= 0 && (nextNew < 0 || nextOld - oldIndex <= nextNew - newIndex)) {
      rows.push({ type: "removed", before: oldLines[oldIndex], after: "" });
      oldIndex += 1;
    } else if (nextNew >= 0) {
      rows.push({ type: "added", before: "", after: newLines[newIndex] });
      newIndex += 1;
    } else {
      if (oldIndex < oldLines.length && newIndex < newLines.length) {
        rows.push({ type: "changed", before: oldLines[oldIndex], after: newLines[newIndex] });
      } else {
        if (oldIndex < oldLines.length) rows.push({ type: "removed", before: oldLines[oldIndex], after: "" });
        if (newIndex < newLines.length) rows.push({ type: "added", before: "", after: newLines[newIndex] });
      }
      oldIndex += 1;
      newIndex += 1;
    }
  }
  return rows;
}

function diffCharacterParts(before, after) {
  const oldChars = Array.from(String(before || ""));
  const newChars = Array.from(String(after || ""));
  let prefix = 0;
  while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldChars.length - prefix &&
    suffix < newChars.length - prefix &&
    oldChars[oldChars.length - suffix - 1] === newChars[newChars.length - suffix - 1]
  ) suffix += 1;

  const oldMiddle = oldChars.slice(prefix, oldChars.length - suffix);
  const newMiddle = newChars.slice(prefix, newChars.length - suffix);
  const beforeParts = [];
  const afterParts = [];
  const appendPart = (parts, value, className) => {
    if (!value) return;
    const previous = parts.at(-1);
    if (previous?.className === className) previous.value += value;
    else parts.push({ value, className });
  };
  appendPart(beforeParts, oldChars.slice(0, prefix).join(""), "same");
  appendPart(afterParts, newChars.slice(0, prefix).join(""), "same");

  // A bounded LCS keeps the highlight at character level for normal report
  // lines while avoiding a quadratic memory spike on pasted full documents.
  if (oldMiddle.length <= 1_200 && newMiddle.length <= 1_200 && oldMiddle.length * newMiddle.length <= 400_000) {
    const table = Array.from({ length: oldMiddle.length + 1 }, () => new Uint32Array(newMiddle.length + 1));
    for (let oldIndex = oldMiddle.length - 1; oldIndex >= 0; oldIndex -= 1) {
      for (let newIndex = newMiddle.length - 1; newIndex >= 0; newIndex -= 1) {
        table[oldIndex][newIndex] = oldMiddle[oldIndex] === newMiddle[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
      }
    }
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldMiddle.length || newIndex < newMiddle.length) {
      if (oldIndex < oldMiddle.length && newIndex < newMiddle.length && oldMiddle[oldIndex] === newMiddle[newIndex]) {
        appendPart(beforeParts, oldMiddle[oldIndex], "same");
        appendPart(afterParts, newMiddle[newIndex], "same");
        oldIndex += 1;
        newIndex += 1;
      } else if (newIndex >= newMiddle.length || (oldIndex < oldMiddle.length && table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1])) {
        appendPart(beforeParts, oldMiddle[oldIndex], "removed");
        oldIndex += 1;
      } else {
        appendPart(afterParts, newMiddle[newIndex], "added");
        newIndex += 1;
      }
    }
  } else {
    appendPart(beforeParts, oldMiddle.join(""), "removed");
    appendPart(afterParts, newMiddle.join(""), "added");
  }
  appendPart(beforeParts, suffix ? oldChars.slice(oldChars.length - suffix).join("") : "", "same");
  appendPart(afterParts, suffix ? newChars.slice(newChars.length - suffix).join("") : "", "same");
  return { before: beforeParts, after: afterParts };
}

function appendDiffText(line, value, className = "same") {
  if (!value) return;
  const span = document.createElement("span");
  span.className = `mini-diff-char ${className}`;
  span.textContent = value;
  line.append(span);
}

function renderDiffSide(node, rows, side) {
  if (!node) return;
  node.replaceChildren();
  for (const row of rows) {
    const line = document.createElement("div");
    line.className = `mini-diff-line ${row.type}`;
    if (row.type === "changed") {
      const parts = diffCharacterParts(row.before, row.after);
      for (const part of parts[side]) appendDiffText(line, part.value, part.className);
    } else {
      line.textContent = row[side] || " ";
    }
    node.append(line);
  }
}

function renderReviewDiff(before, after) {
  const rows = diffLineRows(before, after);
  renderDiffSide($("miniReviewBefore"), rows, "before");
  renderDiffSide($("miniReviewAfter"), rows, "after");
  $("miniReviewDiffEmpty")?.classList.toggle("hidden", rows.length > 0);
}

function setReviewMode(mode = "text") {
  state.reviewMode = mode === "text" ? "text" : "diff";
  const diffMode = state.reviewMode === "diff";
  $("miniReviewDiff")?.classList.toggle("hidden", !diffMode);
  $("miniReviewText")?.classList.toggle("hidden", diffMode);
  const diffToggle = $("miniReviewDiffToggle");
  const editToggle = $("miniReviewEditToggle");
  diffToggle?.classList.toggle("is-active", diffMode);
  editToggle?.classList.toggle("is-active", !diffMode);
  diffToggle?.setAttribute("aria-selected", String(diffMode));
  editToggle?.setAttribute("aria-selected", String(!diffMode));
  $("miniReviewDiff")?.setAttribute("aria-hidden", String(!diffMode));
  $("miniReviewText")?.setAttribute("aria-hidden", String(diffMode));
}

function parseAgentResult(raw) {
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace && (firstBrace > 0 || lastBrace < cleaned.length - 1)) candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      if (typeof parsed.text !== "string") continue;
      const resultText = parsed.text.trim();
      if (!resultText) continue;
      return {
        valid: true,
        text: resultText,
        meta: {
          changes: normalizeMetaList(parsed.changes),
          unclear: normalizeMetaList(parsed.unclear),
          logicIssues: normalizeMetaList(parsed.logicIssues),
          medicalIssues: normalizeMetaList(parsed.medicalIssues),
        },
      };
    } catch {
      // The model response is kept out of the foreign field when the contract is broken.
    }
  }
  return { valid: false, text: "", meta: emptyAgentMeta() };
}

function parseChatResult(raw) {
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace && (firstBrace > 0 || lastBrace < cleaned.length - 1)) candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.text !== "string" || !parsed.text.trim()) continue;
      const hasTextProposalSignal = typeof parsed.answer === "string"
        || typeof parsed.commentary === "string"
        || parsed.type === "text_proposal"
        || ["changes", "unclear", "logicIssues", "medicalIssues"].some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
      if (!hasTextProposalSignal) continue;
      return {
        structured: true,
        answer: String(parsed.answer || parsed.commentary || "Textvorschlag bereit.").trim(),
        text: parsed.text.trim(),
        meta: {
          changes: normalizeMetaList(parsed.changes),
          unclear: normalizeMetaList(parsed.unclear),
          logicIssues: normalizeMetaList(parsed.logicIssues),
          medicalIssues: normalizeMetaList(parsed.medicalIssues),
        },
      };
    } catch {
      // Pure discussion text remains a normal chat answer.
    }
  }
  return { structured: false, answer: String(raw || "").trim(), text: "", meta: emptyAgentMeta() };
}

function updateChatBadge() {
  const badge = $("miniChatBadge");
  badge?.classList.toggle("hidden", !state.chatUnread);
  const button = $("miniChatToggle");
  if (button) {
    button.classList.toggle("has-unread", state.chatUnread);
    button.title = state.chatUnread ? "Text & Chat öffnen · neue Hinweise" : "Text & Chat öffnen";
    button.setAttribute("aria-label", button.title);
  }
}

function syncDiscussionScope() {
  const scope = $("miniChatScope");
  if (!scope) return;
  const source = currentHelperText();
  scope.textContent = hasLockedTarget()
    ? `${helperFieldLabel()} wird automatisch mitbesprochen · Zielfeld bleibt unverändert`
    : source
      ? "Textquelle wird automatisch mitbesprochen · nichts wird ins Zielfeld geschrieben"
      : "Kein Textkontext · Frage kann trotzdem gestellt werden";
}

function appendChatMessage(role, value, { unread = role === "assistant" } = {}) {
  const message = String(value || "").slice(0, MAX_CHAT_MESSAGE_CHARS);
  state.chatMessages.push({ role, text: message });
  if (state.chatMessages.length > MAX_CHAT_MESSAGES) state.chatMessages.splice(0, state.chatMessages.length - MAX_CHAT_MESSAGES);
  const log = $("miniChatLog");
  $("miniChatEmpty")?.classList.add("hidden");
  if (!log) return null;
  const article = document.createElement("article");
  article.className = `mini-chat-message ${role === "user" ? "is-user" : "is-assistant"}`;
  const label = document.createElement("span");
  label.className = "mini-chat-message-label";
  label.textContent = role === "user" ? "Du" : "ReportHalo";
  const body = document.createElement("div");
  body.className = "mini-chat-message-body";
  body.textContent = message || "…";
  article.append(label, body);
  log.append(article);
  while (log.querySelectorAll(".mini-chat-message, .mini-chat-proposal").length > MAX_CHAT_MESSAGES) log.querySelector(".mini-chat-message, .mini-chat-proposal")?.remove();
  log.scrollTop = log.scrollHeight;
  if (role === "assistant" && unread && !isChatVisible()) {
    state.chatUnread = true;
    updateChatBadge();
  }
  return body;
}

function appendChatProposal(result, meta = emptyAgentMeta()) {
  const log = $("miniChatLog");
  if (!log) return;
  $("miniChatEmpty")?.classList.add("hidden");
  const article = document.createElement("article");
  article.className = "mini-chat-proposal";
  article.draggable = true;
  article.title = "Vorschlag ziehen, um ihn als lokale Textquelle zu übernehmen";
  article.addEventListener("dragstart", (event) => {
    event.dataTransfer?.setData("text/plain", result);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
  });
  const label = document.createElement("span");
  label.className = "mini-chat-message-label";
  label.textContent = "Vorschlag";
  const body = document.createElement("div");
  body.textContent = "Bearbeitbarer Textblock bereit. Nicht automatisch ins Zielfeld geschrieben.";
  const noteCount = Object.values(meta).reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0);
  if (noteCount) {
    const note = document.createElement("small");
    note.textContent = "Hinweise und Änderungen stehen in der Antwort oben.";
    article.append(label, body, note);
  } else article.append(label, body);
  const button = document.createElement("button");
  button.className = "mini-panel-button";
  button.type = "button";
  button.textContent = "Im Textfeld öffnen";
  button.addEventListener("click", () => openResultEditor(result));
  article.append(button);
  log.append(article);
  log.scrollTop = log.scrollHeight;
}

function renderChatAssistantNow(value) {
  const next = String(value || "").slice(0, MAX_CHAT_MESSAGE_CHARS);
  const message = state.chatMessages[state.chatMessages.length - 1];
  if (message?.role === "assistant") message.text = next;
  if (state.chatAssistantNode) {
    state.chatAssistantNode.textContent = next || "…";
    const log = $("miniChatLog");
    if (log) log.scrollTop = log.scrollHeight;
  }
}

function updateChatAssistant(value, { immediate = false } = {}) {
  pendingChatAssistantText = String(value || "");
  if (immediate) {
    if (chatAssistantRenderFrame) window.cancelAnimationFrame(chatAssistantRenderFrame);
    chatAssistantRenderFrame = 0;
    renderChatAssistantNow(pendingChatAssistantText);
    return;
  }
  if (chatAssistantRenderFrame) return;
  chatAssistantRenderFrame = window.requestAnimationFrame(() => {
    chatAssistantRenderFrame = 0;
    renderChatAssistantNow(pendingChatAssistantText);
  });
}

function clearChatView() {
  if (chatAssistantRenderFrame) window.cancelAnimationFrame(chatAssistantRenderFrame);
  chatAssistantRenderFrame = 0;
  pendingChatAssistantText = "";
  state.chatMessages = [];
  state.chatAssistantNode = null;
  const log = $("miniChatLog");
  if (log) [...log.querySelectorAll(".mini-chat-message, .mini-chat-proposal")].forEach((node) => node.remove());
  $("miniChatEmpty")?.classList.remove("hidden");
  state.chatUnread = false;
  updateChatBadge();
}

async function startNewDiscussion() {
  if (state.working) {
    helperSetStatus("Die laufende Anfrage zuerst abwarten.", "Denken");
    return;
  }
  clearChatView();
  try {
    await window.radimoAgent.newDiscussion();
    helperSetStatus("Neue Diskussion gestartet. Sie ändert kein Zielfeld.", "Chat");
  } catch (error) {
    helperSetStatus(error.message || "Neue Diskussion konnte nicht gestartet werden.", "Prüfung nötig");
  }
}

function renderAgentNotes(meta) {
  state.lastAgentMeta = {
    changes: normalizeMetaList(meta?.changes),
    unclear: normalizeMetaList(meta?.unclear),
    logicIssues: normalizeMetaList(meta?.logicIssues),
    medicalIssues: normalizeMetaList(meta?.medicalIssues),
  };
  const notes = $("miniReviewNotes");
  if (notes) {
    notes.replaceChildren();
    const sections = [
      ["Geändert", state.lastAgentMeta.changes, ""],
      ["Unklar", state.lastAgentMeta.unclear, "is-warning"],
      ["Logisch prüfen · nicht geändert", state.lastAgentMeta.logicIssues, "is-warning"],
      ["Medizinisch prüfen · nicht geändert", state.lastAgentMeta.medicalIssues, "is-warning"],
    ];
    for (const [label, items, className] of sections) {
      if (!items.length) continue;
      const group = document.createElement("section");
      group.className = `mini-review-note-group ${className}`.trim();
      const heading = document.createElement("strong");
      heading.textContent = label;
      const list = document.createElement("ul");
      for (const item of items) {
        const entry = document.createElement("li");
        entry.textContent = item;
        list.append(entry);
      }
      group.append(heading, list);
      notes.append(group);
    }
  }
  const count = Object.values(state.lastAgentMeta).reduce((total, items) => total + items.length, 0);
  text("miniReviewStatus", count ? "Änderungen und Hinweise stehen unter dem Text und im Chat." : "Keine zusätzlichen Hinweise gemeldet.");
}

function normalizeActionResultText(task, value) {
  const result = String(value || "").trim();
  if (task !== "assessment") return result;
  const withoutHeading = result.replace(/^Beurteilung\s*:?\s*/i, "").trim();
  return withoutHeading ? `Beurteilung: ${withoutHeading}` : "Beurteilung:";
}

function likelyCompleteCorrection(source, result) {
  const original = String(source || "").trim();
  const corrected = String(result || "").trim();
  if (!original || original.length < 120) return true;
  if (!corrected || corrected.length < Math.max(80, Math.floor(original.length * 0.55))) return false;
  if (/(?:\.\.\.|…)\s*$/.test(corrected) && !/(?:\.\.\.|…)\s*$/.test(original)) return false;
  return !/\[(?:gekürzt|ausgelassen|truncated|cut)\]/i.test(corrected);
}

function assessmentReviewText(source, addendum) {
  return [String(source || "").trim(), String(addendum || "").trim()].filter(Boolean).join("\n\n");
}

function assessmentTransferPlan(value, source = state.lastSourceText, generatedAddendum = state.lastResultInsertText) {
  const review = String(value || "").trim();
  const sourceText = String(source || "").trim();
  const generated = String(generatedAddendum || "").trim();
  if (!review) return { text: "", append: true, changed: true };
  if (!sourceText) return { text: review, append: true, changed: review !== generated };

  const expected = assessmentReviewText(sourceText, generated);
  if (review === expected) return { text: generated || review, append: true, changed: false };
  if (generated && review === generated) return { text: generated, append: true, changed: true };
  if (review === sourceText) return { text: "", append: true, changed: true };
  if (/^Beurteilung\s*:/i.test(review)) return { text: review, append: true, changed: true };

  // If the original text is still an exact prefix, only the edited addendum
  // is transferred. Editing the original part intentionally turns the
  // visible full-text review into a complete replacement.
  const separator = review.slice(sourceText.length);
  if (review.startsWith(sourceText) && /^\s*\n/.test(separator)) {
    return { text: separator.trim(), append: true, changed: true };
  }
  return { text: review, append: false, fullReplacement: true, changed: true };
}

function resultTaskLabel(task) {
  return { correction: "Lektorat", write: "Formulierung", structure: "Textordnung", assessment: "Beurteilung", proposal: "Vorschlag" }[task] || "Bearbeitung";
}

function formatResultMeta(task, meta, { activeTarget = false, transferred = false, verified = false, replaced = false, appended = false, manualReview = false, unverified = false, clipboardPrepared = false } = {}) {
  const status = appended && verified ? "Die Beurteilung wurde unterhalb des vorhandenen Textes ergänzt." : replaced && verified ? "Der vollständige Text wurde im aktiven Feld ersetzt." : manualReview ? "Das aktive Feld wurde nicht verändert. Der Entwurf wartet auf deine Prüfung im Editor." : clipboardPrepared ? (appended ? "Die Beurteilung liegt als Paste-Vorlage in der Zwischenablage; im RIS prüfen und am passenden Cursor einfügen." : "Der vollständige Ergebnistext liegt als Paste-Vorlage in der Zwischenablage; im RIS prüfen und bewusst einfügen.") : unverified ? "Die Übertragung wurde gesendet, aber das RIS-Feld lässt sich nicht zurücklesen. Der Ergebnistext liegt in der Zwischenablage; bitte im RIS prüfen." : transferred ? "Die Übertragung wurde versucht, aber das Zielfeld ist noch nicht verifiziert." : activeTarget ? "Das aktive Feld wurde nicht verändert, weil es nicht verifiziert werden konnte." : "Kein aktives externes Feld wurde verändert.";
  const lines = [`${resultTaskLabel(task)} abgeschlossen. ${status}`];
  const sections = [
    ["Geändert", meta.changes],
    ["Unklar", meta.unclear],
    ["Logisch prüfen · nicht geändert", meta.logicIssues],
    ["Medizinisch prüfen · nicht geändert", meta.medicalIssues],
  ];
  let hasNotes = false;
  for (const [label, items] of sections) {
    if (!items.length) continue;
    hasNotes = true;
    lines.push("", `${label}:`, ...items.map((item) => `• ${item}`));
  }
  if (!hasNotes) lines.push("", "Keine zusätzlichen Hinweise.");
  return lines.join("\n");
}

function formatChatNotes(meta) {
  const sections = [
    ["Geändert", meta?.changes],
    ["Unklar", meta?.unclear],
    ["Logisch prüfen · nicht geändert", meta?.logicIssues],
    ["Medizinisch prüfen · nicht geändert", meta?.medicalIssues],
  ].filter(([, items]) => Array.isArray(items) && items.length);
  return sections.map(([label, items]) => `${label}: ${items.join(" · ")}`).join("\n");
}

async function runAgentAction(task, instruction = "", sourceOverride = null) {
  if (state.working) return;
  const operationTarget = targetSnapshot();
  const source = sourceOverride?.trim() || await ensureSource({ allowEmpty: (task === "discussion" || task === "proposal") && Boolean(instruction.trim()) });
  if (!source && !instruction.trim()) {
    helperSetStatus("Zuerst ein Arbeitsfeld aktivieren oder eine Frage eingeben.", "Eingang fehlt");
    return;
  }
  const mode = { correction: "correction", write: "report", structure: "report", assessment: "conclusion", discussion: "discussion", proposal: "proposal" }[task] || "discussion";
  const attachedContext = contextPrompt();
  const attachedReferences = referencePrompt();
  const attachedImage = $("useScreenCapture")?.checked && state.screenCapture?.path ? state.screenCapture.path : null;
  const isChat = task === "discussion";
  const isProposal = task === "proposal";
  const sourceBlock = source ? `[AUTOMATISCHER ARBEITSTEXT · ${helperFieldLabel()}]\n${source}\n[/AUTOMATISCHER ARBEITSTEXT]` : "[KEIN ARBEITSTEXT VORHANDEN]";
  const prompt = [
    promptWithTextBlock(actionPrompt(task), sourceBlock),
    isChat ? "" : isProposal ? PROPOSAL_OUTPUT_CONTRACT : TEXT_ACTION_OUTPUT_CONTRACT,
    instruction.trim(),
    `Arbeitsfeld: ${helperFieldLabel()}`,
    isChat ? recentDiscussionContext() : "",
    attachedContext,
    attachedReferences,
  ].filter(Boolean).join("\n\n");
  state.activeTask = task;
  state.lastSourceText = source;
  state.lastAgentText = "";
  state.lastChatResultTarget = isChat ? operationTarget : null;
  if (!isChat) {
    state.pendingDictationText = "";
    state.pendingDictationTarget = null;
    state.lastResultApplied = false;
    state.transferNeedsReview = null;
    state.lastResultTarget = operationTarget;
    state.manualReviewPending = false;
    state.lastAgentResult = "";
    state.lastResultInsertText = "";
    state.lastResultTask = "";
    state.lastAgentMeta = emptyAgentMeta();
    $("miniReviewText").value = "";
    renderReviewDiff("", "");
    renderAgentNotes(state.lastAgentMeta);
  }
  setMiniWorkingState(true);
  helperSetStatus("ReportHalo arbeitet…", "Denken");
  try {
    await ensureWorkflow(mode);
    await window.radimoAgent.sendTurn({
      text: prompt,
      model: state.selectedModel || DEFAULT_HELPER_MODEL,
      effort: HELPER_REASONING_EFFORT,
      medicalGate: true,
      radiologyMode: true,
      evidenceMode: false,
      assistantMode: mode,
      writingProfile: state.writingProfile,
      fieldType: state.helperFieldType,
      fieldLabel: helperFieldLabel(),
      targetIdentity: state.focusedTarget?.windowHandle ? { ...state.focusedTarget } : null,
      imagePath: attachedImage,
    });
  } catch (error) {
    setMiniWorkingState(false);
    if (isChat && state.chatAssistantNode) {
      state.chatAssistantNode.textContent = error.message || "Anfrage konnte nicht gestartet werden.";
      state.chatAssistantNode.classList.add("is-error");
      state.chatAssistantNode = null;
    }
    state.activeTask = "";
    helperSetStatus(error.message || "Anfrage konnte nicht gestartet werden.", "Prüfung nötig");
  }
}

function reviewText() {
  return String($("miniReviewText")?.value || state.lastAgentResult || "").trim();
}

async function insertTextIntoField(value, { isDictation = false, automatic = false, append = false, targetOverride = null, sourceText = null } = {}) {
  const textToInsert = String(value || "").trim();
  const target = targetOverride || state.focusedTarget;
  if (!textToInsert) {
    helperSetStatus("Kein Ergebnis zum Einsetzen vorhanden.", "Leer");
    return null;
  }
  if (!target?.windowHandle && !targetOverride && fieldAccessMode() === "clipboard") {
    try {
      await window.radimoAgent.writeClipboard(textToInsert);
      helperSetStatus(append ? "Beurteilung kopiert. Im RIS/DMO prüfen und am passenden Cursor mit Strg+V einfügen." : "Vollständiger Ergebnistext kopiert. Im RIS/DMO prüfen und mit Strg+V einfügen.", "Kopiert");
      return { ok: true, verified: false, copied: true };
    } catch (error) {
      helperSetStatus(error.message || "Ergebnis konnte nicht in die Zwischenablage kopiert werden.", "Prüfung nötig");
      return null;
    }
  }
  if (!target?.windowHandle || !state.fieldLocked) {
    helperSetStatus("Kein gesichertes Arbeitsfeld für dieses Ergebnis vorhanden.", "Feld fehlt");
    return null;
  }
  if (targetOverride && !sameTargetIdentity(state.focusedTarget, targetOverride)) {
    helperSetStatus("Das Ergebnis gehört zu einem anderen Arbeitsfeld. Bitte die Aktion erneut starten.", "Zielfeld geändert");
    return null;
  }
  if (target.selectionOnly && !isDictation) {
    try {
      await window.radimoAgent.writeClipboard(textToInsert);
      helperSetStatus("Die markierte Auswahl wird nicht als vollständiges Feld überschrieben. Ergebnis kopiert; im RIS an der Auswahl mit Strg+V einsetzen.", "Manuell einfügen");
      return { ok: true, verified: false, copied: true, selectionPaste: true };
    } catch (error) {
      helperSetStatus(error.message || "Ergebnis konnte nicht in die Zwischenablage kopiert werden.", "Prüfung nötig");
      return null;
    }
  }
  if (target.supportsWrite === false) {
    helperSetStatus("Das aktive Arbeitsfeld ist schreibgeschützt.", "Nur lesen");
    return null;
  }
  if (state.transferNeedsReview && sameTargetIdentity(state.transferNeedsReview.target, target)) {
    helperSetStatus("Die letzte Übertragung ist nicht rücklesbar. Ergebnis im RIS prüfen oder das Zielfeld neu aktivieren.", "Manuell prüfen");
    return null;
  }
  if (!isDictation && state.lastResultApplied) {
    helperSetStatus("Dieses Ergebnis wurde bereits übertragen. Für eine neue Übernahme den Text zuerst ändern oder die Aktion erneut starten.", "Bereits übertragen");
    return null;
  }
  if (state.transferInFlight) return null;
  state.transferInFlight = true;
  setMiniInsertState();
  const existingSource = String(sourceText ?? (state.helperSourceText || state.lastSourceText || "")).trim();
  const appendText = append && existingSource && !/[\r\n]\s*$/.test(existingSource) ? `\n\n${textToInsert}` : textToInsert;
  await window.radimoAgent.setHelperFocusable(false);
  helperSetStatus(
    isDictation ? "Diktat wird eingesetzt…" : append ? "Beurteilung wird ergänzt…" : automatic ? "Ergebnis wird im externen Feld ersetzt…" : "Geprüftes Ergebnis wird eingesetzt…",
    append ? "Ergänzen" : automatic ? "Ersetzen" : "Einfügen",
  );
  try {
    await window.radimoAgent.patchWorkflow({
      phase: "transferring",
      target: "selected-field",
      targetIdentity: target,
    });
    const response = await window.radimoAgent.writeFocusedField({
      text: appendText,
      target: {
        ...target,
        append: isDictation ? false : append,
        replaceAll: isDictation ? false : append || target.replaceAll !== false,
        insertAtCursor: isDictation || target.insertAtCursor === true,
      },
    });
    if (response?.actualHash && response.verified && state.focusedTarget && sameTargetIdentity(state.focusedTarget, target)) state.focusedTarget.expectedFieldHash = response.actualHash;
    let dictationFieldText = null;
    if (isDictation && response?.ok && response.verified) {
      if (typeof response.actualText === "string") {
        dictationFieldText = response.actualText;
      } else {
        try {
          const refreshed = await window.radimoAgent.readFocusedField({
            windowHandle: target.windowHandle,
            processId: target.processId,
            controlWindowHandle: target.controlWindowHandle || target.nativeWindowHandle || "",
            accessMode: target.accessMode || fieldAccessMode(),
          });
          if (refreshed?.ok && typeof refreshed.text === "string") {
            dictationFieldText = refreshed.text;
            if (state.focusedTarget && sameTargetIdentity(state.focusedTarget, target)) state.focusedTarget.expectedFieldHash = refreshed.hash || state.focusedTarget.expectedFieldHash;
          }
        } catch { /* the verified write remains the source of truth when a second read is unavailable */ }
      }
    }
    if (response?.ok && response.verified) {
      state.transferNeedsReview = null;
      if (isDictation) state.pendingDictationText = "";
      if (isDictation) state.pendingDictationTarget = null;
      if (!isDictation) state.lastResultApplied = true;
      if (isDictation) {
        state.helperSourceText = (dictationFieldText ?? existingSource).trim();
      } else {
        state.helperSourceText = append ? [existingSource, textToInsert].filter(Boolean).join("\n\n") : textToInsert;
      }
      helperSetStatus(append ? "Beurteilung ergänzt und Zielfeld verifiziert." : automatic ? "Ergebnis direkt ersetzt und Zielfeld verifiziert." : "Eingesetzt und Zielfeld verifiziert.", "Verifiziert");
      setMiniDictationState("idle");
    } else if (response?.ok) {
      state.transferNeedsReview = { target: { ...target }, text: appendText, isDictation, automatic, at: Date.now() };
      try { await window.radimoAgent.writeClipboard(appendText); } catch { /* result remains in the review panel */ }
      helperSetStatus("Die RIS-Übertragung wurde gesendet, aber der Feldinhalt lässt sich nicht zurücklesen. Ergebnis liegt in der Zwischenablage; bitte im RIS prüfen.", "Manuell prüfen");
    } else {
      try { await window.radimoAgent.writeClipboard(appendText); } catch { /* result remains in the review panel */ }
      state.transferNeedsReview = null;
      helperSetStatus(`Einsetzen gestoppt: ${response?.error || "Ziel geändert"}. Ergebnis liegt in der Zwischenablage; im RIS prüfen und mit Strg+V einsetzen.`, "Prüfung nötig");
    }
    if (response?.ok && response.verified) {
      await window.radimoAgent.patchWorkflow({
        phase: "ready",
        target: "selected-field",
        targetIdentity: target,
      });
    }
    setMiniInsertState();
    return response || null;
  } catch (error) {
    helperSetStatus(error.message || "Ergebnis konnte nicht eingesetzt werden.", "Prüfung nötig");
    return null;
  } finally {
    state.transferInFlight = false;
    setMiniInsertState();
    void window.radimoAgent.setHelperFocusable(Boolean(state.activePanel) || state.settingsOpen);
  }
}

async function insertPendingDictation() {
  const textToInsert = String(state.pendingDictationText || "").trim();
  if (!textToInsert) {
    helperSetStatus("Noch kein Diktat zum Einsetzen vorhanden.", "Leer");
    return null;
  }
  if (!state.pendingDictationTarget?.windowHandle && fieldAccessMode() === "clipboard") {
    try {
      await window.radimoAgent.writeClipboard(textToInsert);
      state.pendingDictationText = "";
      state.pendingDictationTarget = null;
      state.helperSourceText = textToInsert;
      syncDiscussionScope();
      setMiniDictationState("idle");
      helperSetStatus("Diktat kopiert. Im RIS/DMO am Cursor mit Strg+V einfügen.", "Kopiert");
      return { ok: true, verified: false, copied: true };
    } catch (error) {
      helperSetStatus(error.message || "Diktat konnte nicht in die Zwischenablage kopiert werden.", "Prüfung nötig");
      return null;
    }
  }
  return insertTextIntoField(textToInsert, { isDictation: true, targetOverride: state.pendingDictationTarget });
}

async function insertReviewResult() {
  if (state.manualReviewPending) {
    helperSetStatus("Den Entwurf zuerst im Editor prüfen und zur Ergebnisansicht weitergeben.", "Manuell prüfen");
    return;
  }
  const value = reviewText();
  const assessment = state.lastResultTask === "assessment";
  const transfer = assessment ? assessmentTransferPlan(value) : { text: value, append: false };
  if (!transfer.text) {
    helperSetStatus("Für die Beurteilung ist kein ergänzender Text vorhanden.", "Leer");
    return;
  }
  await insertTextIntoField(transfer.text, {
    append: transfer.append,
    targetOverride: state.lastResultTarget,
    sourceText: state.lastSourceText,
  });
}

async function applyCompletedAgentResult() {
  const task = state.activeTask;
  const parsed = parseAgentResult(state.lastAgentText);
  if (!parsed.valid) {
    state.lastAgentResult = "";
    state.lastResultInsertText = "";
    state.lastResultTask = "";
    renderAgentNotes(emptyAgentMeta());
    $("miniReviewText").value = "";
    helperSetStatus("Antwortformat unklar. Nichts wurde ersetzt.", "Prüfung nötig");
    appendChatMessage("assistant", "Das Antwortformat war unklar. Ich habe deshalb nichts ersetzt. Bitte im Chat nachfragen oder die Aktion erneut starten.");
    state.activeTask = "";
    if (!state.activePanel) openPanel("miniChatDrawer");
    return;
  }

  const meta = { ...parsed.meta, changes: [...parsed.meta.changes], unclear: [...parsed.meta.unclear], logicIssues: [...parsed.meta.logicIssues], medicalIssues: [...parsed.meta.medicalIssues] };
  const generatedText = normalizeActionResultText(task, parsed.text);
  const incompleteCorrection = task === "correction" && !likelyCompleteCorrection(state.lastSourceText, generatedText);
  if (incompleteCorrection) meta.unclear = normalizeMetaList(["Das Lektoratsergebnis wirkt unvollständig; es wurde nicht übertragen.", ...meta.unclear]);
  const result = task === "assessment" ? assessmentReviewText(state.lastSourceText, generatedText) : generatedText;
  state.lastAgentResult = result;
  state.lastResultInsertText = generatedText;
  state.lastResultTask = task;
  renderAgentNotes(meta);
  $("miniReviewText").value = result;
  renderReviewDiff(state.lastSourceText, result);
  if (state.activePanel && isWorkspacePanel()) setResultEditorText(result);
  let response = null;
  const appended = task === "assessment";
  const proposal = task === "proposal";
  const manualReview = proposal || incompleteCorrection || Boolean(state.actionSettings?.[task]?.manualReview);
  const operationTarget = state.lastResultTarget;
  const targetUnchanged = Boolean(operationTarget?.windowHandle && state.fieldLocked && sameTargetIdentity(state.focusedTarget, operationTarget));
  const automaticTransferText = appended ? generatedText : result;
  if (targetUnchanged && !manualReview) response = await insertTextIntoField(automaticTransferText, { automatic: true, append: appended, targetOverride: operationTarget, sourceText: state.lastSourceText });
  if (!targetUnchanged && !manualReview && !proposal && fieldAccessMode() === "clipboard" && automaticTransferText) response = await insertTextIntoField(automaticTransferText, { append: appended, sourceText: state.lastSourceText });
  if (manualReview) {
    state.manualReviewPending = true;
    openResultEditor(result);
  }
  if (incompleteCorrection) helperSetStatus("Das Lektoratsergebnis wirkt unvollständig und wurde nicht übertragen. Bitte im Editor prüfen oder die Aktion erneut starten.", "Prüfung nötig");
  const clipboardPrepared = response?.copied === true;
  const transferred = Boolean(response?.ok && !clipboardPrepared);
  const verified = transferred && response.verified === true;
  const unverified = transferred && !verified;
  if (!manualReview && operationTarget?.windowHandle && !targetUnchanged) helperSetStatus("Das Arbeitsfeld wurde während der Anfrage geändert. Nichts wurde übertragen.", "Zielfeld geändert");
  if (!manualReview && !response?.ok && !operationTarget?.windowHandle && fieldAccessMode() !== "clipboard" && !(state.focusedTarget?.windowHandle && state.fieldLocked)) helperSetStatus("Ergebnis bereit. Externes Arbeitsfeld aktivieren.", "Feld fehlt");
  if (proposal) appendChatProposal(result);
  else appendChatMessage("assistant", formatResultMeta(task, meta, {
      activeTarget: targetUnchanged,
      transferred,
      verified,
      unverified,
      replaced: verified && !appended,
      appended: verified && appended,
      manualReview,
      clipboardPrepared,
    }));
  if (transferred) {
    void window.radimoAgent.addWorkflowArtifact({
      kind: verified ? "result" : "draft",
      label: verified ? (appended ? "Beurteilung ergänzt" : "Direkt eingesetzt") : "Übertragung prüfen",
      detail: verified ? (appended ? "Beurteilung im verifizierten externen Zielfeld ergänzt" : "Ergebnis im verifizierten externen Zielfeld ersetzt") : "Übertragung ins externe Zielfeld nicht verifiziert",
      text: result,
    }).catch(() => {});
  } else if (!targetUnchanged) {
    void window.radimoAgent.addWorkflowArtifact({
      kind: "draft",
      label: "Antwortentwurf",
      detail: "Externes Feld nicht aktiviert",
      text: result,
    }).catch(() => {});
  }
  state.activeTask = "";
  setMiniInsertState();
  if (!state.activePanel && !manualReview) openPanel(unverified ? "miniReviewDrawer" : "miniWorkspaceDrawer");
}

function setMiniDictationState(mode) {
  const button = $("miniDictate");
  const icon = $("miniDictateIcon")?.querySelector("use");
  if (!button) return;
  button.classList.toggle("recording", mode === "recording");
  button.classList.toggle("is-ready", mode === "ready");
  if (icon) icon.setAttribute("href", mode === "recording" ? "#icon-stop" : mode === "ready" ? "#icon-insert" : "#icon-mic");
  text("miniDictateLabel", mode === "recording" ? "Stoppen" : mode === "ready" ? "Einsetzen" : "Diktat");
  text("miniDictateHint", mode === "recording" ? "Aufnahme" : mode === "ready" ? "ins Feld" : "starten");
  const label = mode === "recording" ? "Diktataufnahme stoppen" : mode === "ready" ? "Aufgenommenes Diktat ins Arbeitsfeld einsetzen" : "Diktat starten";
  button.title = label;
  button.setAttribute("aria-label", label);
}

function recordingMimeType() {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function resetRecordingUi() {
  $("dictationMonitor")?.classList.add("hidden");
  if ($("dictationLevel")) $("dictationLevel").style.width = "2%";
  text("dictationElapsed", "00:00");
}

function startRecordingMonitor(recording) {
  const monitor = $("dictationMonitor");
  if (!monitor) return;
  monitor.classList.remove("hidden");
  recording.startedAt = performance.now();
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      recording.audioContext = new AudioContext();
      recording.analyser = recording.audioContext.createAnalyser();
      recording.analyser.fftSize = 256;
      recording.audioData = new Uint8Array(recording.analyser.fftSize);
      const source = recording.audioContext.createMediaStreamSource(recording.stream);
      source.connect(recording.analyser);
    }
  } catch { recording.analyser = null; }
  const render = () => {
    if (state.recording !== recording) return;
    const elapsed = Math.floor((performance.now() - recording.startedAt) / 1000);
    text("dictationElapsed", `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`);
    if (recording.analyser) {
      recording.analyser.getByteTimeDomainData(recording.audioData);
      const sum = recording.audioData.reduce((total, value) => total + ((value - 128) / 128) ** 2, 0);
      $("dictationLevel").style.width = `${Math.min(100, Math.max(2, Math.sqrt(sum / recording.audioData.length) * 360))}%`;
    }
    recording.animation = window.requestAnimationFrame(render);
  };
  recording.animation = window.requestAnimationFrame(render);
}

function stopRecordingMonitor(recording) {
  if (recording?.animation) window.cancelAnimationFrame(recording.animation);
  if (recording?.audioContext) void recording.audioContext.close().catch(() => {});
  resetRecordingUi();
}

async function miniStartDictation(point = null) {
  if (state.recording?.recorder?.state === "recording") {
    state.recording.recorder.stop();
    return;
  }
  if (state.pendingDictationText.trim()) {
    await insertPendingDictation();
    return;
  }
  const clipboardFallback = fieldAccessMode() === "clipboard";
  const target = state.focusedTarget?.windowHandle ? state.focusedTarget : clipboardFallback ? null : await miniCaptureField({ point });
  if (!target?.windowHandle && !clipboardFallback) {
    helperSetStatus("Zuerst den Cursor im Zielprogramm setzen. Diktat wird erst nach Bestätigung eingesetzt.", "Feld fehlt");
    return;
  }
  await refreshOpenAIStatus();
  if (!state.openAIConfigured) {
    openSettings();
    helperSetStatus("Für Diktat zuerst einen OpenAI-API-Schlüssel hinterlegen.", "Einrichtung nötig");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    helperSetStatus("Diese Windows-Laufzeit kann kein Mikrofon aufnehmen.", "Nicht verfügbar");
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true }, video: false });
    const mimeType = recordingMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const recording = { recorder, stream, chunks: [], timer: null, cancelled: false, target: target ? { ...target } : null };
    state.recording = recording;
    recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) recording.chunks.push(event.data); });
    recorder.addEventListener("error", (event) => helperSetStatus(`Mikrofonfehler: ${event.error?.message || "Aufnahme abgebrochen"}`, "Prüfung nötig"));
    recorder.addEventListener("stop", async () => {
      window.clearTimeout(recording.timer);
      for (const track of stream.getTracks()) track.stop();
      stopRecordingMonitor(recording);
      state.recording = null;
      if (recording.cancelled) { setMiniDictationState("idle"); helperSetStatus("Diktat verworfen. Das Arbeitsfeld blieb unverändert.", "Abgebrochen"); return; }
      if (!recording.chunks.length) { setMiniDictationState("idle"); helperSetStatus("Keine Audiodaten aufgenommen.", "Leer"); return; }
      helperSetStatus("Diktat wird transkribiert…", "Transkription");
      try {
        const blob = new Blob(recording.chunks, { type: recorder.mimeType || "audio/webm" });
        const result = await window.radimoAgent.transcribeAudio({
          bytes: await blob.arrayBuffer(),
          mimeType: blob.type,
          prompt: configuredActionPrompt("dictation").replaceAll(TEXT_BLOCK_TOKEN, "").trim(),
        });
        state.pendingDictationText = String(result.text || "").trim();
        state.helperSourceText = state.pendingDictationText;
        state.pendingDictationTarget = state.pendingDictationText && recording.target ? { ...recording.target } : null;
        setMiniDictationState(state.pendingDictationText ? "ready" : "idle");
        syncDiscussionScope();
        helperSetStatus(
          state.pendingDictationText
            ? recording.target
              ? "Diktat bereit. Einsetzen bleibt eine separate Bestätigung."
              : "Diktat bereit. Beim Einsetzen wird der Text kopiert; im RIS/DMO am Cursor mit Strg+V einfügen."
            : "Leere Transkription erhalten.",
          state.pendingDictationText ? "Einfügen bereit" : "Leer",
        );
      } catch (error) {
        setMiniDictationState("idle");
        helperSetStatus(error.message || "Diktat konnte nicht transkribiert werden.", "Prüfung nötig");
      }
    });
    recorder.start(1000);
    startRecordingMonitor(recording);
    recording.timer = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 120000);
    setMiniDictationState("recording");
    helperSetStatus("Mikrofon aktiv. Erneut klicken zum Stoppen; Grenze: 2 Minuten.", "Aufnahme");
  } catch (error) {
    if (stream) for (const track of stream.getTracks()) track.stop();
    stopRecordingMonitor(state.recording);
    state.recording = null;
    setMiniDictationState("idle");
    helperSetStatus(error.name === "NotAllowedError" ? "Mikrofonzugriff abgelehnt. Windows-Datenschutz prüfen." : (error.message || "Mikrofon konnte nicht gestartet werden."), "Prüfung nötig");
  }
}

function fieldMapperTargetRule() {
  const rules = Array.isArray(state.fieldMapperProfile?.include) ? state.fieldMapperProfile.include : [];
  return rules.find((rule) => rule.key === "report")
    || rules.find((rule) => rule.key === "summary")
    || rules.find((rule) => rule.patterns?.some((pattern) => /befund|report|impression|beurteil/i.test(pattern)))
    || rules[0]
    || null;
}

function fieldMapperTargetLabel() {
  return fieldMapperTargetRule()?.label || "Befund";
}

function sameFieldMapperTarget(left, right) {
  if (!left || !right) return false;
  if (left.windowHandle && right.windowHandle && String(left.windowHandle) !== String(right.windowHandle)) return false;
  if (left.nativeWindowHandle && right.nativeWindowHandle) return String(left.nativeWindowHandle) === String(right.nativeWindowHandle);
  if (left.runtimeId && right.runtimeId) return String(left.runtimeId) === String(right.runtimeId);
  if (left.automationId && right.automationId) return String(left.automationId) === String(right.automationId);
  return Boolean(left.label && right.label && left.label === right.label && left.controlType === right.controlType);
}

function fieldMapperTargetFromField(report, field, rule) {
  return {
    windowHandle: String(field?.windowHandle || report?.source?.windowHandle || ""),
    processId: Number(field?.processId || report?.source?.processId) || 0,
    controlWindowHandle: Number(field?.nativeWindowHandle) || 0,
    nativeWindowHandle: Number(field?.nativeWindowHandle) || 0,
    runtimeId: String(field?.runtimeId || ""),
    automationId: String(field?.automationId || ""),
    controlType: String(field?.controlType || ""),
    name: String(field?.name || ""),
    title: String(field?.name || field?.label || ""),
    fieldMapperKey: String(rule?.key || ""),
    fieldMapperLabel: String(rule?.label || field?.label || "Befund"),
    replaceAll: true,
  };
}

function preferredFieldMapperMatch(report) {
  const rule = fieldMapperTargetRule();
  if (!rule) return { rule: null, candidates: [] };
  const candidates = (Array.isArray(report?.fields) ? report.fields : []).filter((field) => !field.excluded && !field.isPassword && !field.isOffscreen && field.isEnabled !== false && field.matches?.some((match) => match.key === rule.key));
  return { rule, candidates };
}

function loadFieldMapperPreferences() {
  let stored = {};
  try { stored = JSON.parse(window.localStorage.getItem(FIELD_MAPPER_PREFERENCE_STORAGE_KEY) || "{}"); } catch { stored = {}; }
  state.fieldMapperAutoTarget = state.experimentalUia && stored.autoTarget === true;
  const toggle = $("fieldMapperAutoTarget");
  if (toggle) toggle.checked = state.fieldMapperAutoTarget;
}

function loadFieldAccessPreference() {
  // UIA is never restored from storage. It must be enabled and selected again
  // for the current session, so an old preference cannot trigger automation
  // after an update.
  state.fieldAccessMode = "clipboard";
  const select = $("fieldAccessMode");
  if (select) select.value = state.fieldAccessMode;
  text("fieldAccessStatus", fieldAccessDescription());
}

function applyFieldAccessCapabilities(payload = {}) {
  const enabled = payload?.experimentalUia === true;
  const previousMode = state.fieldAccessMode;
  state.experimentalUia = enabled;
  const select = $("fieldAccessMode");
  const option = select?.querySelector('option[value="uia"]');
  if (option) {
    option.hidden = !enabled;
    option.disabled = !enabled;
  }
  for (const id of ["scanFieldMapper", "inspectFieldMapper", "fieldMapperAutoTarget"]) {
    const control = $(id);
    if (control) control.disabled = !enabled;
  }
  const fieldMapperMenu = $("miniContextFieldMapper");
  if (fieldMapperMenu) fieldMapperMenu.classList.toggle("hidden", !enabled);
  if (!enabled && previousMode === "uia") releaseUiaTargetForClipboard();
  state.fieldAccessMode = normalizeFieldAccessMode(state.fieldAccessMode);
  if (select) select.value = state.fieldAccessMode;
  text("fieldAccessStatus", enabled
    ? fieldAccessDescription()
    : "Zwischenablage-Modus aktiv. DMO/RIS-Text markieren, Strg+C drücken und ausdrücklich übernehmen; Ergebnisse werden bewusst zurückkopiert.");
  if (!enabled) text("fieldMapperStatus", "UIA-Feldsuche ist im normalen ReportHalo-Build nicht enthalten. DMO/RIS-Text bitte markieren, Strg+C drücken und ausdrücklich übernehmen.");
  if (!enabled) text("fieldMapperTargetStatus", "Zwischenablage und Drag-and-drop bleiben verfügbar.");
  updateFieldAccessUi();
}

function saveFieldAccessPreference(value) {
  const previousMode = fieldAccessMode();
  state.fieldAccessMode = normalizeFieldAccessMode(value);
  const persistedMode = state.fieldAccessMode === "uia" ? "clipboard" : state.fieldAccessMode;
  try { window.localStorage.setItem(FIELD_ACCESS_STORAGE_KEY, JSON.stringify({ mode: persistedMode })); } catch { /* optional preference */ }
  const select = $("fieldAccessMode");
  if (select) select.value = state.fieldAccessMode;
  text("fieldAccessStatus", fieldAccessDescription());
  updateFieldAccessUi();
  if (state.fieldAccessMode === "clipboard" && previousMode !== "clipboard" && hasLockedTarget()) {
    releaseUiaTargetForClipboard();
    helperSetStatus("UIA-Zielfeld gelöst. DMO/RIS-Text jetzt kopieren und ausdrücklich übernehmen.", "Zwischenablage");
  } else if (value === "uia" && state.fieldAccessMode !== "uia") {
    helperSetStatus("UIA-Feldzugriff ist in diesem Build deaktiviert. Zwischenablage verwenden.", "Zwischenablage");
  }
}

function saveFieldMapperPreferences() {
  try { window.localStorage.setItem(FIELD_MAPPER_PREFERENCE_STORAGE_KEY, JSON.stringify({ autoTarget: state.fieldMapperAutoTarget })); } catch { /* optional preference */ }
}

function fieldMapperPrompt() {
  const report = state.fieldMapReport;
  if (!report || !$("useFieldMapper")?.checked) return "";
  const groups = (report.groups || []).filter((group) => state.fieldMapSelectedKeys.has(group.key) && group.values?.length);
  if (!groups.length) return "";
  const blocks = groups.map((group) => `${group.label}:\n${group.values.join("\n\n")}`);
  return [
    "[EXPLICITLY ATTACHED READ-ONLY RIS CONTEXT]",
    "The following values were read from configured text fields of the active application. Use them only as case context. Do not infer missing values and do not treat field labels as findings.",
    blocks.join("\n\n"),
    "[/EXPLICITLY ATTACHED READ-ONLY RIS CONTEXT]",
  ].join("\n");
}

function syncFieldMapperAttachment() {
  const toggle = $("useFieldMapper");
  const hasValues = Boolean(state.fieldMapReport?.groups?.some((group) => group.values?.length));
  if (!toggle) return;
  toggle.disabled = !hasValues;
  if (!hasValues) toggle.checked = false;
}

function fieldMapperFieldLabel(field) {
  const label = field?.label || field?.name || field?.labeledBy || field?.automationId || "Unbenanntes Textfeld";
  const identity = [field?.automationId, field?.controlType, field?.frameworkId].filter(Boolean).join(" · ");
  return identity ? `${label} · ${identity}` : label;
}

function renderFieldMapperReport(report) {
  const previousReport = state.fieldMapReport;
  state.fieldMapReport = report || null;
  if (!report || report !== previousReport) state.fieldMapperAutoSelection = null;
  state.fieldMapSelectedKeys = new Set((report?.groups || []).map((group) => group.key));
  syncFieldMapperAttachment();
  const autoToggle = $("fieldMapperAutoTarget");
  if (autoToggle) autoToggle.checked = state.fieldMapperAutoTarget;
  const targetStatus = $("fieldMapperTargetStatus");
  if (targetStatus) targetStatus.textContent = state.fieldMapperAutoSelection
    ? `Auto-Ziel: ${state.fieldMapperAutoSelection.label} · Drag-and-drop bleibt verfügbar.`
    : "Auto-Ziel nur bei eindeutiger Zuordnung; Drag-and-drop bleibt immer verfügbar.";
  const list = $("fieldMapperItems");
  if (!list) return;
  list.replaceChildren();
  if (!report) {
    text("fieldMapperStatus", "Nur nach ausdrücklichem Klick: blendet den Helper kurz aus und prüft den UIA-Baum des aktiven Fensters. Identitätsfelder werden ausgeschlossen.");
    return;
  }
  const diagnostics = report.diagnostics || {};
  const appName = report.source?.processName || "aktives Fenster";
  const mode = diagnostics.readValues ? "Kontext gelesen" : "Felder geprüft";
  const accessNote = diagnostics.strategy === "uia-only" ? " · UIA-only" : "";
  const unavailableNote = diagnostics.inaccessibleFields ? ` · ${diagnostics.inaccessibleFields} nicht lesbar` : "";
  text("fieldMapperStatus", `${mode}: ${appName} · ${diagnostics.matchedFields || 0} Treffer · ${report.groups?.length || 0} Gruppen · ${diagnostics.excludedFields || 0} ausgeschlossen${unavailableNote}${diagnostics.truncated ? " · Liste begrenzt" : ""}${accessNote}.`);
  const configured = Array.isArray(report.configuredGroups) ? report.configuredGroups : [];
  for (const configuredGroup of configured) {
    const group = report.groups?.find((item) => item.key === configuredGroup.key);
    const article = document.createElement("article");
    article.className = "field-mapper-group";
    const head = document.createElement("div");
    head.className = "field-mapper-group-head";
    const label = document.createElement("label");
    label.className = "context-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.fieldMapSelectedKeys.has(configuredGroup.key);
    checkbox.disabled = !group?.values?.length;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.fieldMapSelectedKeys.add(configuredGroup.key);
      else state.fieldMapSelectedKeys.delete(configuredGroup.key);
    });
    const labelText = document.createElement("span");
    labelText.textContent = configuredGroup.label;
    label.append(checkbox, labelText);
    const count = document.createElement("small");
    count.textContent = group?.values?.length ? `${group.values.length} Wert${group.values.length === 1 ? "" : "e"}` : configuredGroup.fieldCount ? `${configuredGroup.fieldCount} Feld${configuredGroup.fieldCount === 1 ? "" : "er"} · leer` : "nicht gefunden";
    head.append(label, count);
    article.append(head);
    if (group?.values?.length) {
      for (const value of group.values.slice(0, 3)) {
        const valueNode = document.createElement("div");
        valueNode.className = "field-mapper-value";
        valueNode.textContent = value.length > 700 ? `${value.slice(0, 700)}…` : value;
        article.append(valueNode);
      }
    }
    list.append(article);
  }
  const allFields = Array.isArray(report.fields) ? report.fields : [];
  if (allFields.length) {
    const details = document.createElement("details");
    details.className = "field-mapper-all";
    const summary = document.createElement("summary");
    summary.textContent = `Alle erkannten Textfelder (${allFields.length})`;
    details.append(summary);
    const fieldList = document.createElement("div");
    fieldList.className = "field-mapper-all-list";
    for (const field of allFields) {
      const item = document.createElement("div");
      const isAutoTarget = sameFieldMapperTarget(field, state.fieldMapperAutoSelection?.field);
      item.className = `field-mapper-field${field.excluded ? " is-excluded" : field.matches?.length ? " is-matched" : ""}${isAutoTarget ? " is-auto-target" : ""}`;
      const title = document.createElement("strong");
      title.textContent = fieldMapperFieldLabel(field);
      const note = document.createElement("small");
      const matches = field.matches?.map((match) => match.label || match.key).join(", ");
      note.textContent = isAutoTarget ? "aktuelles Auto-Ziel · fokussiert" : field.excluded ? "ausgeschlossen" : matches ? `zugeordnet: ${matches}` : field.isPassword ? "geschütztes Feld" : "nicht zugeordnet · Inhalt nicht gelesen";
      item.append(title, note);
      fieldList.append(item);
    }
    details.append(fieldList);
    list.append(details);
  }
}

async function loadFieldMapperConfig() {
  try {
    const profile = await window.radimoAgent.getFieldMapperStatus();
    state.fieldMapperProfile = profile;
    $("fieldMapperInclude").value = profile?.includeText || FIELD_MAPPER_DEFAULT_INCLUDE;
    $("fieldMapperExclude").value = profile?.excludeText || FIELD_MAPPER_DEFAULT_EXCLUDE;
  } catch (error) {
    state.fieldMapperProfile = null;
    $("fieldMapperInclude").value = FIELD_MAPPER_DEFAULT_INCLUDE;
    $("fieldMapperExclude").value = FIELD_MAPPER_DEFAULT_EXCLUDE;
    text("fieldMapperStatus", error.message || "Feldzuordnung konnte nicht geladen werden.");
  }
}

async function saveFieldMapperConfig({ silent = false } = {}) {
  try {
    const profile = await window.radimoAgent.setFieldMapperConfig({
      includeText: $("fieldMapperInclude")?.value || "",
      excludeText: $("fieldMapperExclude")?.value || "",
    });
    state.fieldMapperProfile = profile;
    if (!silent) {
      renderFieldMapperReport(null);
      text("fieldMapperStatus", "Feldzuordnung gespeichert. UIA-Diagnose nur nach ausdrücklichem Klick starten.");
      showToast("RIS-Feldzuordnung gespeichert.");
    }
    return profile;
  } catch (error) {
    text("fieldMapperStatus", error.message || "Feldzuordnung konnte nicht gespeichert werden.");
    return null;
  }
}

async function resetFieldMapperConfig() {
  $("fieldMapperInclude").value = FIELD_MAPPER_DEFAULT_INCLUDE;
  $("fieldMapperExclude").value = FIELD_MAPPER_DEFAULT_EXCLUDE;
  await saveFieldMapperConfig();
}

async function autoSelectMappedField({ reportOverride = null } = {}) {
  if (!state.experimentalUia || fieldAccessMode() !== "uia") {
    text("fieldMapperTargetStatus", "UIA-Auto-Ziel ist in dieser Produktionsversion deaktiviert. Drag-and-drop und Zwischenablage bleiben verfügbar.");
    helperSetStatus("Keine UIA-Feldsuche gestartet. DMO/RIS-Text bitte kopieren oder per Drag-and-drop übernehmen.", "Zwischenablage empfohlen");
    return null;
  }
  if (state.fieldMapperAutoSelecting) return null;
  state.fieldMapperAutoSelecting = true;
  try {
    const report = reportOverride || await scanFieldMapper({ readValues: false, autoSelect: false });
    if (!report?.ok) return null;
    if (report !== state.fieldMapReport) renderFieldMapperReport(report);
    const { rule, candidates } = preferredFieldMapperMatch(report);
    if (!rule) {
      text("fieldMapperTargetStatus", "Keine Auto-Zielregel konfiguriert. Drag-and-drop bleibt verfügbar.");
      helperSetStatus("Keine Feldregel für ein Auto-Ziel vorhanden. Das Feld per Drag-and-drop oder Target-Auswahl aktivieren.", "Manuell wählen");
      return null;
    }
    if (candidates.length !== 1) {
      const detail = candidates.length ? `${candidates.length} mögliche ${rule.label}-Felder gefunden` : `Kein ${rule.label}-Feld gefunden`;
      text("fieldMapperTargetStatus", `${detail}. Drag-and-drop bleibt verfügbar.`);
      helperSetStatus(`${detail}. Bitte das gewünschte Feld per Drag-and-drop oder Target-Auswahl festlegen.`, "Manuell wählen");
      return null;
    }
    const field = candidates[0];
    const mappedTarget = fieldMapperTargetFromField(report, field, rule);
    await window.radimoAgent.setHelperFocusable(false);
    try {
      const diagnosticAccessMode = "uia";
      const focused = await window.radimoAgent.focusMappedField({ windowHandle: mappedTarget.windowHandle, target: { ...mappedTarget, accessMode: diagnosticAccessMode } });
      if (!focused?.ok || !focused.verified) {
        helperSetStatus(`${rule.label}-Feld gefunden, aber der Fokus konnte nicht sicher bestätigt werden.`, "Prüfung nötig");
        return null;
      }
      const read = await window.radimoAgent.readFocusedField({
        windowHandle: mappedTarget.windowHandle,
        processId: mappedTarget.processId,
        controlWindowHandle: mappedTarget.controlWindowHandle,
        accessMode: diagnosticAccessMode,
      });
      if (!read?.ok) {
        helperSetStatus(`${rule.label}-Feld fokussiert, aber der vollständige Feldinhalt konnte nicht gelesen werden.`, "Prüfung nötig");
        return null;
      }
      const target = rememberFocusedField({
        ...read,
        ...mappedTarget,
        text: read.text,
        hash: read.hash,
        strategy: read.strategy,
        approximate: read.approximate,
        supportsWrite: read.supportsWrite !== false,
        replaceAll: true,
      }, { preserveFieldMap: true, accessMode: diagnosticAccessMode });
      if (!target) return null;
      state.fieldMapperAutoSelection = { key: rule.key, label: rule.label, field };
      renderFieldMapperReport(state.fieldMapReport);
      renderMiniTarget();
      helperSetStatus(`${rule.label}-Feld automatisch gewählt · vollständiger Feldtext geladen.`, "Auto-Ziel");
      return target;
    } finally {
      void window.radimoAgent.setHelperFocusable(Boolean(state.activePanel) || state.settingsOpen);
    }
  } finally {
    state.fieldMapperAutoSelecting = false;
  }
}

async function scanFieldMapper({ readValues = true, autoSelect = false } = {}) {
  if (state.fieldMapperBusy) return;
  if (!state.experimentalUia || fieldAccessMode() !== "uia") {
    const message = "Zwischenablage-Modus aktiv. Keine UIA-Diagnose gestartet. DMO/RIS-Text markieren, Strg+C drücken und ausdrücklich übernehmen.";
    text("fieldMapperStatus", message);
    helperSetStatus(message, "Zwischenablage empfohlen");
    return null;
  }
  state.fieldMapperBusy = true;
  const button = $(readValues ? "scanFieldMapper" : "inspectFieldMapper");
  if (button) button.disabled = true;
  text("fieldMapperStatus", readValues ? "Konfigurierte UIA-Felder werden gelesen…" : "UIA-Textfelder des aktiven Fensters werden gesucht…");
  try {
    const profile = await saveFieldMapperConfig({ silent: true });
    if (!profile) return;
    const target = state.focusedTarget?.windowHandle ? state.focusedTarget : null;
    const report = await window.radimoAgent.scanFieldWindow({
      windowHandle: target?.windowHandle || "",
      target,
      accessMode: "uia",
      readValues,
    });
    if (!report?.ok) {
      renderFieldMapperReport(null);
      text("fieldMapperStatus", report?.error === "helper-window" ? "Zuerst ein RIS-/Editorfenster aktivieren, dann erneut prüfen." : report?.error || "Aktives Fenster konnte nicht gelesen werden.");
      helperSetStatus("RIS-Feldinspektor konnte das Fenster nicht lesen.", "Prüfung nötig");
      return;
    }
    renderFieldMapperReport(report);
    if (!readValues && autoSelect) void autoSelectMappedField({ reportOverride: report });
    if (readValues && report.groups?.length) {
      $("useFieldMapper").checked = false;
      showToast(`${report.groups.length} RIS-Kontextgruppen bereit.`);
    }
    return report;
  } catch (error) {
    renderFieldMapperReport(null);
    text("fieldMapperStatus", error.message || "RIS-Felder konnten nicht gelesen werden.");
    helperSetStatus("RIS-Feldinspektor fehlgeschlagen.", "Prüfung nötig");
  } finally {
    state.fieldMapperBusy = false;
    if (button) button.disabled = false;
  }
}

async function copyFieldMapperReport() {
  const value = state.fieldMapReport?.reportText;
  if (!value) return;
  try { await window.radimoAgent.writeClipboard(value); showToast("Feldmapper-Bericht kopiert."); } catch (error) { text("fieldMapperStatus", error.message || "Feldmapper-Bericht konnte nicht kopiert werden."); }
}

function contextPrompt() {
  const blocks = [];
  if (state.contextReport && $("useContext")?.checked) {
    const items = state.contextReport.items.map((item) => `### ${item.relation} · ${item.section} · ${item.name}\n${item.content || item.preview}`).join("\n\n");
    blocks.push(`[EXPLICITLY ATTACHED LOCAL CONTEXT]\n${items}\n[/EXPLICITLY ATTACHED LOCAL CONTEXT]`);
  }
  const mapped = fieldMapperPrompt();
  if (mapped) blocks.push(mapped);
  return blocks.length ? `\n\n${blocks.join("\n\n")}` : "";
}

function referencePrompt() {
  if (!state.referencePack.length || !$("useLocalReferences")?.checked) return "";
  const readable = state.referencePack.filter((item) => item.status === "ready" && item.content);
  if (!readable.length) return "";
  const blocks = readable.map((item) => item.sourceType === "clinic" && item.prompt ? item.prompt : [
    `### ${item.sourceType === "web" ? "WEB REFERENCE" : "LOCAL REFERENCE"} · ${item.name || item.url}`,
    item.sourceType === "web" ? `Source URL: ${item.url}` : `Source filename: ${item.name}`,
    item.content,
    `### END REFERENCE · ${item.name || item.url}`,
  ].join("\n"));
  return `\n\n[EXPLICITLY ATTACHED LOCAL RADIOLOGY REFERENCES]\nUse only the readable text below as local reference material. Do not claim to have read a metadata-only or binary file.\n${blocks.join("\n\n")}\n[/EXPLICITLY ATTACHED LOCAL RADIOLOGY REFERENCES]`;
}

function renderClinicCatalog(catalog) {
  state.clinicCatalog = catalog || { root: null, clinics: [] };
  const select = $("clinicSelect");
  const clinics = state.clinicCatalog.clinics || [];
  if (!select) return;
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
  } else state.selectedClinicId = "";
  text("clinicSourceBadge", clinics.length ? `${clinics.length} Klinik${clinics.length === 1 ? "" : "en"}` : "Keine");
  text("clinicRootStatus", state.clinicCatalog.root ? `Ordner: ${state.clinicCatalog.root}` : "Kein Klinikordner");
  const list = $("clinicSourceItems");
  if (!list) return;
  list.replaceChildren();
  const clinic = clinics.find((item) => item.id === state.selectedClinicId);
  if (!clinic) { list.textContent = "Keine Klinik ausgewählt oder noch keine PDFs in sources/."; return; }
  if (!clinic.sources.length) { list.textContent = "Keine PDFs in diesem Klinikordner."; return; }
  for (const source of clinic.sources) {
    const node = document.createElement("article");
    node.className = "clinic-source-item";
    node.innerHTML = "<strong></strong><small></small><div class=\"reference-actions\"></div>";
    node.querySelector("strong").textContent = source.name;
    node.querySelector("small").textContent = `${source.relativePath} · ${Math.round(source.size / 1024)} KB`;
    const actions = node.querySelector(".reference-actions");
    const read = document.createElement("button");
    read.className = "mini-panel-button";
    read.type = "button";
    read.textContent = source.status === "referenced" ? "Erneut lesen" : "Lesen";
    read.addEventListener("click", () => { void readClinicSource(source); });
    actions.append(read);
    list.append(node);
  }
}

async function loadClinicSources() {
  try { renderClinicCatalog(await window.radimoAgent.getClinicSources()); } catch (error) { text("clinicRootStatus", error.message || "Klinikquellen nicht verfügbar"); }
}

async function loadWritingResources() {
  try {
    const [profile, library] = await Promise.all([window.radimoAgent.getGuidanceStatus(), window.radimoAgent.getTemplateStatus()]);
    text("guidanceBadge", profile?.label || "Deutsch / Latein");
    const select = $("templateSelect");
    if (select) {
      select.replaceChildren();
      for (const template of library?.templates || []) {
        const option = document.createElement("option");
        option.value = template.id;
        option.textContent = template.label;
        select.append(option);
      }
    }
    text("templateStatus", `${library?.templates?.length || 0} Vorlage(n) bereit.`);
  } catch (error) {
    text("guidanceStatus", error.message || "Schreibprofil konnte nicht geladen werden.");
  }
}

async function chooseClinicRoot() {
  try {
    const catalog = await window.radimoAgent.chooseClinicSourceRoot();
    if (catalog) { renderClinicCatalog(catalog); showToast("Klinikquellen aktualisiert."); }
  } catch (error) { text("clinicRootStatus", error.message || "Klinikordner konnte nicht gewählt werden."); }
}

async function openClinicRoot() {
  try { await window.radimoAgent.openClinicSourceRoot(); } catch (error) { text("clinicRootStatus", error.message || "Klinikordner konnte nicht geöffnet werden."); }
}

async function readClinicSource(source) {
  text("clinicRootStatus", `${source.name} wird gelesen…`);
  try {
    const item = await window.radimoAgent.readClinicSource({ clinicId: state.selectedClinicId, sourcePath: source.path });
    if (item.status !== "ready" || !item.content) { renderClinicCatalog(item.catalog); showToast("PDF konnte nicht als Text gelesen werden."); return; }
    state.referencePack = [...state.referencePack.filter((entry) => entry.path !== item.path), { ...item, sourceType: "clinic" }];
    renderReferences(state.referencePack);
    $("useLocalReferences").checked = false;
    renderClinicCatalog(item.catalog);
    showToast("Quelle gelesen und für die nächste Anfrage bereit.");
  } catch (error) { text("clinicRootStatus", error.message || "Klinikquelle konnte nicht gelesen werden."); }
}

function renderReferences(pack) {
  state.referencePack = Array.isArray(pack) ? pack : [];
  const readable = state.referencePack.filter((item) => item.status === "ready" && item.content).length;
  const toggle = $("useLocalReferences");
  if (toggle) { toggle.disabled = readable === 0; if (!readable) toggle.checked = false; }
  if ($("clearReferences")) $("clearReferences").disabled = state.referencePack.length === 0;
  text("referenceBadge", state.referencePack.length ? `${readable} bereit` : "Keine");
  const list = $("referenceItems");
  if (list) { list.replaceChildren(); for (const item of state.referencePack) { const node = document.createElement("div"); node.textContent = `${item.name || item.url} · ${item.status}`; list.append(node); } }
  text("referenceStatus", state.referencePack.length ? `${readable} lesbare Quelle(n) bereit.` : "Keine lokalen Quellen ausgewählt.");
}

async function chooseReferences() {
  try { const pack = await window.radimoAgent.chooseReferences(); if (pack) { renderReferences(pack); showToast("Lokale Quellen aktualisiert."); } } catch (error) { text("referenceStatus", error.message || "Quellen konnten nicht ausgewählt werden."); }
}

async function fetchReferenceUrl() {
  const input = $("referenceUrl");
  const url = input?.value.trim();
  if (!url) return;
  try { const reference = await window.radimoAgent.fetchReferenceUrl(url); renderReferences([...state.referencePack, reference]); input.value = ""; showToast("Quelle für die nächste Anfrage bereit."); } catch (error) { text("referenceStatus", error.message || "Quelle konnte nicht geladen werden."); }
}

function clearReferences() {
  renderReferences([]);
}

async function captureScreen() {
  text("screenCaptureStatus", "Bildschirmbereich auswählen…");
  try {
    const result = await window.radimoAgent.captureScreen();
    if (!result?.ok) { text("screenCaptureStatus", "Aufnahme abgebrochen."); return; }
    const previousPath = state.screenCapture?.path;
    state.screenCapture = result;
    if (previousPath && previousPath !== result.path) void window.radimoAgent.releaseScreenCapture(previousPath).catch(() => {});
    $("screenCapturePreview").src = result.dataUrl;
    $("screenCapturePreview").classList.remove("hidden");
    $("copyScreenCapture").disabled = false;
    $("useScreenCapture").disabled = false;
    text("screenCaptureBadge", `${result.width} × ${result.height}`);
    text("screenCaptureStatus", "Lokal erfasst. Vor dem Senden prüfen.");
  } catch (error) { text("screenCaptureStatus", error.message || "Bildschirmaufnahme fehlgeschlagen."); }
}

async function copyScreenCapture() {
  if (!state.screenCapture?.dataUrl) return;
  try { await window.radimoAgent.copyScreenCapture(state.screenCapture.dataUrl); showToast("Bildschirmaufnahme kopiert."); } catch (error) { text("screenCaptureStatus", error.message || "Bild konnte nicht kopiert werden."); }
}

function isApiBackend() {
  return state.backend === "api";
}

function applyBackendUi(status = {}) {
  if (status.backend) state.backend = status.backend;
  if (status.provider) state.apiProvider = status.provider;
  const api = isApiBackend();
  const separateDictation = api && status.provider === "azure";
  state.apiConfigLocks = { provider: Boolean(status.providerLocked), authMode: Boolean(status.authModeLocked), endpoint: Boolean(status.endpointLocked), model: Boolean(status.modelLocked), audioDeployment: Boolean(status.audioDeploymentLocked) };
  $("agentApiConfigFields")?.classList.toggle("hidden", !api);
  const azure = api && status.provider === "azure";
  $("agentApiAuthModeField")?.classList.toggle("hidden", !azure);
  $("agentApiAudioDeploymentField")?.classList.toggle("hidden", !separateDictation);
  $("agentDictationPanel")?.classList.toggle("hidden", !separateDictation);
  $("usageBudgetPanel")?.classList.toggle("hidden", !api);
  $("loginButton")?.classList.toggle("hidden", api);
  text("loginTitle", api ? "API-Verbindung" : "AI und Diktat");
  text("connectionNote", api
    ? "Text und Diktat laufen über die direkte API. OpenAI und Azure OpenAI werden unterstützt; Azure kann ein eigenes Audio-Deployment nutzen und bietet einen OpenAI-Key als Fallback."
    : "Textfunktionen verwenden die lokale ChatGPT-Anmeldung. Für Mikrofon-Diktat wird separat ein OpenAI-API-Schlüssel benötigt.");
  text("logoutButton", api ? "API-Key entfernen" : "Abmelden");
  text("openaiApiLabel", api ? `${status.provider === "azure" ? "Azure OpenAI" : "OpenAI API"} · Text` : "OpenAI API · Diktat");
  text("saveOpenAIKey", api ? "Key speichern" : "Sicher speichern");
  text("testOpenAIReadiness", api ? "API & Mikrofon testen" : "Diktatbereitschaft testen");
  $("openOpenAIKeys")?.classList.toggle("hidden", api && status.provider === "azure");
  if ($("openaiApiKey")) $("openaiApiKey").placeholder = api && status.provider === "azure" ? "Azure-Key oder Bearer-Token…" : "sk-…";
  if ($("agentApiProvider") && status.provider) $("agentApiProvider").value = status.provider;
  if ($("agentApiAuthMode") && azure && status.authMode && document.activeElement !== $("agentApiAuthMode")) $("agentApiAuthMode").value = status.authMode;
  if ($("agentApiEndpoint") && status.endpoint !== undefined && document.activeElement !== $("agentApiEndpoint")) $("agentApiEndpoint").value = status.endpoint;
  if ($("agentApiModel") && status.model !== undefined && document.activeElement !== $("agentApiModel")) $("agentApiModel").value = status.model;
  if ($("agentApiAudioDeployment") && status.audioDeployment !== undefined && document.activeElement !== $("agentApiAudioDeployment")) $("agentApiAudioDeployment").value = status.audioDeployment;
  if ($("agentApiProvider")) $("agentApiProvider").disabled = !api || state.apiConfigLocks.provider;
  if ($("agentApiAuthMode")) $("agentApiAuthMode").disabled = !azure || state.apiConfigLocks.authMode;
  if ($("agentApiEndpoint")) $("agentApiEndpoint").disabled = !api || state.apiConfigLocks.endpoint;
  if ($("agentApiModel")) $("agentApiModel").disabled = !api || state.apiConfigLocks.model;
  if ($("agentApiAudioDeployment")) $("agentApiAudioDeployment").disabled = !separateDictation || state.apiConfigLocks.audioDeployment;
}

function formatTokenCount(value) {
  return Math.max(0, Number(value) || 0).toLocaleString("de-DE");
}

function renderUsageStatus(usage) {
  if (!usage?.enabled) {
    text("usageBudgetStatus", usage?.message || "Vom Anbieter verwaltet.");
    return;
  }
  const daily = usage.daily || {};
  const monthly = usage.monthly || {};
  const cost = usage.pricingKnown === false ? "Kosten nicht verlässlich geschätzt" : `ca. €${Number(monthly.estimatedEur || 0).toFixed(2)} (Schätzung)`;
  text("usageBudgetStatus", `Heute ${formatTokenCount(daily.tokens)} / ${formatTokenCount(usage.limits?.dailyTokens)} · Monat ${formatTokenCount(monthly.tokens)} / ${formatTokenCount(usage.limits?.monthlyTokens)} · ${cost}`);
}

async function refreshUsageStatus() {
  try {
    const usage = await window.radimoAgent.getUsageStatus();
    renderUsageStatus(usage);
    return usage;
  } catch (error) {
    text("usageBudgetStatus", error.message || "Budgetstatus nicht verfügbar.");
    return null;
  }
}

async function refreshOpenAIStatus() {
  try {
    if (isApiBackend()) {
      const status = await window.radimoAgent.getAgentApiStatus();
      applyBackendUi(status);
      state.openAIConfigured = Boolean(status?.dictationConfigured ?? status?.configured);
      const provider = status.provider === "azure" ? "Azure OpenAI" : "OpenAI";
      const source = status.source === "environment" ? "Umgebungsvariable" : status.source ? "Windows-verschlüsselt" : "noch nicht eingerichtet";
      const dictation = status?.dictationMode === "azure" ? "Azure-Diktat bereit" : status?.dictationConfigured ? "OpenAI-Diktat bereit" : provider === "Azure OpenAI" ? "Audio-Deployment oder OpenAI-Key fehlt" : "Diktat noch nicht bereit";
      text("openaiApiStatus", status?.configured ? `${provider} bereit · ${status.model || "Deployment fehlt"} · ${source} · ${dictation}` : status?.encryptionAvailable ? "Noch nicht eingerichtet. Der Key wird Windows-verschlüsselt gespeichert." : "Windows-Verschlüsselung nicht verfügbar.");
      if ($("clearOpenAIKey")) $("clearOpenAIKey").disabled = !status?.configured || status.source === "environment";
      if (status.provider === "azure") {
        text("agentDictationStatus", status.dictationMode === "azure" ? `Azure-Diktat bereit · ${status.audioDeployment}` : status.dictationConfigured ? `OpenAI-Diktat bereit · ${status.dictationSource === "environment" ? "Umgebungsvariable" : "Windows-verschlüsselt"}` : status.dictationEncryptionAvailable ? "Audio-Deployment konfigurieren oder separaten OpenAI-Key hinterlegen." : "Windows-Verschlüsselung nicht verfügbar.");
        if ($("clearAgentDictationKey")) $("clearAgentDictationKey").disabled = status.dictationMode !== "openai" || status.dictationSource === "environment";
      }
      renderUsageStatus(status.usage);
      return status;
    }
    const status = await window.radimoAgent.getOpenAIStatus();
    applyBackendUi({ backend: "codex" });
    state.openAIConfigured = Boolean(status?.configured);
    text("openaiApiStatus", status?.configured ? `Diktat bereit · ${status.transcriptionModel} · ${status.source === "environment" ? "Umgebungsvariable" : "Windows-verschlüsselt"}` : status?.encryptionAvailable ? "Noch nicht eingerichtet. Der Schlüssel wird Windows-verschlüsselt gespeichert." : "Windows-Verschlüsselung nicht verfügbar.");
    if ($("clearOpenAIKey")) $("clearOpenAIKey").disabled = !status?.configured || status.source === "environment";
    return status;
  } catch (error) { state.openAIConfigured = false; text("openaiApiStatus", error.message || "API-Status konnte nicht geprüft werden."); return null; }
}

async function saveAgentApiConfig() {
  try {
    const result = await window.radimoAgent.setAgentApiConfig({ provider: $("agentApiProvider")?.value || "openai", authMode: $("agentApiAuthMode")?.value || "api-key", endpoint: $("agentApiEndpoint")?.value.trim() || "", model: $("agentApiModel")?.value.trim() || "", audioDeployment: $("agentApiAudioDeployment")?.value.trim() || "" });
    applyBackendUi(result.status || result);
    await refreshOpenAIStatus();
    await loadModels();
    text("loginStatus", "API-Konfiguration gespeichert.");
  } catch (error) { text("loginStatus", error.message || "API-Konfiguration konnte nicht gespeichert werden."); }
}

async function saveOpenAIKey() {
  const value = $("openaiApiKey")?.value.trim();
  if (!value) { text("openaiApiStatus", "API-Key eingeben."); return; }
  try {
    if (isApiBackend()) await window.radimoAgent.setAgentApiKey({ value, authMode: $("agentApiAuthMode")?.value || "api-key" });
    else await window.radimoAgent.setOpenAIKey(value);
    $("openaiApiKey").value = "";
    await refreshOpenAIStatus();
    await loadModels();
  } catch (error) { text("openaiApiStatus", error.message || "API-Key konnte nicht gespeichert werden."); }
}

async function clearOpenAIKey() {
  try {
    if (isApiBackend()) await window.radimoAgent.clearAgentApiKey();
    else await window.radimoAgent.clearOpenAIKey();
    await refreshOpenAIStatus();
  } catch (error) { text("openaiApiStatus", error.message || "API-Key konnte nicht entfernt werden."); }
}

async function saveAgentDictationKey() {
  const value = $("agentDictationKey")?.value.trim();
  if (!value) { text("agentDictationStatus", "OpenAI-Diktat-Key eingeben."); return; }
  try {
    await window.radimoAgent.setOpenAIKey(value);
    $("agentDictationKey").value = "";
    await refreshOpenAIStatus();
  } catch (error) { text("agentDictationStatus", error.message || "Diktat-Key konnte nicht gespeichert werden."); }
}

async function clearAgentDictationKey() {
  try {
    await window.radimoAgent.clearOpenAIKey();
    await refreshOpenAIStatus();
  } catch (error) { text("agentDictationStatus", error.message || "Diktat-Key konnte nicht entfernt werden."); }
}

async function testOpenAIReadiness() {
  text("openaiApiStatus", isApiBackend() ? "API und Mikrofon werden geprüft…" : "OpenAI-Modellzugriff und Mikrofon werden geprüft…");
  let stream;
  try {
    if (isApiBackend() && state.apiProvider === "azure") {
      const status = await window.radimoAgent.getAgentApiStatus();
      if (!status?.dictationConfigured) throw new Error("Azure OpenAI ist für Text bereit. Für Diktat ein Audio-Deployment oder einen OpenAI-Key hinterlegen.");
    }
    const result = isApiBackend() ? await window.radimoAgent.testAgentApi() : await window.radimoAgent.testOpenAI();
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    text("openaiApiStatus", `Bereit · ${result.model || "API"} erreichbar · Mikrofon „${track?.label || "Windows-Audioeingang"}“ verfügbar.`);
  } catch (error) {
    text("openaiApiStatus", error.name === "NotAllowedError" ? "Mikrofonzugriff abgelehnt. Windows-Datenschutz prüfen." : error.name === "NotFoundError" ? "Kein Mikrofon gefunden." : (error.message || "API-/Diktatbereitschaft konnte nicht geprüft werden."));
  } finally { if (stream) for (const track of stream.getTracks()) track.stop(); }
}

async function refreshShortcutStatus({ retry = false } = {}) {
  try {
    const status = retry ? await window.radimoAgent.retryShortcuts() : await window.radimoAgent.getShortcutStatus();
    if (status.ready) { text("shortcutStatus", "Bereit · Ein/Aus, Diktat und Feld holen sind systemweit registriert."); return status; }
    const names = { toggle: "Ein/Aus", dictation: "Diktat", capture: "Feld holen" };
    const unavailable = Object.entries(status.shortcuts || {}).filter(([, item]) => !item.registered).map(([name]) => names[name] || name);
    text("shortcutStatus", `Belegt: ${unavailable.join(", ") || "unbekannt"}. Andere Versionen schließen und neu prüfen.`);
    return status;
  } catch (error) { text("shortcutStatus", error.message || "Shortcutstatus konnte nicht geprüft werden."); return null; }
}

async function refreshConnection() {
  try {
    const status = await window.radimoAgent.getStatus();
    applyBackendUi(status);
    state.loggedIn = Boolean(status?.authMethod);
    setMiniConnectionState(state.loggedIn);
    if (!state.working) helperSetStatus(state.loggedIn ? "Bereit für das nächste Arbeitsfeld." : isApiBackend() ? "API-Key in den Einstellungen hinterlegen." : "Konto öffnen, um Textfunktionen zu starten.", state.loggedIn ? "Bereit" : "Anmeldung nötig");
    if (isApiBackend()) void refreshUsageStatus();
    return status;
  } catch (error) { setMiniConnectionState(false); if (!state.working) helperSetStatus(error.message || "Lokaler Agent nicht verfügbar.", "Nicht verfügbar"); }
}

async function loadModels() {
  try {
    const result = await window.radimoAgent.listModels();
    state.models = result?.data || [];
    state.selectedModel = preferredModelId(state.models);
  } catch { state.models = []; state.selectedModel = DEFAULT_HELPER_MODEL; }
}

async function login() {
  if (isApiBackend()) { openSettings(); return; }
  text("loginStatus", "Browser-Anmeldung wird geöffnet…");
  try { await window.radimoAgent.startBrowserLogin(); text("loginStatus", "Anmeldung im Browser abschließen und hierher zurückkehren."); } catch (error) { text("loginStatus", error.message || "Anmeldung konnte nicht gestartet werden."); }
}

async function logout() {
  try { await window.radimoAgent.logout(); state.loggedIn = false; await refreshConnection(); text("loginStatus", "Abgemeldet."); } catch (error) { text("loginStatus", error.message || "Abmeldung konnte nicht abgeschlossen werden."); }
}

function contextReportText() {
  const blocks = [];
  if (state.contextReport) {
    const report = state.contextReport;
    blocks.push(["ReportHalo Kontextbericht", `Erstellt: ${report.generatedAt}`, `Anker: ${report.source.path}`, `Strategie: ${report.strategy}`, "", ...report.items.flatMap((item) => [`## ${item.relation} · ${item.section} · ${item.name}`, item.content || item.preview, ""])].join("\n"));
  }
  if (state.fieldMapReport?.reportText) blocks.push(state.fieldMapReport.reportText);
  return blocks.join("\n\n");
}

function renderContext(report) {
  state.contextReport = report;
  text("contextSource", report ? report.source.path : "Keine Quelle");
  $("saveContext").disabled = !report;
  $("copyContext").disabled = !report;
  $("useContext").disabled = !report;
  if (!report) $("useContext").checked = false;
  const selected = report?.items?.find((item) => item.relation === "selected");
  $("copySelectedField").disabled = !selected?.content;
  $("prepareCorrection").disabled = !selected?.content;
  $("selectedField").value = selected?.content || selected?.preview || "";
  const list = $("contextItems");
  list.replaceChildren();
  for (const item of report?.items || []) {
    const node = document.createElement("article");
    node.className = `context-item${item.relation === "selected" ? " selected" : ""}`;
    node.innerHTML = "<div class=\"context-item-head\"><strong></strong><span></span></div><small></small><div class=\"context-preview\"></div>";
    node.querySelector("strong").textContent = `${item.relation} · ${item.section}`;
    node.querySelector("span").textContent = `${item.size} bytes`;
    node.querySelector("small").textContent = item.name;
    node.querySelector(".context-preview").textContent = item.preview;
    list.append(node);
  }
}

async function chooseContext() {
  text("contextStatus", "Quelldatei wählen…");
  try {
    const report = await window.radimoAgent.chooseContextSource();
    if (!report) { text("contextStatus", "Keine Quelle gewählt."); return; }
    renderContext(report);
    $("useContext").checked = false;
    text("contextStatus", `${report.items.length} Nachbarbefunde bereit · Anhängen bitte bewusst aktivieren.`);
    showToast("Kontext ist bereit.");
  } catch (error) { text("contextStatus", error.message || "Kontext konnte nicht gelesen werden."); }
}

async function saveContext() {
  if (!state.contextReport) return;
  try { const result = await window.radimoAgent.saveContextReport(state.contextReport); if (result?.filePath) showToast("Kontextbericht gespeichert."); } catch (error) { text("contextStatus", error.message || "Bericht konnte nicht gespeichert werden."); }
}

async function copyContext() {
  if (!state.contextReport) return;
  try { await window.radimoAgent.writeClipboard(contextReportText()); showToast("Kontextbericht kopiert."); } catch (error) { text("contextStatus", error.message || "Bericht konnte nicht kopiert werden."); }
}

async function copySelectedField() {
  const value = $("selectedField")?.value.trim();
  if (!value) return;
  try { await window.radimoAgent.writeClipboard(value); showToast("Feld kopiert."); } catch (error) { text("contextStatus", error.message || "Feld konnte nicht kopiert werden."); }
}

function prepareCorrection() {
  const selected = $("selectedField")?.value.trim();
  if (!selected) return;
  state.helperSourceText = selected;
  state.pendingDictationText = "";
  if (hasLockedTarget()) {
    helperSetStatus("Fallmaterial wird nicht in das aktive Arbeitsfeld geschrieben. Erst als Textquelle prüfen.", "Prüfung nötig");
    return;
  }
  state.editorMode = "source";
  openPanel("miniEditorDrawer");
  helperSetStatus("Textquelle bereit. Im Chat prüfen.", "Text bereit");
}

async function copyLastResponse() {
  const value = reviewText();
  if (!value) return;
  try { await window.radimoAgent.writeClipboard(value); showToast("Ergebnis kopiert."); } catch (error) { text("miniReviewStatus", error.message || "Ergebnis konnte nicht kopiert werden."); }
}

async function saveCorrectionDraft() {
  const value = reviewText();
  if (!value || !state.contextReport?.source?.path) return;
  try { await window.radimoAgent.saveCorrectionDraft({ sourcePath: state.contextReport.source.path, content: value }); showToast("Geprüfter Entwurf gespeichert."); } catch (error) { text("miniReviewStatus", error.message || "Entwurf konnte nicht gespeichert werden."); }
}

async function copyDiagnostics() {
  try { const result = await window.radimoAgent.copyDiagnostics(); text("logPath", result?.path ? `Lokales Log: ${result.path}` : "Diagnose kopiert."); showToast("Diagnose kopiert."); } catch (error) { text("loginStatus", error.message || "Diagnose konnte nicht kopiert werden."); }
}

async function testConnection() {
  text("loginStatus", isApiBackend() ? "API und Proxy werden geprüft…" : "Proxy und Authentifizierung werden geprüft…");
  try {
    const result = await window.radimoAgent.testConnection();
    if (isApiBackend()) {
      text("loginStatus", `${result.provider === "azure" ? "Azure OpenAI" : "OpenAI"}: ${result.model || "bereit"} · ${result.reachable ? "erreichbar" : "nicht erreichbar"}`);
      return;
    }
    const status = result.authEndpoint?.reachable ? `HTTP ${result.authEndpoint.status}` : result.authEndpoint?.error || "nicht erreichbar";
    text("loginStatus", `Proxy: ${result.proxyRules || "nicht gemeldet"} · auth.openai.com: ${status}`);
  } catch (error) { text("loginStatus", error.message || "Verbindungstest fehlgeschlagen."); }
}

async function applyProxy() {
  try {
    const result = await window.radimoAgent.setProxy({ url: $("proxyOverride").value.trim(), username: $("proxyUsername").value, password: $("proxyPassword").value });
    const message = result.mode === "pac_script"
      ? "PAC-/Setup-Skript angewendet."
      : result.configured
        ? "Proxy angewendet."
        : "Proxy-Override entfernt; Windows-System-/PAC-Einstellung wieder aktiv.";
    text("loginStatus", message);
  } catch (error) { text("loginStatus", error.message || "Proxy konnte nicht geändert werden."); }
}

function openContext() {
  openPanel("contextDrawer");
}

function openResultEditor(value = state.lastAgentResult) {
  const result = String(value || "").trim();
  if (!result) return;
  state.lastAgentResult = result;
  $("miniReviewText").value = result;
  renderReviewDiff(state.lastSourceText, result);
  setResultEditorText(result);
  if (!isWorkspacePanel()) openPanel("miniEditorDrawer");
  else $("miniEditorText")?.focus();
  helperSetStatus("Entwurf im Editor geöffnet. Nach manueller Prüfung zur Ergebnisansicht weitergeben.", "Manuell prüfen");
}

function setResultEditorText(value) {
  state.editorMode = "result";
  const editor = $("miniEditorText");
  if (editor) editor.value = String(value || "");
  syncMiniEditorMode();
}

function applyMiniEditorText() {
  const value = $("miniEditorText")?.value.trim();
  if (!value) { helperSetStatus("Das Editorfeld ist leer.", "Leer"); return; }
  if (state.editorMode === "result") {
    state.lastAgentResult = value;
    if (state.lastResultTask !== "assessment") state.lastResultInsertText = value;
    $("miniReviewText").value = value;
    renderReviewDiff(state.lastSourceText, value);
    state.manualReviewPending = false;
    setMiniInsertState();
    state.editorMode = "source";
    openPanel("miniReviewDrawer");
    helperSetStatus("Manuelle Änderungen übernommen. Ergebnis bitte prüfen und bewusst übernehmen.", "Prüfung nötig");
    return;
  }
  state.helperSourceText = value;
  state.pendingDictationText = "";
  if (state.focusedTarget?.windowHandle && state.fieldLocked) {
    void insertTextIntoField(value, { automatic: true });
    return;
  }
  syncDiscussionScope();
  helperSetStatus("Textquelle übernommen.", "Text bereit");
}

async function sendMiniEditor() {
  const value = $("miniEditorText")?.value.trim();
  if (!value) { helperSetStatus("Das Editorfeld ist leer.", "Leer"); return; }
  const resultMode = state.editorMode === "result";
  if (!resultMode) {
    state.helperSourceText = value;
    state.pendingDictationText = "";
    state.pendingDictationTarget = null;
  }
  if (!isWorkspacePanel()) openPanel("miniChatDrawer");
  appendChatMessage("user", value, { unread: false });
  state.chatAssistantNode = appendChatMessage("assistant", "", { unread: false });
  await runAgentAction("discussion", "", value);
}

async function sendMiniProposal() {
  if (state.working) return;
  const input = $("miniChatComposer");
  const value = input?.value.trim();
  if (!value) {
    helperSetStatus("Kurz sagen, was als Vorschlag entstehen soll.", "Eingang fehlt");
    input?.focus();
    return;
  }
  input.value = "";
  appendChatMessage("user", `Vorschlag: ${value}`, { unread: false });
  helperSetStatus("Vorschlag wird im Textfeld vorbereitet…", "Vorschlag");
  await runAgentAction("proposal", value);
}

async function sendMiniChat() {
  if (state.working) return;
  const input = $("miniChatComposer");
  const value = input?.value.trim();
  if (!value) return;
  input.value = "";
  appendChatMessage("user", value, { unread: false });
  state.chatAssistantNode = appendChatMessage("assistant", "", { unread: false });
  await runAgentAction("discussion", value);
}

async function copyMiniText() {
  const value = reviewText() || currentHelperText();
  if (!value) { helperSetStatus("Noch kein Text zum Kopieren vorhanden.", "Leer"); return; }
  try { await window.radimoAgent.writeClipboard(value); helperSetStatus("Text in die Zwischenablage kopiert.", "Kopiert"); } catch (error) { helperSetStatus(error.message || "Text konnte nicht kopiert werden.", "Prüfung nötig"); }
}

function clearMiniTarget() {
  if (state.working || state.transferInFlight) {
    helperSetStatus("Die laufende Aktion zuerst abwarten.", "Bitte warten");
    return;
  }
  if (state.recording?.recorder?.state === "recording") { state.recording.cancelled = true; state.recording.recorder.stop(); }
  state.focusedTarget = null;
  state.fieldLocked = false;
  state.helperSourceText = "";
  state.pendingDictationText = "";
  state.lastAgentText = "";
  state.lastSourceText = "";
  state.lastAgentResult = "";
  state.lastResultInsertText = "";
  state.lastResultApplied = false;
  state.lastResultTarget = null;
  state.lastChatResultTarget = null;
  state.transferNeedsReview = null;
  state.manualReviewPending = false;
  state.pendingDictationTarget = null;
  state.lastAgentMeta = emptyAgentMeta();
  state.editorMode = "source";
  state.workflow = null;
  $("miniReviewText").value = "";
  renderReviewDiff("", "");
  renderAgentNotes(state.lastAgentMeta);
  renderContext(null);
  renderFieldMapperReport(null);
  text("contextStatus", "Keine Quelle");
  renderReferences([]);
  const capturePath = state.screenCapture?.path;
  state.screenCapture = null;
  if (capturePath) void window.radimoAgent.releaseScreenCapture(capturePath).catch(() => {});
  $("screenCapturePreview")?.classList.add("hidden");
  $("screenCapturePreview")?.removeAttribute("src");
  $("copyScreenCapture").disabled = true;
  $("useScreenCapture").disabled = true;
  $("useScreenCapture").checked = false;
  text("screenCaptureBadge", "Keine");
  text("screenCaptureStatus", "");
  clearChatView();
  syncDiscussionScope();
  void window.radimoAgent.newDiscussion();
  void window.radimoAgent.patchWorkflow({ phase: "idle", target: "none", targetIdentity: null });
  setMiniDictationState("idle");
  helperSetStatus("Bereit für das nächste Arbeitsfeld.", "Bereit");
}

on("miniDictate", "click", () => { void miniStartDictation(); });
on("miniCorrection", "click", () => { void runAgentAction("correction"); });
on("miniWrite", "click", () => { void runAgentAction("write"); });
on("miniStructure", "click", () => { void runAgentAction("structure"); });
on("miniAssessment", "click", () => { void runAgentAction("assessment"); });
on("miniReview", "click", () => {
  if (state.manualReviewPending) { helperSetStatus("Den Entwurf zuerst im Editor prüfen.", "Manuell prüfen"); return; }
  if (state.lastAgentResult.trim() || $("miniReviewText")?.value.trim()) openPanel("miniReviewDrawer");
  else helperSetStatus("Noch kein Ergebnis zum Prüfen vorhanden.", "Leer");
});
on("miniInsert", "click", () => { void (state.pendingDictationText.trim() ? insertPendingDictation() : insertReviewResult()); });
on("miniEditorToggle", "click", () => openPanel("miniEditorDrawer"));
on("miniContextToggle", "click", openContext);
on("miniChatToggle", "click", () => openPanel("miniChatDrawer"));
on("miniEditorUse", "click", applyMiniEditorText);
on("miniEditorSend", "click", () => { void sendMiniEditor(); });
on("miniEditorText", "input", (event) => {
  if (state.editorMode === "source" && !hasLockedTarget()) {
    state.helperSourceText = event.target.value;
    state.pendingDictationText = "";
    syncDiscussionScope();
    renderMiniTarget();
  }
});
on("miniEditorText", "keydown", (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void sendMiniEditor(); } });
on("miniChatSend", "click", () => { void sendMiniChat(); });
on("miniChatPropose", "click", () => { void sendMiniProposal(); });
on("miniChatComposer", "keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMiniChat(); } });
on("miniChatNew", "click", () => { void startNewDiscussion(); });
on("miniReviewCopy", "click", () => { void copyLastResponse(); });
on("miniReviewInsert", "click", () => { void insertReviewResult(); });
on("miniReviewDiffToggle", "click", () => { renderReviewDiff(state.lastSourceText, $("miniReviewText")?.value || state.lastAgentResult); setReviewMode("diff"); });
on("miniReviewEditToggle", "click", () => { setReviewMode("text"); $("miniReviewText")?.focus(); });
on("miniReviewText", "input", (event) => { state.lastResultApplied = false; renderReviewDiff(state.lastSourceText, event.target.value); setMiniInsertState(); });
on("miniConfigAction", "change", (event) => { state.configTask = event.target.value; syncMiniConfigPanel(); });
on("miniConfigClose", "click", closeAttachedPanels);
on("miniConfigSave", "click", saveMiniConfig);
on("miniConfigReset", "click", resetMiniConfig);
on("miniTargetClear", "click", (event) => { event.stopPropagation(); clearMiniTarget(); });
on("miniCapture", "click", () => { void miniCaptureField(); });
on("miniClipboardCapture", "click", () => { void captureClipboardSource(); });
on("miniCaptureFromField", "click", () => {
  if (!state.experimentalUia) { void captureClipboardSource(); return; }
  if (!usesExperimentalFieldAccess()) {
    const select = $("fieldAccessMode");
    if (select) select.value = "uia";
    saveFieldAccessPreference("uia");
  }
  void miniCaptureField();
});
on("fieldAccessMode", "change", (event) => {
  saveFieldAccessPreference(event.target.value);
  helperSetStatus(fieldAccessDescription(), "Zugriff geändert");
});
on("miniTargetCell", "dragenter", (event) => {
  event.preventDefault();
  event.currentTarget.classList.add("is-dragging");
  if (!state.working && !state.transferInFlight) helperSetStatus("Textquelle hier ablegen.", "Ablegen");
});
on("miniTargetCell", "dragover", (event) => { event.preventDefault(); event.currentTarget.classList.add("is-dragging"); });
on("miniTargetCell", "dragleave", (event) => {
  const target = event.currentTarget;
  if (!event.relatedTarget || !target.contains(event.relatedTarget)) target.classList.remove("is-dragging");
});
on("miniTargetCell", "drop", (event) => { event.currentTarget.classList.remove("is-dragging"); handleMiniTargetDrop(event); });
on("miniContextRun", "click", () => runMiniContextTarget(state.contextMenuTarget));
on("miniContextSelection", "click", () => { closeMiniContextMenu(); void miniCaptureSelection(); });
on("miniContextCopy", "click", () => { closeMiniContextMenu(); void copyMiniText(); });
on("miniContextClipboard", "click", () => { closeMiniContextMenu(); void captureClipboardSource(); });
on("miniContextReset", "click", () => { closeMiniContextMenu(); clearMiniTarget(); });
on("miniContextAutoSelect", "click", () => { closeMiniContextMenu(); void autoSelectMappedField(); });
on("miniContextConfigure", "click", () => {
  const definition = MINI_ACTIONS[state.contextMenuTarget];
  openMiniConfig(definition?.task || state.configTask);
});
on("miniContextVisibility", "click", toggleMiniContextVisibility);
on("miniContextCubeSize", "click", toggleCubeMode);
on("miniContextFieldMapper", "click", () => { closeMiniContextMenu(); openContext(); void scanFieldMapper({ readValues: false }); });
on("miniContextSettings", "click", () => { closeMiniContextMenu(); openSettings(); });
on("miniContextClose", "click", () => { closeMiniContextMenu(); void window.radimoAgent.setHelperFocusable(false); void window.radimoAgent.hideHelper(); });
on("miniContextQuit", "click", () => { closeMiniContextMenu(); void window.radimoAgent.quitApp(); });
on("miniCore", "keydown", (event) => {
  if (event.key === "Enter" || event.key === " " || (event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
    event.preventDefault();
    showMiniContextMenu(event, "miniCore");
  }
});
for (const id of Object.keys(MINI_ACTIONS)) on(id, "contextmenu", (event) => showMiniContextMenu(event, id));
document.addEventListener("click", (event) => {
  if (!event.target?.closest?.("#miniContextMenu")) closeMiniContextMenu({ restoreFocus: false });
});
document.addEventListener("keydown", (event) => {
  if (handleMiniContextMenuKeydown(event)) return;
  if (event.key === "Escape") closeMiniContextMenu();
});
window.addEventListener("resize", () => { if (state.activePanel) window.requestAnimationFrame(syncPanelConnector); });
on("closeLogin", "click", closeSettings);
on("loginButton", "click", () => { void login(); });
on("logoutButton", "click", () => { void logout(); });
on("saveOpenAIKey", "click", () => { void saveOpenAIKey(); });
on("clearOpenAIKey", "click", () => { void clearOpenAIKey(); });
on("testOpenAIReadiness", "click", () => { void testOpenAIReadiness(); });
on("saveAgentDictationKey", "click", () => { void saveAgentDictationKey(); });
on("clearAgentDictationKey", "click", () => { void clearAgentDictationKey(); });
on("saveAgentApiConfig", "click", () => { void saveAgentApiConfig(); });
on("agentApiProvider", "change", (event) => { applyBackendUi({ backend: "api", provider: event.target.value }); });
on("openOpenAIKeys", "click", () => window.radimoAgent.openUrl("https://platform.openai.com/api-keys"));
on("retryShortcuts", "click", () => { void refreshShortcutStatus({ retry: true }); });
on("testConnection", "click", () => { void testConnection(); });
on("copyDiagnostics", "click", () => { void copyDiagnostics(); });
on("applyProxy", "click", () => { void applyProxy(); });
on("chooseContext", "click", () => { void chooseContext(); });
on("scanFieldMapper", "click", () => { void scanFieldMapper({ readValues: true }); });
on("inspectFieldMapper", "click", () => { void scanFieldMapper({ readValues: false, autoSelect: state.fieldMapperAutoTarget }); });
on("saveFieldMapper", "click", () => { void saveFieldMapperConfig(); });
on("resetFieldMapper", "click", () => { void resetFieldMapperConfig(); });
on("copyFieldMapper", "click", () => { void copyFieldMapperReport(); });
on("fieldMapperAutoTarget", "change", (event) => {
  if (!state.experimentalUia) {
    event.target.checked = false;
    state.fieldMapperAutoTarget = false;
    saveFieldMapperPreferences();
    helperSetStatus("UIA-Auto-Ziel ist in dieser Produktionsversion deaktiviert. Zwischenablage verwenden.", "Zwischenablage empfohlen");
    return;
  }
  state.fieldMapperAutoTarget = Boolean(event.target.checked);
  saveFieldMapperPreferences();
  if (state.fieldMapperAutoTarget && state.fieldMapReport?.fields?.length) void autoSelectMappedField({ reportOverride: state.fieldMapReport });
  else if (!state.fieldMapperAutoTarget) {
    state.fieldMapperAutoSelection = null;
    renderFieldMapperReport(state.fieldMapReport);
    renderMiniTarget();
  }
});
on("copyContext", "click", () => { void copyContext(); });
on("copySelectedField", "click", () => { void copySelectedField(); });
on("prepareCorrection", "click", prepareCorrection);
on("saveContext", "click", () => { void saveContext(); });
on("copyLastResponse", "click", () => { void copyLastResponse(); });
on("saveCorrectionDraft", "click", () => { void saveCorrectionDraft(); });
on("chooseClinicRoot", "click", () => { void chooseClinicRoot(); });
on("openClinicRoot", "click", () => { void openClinicRoot(); });
on("clinicSelect", "change", (event) => { state.selectedClinicId = event.target.value; renderClinicCatalog(state.clinicCatalog); });
on("chooseReferences", "click", () => { void chooseReferences(); });
on("clearReferences", "click", clearReferences);
on("fetchReferenceUrl", "click", () => { void fetchReferenceUrl(); });
on("importGuidance", "click", async () => { try { await window.radimoAgent.importGuidanceProfile(); showToast("Profil importiert."); } catch (error) { text("guidanceStatus", error.message || "Profil konnte nicht importiert werden."); } });
on("exportGuidance", "click", async () => { try { await window.radimoAgent.exportGuidanceProfile(); showToast("Profil exportiert."); } catch (error) { text("guidanceStatus", error.message || "Profil konnte nicht exportiert werden."); } });
on("openGuidanceFolder", "click", async () => { try { await window.radimoAgent.openGuidanceFolder(); } catch (error) { text("guidanceStatus", error.message || "Profilordner konnte nicht geöffnet werden."); } });
on("insertTemplate", "click", async () => { try { const template = await window.radimoAgent.getTemplate($("templateSelect").value); if (template?.content) { if (hasLockedTarget()) { text("templateStatus", "Textquelle nur ohne aktives Arbeitsfeld verfügbar."); return; } state.helperSourceText = [currentHelperText(), template.content.trim()].filter(Boolean).join("\n\n"); openPanel("miniEditorDrawer"); $("miniEditorText").value = state.helperSourceText; } } catch (error) { text("templateStatus", error.message || "Vorlage konnte nicht geladen werden."); } });
on("captureScreen", "click", () => { void captureScreen(); });
on("copyScreenCapture", "click", () => { void copyScreenCapture(); });
on("useContext", "change", () => {});
on("useLocalReferences", "change", () => {});
window.radimoAgent.onContextMenu((payload) => showMiniContextMenu(null, payload?.target || "miniCore"));
updateChatBadge();
document.addEventListener("keydown", handleDialogKeydown);

window.radimoAgent.onEvent((event) => {
  if (event.method === "account/updated" || event.method === "account/login/completed") {
    if (event.method === "account/updated" || event.params?.success === true) closeSettings();
    void refreshConnection();
  }
  if (event.method === "item/agentMessage/delta") {
    state.lastAgentText += String(event.params?.delta || "");
    if (state.activeTask === "discussion") updateChatAssistant(state.lastAgentText);
    else setMiniInsertState();
  }
  if (event.method === "turn/started") {
    setMiniWorkingState(true);
    helperSetStatus("ReportHalo arbeitet…", "Denken");
  }
  if (event.method === "turn/completed") {
    setMiniWorkingState(false);
    if (isApiBackend()) void refreshUsageStatus();
    if (state.activeTask === "discussion") {
      const chatResult = parseChatResult(state.lastAgentText);
      if (chatResult.structured) {
        const answer = [chatResult.answer, formatChatNotes(chatResult.meta)].filter(Boolean).join("\n\n");
        state.lastAgentResult = chatResult.text;
        state.lastResultInsertText = chatResult.text;
        state.lastResultTask = "proposal";
        state.lastResultTarget = state.lastChatResultTarget;
        state.lastResultApplied = false;
        state.manualReviewPending = false;
        renderAgentNotes(chatResult.meta);
        $("miniReviewText").value = chatResult.text;
        renderReviewDiff(state.lastSourceText, chatResult.text);
        updateChatAssistant(answer || "Textvorschlag bereit.", { immediate: true });
        appendChatProposal(chatResult.text, chatResult.meta);
        setMiniInsertState();
      } else {
        updateChatAssistant(chatResult.answer || "Keine Antwort erhalten.", { immediate: true });
      }
      state.chatAssistantNode = null;
      state.activeTask = "";
      helperSetStatus("Chat bereit.", "Chat");
    } else {
      void applyCompletedAgentResult();
    }
  }
  if (event.method === "radimoagent/stderr") helperSetStatus(event.params?.text || "Lokales Signal.", "Hinweis");
});
window.radimoAgent.onReady((payload) => { applyFieldAccessCapabilities(payload || {}); applyBackendUi(payload || {}); void refreshConnection(); void loadModels(); void loadClinicSources(); void loadWritingResources(); });
window.radimoAgent.onError((error) => helperSetStatus(error.message || "Lokaler Agent nicht verfügbar.", "Nicht verfügbar"));
window.radimoAgent.onWorkflowState((workflow) => {
  if (!workflow) return;
  state.workflow = workflow;
  if (workflow.targetIdentity?.windowHandle && fieldAccessMode() !== "clipboard") {
    state.focusedTarget = { ...workflow.targetIdentity };
    state.fieldLocked = true;
  } else if (workflow.target === "none" || workflow.target === "text") {
    state.focusedTarget = null;
    state.fieldLocked = false;
  }
  if (workflow.fieldType) setHelperFieldType(workflow.fieldType);
  renderMiniTarget();
  setMiniInsertState();
});
window.radimoAgent.onToggleDictation((payload) => { void miniStartDictation(payload?.point || null); });
window.radimoAgent.onCaptureFocusedField((payload) => { void miniCaptureField({ point: payload?.point || null }); });
window.radimoAgent.getWorkflowState().then((workflow) => { state.workflow = workflow; if (workflow?.targetIdentity?.windowHandle && fieldAccessMode() !== "clipboard") { state.focusedTarget = { ...workflow.targetIdentity }; state.fieldLocked = true; } renderMiniTarget(); }).catch(() => {});

applyGermanUi();
loadCubeMode();
loadActionSettings();
loadFieldMapperPreferences();
loadFieldAccessPreference();
void loadFieldMapperConfig();
renderActionVisibility();
syncMiniConfigPanel();
setReviewMode("text");
setMiniConnectionState(false);
renderMiniTarget();
setMiniDictationState("idle");
setMiniWorkingState(false);
helperSetStatus("Arbeitsfeld aktivieren oder Text hineinziehen.", "Bereit");
void setCubeMode(state.cubeMode, { persist: false })
  .then(() => window.radimoAgent.setHelperPanel("base"))
  .then(() => window.radimoAgent.setHelperFocusable(false))
  .catch(() => {});
