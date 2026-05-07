import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const appRoot = path.resolve(new URL("..", import.meta.url).pathname);
const cli = path.join(appRoot, "bin", "o2.mjs");
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: appRoot,
    encoding: "utf8"
  });
}

test("o2 -h prints human help", () => {
  const result = runCli(["-h"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^o2\n/);
  assert.match(result.stdout, /features:/);
  assert.doesNotMatch(result.stdout, /Usage:/);
});

test("o2 -v prints package version only", () => {
  const result = runCli(["-v"]);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.equal(result.stderr, "");
});

test("o2 rejects multiple paths", () => {
  const result = runCli(["one", "two"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected zero or one path/);
});
