// Deliberately separate from the app preload: no server tokens, fetch, shell or filesystem access.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("__OPENWORK_COMPANION__", {
  state: () => ipcRenderer.invoke("openwork:companion:state"),
  onState: callback => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on("openwork:companion:state", handler);
    return () => ipcRenderer.removeListener("openwork:companion:state", handler);
  },
  view: value => ipcRenderer.invoke("openwork:companion:view", value),
  command: value => ipcRenderer.invoke("openwork:companion:command", value),
  openMain: () => ipcRenderer.invoke("openwork:companion:open-main"),
  preferences: value => ipcRenderer.invoke("openwork:companion:preferences", value),
  selectSession: key => ipcRenderer.invoke("openwork:companion:select-session", key),
  readSession: key => ipcRenderer.invoke("openwork:companion:read-session", key),
});
