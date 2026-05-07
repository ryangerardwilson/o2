const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("o2", {
  listDirectory(args) {
    return ipcRenderer.invoke("o2:list-directory", args);
  },
  previewPath(filePath) {
    return ipcRenderer.invoke("o2:preview-path", filePath);
  },
  openInEditor(filePath) {
    return ipcRenderer.invoke("o2:open-editor", filePath);
  },
  openExternal(filePath) {
    return ipcRenderer.invoke("o2:open-external", filePath);
  },
  createFile(args) {
    return ipcRenderer.invoke("o2:create-file", args);
  },
  createDirectory(args) {
    return ipcRenderer.invoke("o2:create-directory", args);
  },
  renamePath(args) {
    return ipcRenderer.invoke("o2:rename-path", args);
  },
  pastePaths(args) {
    return ipcRenderer.invoke("o2:paste-paths", args);
  },
  deletePaths(paths) {
    return ipcRenderer.invoke("o2:delete-paths", paths);
  },
  extractZip(filePath) {
    return ipcRenderer.invoke("o2:extract-zip", filePath);
  },
  onControlKey(handler) {
    const listener = (_event, key) => handler(key);
    ipcRenderer.on("o2:control-key", listener);
    return () => ipcRenderer.removeListener("o2:control-key", listener);
  },
  onPreviewKey(handler) {
    const listener = (_event, key) => handler(key);
    ipcRenderer.on("o2:preview-key", listener);
    return () => ipcRenderer.removeListener("o2:preview-key", listener);
  },
  setInputMode(active) {
    ipcRenderer.send("o2:set-input-mode", Boolean(active));
  },
  quit() {
    ipcRenderer.send("o2:quit");
  }
});
