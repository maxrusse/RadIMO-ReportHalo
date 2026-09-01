const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("radimoAgent", {
  getStatus: () => ipcRenderer.invoke("agent:status"),
  startBrowserLogin: () => ipcRenderer.invoke("agent:browser-login"),
  logout: () => ipcRenderer.invoke("agent:logout"),
  newDiscussion: () => ipcRenderer.invoke("agent:new-discussion"),
  listModels: () => ipcRenderer.invoke("agent:models"),
  sendTurn: (payload) => ipcRenderer.invoke("agent:turn", payload),
  openUrl: (url) => ipcRenderer.invoke("agent:open-url", url),
  copyDiagnostics: () => ipcRenderer.invoke("agent:copy-diagnostics"),
  testConnection: () => ipcRenderer.invoke("agent:test-connection"),
  setProxy: (value) => ipcRenderer.invoke("agent:set-proxy", value),
  getAgentApiStatus: () => ipcRenderer.invoke("agent:api-status"),
  setAgentApiConfig: (value) => ipcRenderer.invoke("agent:api-set-config", value),
  setAgentApiKey: (value) => ipcRenderer.invoke("agent:api-set-key", value),
  clearAgentApiKey: () => ipcRenderer.invoke("agent:api-clear-key"),
  testAgentApi: () => ipcRenderer.invoke("agent:api-test"),
  getUsageStatus: () => ipcRenderer.invoke("agent:usage"),
  getOpenAIStatus: () => ipcRenderer.invoke("openai:status"),
  testOpenAI: () => ipcRenderer.invoke("openai:test"),
  setOpenAIKey: (value) => ipcRenderer.invoke("openai:set-key", value),
  clearOpenAIKey: () => ipcRenderer.invoke("openai:clear-key"),
  transcribeAudio: (payload) => ipcRenderer.invoke("audio:transcribe", payload),
  getGuidanceStatus: () => ipcRenderer.invoke("guidance:status"),
  getTemplateStatus: () => ipcRenderer.invoke("templates:status"),
  getTemplate: (id) => ipcRenderer.invoke("templates:get", id),
  importGuidanceProfile: () => ipcRenderer.invoke("guidance:import"),
  exportGuidanceProfile: () => ipcRenderer.invoke("guidance:export"),
  openGuidanceFolder: () => ipcRenderer.invoke("guidance:open-folder"),
  getClinicSources: () => ipcRenderer.invoke("clinic:status"),
  chooseClinicSourceRoot: () => ipcRenderer.invoke("clinic:choose-root"),
  openClinicSourceRoot: () => ipcRenderer.invoke("clinic:open-root"),
  readClinicSource: (payload) => ipcRenderer.invoke("clinic:read-source", payload),
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:write", text),
  readFocusedField: (options) => ipcRenderer.invoke("field:read-focused", options),
  writeFocusedField: (payload) => ipcRenderer.invoke("field:write-focused", payload),
  getWorkflowState: () => ipcRenderer.invoke("workflow:get"),
  newWorkflowCase: (payload) => ipcRenderer.invoke("workflow:new-case", payload),
  patchWorkflow: (payload) => ipcRenderer.invoke("workflow:patch", payload),
  addWorkflowArtifact: (payload) => ipcRenderer.invoke("workflow:add-artifact", payload),
  getShortcutStatus: () => ipcRenderer.invoke("helper:shortcut-status"),
  retryShortcuts: () => ipcRenderer.invoke("helper:retry-shortcuts"),
  hideHelper: () => ipcRenderer.invoke("ui:hide-helper"),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  setHelperFocusable: (value) => ipcRenderer.invoke("ui:set-helper-focusable", Boolean(value)),
  setHelperCubeMode: (mode) => ipcRenderer.invoke("ui:set-helper-cube-mode", mode),
  setHelperPanel: (panel, request = null) => ipcRenderer.invoke("ui:set-helper-panel", request ? { panel, ...request } : panel),
  chooseContextSource: () => ipcRenderer.invoke("context:choose"),
  saveContextReport: (report) => ipcRenderer.invoke("context:save-report", report),
  saveCorrectionDraft: (payload) => ipcRenderer.invoke("context:save-draft", payload),
  chooseReferences: () => ipcRenderer.invoke("reference:choose"),
  fetchReferenceUrl: (url) => ipcRenderer.invoke("reference:fetch-url", url),
  captureScreen: () => ipcRenderer.invoke("screen:snip"),
  releaseScreenCapture: (capturePath) => ipcRenderer.invoke("screen:release", capturePath),
  copyScreenCapture: (dataUrl) => ipcRenderer.invoke("snip:copy", dataUrl),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  onReady: (callback) => ipcRenderer.once("agent:ready", (_event, payload) => callback(payload)),
  onError: (callback) => ipcRenderer.on("agent:error", (_event, payload) => callback(payload)),
  onWorkflowState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("workflow:state", listener);
    return () => ipcRenderer.removeListener("workflow:state", listener);
  },
  onToggleDictation: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("helper:toggle-dictation", listener);
    return () => ipcRenderer.removeListener("helper:toggle-dictation", listener);
  },
  onCaptureFocusedField: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("helper:capture-field", listener);
    return () => ipcRenderer.removeListener("helper:capture-field", listener);
  },
  onContextMenu: (callback) => {
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("helper:context-menu", listener);
    return () => ipcRenderer.removeListener("helper:context-menu", listener);
  },
});
