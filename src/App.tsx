import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";

type TreeNode = {
  type: "dir" | "file";
  name: string;
  path: string;
  children?: TreeNode[];
  size?: number;
  hasMore?: boolean;
  offset?: number;
  limit?: number;
  nextOffset?: number;
};

type Tab = {
  path: string;
  content: string;
  dirty: boolean;
};

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      {...rest}
      className={`inline-flex h-9 items-center justify-center rounded-md bg-secondary px-3 text-sm text-foreground hover:bg-secondary/80 disabled:opacity-50 ${className || ""}`}
    />
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-0 focus:border-ring ${className || ""}`}
    />
  );
}

// removed textarea editor after switching to Monaco

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const authedHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }, [token]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const activeTab = useMemo(() => tabs.find((t) => t.path === activePath) || null, [tabs, activePath]);
  const [cwd, setCwd] = useState<string>("");
  const [termLines, setTermLines] = useState<string[]>([]);
  const [hist, setHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number>(-1);
  const [termCollapsed, setTermCollapsed] = useState(false);
  const [termHeight, setTermHeight] = useState<number>(192);
  const [dragging, setDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartH, setDragStartH] = useState(192);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!token) return;
    refreshTree();
    fetch("/api/health").catch(() => {});
  }, [token]);

  useEffect(() => {
    if (termLines.length === 0) {
      const p = `${cwd || "."} $ `;
      setTermLines([p]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab]);

  function refreshTree() {
    if (!token) return;
    setTreeLoading(true);
    fetch("/api/fs/tree?depth=0", { headers: { ...authedHeaders } })
      .then((r) => r.json())
      .then(setTree)
      .catch(() => setTree(null))
      .finally(() => setTreeLoading(false));
  }

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const delta = dragStartY - e.clientY;
      const h = Math.max(24, Math.min(window.innerHeight * 0.8, dragStartH + delta));
      setTermCollapsed(false);
      setTermHeight(h);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, dragStartY, dragStartH]);

  function onLogin(password: string) {
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("login failed");
        return r.json();
      })
      .then((data) => {
        localStorage.setItem("token", data.token);
        setToken(data.token);
      })
      .catch(() => {});
  }

  function updateTreeByPath(root: TreeNode, p: string, upd: (n: TreeNode) => TreeNode): TreeNode {
    if ((root.path || "") === (p || "")) {
      return upd(root);
    }
    if (root.type === "dir" && root.children?.length) {
      const newChildren = root.children.map((c) => updateTreeByPath(c, p, upd));
      if (newChildren !== root.children) {
        return { ...root, children: newChildren };
      }
    }
    return root;
  }

  async function loadDir(p: string, offset = 0) {
    if (!token) return;
    setLoadingDirs((prev) => ({ ...prev, [p]: true }));
    try {
      const res = await fetch(`/api/fs/tree?path=${encodeURIComponent(p)}&depth=1&limit=200&offset=${offset}`, {
        headers: { ...authedHeaders },
      });
      const data: TreeNode = await res.json();
      setTree((prev) => {
        if (!prev) return prev;
        const updater = (n: TreeNode) => {
          const incoming = data;
          if (offset > 0 && Array.isArray(n.children)) {
            return {
              ...n,
              children: [...n.children, ...(incoming.children || [])],
              hasMore: incoming.hasMore,
              offset: incoming.offset,
              limit: incoming.limit,
              nextOffset: incoming.nextOffset,
            };
          }
          return {
            ...n,
            children: incoming.children || [],
            hasMore: incoming.hasMore,
            offset: incoming.offset,
            limit: incoming.limit,
            nextOffset: incoming.nextOffset,
          };
        };
        return updateTreeByPath(prev, p, updater);
      });
    } finally {
      setLoadingDirs((prev) => ({ ...prev, [p]: false }));
    }
  }

  function toggleDir(p: string, node?: TreeNode) {
    setOpenDirs((prev) => {
      const nextOpen = !prev[p];
      // If opening a directory whose children are not loaded, lazy load
      if (nextOpen && node && node.type === "dir" && !node.children) {
        // Fire and forget
        loadDir(p, 0);
      }
      return { ...prev, [p]: nextOpen };
    });
  }

  function openFile(p: string) {
    const exists = tabs.find((t) => t.path === p);
    if (exists) {
      setActivePath(p);
      return;
    }
    fetch(`/api/fs/read?path=${encodeURIComponent(p)}`, { headers: { ...authedHeaders } })
      .then((r) => r.json())
      .then((data) => {
        const t: Tab = { path: p, content: data.content ?? "", dirty: false };
        setTabs((prev) => [...prev, t]);
        setActivePath(p);
      });
  }

  function saveActive() {
    if (!activeTab) return;
    fetch("/api/fs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authedHeaders },
      body: JSON.stringify({ path: activeTab.path, content: activeTab.content }),
    }).then(() => {
      setTabs((prev) =>
        prev.map((t) => (t.path === activeTab.path ? { ...t, dirty: false } : t))
      );
    });
  }

  function saveByPath(p: string) {
    const t = tabs.find((x) => x.path === p);
    if (!t) return Promise.resolve();
    return fetch("/api/fs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authedHeaders },
      body: JSON.stringify({ path: t.path, content: t.content }),
    }).then(() => {
      setTabs((prev) => prev.map((x) => (x.path === p ? { ...x, dirty: false } : x)));
    });
  }

  function printPrompt() {
    const p = `${cwd || "."} $ `;
    setTermLines((prev) => [...prev, p]);
  }

  function runCommandLine(line: string) {
    const p = `${cwd || "."} $ ${line}`;
    setTermLines((prev) => [...prev, p]);
    setHist((h) => [line, ...h]);
    setHistIdx(-1);
    const trimmed = line.trim();
    if (!trimmed) {
      printPrompt();
      return;
    }
    if (trimmed === "clear") {
      setTermLines([]);
      printPrompt();
      return;
    }
    if (trimmed.startsWith("cd")) {
      const target = trimmed.slice(2).trim() || ".";
      fetch(`/api/fs/chdir?cwd=${encodeURIComponent(cwd)}&target=${encodeURIComponent(target)}`, {
        headers: { ...authedHeaders },
      })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || "chdir failed");
          return data;
        })
        .then((data) => {
          setCwd(data.cwd || "");
          printPrompt();
        })
        .catch((e) => {
          setTermLines((prev) => [...prev, String(e.message || e), ""]);
          printPrompt();
        });
      return;
    }
    fetch("/api/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authedHeaders },
      body: JSON.stringify({ cmd: line, cwd }),
    })
      .then((r) => r.json())
      .then((data) => {
        const out = (data.output ?? "").replace(/\r/g, "");
        const lines = out.length ? out.split("\n") : [];
        setTermLines((prev) => [...prev, ...lines, ""]);
        printPrompt();
      })
      .catch((e) => {
        setTermLines((prev) => [...prev, String(e.message || e), ""]);
        printPrompt();
      });
  }

  function closeTab(p: string) {
    setTabs((prev) => prev.filter((t) => t.path !== p));
    if (activePath === p) {
      const others = tabs.filter((t) => t.path !== p);
      setActivePath(others[0]?.path || null);
    }
  }

  function requestCloseTab(p: string) {
    const t = tabs.find((x) => x.path === p);
    if (!t) return;
    if (t.dirty) {
      setConfirmClose(p);
      return;
    }
    closeTab(p);
  }

  function renderTree(node: TreeNode, depth = 0) {
    if (node.type === "dir") {
      const open = !!openDirs[node.path || ""];
      return (
        <div key={node.path || "__root"} className="select-none">
          <div
            className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-secondary"
            onClick={() => toggleDir(node.path || "", node)}
          >
            <span className="w-3">{open ? "▾" : "▸"}</span>
            <span className="font-medium">{node.name || "root"}</span>
          </div>
          {open && (
            <div className="pl-4">
              {node.children?.map((c) => renderTree(c, depth + 1))}
              {loadingDirs[node.path || ""] && (
                <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
              )}
              {!loadingDirs[node.path || ""] && node.hasMore && (
                <button
                  className="px-2 py-1 text-xs text-blue-400 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = node.nextOffset ?? ((node.offset || 0) + (node.children?.length || 0));
                    loadDir(node.path || "", next);
                  }}
                >
                  Load more…
                </button>
              )}
            </div>
          )}
        </div>
      );
    }
    return (
      <div
        key={node.path}
        className="cursor-pointer px-2 py-1 pl-6 text-sm hover:bg-secondary"
        onClick={() => openFile(node.path)}
        title={node.path}
      >
        {node.name}
      </div>
    );
  }

  if (!token) {
    return <Login onLogin={onLogin} />;
  }

  return (
    <div className="flex h-screen w-full flex-col">
      <div className="flex h-10 items-center justify-between border-b border-border px-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded px-2 py-1 text-sm hover:bg-secondary"
          >
            ☰
          </button>
          <div className="text-sm font-semibold">Remote Editor</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              localStorage.removeItem("token");
              setToken(null);
            }}
          >
            ⎋
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <div className="w-64 min-w-40 max-w-72 border-r border-border">
            <div className="flex h-8 items-center justify-between border-b border-border px-2 text-xs uppercase text-muted-foreground">
              <div>Files</div>
              <button
                className="rounded px-2 py-0.5 text-[11px] normal-case hover:bg-secondary"
                onClick={refreshTree}
                title="Refresh file tree"
                disabled={treeLoading}
              >
                {treeLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <div className="h-[calc(100%-2rem)] overflow-auto">
              {tree ? renderTree(tree) : <div className="p-2 text-sm">Loading...</div>}
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 items-center gap-1 border-b border-border">
            {tabs.map((t) => (
              <div
                key={t.path}
                className={`flex items-center gap-2 px-3 text-sm ${activePath === t.path ? "bg-secondary" : ""} cursor-pointer`}
                onClick={() => setActivePath(t.path)}
                title={t.path}
              >
                <span>
                  {t.path.split("/").pop()}
                  {t.dirty ? " ●" : ""}
                </span>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseTab(t.path);
                  }}
                >
                  ✖
                </button>
              </div>
            ))}
            <div className="ml-auto pr-2">
              <Button onClick={saveActive} disabled={!activeTab || !activeTab.dirty} title="Save">
                💾
              </Button>
            </div>
          </div>
        <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {activeTab ? (
                <div className="h-full">
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    language={detectLanguage(activeTab.path)}
                    value={activeTab.content}
                    onChange={(val: string | undefined) => {
                      const v = val ?? "";
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.path === activeTab.path ? { ...t, content: v, dirty: true } : t
                        )
                      );
                    }}
                    options={{
                      fontSize: 14,
                      minimap: { enabled: false },
                      wordWrap: "on",
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                    }}
                  />
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">Open a file to start editing</div>
              )}
            </div>
          </div>
          <div
            className="border-t border-border"
            style={{ height: termCollapsed ? 28 : termHeight }}
          >
            <div
              className="h-2 cursor-row-resize hover:bg-secondary/50"
              onMouseDown={(e) => {
                setDragStartY(e.clientY);
                setDragStartH(termHeight);
                setDragging(true);
              }}
              title="Resize terminal height"
            />
            <div className="relative h-[calc(100%-0.5rem)]">
              <button
                className="absolute right-2 top-1 rounded px-2 py-0.5 text-xs hover:bg-secondary"
                onClick={() => setTermCollapsed((v) => !v)}
                title={termCollapsed ? "Expand" : "Collapse"}
              >
                {termCollapsed ? "▴" : "▾"}
              </button>
              <TerminalInline
                cwd={cwd}
                lines={termLines}
                onSubmit={runCommandLine}
                hist={hist}
                histIdx={histIdx}
                setHistIdx={setHistIdx}
              />
            </div>
          </div>
        </div>
      </div>
      {confirmClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-md border border-border bg-background p-4">
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span>⚠️</span>
              <span>Unsaved changes</span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="rounded px-3 py-1 text-sm hover:bg-secondary"
                onClick={async () => {
                  const p = confirmClose;
                  setConfirmClose(null);
                  if (!p) return;
                  await saveByPath(p);
                  closeTab(p);
                }}
                title="Save & Close"
              >
                💾
              </button>
              <button
                className="rounded px-3 py-1 text-sm hover:bg-secondary"
                onClick={() => {
                  const p = confirmClose;
                  setConfirmClose(null);
                  if (!p) return;
                  closeTab(p);
                }}
                title="Don’t Save"
              >
                ✖
              </button>
              <button
                className="rounded px-3 py-1 text-sm hover:bg-secondary"
                onClick={() => setConfirmClose(null)}
                title="Cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (password: string) => void }) {
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex h-screen w-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border p-4">
        <div className="mb-4 text-lg font-semibold">Sign In</div>
        <div className="space-y-3">
          <Input
            type="password"
            placeholder="Enter password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
          {error && <div className="text-sm text-red-400">{error}</div>}
          <Button
            disabled={!pwd || loading}
            onClick={async () => {
              setLoading(true);
              setError(null);
              try {
                await onLogin(pwd);
              } catch {
                setError("Sign in failed");
              } finally {
                setLoading(false);
              }
            }}
          >
            Sign In
          </Button>
          <div className="text-xs text-muted-foreground">
            Default dev password: admin. Set ADMIN_PASSWORD to override.
          </div>
        </div>
      </div>
    </div>
  );
}

function detectLanguage(p: string) {
  const ext = p.split(".").pop() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    html: "html",
    md: "markdown",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    cpp: "cpp",
    c: "c",
    sh: "shell",
    yml: "yaml",
    yaml: "yaml",
  };
  return map[ext] || "plaintext";
}

function TerminalInline(props: {
  cwd: string;
  lines: string[];
  onSubmit: (v: string) => void;
  hist: string[];
  histIdx: number;
  setHistIdx: (n: number) => void;
}) {
  const { cwd, lines, onSubmit, hist, histIdx, setHistIdx } = props;
  const [current, setCurrent] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    boxRef.current?.focus();
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [lines, current]);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = current;
      setCurrent("");
      onSubmit(v);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (current.length > 0) setCurrent((s) => s.slice(0, -1));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      setCurrent((s) => s + "  ");
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = histIdx + 1;
      if (next < hist.length) {
        setHistIdx(next);
        setCurrent(hist[next]);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = histIdx - 1;
      if (next >= 0) {
        setHistIdx(next);
        setCurrent(hist[next]);
      } else {
        setHistIdx(-1);
        setCurrent("");
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
      e.preventDefault();
      onSubmit("clear");
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setCurrent((s) => s + e.key);
    }
  };
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    if (text) setCurrent((s) => s + text.replace(/\r/g, ""));
  };
  const lastIdx = lines.length - 1;
  return (
    <div className="h-full">
      <div
        ref={boxRef}
        tabIndex={0}
        className="h-full overflow-auto p-3 text-xs leading-5 font-mono whitespace-pre-wrap outline-none"
        role="textbox"
        aria-multiline="true"
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onMouseDown={() => boxRef.current?.focus()}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {lines.map((l, i) => (
          <div key={i}>
            {i === lastIdx ? (
              <span>
                {l}
                {current}
                <span className={focused ? "blink-cursor" : ""} aria-hidden="true">
                  &nbsp;
                </span>
              </span>
            ) : (
              <span>{l}</span>
            )}
          </div>
        ))}
        {lines.length === 0 && <div>{`${cwd || "."} $ `}{current}</div>}
      </div>
    </div>
  );
}

export default App;
