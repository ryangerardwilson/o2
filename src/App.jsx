import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const params = new URLSearchParams(window.location.search);
const START_DIR = params.get("dir") || "/";
const START_FOCUS = params.get("focus") || "";
const START_HOME = params.get("home") || "/";

const HELP_GROUPS = [
  {
    title: "navigation",
    items: [
      ["j / k", "move down / up"],
      ["h / l", "parent / enter"],
      ["enter", "enter or edit"],
      ["ctrl+j / ctrl+k", "jump rows"],
      ["ctrl+h / ctrl+l", "history"]
    ]
  },
  {
    title: "files",
    items: [
      [",nf", "new file"],
      [",nd", "new directory"],
      [",rn", "rename"],
      ["e", "edit file"],
      ["o", "desktop open"],
      ["r", "refresh"]
    ]
  },
  {
    title: "view",
    items: [
      ["/", "filter"],
      [",dot", "dotfiles"],
      [",sa", "sort name"],
      [",sma / ,smd", "sort modified"],
      ["~", "home"],
      ["q / ctrl+c", "quit"]
    ]
  }
];

function keyName(event) {
  if (event.key?.length === 1) {
    return event.key.toLowerCase();
  }
  if (event.code?.startsWith("Key")) {
    return event.code.slice(3).toLowerCase();
  }
  return event.key;
}

function isPlainKey(event, value) {
  return !event.ctrlKey && !event.altKey && !event.metaKey && keyName(event) === value;
}

function isPrintable(event) {
  return !event.ctrlKey && !event.altKey && !event.metaKey && event.key?.length === 1;
}

function isEnter(event) {
  return (
    event.key === "Enter" ||
    (event.ctrlKey && !event.altKey && !event.metaKey && keyName(event) === "m")
  );
}

function isEscape(event) {
  return (
    event.key === "Escape" ||
    (event.ctrlKey && !event.altKey && !event.metaKey && (keyName(event) === "[" || event.code === "BracketLeft"))
  );
}

function parentPath(value) {
  const normalized = String(value || "/").replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    return "/";
  }
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function clampIndex(index, total) {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(total - 1, index));
}

