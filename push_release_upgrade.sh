#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'push_release_upgrade.sh: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

need git
need gh
need npm
need node

[ -d .git ] || die "run from the o2 git repository root"
[ -f package.json ] || die "package.json not found"
[ -f install.sh ] || die "install.sh not found"

git diff --quiet || die "working tree has unstaged changes"
git diff --cached --quiet || die "index has staged changes"

gh auth status >/dev/null

branch="$(git branch --show-current)"
[ -n "$branch" ] || die "could not determine current branch"

remote_url="$(git remote get-url origin 2>/dev/null || true)"
[ -n "$remote_url" ] || die "origin remote not configured"

latest_tag="$(
  git ls-remote --tags --refs origin 'v*' |
    awk '{print $2}' |
    sed 's#refs/tags/v##' |
    sort -V |
    tail -n 1
)"

current_version="$(node -p "require('./package.json').version")"
if [ -z "$latest_tag" ]; then
  next_version="$current_version"
else
  IFS=. read -r major minor patch <<<"$latest_tag"
  next_version="$major.$minor.$((patch + 1))"
fi

node - "$next_version" <<'NODE'
const fs = require("node:fs");
const version = process.argv[2];
for (const file of ["package.json", "package-lock.json"]) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.version = version;
  if (data.packages && data.packages[""]) {
    data.packages[""].version = version;
  }
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
NODE

npm install --package-lock-only
npm test
npm run build

if ! git diff --quiet -- package.json package-lock.json; then
  git add package.json package-lock.json
  git commit -m "release v$next_version"
fi

git push origin "$branch"
git tag "v$next_version"
git push origin "v$next_version"

printf 'waiting for GitHub Actions release v%s\n' "$next_version"
for _ in $(seq 1 120); do
  if gh release view "v$next_version" >/dev/null 2>&1; then
    ./install.sh -u
    exit 0
  fi
  sleep 2
done

die "release v$next_version was not visible after waiting for GitHub Actions"
