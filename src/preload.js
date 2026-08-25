const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("radimoAgent", {
  getStatus: () => ipcRenderer.invoke("agent:status"),
  startBrowserLogin: () => ipcRenderer.invoke("agent:browser-login"),
  logout: () => ipcRenderer.invoke("agent:logout"),
  listModels: () => ipcRenderer.invoke("agent:models"),
  startThread: (options) => ipcRenderer.invoke("agent:thread", options),
  newDiscussion: (options) => ipcRenderer.invoke("agent:new-discussion", options),
  sendTurn: (payload) => ipcRenderer.invoke("agent:turn", payload),
  openUrl: (url) => ipcRenderer.invoke("agent:open-url", url),
  getDiagnostics: () => ipcRenderer.invoke("agent:diagnostics"),
  copyDiagnostics: () => ipcRenderer.invoke("agent:copy-diagnostics"),
  testConnection: () => ipcRenderer.invoke("agent:test-connection"),
  setProxy: (value) => ipcRenderer.invoke("agent:set-proxy", value),
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
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:write", text),
  readFocusedField: (options) => ipcRenderer.invoke("field:read-focused", options),
  writeFocusedField: (payload) => ipcRenderer.invoke("field:write-focused", payload),
  getWorkflowState: () => ipcRenderer.invoke("workflow:get"),
  newWorkflowCase: (payload) => ipcRenderer.invoke("workflow:new-case", payload),
  patchWorkflow: (payload) => ipcRenderer.invoke("workflow:patch", payload),
  addWorkflowArtifact: (payload) => ipcRenderer.invoke("workflow:add-artifact", payload),
  toggleHelper: () => ipcRenderer.invoke("ui:toggle-helper"),
  showMain: (payload) => ipcRenderer.invoke("ui:show-main", payload),
  openMainWithDraft: (payload) => ipcRenderer.invoke("ui:show-main", payload),
  hideHelper: () => ipcRenderer.invoke("ui:hide-helper"),
  setHelperFocusable: (value) => ipcRenderer.invoke("ui:set-helper-focusable", Boolean(value)),
  chooseContextSource: () => ipcRenderer.invoke("context:choose"),
  saveContextReport: (report) => ipcRenderer.invoke("context:save-report", report),
  saveCorrectionDraft: (payload) => ipcRenderer.invoke("context:save-draft", payload),
  chooseReferences: () => ipcRenderer.invoke("reference:choose"),
  fetchReferenceUrl: (url) => ipcRenderer.invoke("reference:fetch-url", url),
  captureScreen: () => ipcRenderer.invoke("screen:snip"),
  copyScreenCapture: (dataUrl) => ipcRenderer.invoke("snip:copy", dataUrl),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  onReady: (callback) => ipcRenderer.once("agent:ready", (_event, payload) => callback(payload)),
  onError: (callback) => ipcRenderer.on("agent:error", (_event, payload) => callback(payload)),
  onWorkflow: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("workflow:open", listener);
    return () => ipcRenderer.removeListener("workflow:open", listener);
  },
  onWorkflowState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("workflow:state", listener);
    return () => ipcRenderer.removeListener("workflow:state", listener);
  },
});
