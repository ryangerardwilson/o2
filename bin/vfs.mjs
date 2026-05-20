#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { normalizeStartPath } from "../src/fsModel.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const HELP = `vfs

flags:
  vfs -h
    show this help
  vfs -v
    print the installed version
  vfs -u
    upgrade through the installer

features:
  open the Electron navigator in the current directory
  # vfs
  vfs

  open a directory or reveal a file's parent directory
  # vfs <path>
  vfs ~/Apps/o2
  vfs README.md

  run from source while developing
  # npm run desktop
  npm run desktop
`;

async function packageVersion() {
  const raw = await fs.readFile(path.join(appRoot, "package.json"), "utf8");
  return JSON.parse(raw).version;
}

function runInstallerUpgrade() {
  const installScript = process.env.VFS_INSTALL_SCRIPT || process.env.VFILES_INSTALL_SCRIPT || process.env.O2_INSTALL_SCRIPT || path.join(appRoot, "install.sh");
  return new Promise((resolve, reject) => {
    const child = spawn(installScript, ["-u"], {
      cwd: appRoot,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve(signal ? 128 : code || 0);
    });
  });
}

function runElectron({ directory, focusPath }) {
  return new Promise((resolve, reject) => {
    const require = createRequire(import.meta.url);
    const electronPath = require("electron");
    const child = spawn(
      electronPath,
      [
        "--in-process-gpu",
        "--disable-gpu-sandbox",
        "--disable-vulkan",
        "--disable-features=Vulkan,VulkanFromANGLE",
        "electron/main.cjs"
      ],
      {
        cwd: appRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          VFS_START_DIR: directory,
          VFS_FOCUS_PATH: focusPath || "",
          O2_START_DIR: directory,
          O2_FOCUS_PATH: focusPath || ""
        }
      }
    );

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve(signal ? 128 : code || 0);
    });
  });
}

async function main(argv) {
  if (argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }

  if (argv.includes("-v")) {
    process.stdout.write(`${await packageVersion()}\n`);
    return 0;
  }

  if (argv.includes("-u")) {
    if (argv.length > 1) {
      throw new Error("-u cannot be combined with a path");
    }
    return runInstallerUpgrade();
  }

  if (argv.length > 1) {
    throw new Error("expected zero or one path");
  }

  const { directory, focusPath } = await normalizeStartPath(argv[0] || process.cwd());
  return runElectron({ directory, focusPath });
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`vfs: ${error.message}\n`);
    process.exit(1);
  });
