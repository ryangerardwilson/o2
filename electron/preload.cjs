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
  onControlKey(handler) {
    const listener = (_event, key) => handler(key);
    ipcRenderer.on("o2:control-key", listener);
    return () => ipcRenderer.removeListener("o2:control-key", listener);
  },
  quit() {
    ipcRenderer.send("o2:quit");
  }
});
