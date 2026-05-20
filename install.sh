#!/usr/bin/env bash
set -euo pipefail

OWNER="ryangerardwilson"
REPO="vfs"
APP_NAME="vfs"
INSTALL_ROOT="${VFS_INSTALL_ROOT:-$HOME/.vfs}"
APP_DIR="$INSTALL_ROOT/app"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/$APP_NAME"

usage() {
  cat <<'EOF'
vfs installer

flags:
  install.sh -h
    show this help
  install.sh -v
    print the latest GitHub release version
  install.sh -v <version>
    install a specific release version
  install.sh -u
    upgrade to the latest release if newer than installed
  install.sh -b <archive.tar.gz>
    install from a local source archive
EOF
}

die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

strip_v() {
  printf '%s\n' "${1#v}"
}

latest_version() {
  need curl
  curl -fsSL "https://api.github.com/repos/$OWNER/$REPO/releases/latest" |
    sed -n 's/.*"tag_name":[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' |
    head -n 1
}

archive_url_for_version() {
  local version
  version="$(strip_v "$1")"
  printf 'https://github.com/%s/%s/archive/refs/tags/v%s.tar.gz\n' "$OWNER" "$REPO" "$version"
}

install_from_archive() {
  local archive="$1"
  local tmp_dir source_dir
  need npm
  need node
  need tar
  tmp_dir="$(mktemp -d)"

  tar -xzf "$archive" -C "$tmp_dir"
  source_dir="$(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [ -z "$source_dir" ]; then
    rm -rf "$tmp_dir"
    die "archive did not contain a source directory"
  fi

  rm -rf "$APP_DIR"
  mkdir -p "$INSTALL_ROOT" "$BIN_DIR"
  cp -R "$source_dir" "$APP_DIR"
  chmod +x "$APP_DIR/vfs" "$APP_DIR/bin/vfs.mjs"
  (cd "$APP_DIR" && npm install --omit=dev && npm install --no-save electron@^41.3.0)
  ln -sfn "$APP_DIR/vfs" "$LAUNCHER"

  if ! printf '%s' ":$PATH:" | grep -q ":$BIN_DIR:"; then
    printf 'Add this to ~/.bashrc if needed:\n'
    printf 'export PATH="$HOME/.local/bin:$PATH"\n'
  fi

  "$LAUNCHER" -v >/dev/null
  printf 'installed vfs %s\n' "$("$LAUNCHER" -v)"
  rm -rf "$tmp_dir"
}

install_version() {
  local version url archive
  version="$(strip_v "$1")"
  [ -n "$version" ] || die "empty version"
  need curl
  url="$(archive_url_for_version "$version")"
  archive="$(mktemp)"
  curl -fsSL "$url" -o "$archive"
  install_from_archive "$archive"
  rm -f "$archive"
}

upgrade_latest() {
  local latest installed=""
  latest="$(latest_version)"
  [ -n "$latest" ] || die "could not determine latest release"
  if [ -x "$LAUNCHER" ]; then
    installed="$("$LAUNCHER" -v 2>/dev/null || true)"
  fi
  if [ "$installed" = "$latest" ]; then
    printf 'vfs %s already installed\n' "$installed"
    return 0
  fi
  install_version "$latest"
}

mode=""
version_arg=""
bundle_arg=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -u|--upgrade)
      [ -z "$mode" ] || die "-u cannot be combined with another install mode"
      mode="upgrade"
      shift
      ;;
    -v|--version)
      if [ "${2:-}" ] && [[ "${2:-}" != -* ]]; then
        [ -z "$mode" ] || die "-v <version> cannot be combined with another install mode"
        mode="version"
        version_arg="$2"
        shift 2
      else
        latest_version
        exit 0
      fi
      ;;
    -b|--bundle)
      [ -z "$mode" ] || die "-b cannot be combined with another install mode"
      [ "${2:-}" ] || die "-b requires an archive path"
      mode="bundle"
      bundle_arg="$2"
      shift 2
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

case "$mode" in
  upgrade)
    upgrade_latest
    ;;
  version)
    install_version "$version_arg"
    ;;
  bundle)
    install_from_archive "$bundle_arg"
    ;;
  "")
    upgrade_latest
    ;;
esac
