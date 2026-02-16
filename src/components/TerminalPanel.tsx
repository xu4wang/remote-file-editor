import { useEffect, useState } from "react";
import TerminalInline from "./TerminalInline";

type TerminalPanelProps = {
  authedHeaders: Record<string, string>;
  onAuthError: () => void;
};

function TerminalPanel(props: TerminalPanelProps) {
  const { authedHeaders, onAuthError } = props;

  const [cwd, setCwd] = useState<string>("");
  const [termLines, setTermLines] = useState<string[]>([]);
  const [hist, setHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number>(-1);
  const [termCollapsed, setTermCollapsed] = useState(false);
  const [termHeight, setTermHeight] = useState<number>(192);
  const [dragging, setDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartH, setDragStartH] = useState(192);

  useEffect(() => {
    if (termLines.length === 0) {
      const p = `${cwd || "."} $ `;
      setTermLines([p]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      fetch(
        `/api/fs/chdir?cwd=${encodeURIComponent(cwd)}&target=${encodeURIComponent(target)}`,
        {
          headers: { ...authedHeaders },
        }
      )
        .then((r) => {
          if (r.status === 401) {
            onAuthError();
            throw new Error("Unauthorized");
          }
          return r.json();
        })
        .then((data) => {
          if (!data.cwd && data.error) throw new Error(data.error);
          setCwd(data.cwd || "");
          printPrompt();
        })
        .catch((e) => {
          setTermLines((prev) => [...prev, String((e as Error).message || e), ""]);
          printPrompt();
        });
      return;
    }
    fetch("/api/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authedHeaders },
      body: JSON.stringify({ cmd: line, cwd }),
    })
      .then((r) => {
        if (r.status === 401) {
          onAuthError();
          throw new Error("Unauthorized");
        }
        return r.json();
      })
      .then((data) => {
        const out = (data.output ?? "").replace(/\r/g, "");
        const lines = out.length ? out.split("\n") : [];
        setTermLines((prev) => [...prev, ...lines, ""]);
        printPrompt();
      })
      .catch((e) => {
        setTermLines((prev) => [...prev, String((e as Error).message || e), ""]);
        printPrompt();
      });
  }

  return (
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
  );
}

export default TerminalPanel;

