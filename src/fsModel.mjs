import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cfg",
  ".conf",
  ".cpp",
  ".css",
  ".csv",
  ".env",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);

const IMAGE_MIME_BY_EXTENSION = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".webp", "image/webp"]
]);

export function expandHome(value) {
  const raw = String(value || "");
  if (raw === "~") {
    return os.homedir();
  }
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

export function prettyPath(value) {
  const fullPath = path.resolve(expandHome(value || ""));
  const home = path.resolve(os.homedir());
  if (fullPath === home) {
    return "~";
  }
  if (fullPath.startsWith(`${home}${path.sep}`)) {
    return `~/${path.relative(home, fullPath)}`;
  }
  return fullPath;
}

export async function normalizeStartPath(value, fallback = process.cwd()) {
  const raw = String(value || fallback || process.cwd()).trim();
  const fullPath = path.resolve(expandHome(raw));
  const stats = await fs.stat(fullPath);
  if (stats.isDirectory()) {
    return { directory: fullPath, focusPath: "" };
  }
  if (stats.isFile()) {
    return { directory: path.dirname(fullPath), focusPath: fullPath };
  }
  throw new Error("path must be a file or directory");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["pipe", "pipe", "ignore"]
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve({ code: 127, stdout: "" }));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout }));
    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

async function gitRepoRoot(directory) {
  const result = await runCommand("git", [
    "-C",
    directory,
    "rev-parse",
    "--show-toplevel"
  ]);
  if (result.code !== 0) {
    return "";
  }
  return result.stdout.trim();
}

async function gitIgnoredNames(directory, names) {
  if (!names.length) {
    return new Set();
  }

  const repoRoot = await gitRepoRoot(directory);
  if (!repoRoot) {
    return new Set();
  }

  const relPaths = names.map((name) =>
    path.relative(repoRoot, path.join(directory, name)).replace(/\\/g, "/")
  );
  const result = await runCommand(
    "git",
    ["-C", repoRoot, "check-ignore", "--stdin"],
    { input: `${relPaths.join("\n")}\n` }
  );
  if (result.code !== 0) {
    return new Set();
  }

  const ignoredRelPaths = new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const ignored = new Set();
  relPaths.forEach((relPath, index) => {
    if (ignoredRelPaths.has(relPath)) {
      ignored.add(names[index]);
    }
  });
  return ignored;
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function splitPatterns(value) {
  return String(value || "")
    .replace(/^\//, "")
    .replace(/;/g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function matchesFilter(name, filter) {
  const patterns = splitPatterns(filter);
  if (!patterns.length) {
    return true;
  }

  return patterns.some((pattern) => {
    const normalized = /[*?\[\]]/.test(pattern) ? pattern : `${pattern}*`;
    return globToRegExp(normalized).test(name);
  });
}

function alphaSortKey(entry) {
  const hiddenGroup = entry.hidden ? 2 : 0;
  const typeGroup = entry.isDirectory ? 0 : 1;
  return [hiddenGroup + typeGroup, entry.name.toLowerCase()];
}

export function sortEntries(entries, sortMode = "alpha") {
  const next = entries.slice();
  if (sortMode === "mtime_asc" || sortMode === "mtime_desc") {
    const multiplier = sortMode === "mtime_desc" ? -1 : 1;
    next.sort((a, b) => {
      const timeDelta = (a.mtimeMs - b.mtimeMs) * multiplier;
      if (timeDelta !== 0) {
        return timeDelta;
      }
      return a.name.localeCompare(b.name);
    });
    return next;
  }

  next.sort((a, b) => {
    const left = alphaSortKey(a);
    const right = alphaSortKey(b);
    if (left[0] !== right[0]) {
      return left[0] - right[0];
    }
    return left[1].localeCompare(right[1]);
  });
  return next;
}

export async function listDirectory({
  dir,
  showHidden = false,
  filter = "",
  sortMode = "alpha",
  ignoreGitIgnored = false
} = {}) {
  const directory = path.resolve(expandHome(dir || process.cwd()));
  const dirents = await fs.readdir(directory, { withFileTypes: true });
  const names = dirents.map((entry) => entry.name);
  const ignoredNames = ignoreGitIgnored
    ? await gitIgnoredNames(directory, names)
    : new Set();

  const collectEntries = async (ignored) => {
    const entries = [];
    for (const dirent of dirents) {
      const name = dirent.name;
      if (name === "." || name === "..") {
        continue;
      }
      const hidden = name.startsWith(".");
      if (hidden && !showHidden) {
        continue;
      }
      if (ignored.has(name)) {
        continue;
      }
      if (!matchesFilter(name, filter)) {
        continue;
      }

      const fullPath = path.join(directory, name);
      let stats;
      try {
        stats = await fs.stat(fullPath);
      } catch {
        continue;
      }

      const isDirectory = stats.isDirectory();
      const extension = isDirectory ? "" : path.extname(name).toLowerCase();
      entries.push({
        name,
        path: fullPath,
        prettyPath: prettyPath(fullPath),
        isDirectory,
        extension,
        hidden,
        size: stats.size,
        mtimeMs: stats.mtimeMs
      });
    }
    return entries;
  };

  let entries = await collectEntries(ignoredNames);
  if (entries.length === 0 && ignoredNames.size > 0) {
    entries = await collectEntries(new Set());
  }

  return {
    path: directory,
    prettyPath: prettyPath(directory),
    parentPath: path.dirname(directory),
    entries: sortEntries(entries, sortMode)
  };
}

export function isLikelyTextFile(filePath, size = 0) {
  if (size > 512 * 1024) {
    return false;
  }
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function imageMimeType(filePath) {
  return IMAGE_MIME_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) || "";
}

export function isLikelyImageFile(filePath) {
  return Boolean(imageMimeType(filePath));
}

export function isLikelyPdfFile(filePath) {
  return path.extname(filePath).toLowerCase() === ".pdf";
}
