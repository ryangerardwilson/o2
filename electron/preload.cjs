const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vfs", {
  listDirectory(args) {
    return ipcRenderer.invoke("vfs:list-directory", args);
  },
  previewPath(filePath) {
    return ipcRenderer.invoke("vfs:preview-path", filePath);
  },
  openInEditor(filePath) {
    return ipcRenderer.invoke("vfs:open-editor", filePath);
  },
  openExternal(filePath) {
    return ipcRenderer.invoke("vfs:open-external", filePath);
  },
  createFile(args) {
    return ipcRenderer.invoke("vfs:create-file", args);
  },
  createDirectory(args) {
    return ipcRenderer.invoke("vfs:create-directory", args);
  },
  renamePath(args) {
    return ipcRenderer.invoke("vfs:rename-path", args);
  },
  pastePaths(args) {
    return ipcRenderer.invoke("vfs:paste-paths", args);
  },
  deletePaths(paths) {
    return ipcRenderer.invoke("vfs:delete-paths", paths);
  },
  extractZip(filePath) {
    return ipcRenderer.invoke("vfs:extract-zip", filePath);
  },
  runShellCommand(args) {
    return ipcRenderer.invoke("vfs:run-shell-command", args);
  },
  onControlKey(handler) {
    const listener = (_event, key) => handler(key);
    ipcRenderer.on("vfs:control-key", listener);
    return () => ipcRenderer.removeListener("vfs:control-key", listener);
  },
  onPreviewKey(handler) {
    const listener = (_event, key) => handler(key);
    ipcRenderer.on("vfs:preview-key", listener);
    return () => ipcRenderer.removeListener("vfs:preview-key", listener);
  },
  setInputMode(active) {
    ipcRenderer.send("vfs:set-input-mode", Boolean(active));
  },
  quit() {
    ipcRenderer.send("vfs:quit");
  }
});
