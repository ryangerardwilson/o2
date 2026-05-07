import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const params = new URLSearchParams(window.location.search);
const START_DIR = params.get("dir") || "/";
const START_FOCUS = params.get("focus") || "";
const START_HOME = params.get("home") || "/";
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.15;

const HELP_GROUPS = [
  {
    title: "navigation",
    items: [
      ["j / k", "move down / up"],
      ["h / l", "parent / enter, preview, unzip"],
      ["enter / ctrl+m", "enter, preview, unzip"],
      ["ctrl+j / ctrl+k", "scroll preview"],
      ["ctrl+h / ctrl+l", "pan preview"]
    ]
  },
  {
    title: "files",
    items: [
      [",nf", "new file"],
      [",nd", "new directory"],
      [",rn", "rename"],
      ["m / v", "mark / visual"],
      ["y / dd", "yank / cut"],
      ["p / x", "paste / delete"],
      ["e", "edit file"],
      ["o", "desktop open"],
      ["r", "refresh"]
    ]
  },
  {
    title: "view",
    items: [
      ["/", "filter"],
      ["p", "paste or preview"],
      ["- / =", "zoom preview"],
      [". / ,dot", "dotfiles"],
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

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function previewPanBounds(node, type, zoom, axis) {
  if (!node) {
    return { min: 0, max: 0 };
  }
  if (type === "pdf") {
    if (axis === "x") {
      return {
        min: 0,
        max: Math.max(0, Math.floor(node.clientWidth * Math.max(0, zoom - 1) + 22 * zoom))
      };
    }
    return {
      min: 0,
      max: Math.max(0, Math.floor(node.clientHeight * Math.max(0, 6 * zoom - 1)))
    };
  }
  if (type === "image") {
    const size = axis === "x" ? node.clientWidth : node.clientHeight;
    const limit = Math.max(0, Math.floor(size * Math.max(0, zoom - 1) * 0.5));
    return { min: -limit, max: limit };
  }
  return { min: 0, max: 0 };
}

function clampPreviewPan(value, node, type, zoom, axis) {
  const bounds = previewPanBounds(node, type, zoom, axis);
  return clampNumber(value, bounds.min, bounds.max);
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

function isZipEntry(entry) {
  return Boolean(entry && !entry.isDirectory && entry.extension === ".zip");
}

function itemLabel(count) {
  return count === 1 ? "item" : "items";
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

function HelpOverlay({ onClose, scrollRef }) {
  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <div className="help-modal" ref={scrollRef} onMouseDown={(event) => event.stopPropagation()}>
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

function FileList({ entries, selectedIndex, onSelect, markedPaths, visualMode }) {
  const selectedRef = useRef(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });
  }, [selectedIndex, entries]);

  return (
    <div className="file-list">
      {entries.length === 0 ? (
        <div className="empty-row">(empty)</div>
      ) : (
        entries.map((entry, index) => {
          const selected = index === selectedIndex;
          const marked = markedPaths.has(entry.path);
          return (
            <button
              type="button"
              ref={selected ? selectedRef : null}
              key={entry.path}
              className={`file-row ${selected ? "selected" : ""} ${marked ? "marked" : ""} ${visualMode ? "visual" : ""}`}
              onMouseEnter={() => onSelect(index)}
              onFocus={() => onSelect(index)}
            >
              <span className="file-cursor">{selected ? ">" : marked ? "*" : " "}</span>
              <span className="file-kind">{entry.isDirectory ? "/" : "."}</span>
              <span className="file-name">{entry.name}{entry.isDirectory ? "/" : ""}</span>
              <span className="file-meta">{entry.isDirectory ? "dir" : formatBytes(entry.size)}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

function PreviewPane({ entry, preview, scrollRef, previewZoom, previewPanX, previewPanY }) {
  const previewTransform = `translate3d(${-previewPanX}px, ${-previewPanY}px, 0) scale(${previewZoom})`;
  const content = (() => {
    if (!entry) {
      return (
        <div className="preview-heading">
          <strong>no selection</strong>
        </div>
      );
    }

    if (preview?.type === "text") {
      return (
        <pre className="text-preview" style={{ fontSize: `${11 * previewZoom}px` }}>{preview.text}</pre>
      );
    }
    if (preview?.type === "pdf" && preview.dataUrl) {
      return (
        <div className="pdf-preview-frame">
          <iframe
            className="pdf-preview"
            src={`${preview.dataUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            style={{ transform: previewTransform }}
            title={entry.name}
          />
        </div>
      );
    }
    if (preview?.type === "pdf" && preview.tooLarge) {
      return <div className="preview-note">PDF too large to preview</div>;
    }
    if (preview?.type === "image" && preview.dataUrl) {
      return (
        <div className="image-preview">
          <img src={preview.dataUrl} alt={entry.name} style={{ transform: previewTransform }} />
        </div>
      );
    }
    if (preview?.type === "image" && preview.tooLarge) {
      return <div className="preview-note">image too large to preview</div>;
    }
    if (preview?.type === "directory") {
      return <div className="preview-note">{preview.count} entries</div>;
    }
    if (preview?.type === "binary") {
      return <div className="preview-note">binary file</div>;
    }
    return <div className="preview-note">preview unavailable</div>;
  })();

  if (!entry) {
    return (
      <aside className="preview-pane">
        <div className="preview-scroll" ref={scrollRef}>
          {content}
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
      <div className="preview-scroll" ref={scrollRef}>
        {content}
      </div>
    </aside>
  );
}

function UnzipOverlay({ entry }) {
  const columns = Array.from({ length: 32 }, (_, index) => index);
  const stream = "010110100111001011010010111001";
  return (
    <div className="unzip-layer">
      <div className="matrix-rain" aria-hidden="true">
        {columns.map((index) => (
          <span
            className="matrix-column"
            key={index}
            style={{
              animationDelay: `${-index * 0.11}s`,
              animationDuration: `${1.4 + (index % 7) * 0.18}s`
            }}
          >
            {stream}
          </span>
        ))}
      </div>
      <div className="unzip-status">
        <strong>unzipping</strong>
        <span>{entry?.name || "archive.zip"}</span>
      </div>
    </div>
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
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPanX, setPreviewPanX] = useState(0);
  const [previewPanY, setPreviewPanY] = useState(0);
  const [markedPaths, setMarkedPaths] = useState(() => new Set());
  const [visualMode, setVisualMode] = useState(false);
  const [visualAnchorIndex, setVisualAnchorIndex] = useState(0);
  const [fileClipboard, setFileClipboard] = useState(null);
  const [pendingD, setPendingD] = useState(false);
  const [extractingZip, setExtractingZip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pathHistory, setPathHistory] = useState([START_DIR]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const selectedPathRef = useRef(focusPath);
  const previewScrollRef = useRef(null);
  const helpScrollRef = useRef(null);

  const cutPathSet = useMemo(() => (
    new Set(fileClipboard?.mode === "move" ? fileClipboard.items.map((item) => item.path) : [])
  ), [fileClipboard]);
  const visibleEntries = useMemo(
    () => entries.filter((entry) => !cutPathSet.has(entry.path)),
    [cutPathSet, entries]
  );
  const selectedEntry = visibleEntries[selectedIndex] || null;
  const markedEntries = useMemo(
    () => visibleEntries.filter((entry) => markedPaths.has(entry.path)),
    [markedPaths, visibleEntries]
  );
  const actionEntries = markedEntries.length > 0 ? markedEntries : selectedEntry ? [selectedEntry] : [];

  useEffect(() => {
    selectedPathRef.current = selectedEntry?.path || selectedPathRef.current || focusPath;
  }, [selectedEntry, focusPath]);

  useEffect(() => {
    setSelectedIndex((index) => clampIndex(index, visibleEntries.length));
  }, [visibleEntries.length]);

  useEffect(() => {
    setMarkedPaths(new Set());
    setVisualMode(false);
    setVisualAnchorIndex(0);
    setPendingD(false);
  }, [currentDir]);

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
        const visibleResultEntries = result.entries.filter((entry) => !cutPathSet.has(entry.path));
        const focusIndex = requestedFocus
          ? visibleResultEntries.findIndex((entry) => entry.path === requestedFocus)
          : -1;
        setSelectedIndex((current) => (
          focusIndex >= 0 ? focusIndex : clampIndex(current, visibleResultEntries.length)
        ));
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
  }, [currentDir, showHidden, filter, sortMode, refreshTick, focusPath, cutPathSet]);

  useEffect(() => {
    let cancelled = false;
    if (!previewVisible || !selectedEntry) {
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
  }, [previewVisible, selectedEntry]);

  useEffect(() => {
    if (previewScrollRef.current) {
      previewScrollRef.current.scrollTop = 0;
      previewScrollRef.current.scrollLeft = 0;
    }
    setPreviewZoom(1);
    setPreviewPanX(0);
    setPreviewPanY(0);
  }, [selectedEntry, preview]);

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

  const markVisualRange = useCallback((anchorIndex, cursorIndex) => {
    if (!visibleEntries.length) {
      setMarkedPaths(new Set());
      return;
    }
    const start = Math.min(anchorIndex, cursorIndex);
    const end = Math.max(anchorIndex, cursorIndex);
    setMarkedPaths(new Set(visibleEntries.slice(start, end + 1).map((entry) => entry.path)));
  }, [visibleEntries]);

  const moveSelection = useCallback((delta) => {
    setSelectedIndex((index) => {
      const nextIndex = wrapIndex(index + delta, visibleEntries.length);
      if (visualMode) {
        markVisualRange(visualAnchorIndex, nextIndex);
      }
      return nextIndex;
    });
  }, [markVisualRange, visibleEntries.length, visualAnchorIndex, visualMode]);

  const changePreviewZoom = useCallback((direction) => {
    if (!previewVisible) {
      setStatus("preview hidden");
      return;
    }
    const node = previewScrollRef.current;
    setPreviewZoom((zoom) => {
      const nextZoom = clampNumber(
        Number((zoom + direction * PREVIEW_ZOOM_STEP).toFixed(2)),
        MIN_PREVIEW_ZOOM,
        MAX_PREVIEW_ZOOM
      );
      setPreviewPanX((offset) => clampPreviewPan(offset, node, preview?.type, nextZoom, "x"));
      setPreviewPanY((offset) => clampPreviewPan(offset, node, preview?.type, nextZoom, "y"));
      setStatus(`preview zoom ${Math.round(nextZoom * 100)}%`);
      return nextZoom;
    });
  }, [preview?.type, previewVisible]);

  const scrollPreview = useCallback((direction) => {
    if (!previewVisible) {
      setStatus("preview hidden");
      return;
    }
    const node = previewScrollRef.current;
    if (!node) {
      return;
    }
    const amount = Math.max(80, Math.floor(node.clientHeight * 0.52));
    if (preview?.type === "pdf" || preview?.type === "image") {
      setPreviewPanY((offset) => (
        clampPreviewPan(offset + direction * amount, node, preview?.type, previewZoom, "y")
      ));
      return;
    }
    node.scrollBy({
      top: direction * amount,
      left: 0,
      behavior: "auto"
    });
  }, [preview?.type, previewVisible, previewZoom]);

  const panPreview = useCallback((direction) => {
    if (!previewVisible) {
      setStatus("preview hidden");
      return;
    }
    const node = previewScrollRef.current;
    if (!node) {
      return;
    }
    const amount = Math.max(80, Math.floor(node.clientWidth * 0.45));
    if (preview?.type === "pdf" || preview?.type === "image") {
      setPreviewPanX((offset) => (
        clampPreviewPan(offset + direction * amount, node, preview?.type, previewZoom, "x")
      ));
      return;
    }
    node.scrollBy({
      top: 0,
      left: direction * amount,
      behavior: "auto"
    });
  }, [preview?.type, previewVisible, previewZoom]);

  const goParent = useCallback(() => {
    const parent = parentPath(currentDir);
    if (parent === currentDir) {
      setStatus("already at filesystem root");
      return;
    }
    navigateTo(parent, { focusPath: currentDir });
  }, [currentDir, navigateTo]);

  const togglePreview = useCallback(() => {
    setPreviewVisible((visible) => {
      const next = !visible;
      setStatus(next ? "preview shown" : "preview hidden");
      return next;
    });
  }, []);

  const clearSelectionModes = useCallback(() => {
    setMarkedPaths(new Set());
    setVisualMode(false);
    setVisualAnchorIndex(0);
    setPendingD(false);
  }, []);

  const selectedActionItems = useCallback(() => (
    actionEntries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      isDirectory: entry.isDirectory
    }))
  ), [actionEntries]);

  const toggleMark = useCallback(() => {
    if (!selectedEntry) {
      setStatus("nothing to mark");
      return;
    }
    setVisualMode(false);
    setVisualAnchorIndex(selectedIndex);
    setPendingD(false);
    setMarkedPaths((paths) => {
      const next = new Set(paths);
      if (next.has(selectedEntry.path)) {
        next.delete(selectedEntry.path);
        setStatus(`unmarked ${selectedEntry.name}`);
      } else {
        next.add(selectedEntry.path);
        setStatus(`marked ${selectedEntry.name}`);
      }
      return next;
    });
  }, [selectedEntry, selectedIndex]);

  const toggleVisualMode = useCallback(() => {
    if (!selectedEntry) {
      setStatus("nothing to mark");
      return;
    }
    setPendingD(false);
    setVisualMode((active) => {
      if (active) {
        setStatus(`${markedPaths.size} marked`);
        return false;
      }
      setVisualAnchorIndex(selectedIndex);
      setMarkedPaths(new Set([selectedEntry.path]));
      setStatus("visual");
      return true;
    });
  }, [markedPaths.size, selectedEntry, selectedIndex]);

  const queueClipboard = useCallback((mode) => {
    const items = selectedActionItems();
    if (!items.length) {
      setStatus("nothing selected");
      setPendingD(false);
      return;
    }
    setFileClipboard({ mode, items });
    clearSelectionModes();
    setStatus(`${mode === "move" ? "cut" : "yanked"} ${items.length} ${itemLabel(items.length)}`);
  }, [clearSelectionModes, selectedActionItems]);

  const deleteSelection = useCallback(async () => {
    const items = selectedActionItems();
    if (!items.length) {
      setStatus("nothing selected");
      return;
    }
    try {
      clearSelectionModes();
      setStatus(`deleting ${items.length} ${itemLabel(items.length)}`);
      await window.o2.deletePaths(items.map((item) => item.path));
      setStatus(`deleted ${items.length} ${itemLabel(items.length)}`);
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setStatus(error.message || "delete failed");
    }
  }, [clearSelectionModes, selectedActionItems]);

  const pasteClipboard = useCallback(async () => {
    if (!fileClipboard?.items?.length) {
      togglePreview();
      return;
    }
    try {
      setStatus(`${fileClipboard.mode === "move" ? "moving" : "copying"} ${fileClipboard.items.length} ${itemLabel(fileClipboard.items.length)}`);
      const result = await window.o2.pastePaths({
        sources: fileClipboard.items.map((item) => item.path),
        dir: currentDir,
        mode: fileClipboard.mode
      });
      const changedCount = result.results?.filter((item) => !item.unchanged).length || 0;
      if (fileClipboard.mode === "move") {
        setFileClipboard(null);
      }
      setFocusPath(result.path || "");
      if (fileClipboard.mode === "move" && changedCount === 0) {
        setStatus("already here");
      } else {
        const count = fileClipboard.mode === "move" ? changedCount : result.count;
        setStatus(`${fileClipboard.mode === "move" ? "moved" : "copied"} ${count} ${itemLabel(count)}`);
      }
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setStatus(error.message || "paste failed");
    }
  }, [currentDir, fileClipboard, togglePreview]);

  const extractZipEntry = useCallback(async (entry) => {
    if (!entry) {
      return;
    }
    setExtractingZip(entry);
    setStatus(`unzipping ${entry.name}`);
    try {
      const result = await window.o2.extractZip(entry.path);
      setFocusPath(result.path || "");
      setStatus(`unzipped ${entry.name}`);
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setStatus(error.message || "unzip failed");
    } finally {
      setExtractingZip(null);
    }
  }, []);

  const openEntry = useCallback(
    async (entry = selectedEntry, mode = "preview") => {
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
        } else if (mode === "editor") {
          const result = await window.o2.openInEditor(entry.path);
          setStatus(`editing ${entry.name}${result?.terminal ? ` in ${result.terminal}` : ""}`);
        } else if (isZipEntry(entry)) {
          await extractZipEntry(entry);
        } else {
          setPreviewVisible(true);
          setStatus(`previewing ${entry.name}`);
        }
      } catch (error) {
        setStatus(error.message || "open failed");
      }
    },
    [extractZipEntry, navigateTo, selectedEntry]
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
        j: () => setSelectedIndex(Math.max(0, visibleEntries.length - 1)),
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
    [selectedEntry, showHidden, visibleEntries.length]
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
    if (!window.o2?.onControlKey) {
      return undefined;
    }
    return window.o2.onControlKey((key) => {
      if (key === "h") {
        panPreview(-1);
      }
      if (key === "j") {
        scrollPreview(1);
      }
      if (key === "k") {
        scrollPreview(-1);
      }
      if (key === "l") {
        panPreview(1);
      }
      if (key === "m") {
        openEntry();
      }
    });
  }, [openEntry, panPreview, scrollPreview]);

  useEffect(() => {
    if (!window.o2?.onPreviewKey) {
      return undefined;
    }
    return window.o2.onPreviewKey((key) => {
      if (key === "zoom-out") {
        changePreviewZoom(-1);
      }
      if (key === "zoom-in") {
        changePreviewZoom(1);
      }
    });
  }, [changePreviewZoom]);

  useEffect(() => {
    window.o2?.setInputMode?.(
      Boolean(prompt) || filterMode || leader !== null || showHelp || pendingD || Boolean(extractingZip)
    );
  }, [extractingZip, filterMode, leader, pendingD, prompt, showHelp]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (prompt) {
        return;
      }

      if (extractingZip) {
        event.preventDefault();
        return;
      }

      if (showHelp) {
        if (isEscape(event) || isPlainKey(event, "h") || isPlainKey(event, "?")) {
          event.preventDefault();
          setShowHelp(false);
          return;
        }
        if (isPlainKey(event, "j")) {
          event.preventDefault();
          helpScrollRef.current?.scrollBy({ top: 56, left: 0, behavior: "auto" });
          return;
        }
        if (isPlainKey(event, "k")) {
          event.preventDefault();
          helpScrollRef.current?.scrollBy({ top: -56, left: 0, behavior: "auto" });
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

      if (pendingD) {
        if (isEscape(event)) {
          event.preventDefault();
          setPendingD(false);
          setStatus("cut canceled");
          return;
        }
        if (isPlainKey(event, "d")) {
          event.preventDefault();
          queueClipboard("move");
          return;
        }
        setPendingD(false);
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
        setShowHelp((value) => !value);
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

      if (isPlainKey(event, ".")) {
        event.preventDefault();
        setShowHidden((value) => {
          const next = !value;
          setStatus(next ? "showing dotfiles" : "hiding dotfiles");
          return next;
        });
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

      if (isPlainKey(event, "p")) {
        event.preventDefault();
        pasteClipboard();
        return;
      }

      if (isPlainKey(event, "m")) {
        event.preventDefault();
        toggleMark();
        return;
      }

      if (isPlainKey(event, "v")) {
        event.preventDefault();
        toggleVisualMode();
        return;
      }

      if (isPlainKey(event, "y")) {
        event.preventDefault();
        queueClipboard("copy");
        return;
      }

      if (isPlainKey(event, "d")) {
        event.preventDefault();
        setPendingD(true);
        setStatus("d");
        return;
      }

      if (isPlainKey(event, "x")) {
        event.preventDefault();
        deleteSelection();
        return;
      }

      if (isPlainKey(event, "-")) {
        event.preventDefault();
        changePreviewZoom(-1);
        return;
      }

      if (isPlainKey(event, "=") || isPlainKey(event, "+")) {
        event.preventDefault();
        changePreviewZoom(1);
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
          panPreview(-1);
          return;
        }
        if (key === "l") {
          event.preventDefault();
          panPreview(1);
          return;
        }
        if (key === "j") {
          event.preventDefault();
          scrollPreview(1);
          return;
        }
        if (key === "k") {
          event.preventDefault();
          scrollPreview(-1);
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
    changePreviewZoom,
    deleteSelection,
    extractingZip,
    filter,
    filterDraft,
    filterMode,
    goParent,
    leader,
    moveSelection,
    navigateTo,
    openEntry,
    panPreview,
    pasteClipboard,
    pendingD,
    prompt,
    queueClipboard,
    refresh,
    runLeaderCommand,
    scrollPreview,
    selectedEntry,
    showHelp,
    toggleMark,
    toggleVisualMode
  ]);

  const statusLine = useMemo(() => {
    const parts = [
      `${visibleEntries.length ? selectedIndex + 1 : 0}/${visibleEntries.length}`,
      previewVisible ? "preview" : "",
      previewVisible && previewZoom !== 1 ? `${Math.round(previewZoom * 100)}%` : "",
      visualMode ? "visual" : "",
      markedPaths.size ? `${markedPaths.size} marked` : "",
      fileClipboard?.items?.length
        ? `${fileClipboard.mode === "move" ? "cut" : "yank"} ${fileClipboard.items.length}`
        : "",
      pendingD ? "d" : "",
      filter ? `/${filter}` : "",
      leader !== null ? `,${leader}` : "",
      showHidden ? ".dot" : "",
      sortMode === "alpha" ? "" : sortMode.replace("_", " "),
      loading ? "loading" : "",
      extractingZip ? "unzipping" : "",
      status
    ].filter(Boolean);
    return parts.join("  ");
  }, [
    extractingZip,
    fileClipboard,
    filter,
    leader,
    loading,
    markedPaths.size,
    pendingD,
    previewVisible,
    previewZoom,
    selectedIndex,
    showHidden,
    sortMode,
    status,
    visibleEntries.length,
    visualMode
  ]);

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

      <section className={`workspace ${previewVisible ? "preview-open" : ""}`}>
        <FileList
          entries={visibleEntries}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          markedPaths={markedPaths}
          visualMode={visualMode}
        />
        {previewVisible ? (
          <PreviewPane
            entry={selectedEntry}
            preview={preview}
            scrollRef={previewScrollRef}
            previewZoom={previewZoom}
            previewPanX={previewPanX}
            previewPanY={previewPanY}
          />
        ) : null}
        {showHelp ? <HelpOverlay onClose={() => setShowHelp(false)} scrollRef={helpScrollRef} /> : null}
        {extractingZip ? <UnzipOverlay entry={extractingZip} /> : null}
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
