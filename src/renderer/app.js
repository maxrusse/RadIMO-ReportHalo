const state = {
  models: [],
  selectedModel: "",
  backend: "codex",
  apiProvider: "openai",
  apiConfigLocks: { provider: false, authMode: false, endpoint: false, model: false, audioDeployment: false },
  loggedIn: false,
  contextReport: null,
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
  lastResultTask: "",
  lastAgentMeta: { changes: [], unclear: [], logicIssues: [], medicalIssues: [] },
  lastResultApplied: false,
  lastResultTarget: null,
  manualReviewPending: false,
  transferInFlight: false,
  pendingDictationTarget: null,
  chatMessages: [],
  chatAssistantNode: null,
  chatUnread: false,
  workspaceFocus: "chat",
  reviewMode: "diff",
  editorMode: "source",
  actionSettings: {},
  contextMenuTarget: "",
  configTask: "correction",
  settingsOpen: false,
  dialogReturnFocus: null,
  panelReturnFocus: null,
  contextMenuReturnFocus: null,
  connectionOnline: false,
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
const ACTION_SETTINGS_STORAGE_KEY = "radimoagent.action-settings.v1";
const ACTION_SETTING_DEFAULTS = {
  write: { visible: true, prompt: "", manualReview: false },
  correction: { visible: true, prompt: "", manualReview: false },
  structure: { visible: true, prompt: "", manualReview: false },
  assessment: { visible: true, prompt: "", manualReview: false },
};
const panelLayoutEpoch = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let panelLayoutRequest = 0;
let chatAssistantRenderFrame = 0;
let pendingChatAssistantText = "";
const MINI_ACTIONS = {
  miniCore: { label: "ReportHalo", kind: "core" },
  miniTargetCell: { label: "Arbeitsfeld", run: true },
  miniWrite: { label: "Klarer formulieren", task: "write", run: true, configurable: true, hideable: true },
  miniDictate: { label: "Diktat", run: true },
  miniCorrection: { label: "Lektorat", task: "correction", run: true, configurable: true, hideable: true },
  miniInsert: { label: "Ergebnis anwenden", run: true },
  miniStructure: { label: "Strukturieren", task: "structure", run: true, configurable: true, hideable: true },
  miniAssessment: { label: "Beurteilung ergänzen", task: "assessment", run: true, configurable: true, hideable: true },
  miniReview: { label: "Ergebnis prüfen", run: true, hideable: false },
  miniEditorToggle: { label: "Textquelle", run: true },
  miniContextToggle: { label: "Kontext", run: true },
  miniChatToggle: { label: "Chat", run: true },
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
      prompt: typeof value.prompt === "string" ? value.prompt.trim().slice(0, 1200) : defaults.prompt,
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

function renderActionVisibility() {
  for (const [id, config] of Object.entries(MINI_ACTIONS)) {
    if (!config.hideable || !config.task) continue;
    $(id)?.classList.toggle("hidden", state.actionSettings?.[config.task]?.visible === false);
  }
}

function configuredActionPrompt(task) {
  const value = state.actionSettings?.[task]?.prompt?.trim();
  return value ? "Zusatzwunsch des Nutzers: " + value : "";
}

function configTaskIsValid(task) {
  return Object.prototype.hasOwnProperty.call(ACTION_SETTING_DEFAULTS, task);
}

function syncMiniConfigPanel() {
  const task = configTaskIsValid(state.configTask) ? state.configTask : "correction";
  state.configTask = task;
  const definition = Object.values(MINI_ACTIONS).find((item) => item.task === task);
  const settings = state.actionSettings[task] || ACTION_SETTING_DEFAULTS[task];
  const select = $("miniConfigAction");
  if (select) select.value = task;
  text("miniConfigTitle", definition?.label || "Aktion");
  const visible = $("miniConfigVisible");
  if (visible) visible.checked = settings.visible !== false;
  const manualReview = $("miniConfigManualReview");
  if (manualReview) manualReview.checked = settings.manualReview === true;
  const prompt = $("miniConfigPrompt");
  if (prompt) prompt.value = settings.prompt || "";
}

function openMiniConfig(task = state.configTask) {
  closeMiniContextMenu();
  if (configTaskIsValid(task)) state.configTask = task;
  syncMiniConfigPanel();
  if (state.activePanel !== "miniConfigDrawer") openPanel("miniConfigDrawer");
}

function saveMiniConfig() {
  const task = configTaskIsValid(state.configTask) ? state.configTask : "correction";
  state.actionSettings[task] = {
    visible: Boolean($("miniConfigVisible")?.checked),
    prompt: String($("miniConfigPrompt")?.value || "").trim().slice(0, 1200),
    manualReview: Boolean($("miniConfigManualReview")?.checked),
  };
  saveActionSettings();
  renderActionVisibility();
  syncMiniConfigPanel();
  const definition = Object.values(MINI_ACTIONS).find((item) => item.task === task);
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
    run.textContent = definition.task ? "Ausführen" : definition.label + " öffnen";
  }
  const targetMenu = targetId === "miniTargetCell";
  const selection = $("miniContextSelection");
  if (selection) selection.classList.toggle("hidden", !targetMenu);
  const copy = $("miniContextCopy");
  if (copy) copy.classList.toggle("hidden", !targetMenu || !Boolean(currentHelperText() || reviewText()));
  const reset = $("miniContextReset");
  if (reset) {
    const canReset = hasLockedTarget() || Boolean(currentHelperText() || state.lastAgentResult.trim() || $("miniReviewText")?.value.trim());
    reset.classList.toggle("hidden", !targetMenu || !canReset);
    reset.textContent = hasLockedTarget() ? "Arbeitsfeld lösen" : "Textquelle leeren";
  }
  const configure = $("miniContextConfigure");
  const canConfigure = definition.kind === "core" || Boolean(definition.configurable);
  if (configure) {
    configure.classList.toggle("hidden", !canConfigure);
    configure.textContent = definition.kind === "core" ? "Aktionen anpassen" : "Prompt & Anzeige";
  }
  const visibility = $("miniContextVisibility");
  const canToggle = Boolean(definition.hideable && definition.task);
  if (visibility) {
    visibility.classList.toggle("hidden", !canToggle);
    visibility.textContent = state.actionSettings?.[definition.task]?.visible === false ? "Aktion einblenden" : "Aktion ausblenden";
  }
  const quit = $("miniContextQuit");
  if (quit) quit.classList.toggle("hidden", definition.kind !== "core");
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
  [run, selection, copy, reset, configure, $("miniContextSettings"), $("miniContextClose"), quit]
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
  document.title = "RadIMO – ReportHalo Minihelfer";
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
    setReviewMode("diff");
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
  cell.classList.toggle("has-text", !hasTarget && hasText);
  cell.classList.toggle("is-empty", !hasTarget && !hasText);
  cell.setAttribute("aria-label", hasTarget ? `Externes Feld aktiv: ${helperFieldLabel()}` : hasText ? "Textquelle bereit" : "Arbeitsfeld oder Textquelle");
  cell.title = hasTarget ? "Externes Feld aktiv · X löst das Zielfeld" : hasText ? "Textquelle bereit · X leert den Text" : "Externes Arbeitsfeld aktivieren oder Text hierher ziehen";
  const targetIcon = $("miniTargetIcon");
  if (targetIcon) targetIcon.setAttribute("href", hasTarget ? "#icon-lock" : hasText ? "#icon-edit" : "#icon-target");
  const capture = $("miniCapture");
  capture?.classList.toggle("is-active", hasTarget);
  capture?.setAttribute("aria-label", hasTarget ? `Arbeitsfeld erneut lesen: ${helperFieldLabel()}` : hasText ? "Textquelle durch externes Arbeitsfeld ersetzen" : "Externes Arbeitsfeld aktivieren");
  capture?.setAttribute("title", hasTarget ? "Arbeitsfeld erneut lesen" : hasText ? "Externes Arbeitsfeld aktivieren" : "Externes Arbeitsfeld aktivieren");
  text("miniTargetCellStatus", hasTarget ? `Externes Feld aktiv: ${helperFieldLabel()}` : hasText ? "Textquelle bereit" : "Feld wählen");
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
  const hasTarget = hasLockedTarget();
  const readOnly = hasTarget && state.focusedTarget?.supportsWrite === false;
  const ready = hasTarget && !readOnly && !state.manualReviewPending && !state.transferInFlight && !state.activeTask && !state.lastResultApplied && (hasPending || hasReview);
  const review = $("miniReview");
  if (review) {
    review.classList.toggle("is-ready", hasReview);
    review.title = state.manualReviewPending ? "Entwurf zuerst im Editor prüfen" : hasReview ? "Ergebnis prüfen" : "Ergebnis prüfen · noch kein Ergebnis";
    review.setAttribute("aria-label", review.title);
  }
  const resultTargetChanged = Boolean(state.lastResultTarget?.windowHandle && (!hasTarget || !sameTargetIdentity(state.focusedTarget, state.lastResultTarget)));
  text("miniReviewTarget", resultTargetChanged ? "Zielfeld geändert · Ergebnis nicht automatisch übernehmen." : hasTarget ? `${state.lastResultTask === "assessment" ? "Beurteilung wird ergänzt" : "Ergebnis ersetzt"} · Zielfeld: ${helperFieldLabel()}` : "Kein aktives Zielfeld · Ergebnis bleibt lokal.");
  const reviewInsert = $("miniReviewInsert");
  const reviewReady = hasReview && hasTarget && !readOnly && !resultTargetChanged && !state.manualReviewPending && !state.transferInFlight && !state.activeTask && !state.lastResultApplied;
  if (reviewInsert) {
    reviewInsert.disabled = !reviewReady;
    reviewInsert.title = resultTargetChanged ? "Zielfeld geändert · Aktion erneut starten" : readOnly ? "Zielfeld ist schreibgeschützt" : state.manualReviewPending ? "Zuerst den Entwurf im Editor prüfen" : "Geprüftes Ergebnis ins Zielfeld übernehmen";
    reviewInsert.setAttribute("aria-label", reviewInsert.title);
  }
  button.disabled = !ready;
  button.classList.toggle("is-ready", ready);
  button.title = readOnly ? "Zielfeld ist schreibgeschützt" : state.manualReviewPending ? "Nach manueller Prüfung ins Zielfeld übernehmen" : hasPending ? "Diktat ins Arbeitsfeld einsetzen" : state.lastResultTask === "assessment" ? "Beurteilung im Arbeitsfeld ergänzen" : "Geprüftes Ergebnis im Arbeitsfeld anwenden";
  button.setAttribute("aria-label", button.title);
  const use = icon.querySelector("use");
  if (use) use.setAttribute("href", "#icon-insert");
  const copy = $("miniReviewCopy");
  if (copy) copy.disabled = !hasReview;
  const save = $("saveCorrectionDraft");
  if (save) save.disabled = !hasReview || !state.contextReport?.source?.path;
}

function rememberFocusedField(focused) {
  if (focused?.ok === false || !focused?.windowHandle || state.working || state.transferInFlight) return null;
  state.focusedTarget = {
    ...focused,
    expectedFieldHash: focused.hash || null,
    replaceAll: focused.strategy !== "TextPattern.Selection",
  };
  state.fieldLocked = true;
  setHelperFieldType(inferHelperFieldType(focused));
  state.helperSourceText = typeof focused.text === "string" ? focused.text.trim() : "";
  state.pendingDictationText = "";
  state.pendingDictationTarget = null;
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

async function captureWorkingField({ selectionOnly = false } = {}) {
  if (state.working || state.transferInFlight) {
    helperSetStatus("Das Arbeitsfeld kann während einer laufenden Aktion nicht gewechselt werden.", "Bitte warten");
    return null;
  }
  await window.radimoAgent.setHelperFocusable(false);
  try {
    const focused = await window.radimoAgent.readFocusedField({ selectionOnly });
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
      : "Kein unterstütztes externes Textfeld gefunden. Text kann hierher gezogen werden.";
    helperSetStatus(message, focused?.error === "no-selection" ? "Keine Auswahl" : "Feld fehlt");
    return null;
  } catch (error) {
    helperSetStatus(error.message || "Arbeitsfeld konnte nicht aktiviert werden.", "Prüfung nötig");
    return null;
  } finally {
    void window.radimoAgent.setHelperFocusable(Boolean(state.activePanel) || state.settingsOpen);
  }
}

async function miniCaptureField() {
  return captureWorkingField({ selectionOnly: false });
}

async function miniCaptureSelection() {
  return captureWorkingField({ selectionOnly: true });
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
  state.focusedTarget = null;
  state.fieldLocked = false;
  state.helperSourceText = dropped;
  state.pendingDictationText = "";
  state.pendingDictationTarget = null;
  void window.radimoAgent.patchWorkflow({ phase: "idle", target: "text", targetIdentity: null });
  syncDiscussionScope();
  helperSetStatus(`${dropped.length} Zeichen als Textquelle übernommen. Für Einsetzen ein externes Arbeitsfeld aktivieren.`, "Text bereit");
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
  const base = {
    correction: "Medizinisches Lektorat: Überarbeite nur den vorhandenen Text. Korrigiere Rechtschreibung, Grammatik, Diktatfehler und Lesbarkeit. Keine neuen Inhalte.",
    write: "Formuliere nur den vorhandenen Text klarer. Keine neuen Informationen und keine inhaltlichen Ergänzungen.",
    structure: "Ordne nur den vorhandenen Text besser. Nichts ergänzen und keine fehlenden Bausteine erfinden.",
    assessment: "Fasse nur die vorhandenen Aussagen knapp als Beurteilung. Unsicherheiten und Lücken bleiben sichtbar.",
    discussion: "Chat: Antworte knapp in 1–4 kurzen Absätzen oder höchstens fünf Stichpunkten. Erkläre, frage nach und diskutiere nur anhand des vorhandenen Textes. Du schreibst nie in ein externes Feld.",
    proposal: "Vorschlag: Erstelle aus dem Arbeitsfeld und der Anweisung einen kurzen, bearbeitbaren Textentwurf. Der Entwurf darf die gewünschte Zielsektion (zum Beispiel Befund oder Beurteilung) abbilden, aber keine neuen medizinischen Fakten ergänzen. Schreibe nie in ein externes Feld.",
  }[task] || "Bearbeite nur den vorhandenen Text und markiere offene Punkte.";
  return [base, configuredActionPrompt(task)].filter(Boolean).join("\n");
}

const TEXT_ACTION_OUTPUT_CONTRACT = [
  "FELDAKTION: Gib ausschließlich das vollständige JSON-Ergebnis im vorgegebenen Schema zurück.",
  "text ist der vollständige Ersatztext. changes nennt nur tatsächliche Sprach-, Rechtschreib-, Grammatik- oder Lektoratsänderungen; unclear, logicIssues und medicalIssues sind kurze Hinweise zum Ausgangstext und werden nicht geändert. Keine Einleitung, kein Markdown, keine neuen medizinischen Fakten.",
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
  const oldText = String(before || "");
  const newText = String(after || "");
  let prefix = 0;
  while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - suffix - 1] === newText[newText.length - suffix - 1]
  ) suffix += 1;
  return {
    prefix: oldText.slice(0, prefix),
    removed: oldText.slice(prefix, oldText.length - suffix),
    added: newText.slice(prefix, newText.length - suffix),
    suffix: suffix ? oldText.slice(oldText.length - suffix) : "",
  };
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
      appendDiffText(line, parts.prefix);
      appendDiffText(line, side === "before" ? parts.removed : parts.added, side === "before" ? "removed" : "added");
      appendDiffText(line, parts.suffix);
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

function setReviewMode(mode = "diff") {
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

function appendChatProposal(result) {
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
  body.textContent = "Bearbeitbarer Vorschlag im Textfeld bereit.";
  const button = document.createElement("button");
  button.className = "mini-panel-button";
  button.type = "button";
  button.textContent = "Im Textfeld öffnen";
  button.addEventListener("click", () => openResultEditor(result));
  article.append(label, body, button);
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
  const count = Object.values(state.lastAgentMeta).reduce((total, items) => total + items.length, 0);
  text("miniReviewStatus", count ? "Änderungen und Hinweise stehen im Chat." : "Keine zusätzlichen Hinweise gemeldet.");
}

function resultTaskLabel(task) {
  return { correction: "Lektorat", write: "Formulierung", structure: "Textordnung", assessment: "Beurteilung", proposal: "Vorschlag" }[task] || "Bearbeitung";
}

function formatResultMeta(task, meta, { activeTarget = false, transferred = false, verified = false, replaced = false, appended = false, manualReview = false } = {}) {
  const status = appended && verified ? "Die Beurteilung wurde unterhalb des vorhandenen Textes ergänzt." : replaced && verified ? "Der vollständige Text wurde im aktiven Feld ersetzt." : manualReview ? "Das aktive Feld wurde nicht verändert. Der Entwurf wartet auf deine Prüfung im Editor." : transferred ? "Die Übertragung wurde versucht, aber das Zielfeld ist noch nicht verifiziert." : activeTarget ? "Das aktive Feld wurde nicht verändert, weil es nicht verifiziert werden konnte." : "Kein aktives externes Feld wurde verändert.";
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
  const prompt = [actionPrompt(task), isChat ? "" : isProposal ? PROPOSAL_OUTPUT_CONTRACT : TEXT_ACTION_OUTPUT_CONTRACT, instruction.trim(), `Arbeitsfeld: ${helperFieldLabel()}`, sourceBlock, attachedContext, attachedReferences].filter(Boolean).join("\n\n");
  state.activeTask = task;
  state.lastSourceText = source;
  state.lastAgentText = "";
  if (!isChat) {
    state.pendingDictationText = "";
    state.pendingDictationTarget = null;
    state.lastResultApplied = false;
    state.lastResultTarget = operationTarget;
    state.manualReviewPending = false;
    state.lastAgentResult = "";
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
  if (!textToInsert || !target?.windowHandle || !state.fieldLocked) {
    helperSetStatus("Kein gesichertes Arbeitsfeld für dieses Ergebnis vorhanden.", "Feld fehlt");
    return null;
  }
  if (targetOverride && !sameTargetIdentity(state.focusedTarget, targetOverride)) {
    helperSetStatus("Das Ergebnis gehört zu einem anderen Arbeitsfeld. Bitte die Aktion erneut starten.", "Zielfeld geändert");
    return null;
  }
  if (target.supportsWrite === false) {
    helperSetStatus("Das aktive Arbeitsfeld ist schreibgeschützt.", "Nur lesen");
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
      target: { ...target, append, replaceAll: append || isDictation ? false : target.replaceAll !== false },
    });
    if (response?.actualHash && state.focusedTarget && sameTargetIdentity(state.focusedTarget, target)) state.focusedTarget.expectedFieldHash = response.actualHash;
    if (response?.ok && response.verified) {
      if (isDictation) state.pendingDictationText = "";
      if (isDictation) state.pendingDictationTarget = null;
      if (!isDictation) state.lastResultApplied = true;
      state.helperSourceText = append ? [existingSource, textToInsert].filter(Boolean).join("\n\n") : textToInsert;
      helperSetStatus(append ? "Beurteilung ergänzt und Zielfeld verifiziert." : automatic ? "Ergebnis direkt ersetzt und Zielfeld verifiziert." : "Eingesetzt und Zielfeld verifiziert.", "Verifiziert");
      setMiniDictationState("idle");
    } else if (response?.ok) {
      if (!isDictation) state.lastResultApplied = true;
      state.helperSourceText = append ? [existingSource, textToInsert].filter(Boolean).join("\n\n") : textToInsert;
      helperSetStatus(append ? "Beurteilung ergänzt; Zielfeld bitte prüfen." : automatic ? "Ergebnis ersetzt; Zielfeld bitte prüfen." : "Eingesetzt; Zielfeld bitte im Zielprogramm prüfen.", "Prüfung nötig");
    } else {
      helperSetStatus(`Einsetzen gestoppt: ${response?.error || "Ziel geändert"}.`, "Prüfung nötig");
    }
    if (response?.ok) {
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
  await insertTextIntoField(state.pendingDictationText, { isDictation: true, targetOverride: state.pendingDictationTarget });
}

async function insertReviewResult() {
  if (state.manualReviewPending) {
    helperSetStatus("Den Entwurf zuerst im Editor prüfen und zur Ergebnisansicht weitergeben.", "Manuell prüfen");
    return;
  }
  await insertTextIntoField(reviewText(), { append: state.lastResultTask === "assessment", targetOverride: state.lastResultTarget });
}

async function applyCompletedAgentResult() {
  const task = state.activeTask;
  const parsed = parseAgentResult(state.lastAgentText);
  if (!parsed.valid) {
    state.lastAgentResult = "";
    renderAgentNotes(emptyAgentMeta());
    $("miniReviewText").value = "";
    helperSetStatus("Antwortformat unklar. Nichts wurde ersetzt.", "Prüfung nötig");
    appendChatMessage("assistant", "Das Antwortformat war unklar. Ich habe deshalb nichts ersetzt. Bitte im Chat nachfragen oder die Aktion erneut starten.");
    state.activeTask = "";
    if (!state.activePanel) openPanel("miniChatDrawer");
    return;
  }

  const { text: result, meta } = parsed;
  state.lastAgentResult = result;
  state.lastResultTask = task;
  renderAgentNotes(meta);
  $("miniReviewText").value = result;
  renderReviewDiff(state.lastSourceText, result);
  let response = null;
  const appended = task === "assessment";
  const proposal = task === "proposal";
  const manualReview = proposal || Boolean(state.actionSettings?.[task]?.manualReview);
  const operationTarget = state.lastResultTarget;
  const targetUnchanged = Boolean(operationTarget?.windowHandle && state.fieldLocked && sameTargetIdentity(state.focusedTarget, operationTarget));
  if (targetUnchanged && !manualReview) response = await insertTextIntoField(result, { automatic: true, append: appended, targetOverride: operationTarget, sourceText: state.lastSourceText });
  if (manualReview) {
    state.manualReviewPending = true;
    openResultEditor(result);
  }
  const transferred = Boolean(response?.ok);
  const verified = transferred && response.verified === true;
  if (!manualReview && operationTarget?.windowHandle && !targetUnchanged) helperSetStatus("Das Arbeitsfeld wurde während der Anfrage geändert. Nichts wurde übertragen.", "Zielfeld geändert");
  if (!manualReview && !response?.ok && !operationTarget?.windowHandle && !(state.focusedTarget?.windowHandle && state.fieldLocked)) helperSetStatus("Ergebnis bereit. Externes Arbeitsfeld aktivieren.", "Feld fehlt");
  if (proposal) appendChatProposal(result);
  else appendChatMessage("assistant", formatResultMeta(task, meta, {
      activeTarget: targetUnchanged,
      transferred,
      verified,
      replaced: verified && !appended,
      appended: verified && appended,
      manualReview,
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
  if (!state.activePanel && !manualReview) openPanel("miniChatDrawer");
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

async function miniStartDictation() {
  if (state.recording?.recorder?.state === "recording") {
    state.recording.recorder.stop();
    return;
  }
  if (state.pendingDictationText.trim()) {
    await insertPendingDictation();
    return;
  }
  const target = state.focusedTarget?.windowHandle ? state.focusedTarget : await miniCaptureField();
  if (!target?.windowHandle) {
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
    const recording = { recorder, stream, chunks: [], timer: null, cancelled: false, target: { ...target } };
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
        const result = await window.radimoAgent.transcribeAudio({ bytes: await blob.arrayBuffer(), mimeType: blob.type });
        state.pendingDictationText = String(result.text || "").trim();
        state.helperSourceText = state.pendingDictationText;
        state.pendingDictationTarget = state.pendingDictationText ? { ...recording.target } : null;
        setMiniDictationState(state.pendingDictationText ? "ready" : "idle");
        syncDiscussionScope();
        helperSetStatus(state.pendingDictationText ? "Diktat bereit. Einsetzen bleibt eine separate Bestätigung." : "Leere Transkription erhalten.", state.pendingDictationText ? "Einfügen bereit" : "Leer");
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

function contextPrompt() {
  if (!state.contextReport || !$("useContext")?.checked) return "";
  const blocks = state.contextReport.items.map((item) => `### ${item.relation} · ${item.section} · ${item.name}\n${item.content || item.preview}`).join("\n\n");
  return `\n\n[EXPLICITLY ATTACHED LOCAL CONTEXT]\n${blocks}\n[/EXPLICITLY ATTACHED LOCAL CONTEXT]`;
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
  if (!state.contextReport) return "";
  const report = state.contextReport;
  return ["ReportHalo Kontextbericht", `Erstellt: ${report.generatedAt}`, `Anker: ${report.source.path}`, `Strategie: ${report.strategy}`, "", ...report.items.flatMap((item) => [`## ${item.relation} · ${item.section} · ${item.name}`, item.content || item.preview, ""])].join("\n");
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
    text("loginStatus", result.configured ? "Proxy angewendet." : "Proxy-Override entfernt.");
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
  state.editorMode = "result";
  $("miniEditorText").value = result;
  syncMiniEditorMode();
  if (!isWorkspacePanel()) openPanel("miniEditorDrawer");
  else $("miniEditorText")?.focus();
  helperSetStatus("Entwurf im Editor geöffnet. Nach manueller Prüfung zur Ergebnisansicht weitergeben.", "Manuell prüfen");
}

function applyMiniEditorText() {
  const value = $("miniEditorText")?.value.trim();
  if (!value) { helperSetStatus("Das Editorfeld ist leer.", "Leer"); return; }
  if (state.editorMode === "result") {
    state.lastAgentResult = value;
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
  state.lastResultApplied = false;
  state.lastResultTarget = null;
  state.manualReviewPending = false;
  state.pendingDictationTarget = null;
  state.lastAgentMeta = emptyAgentMeta();
  state.editorMode = "source";
  state.workflow = null;
  $("miniReviewText").value = "";
  renderReviewDiff("", "");
  renderAgentNotes(state.lastAgentMeta);
  renderContext(null);
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
on("miniTargetCell", "dragover", (event) => { event.preventDefault(); event.currentTarget.classList.add("is-dragging"); });
on("miniTargetCell", "dragleave", (event) => { if (event.currentTarget === event.target) event.currentTarget.classList.remove("is-dragging"); });
on("miniTargetCell", "drop", (event) => { event.currentTarget.classList.remove("is-dragging"); handleMiniTargetDrop(event); });
on("miniContextRun", "click", () => runMiniContextTarget(state.contextMenuTarget));
on("miniContextSelection", "click", () => { closeMiniContextMenu(); void miniCaptureSelection(); });
on("miniContextCopy", "click", () => { closeMiniContextMenu(); void copyMiniText(); });
on("miniContextReset", "click", () => { closeMiniContextMenu(); clearMiniTarget(); });
on("miniContextConfigure", "click", () => {
  const definition = MINI_ACTIONS[state.contextMenuTarget];
  openMiniConfig(definition?.task || state.configTask);
});
on("miniContextVisibility", "click", toggleMiniContextVisibility);
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
      updateChatAssistant(state.lastAgentText.trim() ? state.lastAgentText : "Keine Antwort erhalten.", { immediate: true });
      state.chatAssistantNode = null;
      state.activeTask = "";
      helperSetStatus("Chat bereit.", "Chat");
    } else {
      void applyCompletedAgentResult();
    }
  }
  if (event.method === "radimoagent/stderr") helperSetStatus(event.params?.text || "Lokales Signal.", "Hinweis");
});
window.radimoAgent.onReady((payload) => { applyBackendUi(payload || {}); void refreshConnection(); void loadModels(); void loadClinicSources(); void loadWritingResources(); });
window.radimoAgent.onError((error) => helperSetStatus(error.message || "Lokaler Agent nicht verfügbar.", "Nicht verfügbar"));
window.radimoAgent.onWorkflowState((workflow) => {
  if (!workflow) return;
  state.workflow = workflow;
  if (workflow.targetIdentity?.windowHandle) {
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
window.radimoAgent.onToggleDictation(() => { void miniStartDictation(); });
window.radimoAgent.onCaptureFocusedField(() => { void miniCaptureField(); });
window.radimoAgent.getWorkflowState().then((workflow) => { state.workflow = workflow; if (workflow?.targetIdentity?.windowHandle) { state.focusedTarget = { ...workflow.targetIdentity }; state.fieldLocked = true; } renderMiniTarget(); }).catch(() => {});

applyGermanUi();
loadActionSettings();
renderActionVisibility();
syncMiniConfigPanel();
setReviewMode("diff");
setMiniConnectionState(false);
renderMiniTarget();
setMiniDictationState("idle");
setMiniWorkingState(false);
helperSetStatus("Arbeitsfeld aktivieren oder Text hineinziehen.", "Bereit");
void window.radimoAgent.setHelperPanel("base").then(() => window.radimoAgent.setHelperFocusable(false)).catch(() => {});
