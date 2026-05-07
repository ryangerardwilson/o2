const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const appRoot = path.resolve(__dirname, "..");
const startDir = process.env.O2_START_DIR || process.cwd();
const focusPath = process.env.O2_FOCUS_PATH || "";
let viteServer = null;
let fsModelPromise = null;
const inputModeByWebContentsId = new Map();

app.commandLine.appendSwitch("in-process-gpu");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("disable-vulkan");
app.commandLine.appendSwitch("disable-features", "Vulkan,VulkanFromANGLE");
app.commandLine.appendSwitch("disable-http-cache");

function fsModel() {
  if (!fsModelPromise) {
    fsModelPromise = import(pathToFileURL(path.join(appRoot, "src", "fsModel.mjs")).href);
  }
  return fsModelPromise;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
      stdio: "ignore"
    });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function splitCommand(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizedInputKey(input) {
  const code = String(input.code || "");
  if (code.startsWith("Key")) {
    return code.slice(3).toLowerCase();
  }
  if (code === "Minus") {
    return "-";
  }
  if (code === "Equal") {
    return "=";
  }
  return String(input.key || "").toLowerCase();
}

async function resolveTerminalCommand({ workdir, title, command }) {
  const preferred = process.env.O2_TERMINAL || process.env.EVIM_TERMINAL || process.env.TERMINAL || "";
  const preferredParts = splitCommand(preferred);
  const preferredName = preferredParts[0] || "";
  const preferredBase = path.basename(preferredName);

  if (preferredBase && (await commandExists(preferredBase))) {
    if (preferredBase.includes("alacritty")) {
      return {
        executable: preferredName,
        args: [...preferredParts.slice(1), "--working-directory", workdir, "--title", title, "-e", "sh", "-lc", command]
      };
    }
    if (preferredBase.includes("kitty")) {
      return {
        executable: preferredName,
        args: [...preferredParts.slice(1), "--directory", workdir, "--title", title, "sh", "-lc", command]
      };
    }
    if (preferredBase.includes("wezterm")) {
      return {
        executable: preferredName,
        args: [...preferredParts.slice(1), "start", "--cwd", workdir, "--", "sh", "-lc", command]
      };
    }
    return {
      executable: preferredName,
      args: [...preferredParts.slice(1), "-e", "sh", "-lc", `cd ${shellQuote(workdir)} && ${command}`]
    };
  }

  if (await commandExists("alacritty")) {
    return {
      executable: "alacritty",
      args: ["--working-directory", workdir, "--title", title, "-e", "sh", "-lc", command]
    };
  }
  if (await commandExists("kitty")) {
    return {
      executable: "kitty",
      args: ["--directory", workdir, "--title", title, "sh", "-lc", command]
    };
  }
  if (await commandExists("wezterm")) {
    return {
      executable: "wezterm",
      args: ["start", "--cwd", workdir, "--", "sh", "-lc", command]
    };
  }
  if (await commandExists("foot")) {
    return {
      executable: "foot",
      args: ["--working-directory", workdir, "--title", title, "sh", "-lc", command]
    };
  }
  if (await commandExists("xterm")) {
    return {
      executable: "xterm",
      args: ["-T", title, "-e", "sh", "-lc", `cd ${shellQuote(workdir)} && ${command}`]
    };
  }
  if (await commandExists("xdg-terminal-exec")) {
    return {
      executable: "xdg-terminal-exec",
      args: ["sh", "-lc", `cd ${shellQuote(workdir)} && ${command}`]
    };
  }

  throw new Error("no supported terminal found");
}

function launchDetached({ executable, args, workdir }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workdir,
      detached: true,
      stdio: "ignore"
    });

    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    const timer = setTimeout(() => {
      child.unref();
      finish(resolve, null);
    }, 500);

    child.once("error", (error) => finish(reject, error));
    child.once("exit", (code, signal) => {
      finish(
        reject,
        new Error(`${executable} exited before opening${signal ? ` (${signal})` : ` (${code})`}`)
      );
    });
  });
}

