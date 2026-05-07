# o2

`o2` is an Electron file navigator with `o`-style hjkl movement and `evim`-style
transparent dark chrome. It opens on the current directory by default and keeps
the first version focused on a simple keyboard-first file list with preview.

## Install

From a source checkout:

```bash
npm install
ln -sfn "$PWD/o2" "$HOME/.local/bin/o2"
```

Make sure `~/.local/bin` is on your `PATH`.

## CLI

```bash
o2
o2 ~/Apps/o2
o2 -h
o2 -v
o2 -u
```

Running `o2` with no path opens the current working directory. Passing a file
opens its parent directory and focuses the file when possible.

Unlike `o`, `o2` does not hide gitignored entries by default. Desktop
navigation should show ordinary folders such as `~/Downloads` even when a parent
repo ignores them.

## Navigation

- `j` / `k`: move down or up
- `h`: parent directory
- `l`: enter the focused directory or open the focused file in Vim
- `Enter`: enter the focused directory or open the focused file in Vim
- `Ctrl+J` / `Ctrl+K`: scroll the preview pane
- `Ctrl+H` / `Ctrl+L`: back and forward through directory history
- `/`: filter by name
- `?`: shortcut overlay
- `,dot`: toggle dotfiles
- `,sa`, `,sma`, `,smd`: sort by name, modified ascending, modified descending
- `,nf`, `,nd`, `,rn`: create file, create directory, rename selection
- `e`: open the focused file in Vim
- `o`: open the focused file with the desktop default app
- `r`: refresh
- `~`: jump home
- `q` or `Ctrl+C`: quit

To choose a terminal or editor explicitly:

The preview pane supports text files, common image formats, and PDFs.

```bash
O2_TERMINAL=alacritty O2_EDITOR=nvim o2
```

## Development

```bash
npm install
npm run desktop
npm test
npm run build
```

`o2 -v` prints the installed app version from `package.json`.

## Release

`o2` follows the local RGW CLI contract:

- `o2 -h` prints help.
- `o2 -v` prints the installed version from `package.json`.
- `o2 -u` delegates to the installer upgrade path.
- `install.sh -h`, `install.sh -v`, `install.sh -v <version>`, `install.sh -u`,
  and `install.sh -b <archive.tar.gz>` are supported.

After the GitHub repository is configured, release and upgrade with:

```bash
./push_release_upgrade.sh
```

The script checks the tree, bumps the patch version from the latest remote tag,
runs tests and a production build, pushes the tag, waits for GitHub Actions to
publish the release, and then upgrades the local install through `install.sh -u`.
