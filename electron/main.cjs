const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const { constants: fsConstants } = require("node:fs");
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

function commandPath(command) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${shellQuote(command)}`], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("exit", async (code) => {
      const foundPath = code === 0 ? stdout.trim().split(/\r?\n/)[0] || "" : "";
      if (foundPath) {
        resolve(foundPath);
        return;
      }
      for (const directory of ["/usr/bin", "/bin", "/usr/local/bin"]) {
        const candidate = path.join(directory, command);
        try {
          await fs.access(candidate, fsConstants.X_OK);
          resolve(candidate);
          return;
        } catch {
          // Try the next common system bin directory.
        }
      }
      resolve("");
    });
    child.on("error", () => resolve(""));
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
  const root = path.parse(base).root;
  const insideBase = base === root ? fullPath.startsWith(root) : fullPath.startsWith(`${base}${path.sep}`);
  if (fullPath !== base && !insideBase) {
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

async function pathExists(fullPath) {
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

function isSameOrChildPath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function duplicateName(baseName, isDirectory, index) {
  if (isDirectory) {
    return index === 1 ? `${baseName} copy` : `${baseName} copy ${index}`;
  }
  const parsed = path.parse(baseName);
  const stem = parsed.name || baseName;
  return index === 1 ? `${stem} copy${parsed.ext}` : `${stem} copy ${index}${parsed.ext}`;
}

async function uniqueChildPath(directory, baseName, { isDirectory = false } = {}) {
  const resolvedDirectory = path.resolve(directory);
  let target = safeChildPath(resolvedDirectory, baseName);
  if (!(await pathExists(target))) {
    return target;
  }
  for (let index = 1; index < 10000; index += 1) {
    target = safeChildPath(resolvedDirectory, duplicateName(baseName, isDirectory, index));
    if (!(await pathExists(target))) {
      return target;
    }
  }
  throw new Error("could not find an available destination name");
}

async function requireDirectory(directory) {
  const resolvedDirectory = path.resolve(directory);
  const stats = await fs.stat(resolvedDirectory);
  if (!stats.isDirectory()) {
    throw new Error("destination must be a directory");
  }
  return resolvedDirectory;
}

function topLevelPaths(paths) {
  const resolved = Array.from(
    new Set(paths.map((value) => String(value || "").trim()).filter(Boolean).map((value) => path.resolve(value)))
  );
  resolved.sort((left, right) => left.length - right.length);
  const result = [];
  for (const candidate of resolved) {
    if (!result.some((kept) => isSameOrChildPath(kept, candidate))) {
      result.push(candidate);
    }
  }
  return result;
}

async function pasteOnePath({ source, dir, mode }) {
  const sourcePath = path.resolve(source);
  const targetDirectory = await requireDirectory(dir);
  const sourceStats = await fs.stat(sourcePath);
  const sourceName = path.basename(sourcePath);
  const isDirectory = sourceStats.isDirectory();
  const operation = mode === "move" ? "move" : "copy";

  if (isDirectory && isSameOrChildPath(sourcePath, targetDirectory)) {
    throw new Error("cannot paste a folder inside itself");
  }

  if (operation === "move" && path.resolve(path.dirname(sourcePath)) === targetDirectory) {
    return { ok: true, mode: operation, path: sourcePath, name: sourceName, unchanged: true };
  }

  const target = await uniqueChildPath(targetDirectory, sourceName, { isDirectory });

  if (operation === "copy") {
    await fs.cp(sourcePath, target, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
      force: false
    });
    return { ok: true, mode: operation, path: target, name: path.basename(target) };
  }

  try {
    await fs.rename(sourcePath, target);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }
    await fs.cp(sourcePath, target, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
      force: false
    });
    await fs.rm(sourcePath, { recursive: true, force: false });
  }
  return { ok: true, mode: operation, path: target, name: path.basename(target) };
}

async function pastePaths({ sources, dir, mode }) {
  const sourcePaths = topLevelPaths(Array.isArray(sources) ? sources : [sources]);
  if (!sourcePaths.length) {
    throw new Error("nothing to paste");
  }
  const results = [];
  for (const source of sourcePaths) {
    results.push(await pasteOnePath({ source, dir, mode }));
  }
  return {
    ok: true,
    mode: mode === "move" ? "move" : "copy",
    count: results.length,
    path: results.find((result) => !result.unchanged)?.path || results[0]?.path || "",
    results
  };
}

async function deletePaths(paths) {
  const targets = topLevelPaths(Array.isArray(paths) ? paths : [paths]);
  if (!targets.length) {
    throw new Error("nothing to delete");
  }
  for (const target of targets) {
    await fs.stat(target);
    try {
      if (typeof shell.trashItem !== "function") {
        throw new Error("trash unavailable");
      }
      await shell.trashItem(target);
    } catch {
      await fs.rm(target, { recursive: true, force: false });
    }
  }
  return { ok: true, count: targets.length };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      reject(new Error(`${path.basename(command)} failed: ${error.message}`));
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

async function extractZip(filePath) {
  const fullPath = path.resolve(filePath);
  const stats = await fs.stat(fullPath);
  if (!stats.isFile() || path.extname(fullPath).toLowerCase() !== ".zip") {
    throw new Error("select a .zip file");
  }

  const parentDirectory = path.dirname(fullPath);
  await requireDirectory(parentDirectory);
  const targetDirectory = await uniqueChildPath(parentDirectory, path.basename(fullPath, path.extname(fullPath)), {
    isDirectory: true
  });
  const tempDirectory = await fs.mkdtemp(path.join(parentDirectory, `.${path.basename(targetDirectory)}.o2-`));

  try {
    const bsdtarPath = await commandPath("bsdtar");
    const unzipPath = await commandPath("unzip");
    if (bsdtarPath) {
      await runProcess(bsdtarPath, ["-xmf", fullPath, "-C", tempDirectory], { cwd: parentDirectory });
    } else if (unzipPath) {
      await runProcess(unzipPath, ["-qDD", fullPath, "-d", tempDirectory], { cwd: parentDirectory });
    } else {
      throw new Error("install unzip or bsdtar to extract zip files");
    }
    await fs.rename(tempDirectory, targetDirectory);
  } catch (error) {
    await fs.rm(tempDirectory, { recursive: true, force: true });
    throw error;
  }

  return { ok: true, path: targetDirectory, name: path.basename(targetDirectory) };
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
    if (
      input.control &&
      !input.alt &&
      !input.meta &&
      !inputModeByWebContentsId.get(window.webContents.id) &&
      ["h", "j", "k", "l", "m"].includes(normalizedKey)
    ) {
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
  ipcMain.handle("o2:paste-paths", (_event, args) => pastePaths(args));
  ipcMain.handle("o2:delete-paths", (_event, paths) => deletePaths(paths));
  ipcMain.handle("o2:extract-zip", (_event, filePath) => extractZip(filePath));
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