async function openInEditor(filePath) {
  const fullPath = path.resolve(filePath);
  const stats = await fs.stat(fullPath);
  if (!stats.isFile()) {
    throw new Error("select a file");
  }
  const editor = process.env.O2_EDITOR || process.env.EVIM_EDITOR || process.env.VISUAL || process.env.EDITOR || "vim";
  const workdir = path.dirname(fullPath);
  const command = `${editor} ${shellQuote(fullPath)}`;
  const terminal = await resolveTerminalCommand({
    workdir,
    title: `o2 ${path.basename(fullPath)}`,
    command
  });
  await launchDetached({ ...terminal, workdir });
  return { ok: true, terminal: terminal.executable };
}

async function previewPath(filePath) {
  const { prettyPath, isLikelyTextFile, imageMimeType, isLikelyPdfFile } = await fsModel();
  const fullPath = path.resolve(filePath);
  const stats = await fs.stat(fullPath);
  if (stats.isDirectory()) {
    const entries = await fs.readdir(fullPath);
    return {
      type: "directory",
      path: fullPath,
      prettyPath: prettyPath(fullPath),
      count: entries.length,
      mtimeMs: stats.mtimeMs
    };
  }

  if (!stats.isFile()) {
    return {
      type: "other",
      path: fullPath,
      prettyPath: prettyPath(fullPath),
      size: stats.size,
      mtimeMs: stats.mtimeMs
    };
  }

  if (isLikelyPdfFile(fullPath)) {
    const maxInlinePdfSize = 40 * 1024 * 1024;
    if (stats.size > maxInlinePdfSize) {
      return {
        type: "pdf",
        path: fullPath,
        prettyPath: prettyPath(fullPath),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        mimeType: "application/pdf",
        tooLarge: true
      };
    }
    const buffer = await fs.readFile(fullPath);
    return {
      type: "pdf",
      path: fullPath,
      prettyPath: prettyPath(fullPath),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mimeType: "application/pdf",
      dataUrl: `data:application/pdf;base64,${buffer.toString("base64")}`
    };
  }

  const mimeType = imageMimeType(fullPath);
  if (mimeType) {
    const maxInlineImageSize = 20 * 1024 * 1024;
    if (stats.size > maxInlineImageSize) {
      return {
        type: "image",
        path: fullPath,
        prettyPath: prettyPath(fullPath),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        mimeType,
        tooLarge: true
      };
    }
    const buffer = await fs.readFile(fullPath);
    return {
      type: "image",
      path: fullPath,
      prettyPath: prettyPath(fullPath),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mimeType,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`
    };
  }

  if (!isLikelyTextFile(fullPath, stats.size)) {
    return {
      type: "binary",
      path: fullPath,
      prettyPath: prettyPath(fullPath),
      size: stats.size,
      mtimeMs: stats.mtimeMs
    };
  }

  const buffer = await fs.readFile(fullPath);
  if (buffer.includes(0)) {
    return {
      type: "binary",
      path: fullPath,
      prettyPath: prettyPath(fullPath),
      size: stats.size,
      mtimeMs: stats.mtimeMs
    };
  }

  return {
    type: "text",
    path: fullPath,
    prettyPath: prettyPath(fullPath),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    text: buffer.toString("utf8").slice(0, 12000)
  };
}

function safeChildPath(directory, name) {
  const cleanName = String(name || "").trim();
  if (!cleanName || cleanName.includes("\0")) {
    throw new Error("name is required");
  }
  const base = path.resolve(directory);
  const fullPath = path.resolve(base, cleanName);
  if (fullPath !== base && !fullPath.startsWith(`${base}${path.sep}`)) {
    throw new Error("path escapes the current directory");
  }
  return fullPath;
}

async function createFile({ dir, name }) {
  const target = safeChildPath(dir, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const handle = await fs.open(target, "wx");
  await handle.close();
  return { ok: true, path: target };
}

async function createDirectory({ dir, name }) {
  const target = safeChildPath(dir, name);
  await fs.mkdir(target, { recursive: false });
  return { ok: true, path: target };
}

async function renamePath({ from, name }) {
  const source = path.resolve(from);
  const target = safeChildPath(path.dirname(source), name);
  await fs.rename(source, target);
  return { ok: true, path: target };
}

async function startViteServer() {
  if (viteServer) {
    return viteServer.resolvedUrls?.local?.[0] || "http://127.0.0.1:5173/";
  }
  const { createServer } = await import("vite");
  viteServer = await createServer({
    root: appRoot,
    server: {
      host: "127.0.0.1",
      port: Number(process.env.O2_VITE_PORT || 5173),
      strictPort: false
    }
  });
  await viteServer.listen();
  return viteServer.resolvedUrls?.local?.[0] || "http://127.0.0.1:5173/";
}

async function loadApp(window) {
  const query = new URLSearchParams({
    dir: startDir,
    focus: focusPath,
    home: os.homedir()
  }).toString();

  if (process.env.O2_DEV === "1") {
    const url = await startViteServer();
    await window.loadURL(`${url}?${query}`);
    return;
  }

  const distPath = path.join(appRoot, "dist", "index.html");
  try {
    await fs.access(distPath);
    await window.loadFile(distPath, { query: { dir: startDir, focus: focusPath, home: os.homedir() } });
  } catch {
    const url = await startViteServer();
    await window.loadURL(`${url}?${query}`);
  }
}

function forwardGlobalKeys(window) {
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    const normalizedKey = normalizedInputKey(input);
    if (input.control && !input.alt && !input.meta && ["h", "j", "k", "l"].includes(normalizedKey)) {
      event.preventDefault();
      window.webContents.send("o2:control-key", normalizedKey);
      return;
    }
    if (input.control && !input.alt && !input.meta && normalizedKey === "c") {
      event.preventDefault();
      app.quit();
      return;
    }
    if (
      !input.control &&
      !input.alt &&
      !input.meta &&
      !inputModeByWebContentsId.get(window.webContents.id) &&
      (normalizedKey === "-" || normalizedKey === "=" || normalizedKey === "+")
    ) {
      event.preventDefault();
      window.webContents.send("o2:preview-key", normalizedKey === "-" ? "zoom-out" : "zoom-in");
    }
  });
}

async function createWindow() {
  Menu.setApplicationMenu(null);

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 560,
    minHeight: 420,
    backgroundColor: "#00000000",
    transparent: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  forwardGlobalKeys(window);
  await window.webContents.session.clearCache();
  await loadApp(window);
  window.focus();
}

app.whenReady().then(() => {
  ipcMain.handle("o2:list-directory", async (_event, args) => {
    const model = await fsModel();
    return model.listDirectory(args);
  });
  ipcMain.handle("o2:preview-path", (_event, filePath) => previewPath(filePath));
  ipcMain.handle("o2:open-editor", (_event, filePath) => openInEditor(filePath));
  ipcMain.handle("o2:open-external", async (_event, filePath) => {
    const message = await shell.openPath(path.resolve(filePath));
    if (message) {
      throw new Error(message);
    }
    return { ok: true };
  });
  ipcMain.handle("o2:create-file", (_event, args) => createFile(args));
  ipcMain.handle("o2:create-directory", (_event, args) => createDirectory(args));
  ipcMain.handle("o2:rename-path", (_event, args) => renamePath(args));
  ipcMain.on("o2:set-input-mode", (event, active) => {
    inputModeByWebContentsId.set(event.sender.id, Boolean(active));
  });
  ipcMain.on("o2:quit", () => app.quit());

  createWindow().catch((error) => {
    console.error(error);
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", async () => {
  if (viteServer) {
    await viteServer.close();
  }
});
