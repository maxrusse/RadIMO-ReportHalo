const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("radimoSnip", {
  finish: (rect) => ipcRenderer.invoke("snip:finish", rect),
  cancel: () => ipcRenderer.invoke("snip:cancel"),
});
