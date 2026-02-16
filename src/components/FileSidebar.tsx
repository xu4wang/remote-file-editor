import type { TreeNode } from "../types";

type FileSidebarProps = {
  tree: TreeNode | null;
  treeRootPath: string | null;
  treeLoading: boolean;
  openDirs: Record<string, boolean>;
  loadingDirs: Record<string, boolean>;
  onToggleDir: (path: string, node?: TreeNode) => void;
  onLoadDir: (path: string, offset: number) => void;
  onRefreshTree: (path?: string | null) => void;
  onOpenFile: (path: string) => void;
};

function FileSidebar(props: FileSidebarProps) {
  const {
    tree,
    treeRootPath,
    treeLoading,
    openDirs,
    loadingDirs,
    onToggleDir,
    onLoadDir,
    onRefreshTree,
    onOpenFile,
  } = props;

  function renderTree(node: TreeNode, depth = 0) {
    if (node.type === "dir") {
      const open = !!openDirs[node.path || ""];
      return (
        <div key={node.path || "__root"} className="select-none">
          <div
            className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-secondary"
            onClick={() => onToggleDir(node.path || "", node)}
          >
            <span className="w-3">{open ? "▾" : "▸"}</span>
            <span className="font-medium">{node.name || "root"}</span>
            <button
              className="ml-auto rounded px-2 py-0.5 text-[11px] normal-case hover:bg-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onRefreshTree(node.path || "");
              }}
              title="Use this directory as tree root"
            >
              Root
            </button>
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
                    const next =
                      node.nextOffset ??
                      ((node.offset || 0) + (node.children?.length || 0));
                    onLoadDir(node.path || "", next);
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
        onClick={() => onOpenFile(node.path)}
        title={node.path}
      >
        {node.name}
      </div>
    );
  }

  return (
    <div className="w-64 min-w-40 max-w-72 border-r border-border">
      <div className="flex h-8 items-center justify-between border-b border-border px-2 text-xs uppercase text-muted-foreground">
        <div className="flex items-center gap-2">
          <div>Files</div>
          {treeRootPath && (
            <div className="max-w-[120px] truncate text-[11px] normal-case text-muted-foreground">
              {treeRootPath}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {treeRootPath && (
            <button
              className="rounded px-2 py-0.5 text-[11px] normal-case hover:bg-secondary"
              onClick={() => onRefreshTree(null)}
              title="Reset to workspace root"
              disabled={treeLoading}
            >
              Root
            </button>
          )}
          <button
            className="rounded px-2 py-0.5 text-[11px] normal-case hover:bg-secondary"
            onClick={() => onRefreshTree()}
            title="Refresh file tree"
            disabled={treeLoading}
          >
            {treeLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="h-[calc(100%-2rem)] overflow-auto">
        {tree ? (
          renderTree(tree)
        ) : (
          <div className="p-2 text-sm">Loading...</div>
        )}
      </div>
    </div>
  );
}

export default FileSidebar;
