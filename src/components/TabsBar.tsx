import type { MouseEvent } from "react";
import { Button } from "./ui";
import type { Tab } from "../types";

type TabsBarProps = {
  tabs: Tab[];
  activePath: string | null;
  activeTab: Tab | null;
  onSelectTab: (path: string) => void;
  onRequestCloseTab: (path: string) => void;
  onSaveActive: () => void;
  onRevertActive: () => void;
  onContextMenuTab?: (event: MouseEvent<HTMLDivElement>, path: string) => void;
};

function TabsBar(props: TabsBarProps) {
  const {
    tabs,
    activePath,
    activeTab,
    onSelectTab,
    onRequestCloseTab,
    onSaveActive,
    onRevertActive,
    onContextMenuTab,
  } = props;

  return (
    <div className="flex h-9 items-center gap-1 border-b border-border">
      {tabs.map((t) => (
        <div
          key={t.path}
          className={`flex items-center gap-2 px-3 text-sm ${
            activePath === t.path ? "bg-secondary" : ""
          } cursor-pointer`}
          onClick={() => onSelectTab(t.path)}
          onContextMenu={(e) => {
            if (onContextMenuTab) {
              onContextMenuTab(e, t.path);
            }
          }}
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
              onRequestCloseTab(t.path);
            }}
          >
            ✖
          </button>
        </div>
      ))}
      <div className="ml-auto flex items-center gap-1 pr-2">
        <Button
          onClick={onSaveActive}
          disabled={!activeTab || !activeTab.dirty}
          title="Save"
        >
          💾
        </Button>
        <Button
          onClick={onRevertActive}
          disabled={!activeTab || !activeTab.dirty}
          title="Revert changes"
        >
          ↩
        </Button>
      </div>
    </div>
  );
}

export default TabsBar;
