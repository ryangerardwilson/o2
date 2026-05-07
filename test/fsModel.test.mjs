import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  imageMimeType,
  isLikelyPdfFile,
  isLikelyImageFile,
  listDirectory,
  matchesFilter,
  normalizeStartPath,
  sortEntries
} from "../src/fsModel.mjs";

test("normalizeStartPath returns file parent and focus path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "o2-model-"));
  const filePath = path.join(root, "note.md");
  await fs.writeFile(filePath, "# note\n", "utf8");

  const result = await normalizeStartPath(filePath);

  assert.equal(result.directory, root);
  assert.equal(result.focusPath, filePath);
});

test("listDirectory hides dotfiles by default and keeps directories first", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "o2-list-"));
  await fs.mkdir(path.join(root, "zeta"));
  await fs.mkdir(path.join(root, "alpha"));
  await fs.writeFile(path.join(root, "beta.txt"), "beta", "utf8");
  await fs.writeFile(path.join(root, ".secret"), "secret", "utf8");

  const result = await listDirectory({
    dir: root,
    ignoreGitIgnored: false
  });

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["alpha", "zeta", "beta.txt"]
  );
});

test("listDirectory shows gitignored entries by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "o2-gitignored-"));
  await fs.mkdir(path.join(root, "Downloads"));
  await fs.writeFile(path.join(root, ".gitignore"), "/Downloads/\n", "utf8");

  const gitInit = spawnSync("git", ["init"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(gitInit.status, 0, gitInit.stderr);

  const result = await listDirectory({ dir: root });

  assert.ok(result.entries.some((entry) => entry.name === "Downloads"));
});

test("listDirectory can show hidden files and filter names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "o2-filter-"));
  await fs.writeFile(path.join(root, ".env"), "x", "utf8");
  await fs.writeFile(path.join(root, "alpha.js"), "x", "utf8");
  await fs.writeFile(path.join(root, "beta.py"), "x", "utf8");

  const result = await listDirectory({
    dir: root,
    showHidden: true,
    filter: "*.py,.env",
    ignoreGitIgnored: false
  });

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["beta.py", ".env"]
  );
});

test("matchesFilter treats plain text as a prefix glob", () => {
  assert.equal(matchesFilter("alpha.txt", "alp"), true);
  assert.equal(matchesFilter("alpha.txt", "pha"), false);
  assert.equal(matchesFilter("alpha.txt", "*pha*"), true);
});

test("sortEntries supports modified descending", () => {
  const entries = [
    { name: "old", isDirectory: false, hidden: false, mtimeMs: 1 },
    { name: "new", isDirectory: false, hidden: false, mtimeMs: 10 }
  ];

  assert.deepEqual(
    sortEntries(entries, "mtime_desc").map((entry) => entry.name),
    ["new", "old"]
  );
});

test("image helpers recognize common image files", () => {
  assert.equal(isLikelyImageFile("photo.JPG"), true);
  assert.equal(imageMimeType("photo.JPG"), "image/jpeg");
  assert.equal(isLikelyImageFile("poster.WEBP"), true);
  assert.equal(imageMimeType("poster.WEBP"), "image/webp");
  assert.equal(isLikelyImageFile("notes.md"), false);
});

test("pdf helper recognizes pdf files", () => {
  assert.equal(isLikelyPdfFile("report.PDF"), true);
  assert.equal(isLikelyPdfFile("report.txt"), false);
});
