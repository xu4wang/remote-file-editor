import { useEffect, useState } from "react";
import TerminalInline from "./TerminalInline";

type TerminalPanelProps = {
  authedHeaders: Record<string, string>;
  onAuthError: () => void;
  baseDir: string | null;
};

function TerminalPanel(props: TerminalPanelProps) {
  const { authedHeaders, onAuthError, baseDir } = props;

  const [cwd, setCwd] = useState<string>("");
  const [termLines, setTermLines] = useState<string[]>([]);
  const [hist, setHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number>(-1);
  const [termHeight, setTermHeight] = useState<number>(192);
  const [dragging, setDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartH, setDragStartH] = useState(192);

  function getPromptPath() {
    if (!baseDir) return cwd || ".";
    const trimmedBase = baseDir.replace(/[\\/]+$/, "");
    if (!cwd) return trimmedBase;
    const sep = baseDir.includes("\\") ? "\\" : "/";
    return `${trimmedBase}${sep}${cwd}`;
  }

  function getPrompt() {
    const path = getPromptPath();
    return `${path} $ `;
  }

  useEffect(() => {
    setTermLines((prev) => {
      const prompt = getPrompt();
      if (prev.length === 0) {
        return [prompt];
      }
      if (prev.length === 1 && prev[0].endsWith(" $ ") && prev[0] !== prompt) {
        return [prompt];
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseDir]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const delta = dragStartY - e.clientY;
      const h = Math.max(24, Math.min(window.innerHeight * 0.8, dragStartH + delta));
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
    const p = getPrompt();
    setTermLines((prev) => [...prev, p]);
  }

  function runCommandLine(line: string) {
    const prompt = getPrompt();
    const withCmd = `${prompt}${line}`;
    setTermLines((prev) => {
      if (prev.length === 0) return [withCmd];
      const last = prev[prev.length - 1];
      if (last === prompt) {
        return [...prev.slice(0, -1), withCmd];
      }
      return [...prev, withCmd];
    });
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
          setTermLines((prev) => [...prev, String((e as Error).message || e)]);
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
        setTermLines((prev) => [...prev, ...lines]);
        printPrompt();
      })
      .catch((e) => {
        setTermLines((prev) => [...prev, String((e as Error).message || e)]);
        printPrompt();
      });
  }

  return (
    <div className="border-t border-border" style={{ height: termHeight }}>
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