function wrapIndex(index, total) {
  if (total <= 0) {
    return 0;
  }
  return ((index % total) + total) % total;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function Prompt({ prompt, onCancel, onSubmit }) {
  const [value, setValue] = useState(prompt.initialValue || "");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="modal-layer">
      <form
        className="prompt-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <div className="prompt-title">{prompt.title}</div>
        <input
          ref={inputRef}
          value={value}
          spellCheck="false"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (isEscape(event)) {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </form>
    </div>
  );
}

function HelpOverlay({ onClose }) {
  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <div className="help-modal" onMouseDown={(event) => event.stopPropagation()}>
        {HELP_GROUPS.map((group) => (
          <section key={group.title}>
            <h2>{group.title}</h2>
            <dl>
              {group.items.map(([key, label]) => (
                <React.Fragment key={key}>
                  <dt>{key}</dt>
                  <dd>{label}</dd>
                </React.Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

function FileList({ entries, selectedIndex, onSelect }) {
  return (
    <div className="file-list">
      {entries.length === 0 ? (
        <div className="empty-row">(empty)</div>
      ) : (
        entries.map((entry, index) => (
          <button
            type="button"
            key={entry.path}
            className={`file-row ${index === selectedIndex ? "selected" : ""}`}
            onMouseEnter={() => onSelect(index)}
            onFocus={() => onSelect(index)}
          >
            <span className="file-cursor">{index === selectedIndex ? ">" : " "}</span>
            <span className="file-kind">{entry.isDirectory ? "/" : "."}</span>
            <span className="file-name">{entry.name}{entry.isDirectory ? "/" : ""}</span>
            <span className="file-meta">{entry.isDirectory ? "dir" : formatBytes(entry.size)}</span>
          </button>
        ))
      )}
    </div>
  );
}

function PreviewPane({ entry, preview }) {
  if (!entry) {
    return (
      <aside className="preview-pane">
        <div className="preview-heading">
          <strong>no selection</strong>
        </div>
      </aside>
    );
  }

  return (
    <aside className="preview-pane">
      <div className="preview-heading">
        <strong>{entry.name}{entry.isDirectory ? "/" : ""}</strong>
        <span>{entry.prettyPath}</span>
      </div>
      <div className="preview-stats">
        <span>{entry.isDirectory ? "directory" : entry.extension || "file"}</span>
        <span>{entry.isDirectory ? "dir" : formatBytes(entry.size)}</span>
        <span>{formatTime(entry.mtimeMs)}</span>
      </div>
      {preview?.type === "text" ? (
        <pre className="text-preview">{preview.text}</pre>
      ) : preview?.type === "pdf" && preview.dataUrl ? (
        <iframe className="pdf-preview" src={preview.dataUrl} title={entry.name} />
      ) : preview?.type === "pdf" && preview.tooLarge ? (
        <div className="preview-note">PDF too large to preview</div>
      ) : preview?.type === "image" && preview.dataUrl ? (
        <div className="image-preview">
          <img src={preview.dataUrl} alt={entry.name} />
        </div>
      ) : preview?.type === "image" && preview.tooLarge ? (
        <div className="preview-note">image too large to preview</div>
      ) : preview?.type === "directory" ? (
        <div className="preview-note">{preview.count} entries</div>
      ) : preview?.type === "binary" ? (
        <div className="preview-note">binary file</div>
      ) : (
        <div className="preview-note">preview unavailable</div>
      )}
    </aside>
  );
}

export default function App() {
  const [currentDir, setCurrentDir] = useState(START_DIR);
  const [focusPath, setFocusPath] = useState(START_FOCUS);
  const [entries, setEntries] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState("");
  const [filterDraft, setFilterDraft] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [sortMode, setSortMode] = useState("alpha");
  const [status, setStatus] = useState("");
  const [leader, setLeader] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pathHistory, setPathHistory] = useState([START_DIR]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const selectedPathRef = useRef(focusPath);

  const selectedEntry = entries[selectedIndex] || null;

  useEffect(() => {
    selectedPathRef.current = selectedEntry?.path || selectedPathRef.current || focusPath;
  }, [selectedEntry, focusPath]);

  useEffect(() => {
    let cancelled = false;
    const requestedFocus = focusPath || selectedPathRef.current;
    setLoading(true);
    window.o2
      .listDirectory({
        dir: currentDir,
        showHidden,
        filter,
        sortMode
      })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCurrentDir(result.path);
        setEntries(result.entries);
        const focusIndex = requestedFocus
          ? result.entries.findIndex((entry) => entry.path === requestedFocus)
          : -1;
        setSelectedIndex((current) => (focusIndex >= 0 ? focusIndex : clampIndex(current, result.entries.length)));
        setLoading(false);
        if (focusPath) {
          setFocusPath("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setEntries([]);
          setSelectedIndex(0);
          setLoading(false);
          setStatus(error.message || "failed to read directory");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentDir, showHidden, filter, sortMode, refreshTick, focusPath]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedEntry) {
      setPreview(null);
      return undefined;
    }
    window.o2
      .previewPath(selectedEntry.path)
      .then((nextPreview) => {
        if (!cancelled) {
          setPreview(nextPreview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEntry]);

  const navigateTo = useCallback(
    (directory, options = {}) => {
      const record = options.record !== false;
      setFocusPath(options.focusPath || "");
      selectedPathRef.current = options.focusPath || "";
      setSelectedIndex(0);
      setCurrentDir(directory);
      if (record) {
        setPathHistory((history) => {
          const base = history.slice(0, historyIndex + 1);
          if (base[base.length - 1] === directory) {
            return base;
          }
          return [...base, directory];
        });
        setHistoryIndex((index) => index + 1);
      }
    },
    [historyIndex]
  );

  const moveSelection = useCallback((delta) => {
    setSelectedIndex((index) => wrapIndex(index + delta, entries.length));
  }, [entries.length]);

  const jumpSelection = useCallback((direction) => {
    const jump = Math.max(1, Math.floor(entries.length / 10));
    setSelectedIndex((index) => clampIndex(index + direction * jump, entries.length));
  }, [entries.length]);

  const goParent = useCallback(() => {
    const parent = parentPath(currentDir);
    if (parent === currentDir) {
      setStatus("already at filesystem root");
      return;
    }
    navigateTo(parent, { focusPath: currentDir });
  }, [currentDir, navigateTo]);

  const openEntry = useCallback(
    async (entry = selectedEntry, mode = "editor") => {
      if (!entry) {
        return;
      }
      if (entry.isDirectory) {
        navigateTo(entry.path);
        return;
      }
      try {
        if (mode === "external") {
          await window.o2.openExternal(entry.path);
          setStatus(`opened ${entry.name}`);
        } else {
          const result = await window.o2.openInEditor(entry.path);
          setStatus(`editing ${entry.name}${result?.terminal ? ` in ${result.terminal}` : ""}`);
        }
      } catch (error) {
        setStatus(error.message || "open failed");
      }
    },
    [navigateTo, selectedEntry]
  );

  const refresh = useCallback(() => {
    setRefreshTick((value) => value + 1);
    setStatus("refreshed");
  }, []);

  const goHistory = useCallback(
    (delta) => {
      const nextIndex = historyIndex + delta;
      if (nextIndex < 0 || nextIndex >= pathHistory.length) {
        setStatus(delta < 0 ? "no previous directory" : "no next directory");
        return;
      }
      selectedPathRef.current = "";
      setHistoryIndex(nextIndex);
      setSelectedIndex(0);
      setCurrentDir(pathHistory[nextIndex]);
    },
    [historyIndex, pathHistory]
  );

  const runLeaderCommand = useCallback(
    (command) => {
      const actions = {
        j: () => setSelectedIndex(Math.max(0, entries.length - 1)),
        k: () => setSelectedIndex(0),
        dot: () => {
          setShowHidden((value) => !value);
          setStatus(showHidden ? "hiding dotfiles" : "showing dotfiles");
        },
        sa: () => {
          setSortMode("alpha");
          setStatus("sort: name");
        },
        sma: () => {
          setSortMode("mtime_asc");
          setStatus("sort: modified ascending");
        },
        smd: () => {
          setSortMode("mtime_desc");
          setStatus("sort: modified descending");
        },
        nf: () => setPrompt({ type: "file", title: "new file", initialValue: "" }),
        nd: () => setPrompt({ type: "directory", title: "new directory", initialValue: "" }),
        rn: () => {
          if (!selectedEntry) {
            setStatus("nothing to rename");
            return;
          }
          setPrompt({ type: "rename", title: "rename", initialValue: selectedEntry.name });
        }
      };

      if (actions[command]) {
        actions[command]();
        setLeader(null);
        return;
      }

      if (Object.keys(actions).some((name) => name.startsWith(command))) {
        setLeader(command);
        return;
      }

      setStatus(`unknown ,${command}`);
      setLeader(null);
    },
    [entries.length, selectedEntry, showHidden]
  );

  const submitPrompt = useCallback(
    async (value) => {
      const name = String(value || "").trim();
      if (!name) {
        setPrompt(null);
        return;
      }
      try {
        let result;
        if (prompt.type === "file") {
          result = await window.o2.createFile({ dir: currentDir, name });
          setStatus(`created ${name}`);
        } else if (prompt.type === "directory") {
          result = await window.o2.createDirectory({ dir: currentDir, name });
          setStatus(`created ${name}/`);
        } else if (prompt.type === "rename" && selectedEntry) {
          result = await window.o2.renamePath({ from: selectedEntry.path, name });
          setStatus(`renamed to ${name}`);
        }
        setPrompt(null);
        setFocusPath(result?.path || "");
        refresh();
      } catch (error) {
        setStatus(error.message || "operation failed");
        setPrompt(null);
      }
    },
    [currentDir, prompt, refresh, selectedEntry]
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (prompt) {
        return;
      }

      if (showHelp) {
        if (isEscape(event) || isPlainKey(event, "h") || isPlainKey(event, "?")) {
          event.preventDefault();
          setShowHelp(false);
        }
        return;
      }

      if (filterMode) {
        if (isEnter(event)) {
          event.preventDefault();
          const nextFilter = filterDraft.replace(/^\//, "");
          setFilter(nextFilter);
          setFilterMode(false);
          setStatus(nextFilter ? `filter: ${nextFilter}` : "filter cleared");
          return;
        }
        if (isEscape(event)) {
          event.preventDefault();
          setFilterDraft("");
          setFilter("");
          setFilterMode(false);
          setStatus("filter cleared");
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          setFilterDraft((value) => (value.length <= 1 ? "/" : value.slice(0, -1)));
          return;
        }
        if (isPrintable(event)) {
          event.preventDefault();
          setFilterDraft((value) => `${value || "/"}${event.key}`);
        }
        return;
      }

      if (leader !== null) {
        if (isEscape(event)) {
          event.preventDefault();
          setLeader(null);
          return;
        }
        if (isPrintable(event)) {
          event.preventDefault();
          runLeaderCommand(`${leader}${event.key.toLowerCase()}`);
        }
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.metaKey && keyName(event) === "c") {
        event.preventDefault();
        window.o2.quit();
        return;
      }

      if (isPlainKey(event, "q")) {
        event.preventDefault();
        window.o2.quit();
        return;
      }

      if (isPlainKey(event, "?")) {
        event.preventDefault();
        setShowHelp(true);
        return;
      }

      if (isPlainKey(event, ",")) {
        event.preventDefault();
        setLeader("");
        return;
      }

      if (isPlainKey(event, "/")) {
        event.preventDefault();
        if (filter) {
          setFilter("");
          setFilterDraft("");
          setStatus("filter cleared");
        } else {
          setFilterDraft("/");
          setFilterMode(true);
        }
        return;
      }

      if (isPlainKey(event, "~")) {
        event.preventDefault();
        navigateTo(START_HOME);
        return;
      }

      if (isPlainKey(event, "r")) {
        event.preventDefault();
        refresh();
        return;
      }

      if (isPlainKey(event, "e")) {
        event.preventDefault();
        openEntry(selectedEntry, "editor");
        return;
      }

      if (isPlainKey(event, "o")) {
        event.preventDefault();
        openEntry(selectedEntry, "external");
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        const key = keyName(event);
        if (key === "h") {
          event.preventDefault();
          goHistory(-1);
          return;
        }
        if (key === "l") {
          event.preventDefault();
          goHistory(1);
          return;
        }
        if (key === "j") {
          event.preventDefault();
          jumpSelection(1);
          return;
        }
        if (key === "k") {
          event.preventDefault();
          jumpSelection(-1);
          return;
        }
      }

      if (isPlainKey(event, "j")) {
        event.preventDefault();
        moveSelection(1);
        return;
      }
      if (isPlainKey(event, "k")) {
        event.preventDefault();
        moveSelection(-1);
        return;
      }
      if (isPlainKey(event, "h")) {
        event.preventDefault();
        goParent();
        return;
      }
      if (isPlainKey(event, "l") || isEnter(event)) {
        event.preventDefault();
        openEntry();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    filter,
    filterDraft,
    filterMode,
    goHistory,
    goParent,
    jumpSelection,
    leader,
    moveSelection,
    navigateTo,
    openEntry,
    prompt,
    refresh,
    runLeaderCommand,
    selectedEntry,
    showHelp
  ]);

  const statusLine = useMemo(() => {
    const parts = [
      `${entries.length ? selectedIndex + 1 : 0}/${entries.length}`,
      filter ? `/${filter}` : "",
      leader !== null ? `,${leader}` : "",
      showHidden ? ".dot" : "",
      sortMode === "alpha" ? "" : sortMode.replace("_", " "),
      loading ? "loading" : "",
      status
    ].filter(Boolean);
    return parts.join("  ");
  }, [entries.length, filter, leader, loading, selectedIndex, showHidden, sortMode, status]);

  return (
    <main className="app-shell" tabIndex={-1}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">o2</span>
        </div>
        <div className="path-heading">
          <strong>{currentDir}</strong>
          <span>{selectedEntry ? selectedEntry.prettyPath : "no selection"}</span>
        </div>
        <div className="mode-label">hjkl</div>
      </header>

      <section className="workspace">
        <FileList entries={entries} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
        <PreviewPane entry={selectedEntry} preview={preview} />
        {showHelp ? <HelpOverlay onClose={() => setShowHelp(false)} /> : null}
        {prompt ? (
          <Prompt
            prompt={prompt}
            onCancel={() => setPrompt(null)}
            onSubmit={submitPrompt}
          />
        ) : null}
      </section>

      <footer className="statusbar">
        <span>{filterMode ? `/${filterDraft.replace(/^\//, "")}` : statusLine}</span>
      </footer>
    </main>
  );
}
