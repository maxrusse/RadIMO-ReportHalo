const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reportHaloFieldMapper", {
  getStatus: () => ipcRenderer.invoke("field-mapper:status"),
  setConfig: (payload) => ipcRenderer.invoke("field-mapper:set-config", payload),
  scan: (payload) => ipcRenderer.invoke("field-mapper:scan", payload),
  copy: (value) => ipcRenderer.invoke("field-mapper:copy", value),
  saveReport: (value) => ipcRenderer.invoke("field-mapper:save-report", value),
  quit: () => ipcRenderer.invoke("field-mapper:quit"),
  onScanComplete: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("field-mapper:scan-complete", listener);
    return () => ipcRenderer.removeListener("field-mapper:scan-complete", listener);
  },
});
