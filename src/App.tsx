import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "./components/ui";
import Login from "./components/Login";
import ImageEditor from "./components/ImageEditor";
import FileSidebar from "./components/FileSidebar";
import TabsBar from "./components/TabsBar";
import ConfirmCloseDialog from "./components/ConfirmCloseDialog";
import TerminalPanel from "./components/TerminalPanel";
import type { Tab, TreeNode, WorkspaceFile } from "./types";

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const authedHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }, [token]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [treeRootPath, setTreeRootPath] = useState<string | null>(null);
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [baseDir, setBaseDir] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  });
  const [markdownViewMode, setMarkdownViewMode] = useState<"edit" | "preview" | "split">("edit");
  const activeTab = useMemo(
    () => tabs.find((t) => t.path === activePath) || null,
    [tabs, activePath]
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 768;
  });
  const [treeLoading, setTreeLoading] = useState(false);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; tabPath: string | null }>({
    visible: false,
    x: 0,
    y: 0,
    tabPath: null,
  });
  const [topMenuOpen, setTopMenuOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    refreshTree();
    fetch("/api/health", { headers: { ...authedHeaders } })
      .then((r) => r.json())
      .then((data) => setBaseDir(data.baseDir || null))
      .catch(() => {});
  }, [token, authedHeaders]);

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

  useEffect(() => {
    if (!contextMenu.visible) return;
    const onClick = () => setContextMenu((prev) => ({ ...prev, visible: false }));
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [contextMenu.visible]);

  useEffect(() => {
    if (!topMenuOpen) return;
    const onClick = () => setTopMenuOpen(false);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [topMenuOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  function refreshTree(rootOverride?: string | null) {
    if (!token) return;
    const root = rootOverride === undefined ? treeRootPath : rootOverride;
    setTreeRootPath(root ?? null);
    setTreeLoading(true);
    const params = new URLSearchParams();
    if (root) params.set("path", root);
    params.set("depth", "0");
    fetch(`/api/fs/tree?${params.toString()}`, { headers: { ...authedHeaders } })
      .then((r) => {
        if (r.status === 401) {
          handleAuthError();
          return null;
        }
        return r.json();
      })
      .then(setTree)
      .catch(() => setTree(null))
      .finally(() => setTreeLoading(false));
  }

  function onLogin(password: string) {
    return fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || "Invalid password");
        }
        return r.json();
      })
      .then((data) => {
        localStorage.setItem("token", data.token);
        setToken(data.token);
      });
  }

  function handleAuthError() {
    localStorage.removeItem("token");
    setToken(null);
    setTree(null);
    setTabs([]);
    setActivePath(null);
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
      if (res.status === 401) {
        handleAuthError();
        return;
      }
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

  function isImagePath(p: string) {
    const ext = p.split(".").pop()?.toLowerCase() || "";
    const exts = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"];
    return exts.includes(ext);
  }

  function isMarkdownPath(p: string) {
    const lower = p.toLowerCase();
    return lower.endsWith(".md") || lower.endsWith(".markdown");
  }

  function isWorkspacePath(p: string) {
    return p.toLowerCase().endsWith(".workspace");
  }

  function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Failed to read blob"));
      reader.readAsDataURL(blob);
    });
  }

  function openFile(p: string) {
    if (isWorkspacePath(p)) {
      openWorkspaceByPath(p);
      return;
    }
    const exists = tabs.find((t) => t.path === p);
    if (exists) {
      setActivePath(p);
      return;
    }
    if (isImagePath(p)) {
      fetch(`/api/fs/read-binary?path=${encodeURIComponent(p)}`, {
        headers: { ...authedHeaders },
      })
        .then((r) => {
          if (r.status === 401) {
            handleAuthError();
            return null;
          }
          if (!r.ok) {
            return null;
          }
          return r.blob();
        })
        .then(async (blob) => {
          if (!blob) return;
          const dataUrl = await blobToDataUrl(blob);
          const t: Tab = {
            kind: "image",
            path: p,
            dataUrl,
            originalDataUrl: dataUrl,
            dirty: false,
          };
          setTabs((prev) => [...prev, t]);
          setActivePath(p);
        });
      return;
    }
    fetch(`/api/fs/read?path=${encodeURIComponent(p)}`, { headers: { ...authedHeaders } })
      .then((r) => {
        if (r.status === 401) {
          handleAuthError();
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        const content = data.content ?? "";
        const t: Tab = {
          kind: "text",
          path: p,
          content,
          originalContent: content,
          dirty: false,
        };
        setTabs((prev) => [...prev, t]);
        setActivePath(p);
      });
  }

  function saveImage(p: string, dataUrl: string) {
    return fetch("/api/fs/save-binary", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authedHeaders },
      body: JSON.stringify({ path: p, dataUrl }),
    }).then((r) => {
      if (r.status === 401) {
        handleAuthError();
        return;
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.path === p && t.kind === "image"
            ? { ...t, originalDataUrl: t.dataUrl, dirty: false }
            : t
        )
      );
    });
  }

  async function openWorkspaceByPath(p: string) {
    const res = await fetch(`/api/fs/read?path=${encodeURIComponent(p)}`, {
      headers: { ...authedHeaders },
    });
    if (res.status === 401) {
      handleAuthError();
      return;
    }
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    const content = data.content ?? "";
    let parsed: WorkspaceFile;
    try {
      parsed = JSON.parse(content);
    } catch {
      return;
    }
    applyWorkspace(parsed, p);
  }

  function applyWorkspace(workspace: WorkspaceFile, path: string | null) {
    const root = workspace.rootPath ?? null;
    setWorkspacePath(path);
    setTabs([]);
    setActivePath(null);
    refreshTree(root);
    const files = workspace.openFiles || [];
    files.forEach((p) => {
      if (p) {
        openFile(p);
      }
    });
    if (workspace.activePath) {
      setActivePath(workspace.activePath);
    }
  }

  async function saveWorkspaceAs() {
    const defaultName =
      workspacePath?.split("/").pop() || "workspace.workspace";
    const nameInput = window.prompt("Workspace file name", defaultName);
    if (!nameInput) return;
    let targetPath = nameInput.trim();
    if (!targetPath.toLowerCase().endsWith(".workspace")) {
      targetPath = `${targetPath}.workspace`;
    }
    targetPath = targetPath.replace(/^\/+/, "");
    const workspace: WorkspaceFile = {
      rootPath: treeRootPath ?? null,
      openFiles: tabs.map((t) => t.path),
      activePath,
    };
    const content = JSON.stringify(workspace, null, 2);
    const res = await fetch("/api/fs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authedHeaders },
      body: JSON.stringify({ path: targetPath, content }),
    });
    if (res.status === 401) {
      handleAuthError();
      return;
    }
    setWorkspacePath(targetPath);
  }

  function saveActive() {
    if (!activeTab) return;
    if (activeTab.kind === "image") {
      saveImage(activeTab.path, activeTab.dataUrl);
      return;
    }
    fetch("/api/fs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authedHeaders },
      body: JSON.stringify({ path: activeTab.path, content: activeTab.content }),
    }).then((r) => {
      if (r.status === 401) {
        handleAuthError();
        return;
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.path === activeTab.path && t.kind === "text"
            ? { ...t, originalContent: t.content, dirty: false }
            : t
        )
      );
    });
  }

  function saveByPath(p: string) {
    const t = tabs.find((x) => x.path === p);
    if (!t) return Promise.resolve();
    if (t.kind === "image") {
      return saveImage(p, t.dataUrl);
    }
    return fetch("/api/fs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authedHeaders },
      body: JSON.stringify({ path: t.path, content: t.content }),
    }).then((r) => {
      if (r.status === 401) {
        handleAuthError();
        return;
      }
      setTabs((prev) =>
        prev.map((x) =>
          x.path === p && x.kind === "text"
            ? { ...x, originalContent: x.content, dirty: false }
            : x
        )
      );
    });
  }

  function revertActive() {
    if (!activeTab || !activeTab.dirty) return;
    if (activeTab.kind === "image") {
      const path = activeTab.path;
      setTabs((prev) =>
        prev.map((t) =>
          t.path === path && t.kind === "image"
            ? { ...t, dataUrl: t.originalDataUrl, dirty: false }
            : t
        )
      );
      return;
    }
    const path = activeTab.path;
    setTabs((prev) =>
      prev.map((t) =>
        t.path === path && t.kind === "text"
          ? { ...t, content: t.originalContent, dirty: false }
          : t
      )
    );
  }

  function closeTab(p: string) {
    setTabs((prev) => prev.filter((t) => t.path !== p));
    if (activePath === p) {
      const others = tabs.filter((t) => t.path !== p);
      setActivePath(others[0]?.path || null);
    }
  }

  function closeAllTabs() {
    setTabs([]);
    setActivePath(null);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }

  function closeOtherTabs(p: string) {
    const targetTab = tabs.find((t) => t.path === p);
    if (!targetTab) return;
    setTabs([targetTab]);
    setActivePath(p);
    setContextMenu((prev) => ({ ...prev, visible: false }));
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

  if (!token) {
    return <Login onLogin={onLogin} />;
  }

  return (
    <div className="flex h-screen w-full flex-col">
      {contextMenu.visible && (
        <div
          className="fixed z-50 min-w-[140px] rounded-md border border-border bg-card text-card-foreground p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
            onClick={() => contextMenu.tabPath && closeOtherTabs(contextMenu.tabPath)}
          >
            Close Others
          </button>
          <button
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
            onClick={closeAllTabs}
          >
            Close All
          </button>
        </div>
      )}
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
          <div className="relative">
            <Button
              onClick={(e) => {
                e.stopPropagation();
                setTopMenuOpen((v) => !v);
              }}
              className="flex h-8 w-8 items-center justify-center p-0 text-lg"
              title="More actions"
            >
              ⋯
            </Button>
            {topMenuOpen && (
              <div
                className="absolute right-0 mt-1 w-44 rounded-md border border-border bg-card text-card-foreground shadow-lg z-20"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    setTopMenuOpen(false);
                    saveWorkspaceAs();
                  }}
                >
                  Save workspace as...
                </button>
                <button
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    setTopMenuOpen(false);
                    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
                  }}
                >
                  {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                </button>
                <button
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    setTopMenuOpen(false);
                    setShowTerminal((v) => !v);
                  }}
                >
                  {showTerminal ? "Hide terminal" : "Show terminal"}
                </button>
                <button
                  className="block w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-muted"
                  onClick={() => {
                    setTopMenuOpen(false);
                    localStorage.removeItem("token");
                    setToken(null);
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <FileSidebar
            tree={tree}
            treeRootPath={treeRootPath}
            treeLoading={treeLoading}
            openDirs={openDirs}
            loadingDirs={loadingDirs}
            onToggleDir={toggleDir}
            onLoadDir={loadDir}
            onRefreshTree={refreshTree}
            onOpenFile={openFile}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <TabsBar
            tabs={tabs}
            activePath={activePath}
            activeTab={activeTab}
            onSelectTab={setActivePath}
            onRequestCloseTab={requestCloseTab}
            onSaveActive={saveActive}
            onRevertActive={revertActive}
            onContextMenuTab={(e, path) => {
              e.preventDefault();
              setContextMenu({
                visible: true,
                x: e.clientX,
                y: e.clientY,
                tabPath: path,
              });
            }}
          />
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-w-0 flex-1 flex-col overflow-auto">
              {activeTab ? (
                activeTab.kind === "image" ? (
                  <ImageEditor
                    tab={activeTab}
                    onChange={(dataUrl) => {
                      const path = activeTab.path;
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.path === path && t.kind === "image"
                            ? { ...t, dataUrl, dirty: true }
                            : t
                        )
                      );
                    }}
                  />
                ) : isMarkdownPath(activeTab.path) ? (
                  <div className="h-full flex flex-col">
                    <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
                      <span className="text-muted-foreground">Markdown view:</span>
                      <button
                        className={`rounded px-2 py-0.5 ${
                          markdownViewMode === "edit" ? "bg-secondary text-foreground" : "hover:bg-secondary"
                        }`}
                        onClick={() => setMarkdownViewMode("edit")}
                      >
                        Editor
                      </button>
                      <button
                        className={`rounded px-2 py-0.5 ${
                          markdownViewMode === "preview" ? "bg-secondary text-foreground" : "hover:bg-secondary"
                        }`}
                        onClick={() => setMarkdownViewMode("preview")}
                      >
                        Preview
                      </button>
                      <button
                        className={`rounded px-2 py-0.5 ${
                          markdownViewMode === "split" ? "bg-secondary text-foreground" : "hover:bg-secondary"
                        }`}
                        onClick={() => setMarkdownViewMode("split")}
                      >
                        Split
                      </button>
                    </div>
                    <div className="min-h-0 flex-1">
                      {markdownViewMode === "preview" && (
                        <div className="markdown-body p-4 text-sm">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {activeTab.content}
                          </ReactMarkdown>
                        </div>
                      )}
                      {markdownViewMode === "edit" && (
                        <div className="h-full">
                          <Editor
                            height="100%"
                            theme={theme === "dark" ? "vs-dark" : "vs-light"}
                            language={detectLanguage(activeTab.path)}
                            value={activeTab.content}
                            onChange={(val: string | undefined) => {
                              const v = val ?? "";
                              const path = activeTab.path;
                              setTabs((prev) =>
                                prev.map((t) =>
                                  t.path === path && t.kind === "text"
                                    ? { ...t, content: v, dirty: true }
                                    : t
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
                      )}
                      {markdownViewMode === "split" && (
                        <div className="flex h-full">
                          <div className="w-1/2 border-r border-border">
                            <div className="h-full">
                              <Editor
                                height="100%"
                                theme={theme === "dark" ? "vs-dark" : "vs-light"}
                                language={detectLanguage(activeTab.path)}
                                value={activeTab.content}
                                onChange={(val: string | undefined) => {
                                  const v = val ?? "";
                                  const path = activeTab.path;
                                  setTabs((prev) =>
                                    prev.map((t) =>
                                      t.path === path && t.kind === "text"
                                        ? { ...t, content: v, dirty: true }
                                        : t
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
                          </div>
                          <div className="w-1/2">
                            <div className="markdown-body p-4 text-sm">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {activeTab.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-full">
                    <Editor
                      height="100%"
                      theme={theme === "dark" ? "vs-dark" : "vs-light"}
                      language={detectLanguage(activeTab.path)}
                      value={activeTab.content}
                      onChange={(val: string | undefined) => {
                        const v = val ?? "";
                        const path = activeTab.path;
                        setTabs((prev) =>
                          prev.map((t) =>
                            t.path === path && t.kind === "text"
                              ? { ...t, content: v, dirty: true }
                              : t
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
                )
              ) : (
                <div className="p-4 text-sm text-muted-foreground">
                  Open a file to start editing
                </div>
              )}
            </div>
            {showTerminal && (
              <TerminalPanel
                authedHeaders={authedHeaders}
                onAuthError={handleAuthError}
                baseDir={baseDir}
              />
            )}
          </div>
        </div>
      </div>
      <ConfirmCloseDialog
        path={confirmClose}
        onSaveAndClose={async (p) => {
          if (!p) return;
          setConfirmClose(null);
          await saveByPath(p);
          closeTab(p);
        }}
        onDiscard={(p) => {
          if (!p) return;
          setConfirmClose(null);
          closeTab(p);
        }}
        onCancel={() => setConfirmClose(null)}
      />
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

export default App;
