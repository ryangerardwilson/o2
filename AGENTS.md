# AGENTS.md

## Product

`vfs` is a CLI-launched Electron file navigator inspired by `o` and `evim`.

It is not a terminal TUI, but it keeps the `o` navigation grammar:

- `j` and `k` move rows.
- `h` returns to the parent directory.
- `l` or `Enter` enters a directory or opens a file in Vim.

## Interface

- Keep the window transparent.
- Keep the visual system black, white, and gray.
- Keep the surface dense, quiet, keyboard-first, and low chrome.
- Prefer the simplest useful file-navigation surface before adding visual modes.
- Do not introduce colored UI accents.
- Do not turn the first screen into a landing page or documentation page.
- Keep file navigation as the main surface.

## Architecture

- `bin/vfs.mjs` owns the CLI launcher and `-h`, `-v`, `-u`.
- `electron/` owns the Electron shell, preload bridge, and filesystem IPC.
- `src/` owns the React renderer and shared filesystem model.
- `test/` owns Node test coverage for CLI contract and filesystem behavior.
- `package.json` is the single checked-in version source for this Node app.

Renderer code must not use Node integration directly. Filesystem access goes
through preload-exposed IPC methods.

## Development

- `npm install` installs dependencies.
- `npm run desktop` starts the transparent Electron app from source.
- `npm run build` verifies the renderer bundle.
- `npm test` runs local tests.

Do not assume a shipped release, tag, push, or installed upgrade unless the
user explicitly asks for that path.
