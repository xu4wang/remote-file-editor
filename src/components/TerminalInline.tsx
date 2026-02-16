import { useEffect, useRef, useState } from "react";

type TerminalInlineProps = {
  cwd: string;
  lines: string[];
  onSubmit: (v: string) => void;
  hist: string[];
  histIdx: number;
  setHistIdx: (n: number) => void;
};

function TerminalInline(props: TerminalInlineProps) {
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

export default TerminalInline;

