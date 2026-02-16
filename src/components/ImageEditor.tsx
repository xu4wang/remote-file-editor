import { useEffect, useMemo, useState } from "react";
import type { Tab } from "../types";

type ImageEditorProps = {
  tab: Extract<Tab, { kind: "image" }>;
  onChange: (dataUrl: string) => void;
};

function ImageEditor({ tab, onChange }: ImageEditorProps) {
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [keepRatio, setKeepRatio] = useState(true);
  const [colorMode, setColorMode] = useState<"original" | "grayscale">("original");
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState(tab.dataUrl);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      setWidth(w);
      setHeight(h);
      if (w > 0 && h > 0) {
        setNaturalRatio(w / h);
      }
      setPreviewUrl(tab.dataUrl);
    };
    img.src = tab.dataUrl;
  }, [tab.dataUrl]);

  const sizeBytes = useMemo(() => {
    if (!previewUrl) return 0;
    const idx = previewUrl.indexOf(",");
    if (idx === -1) return 0;
    const base64 = previewUrl.slice(idx + 1);
    const len = base64.length;
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.floor((len * 3) / 4) - padding;
  }, [previewUrl]);

  function formatBytes(n: number) {
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    if (n < 1024) return `${n} B`;
    const kb = n / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
  }

  function applyTransforms() {
    if (!previewUrl || width == null || height == null || width <= 0 || height <= 0) {
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, width, height);
      if (colorMode === "grayscale") {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const v = 0.299 * r + 0.587 * g + 0.114 * b;
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
        }
        ctx.putImageData(imageData, 0, 0);
      }
      const next = canvas.toDataURL();
      setPreviewUrl(next);
      onChange(next);
    };
    img.src = previewUrl;
  }

  function handleWidthChange(v: string) {
    const n = parseInt(v || "0", 10);
    if (!Number.isFinite(n) || n <= 0) {
      setWidth(null);
      return;
    }
    setWidth(n);
    if (keepRatio && naturalRatio && naturalRatio > 0) {
      setHeight(Math.round(n / naturalRatio));
    }
  }

  function handleHeightChange(v: string) {
    const n = parseInt(v || "0", 10);
    if (!Number.isFinite(n) || n <= 0) {
      setHeight(null);
      return;
    }
    setHeight(n);
    if (keepRatio && naturalRatio && naturalRatio > 0) {
      setWidth(Math.round(n * naturalRatio));
    }
  }

  return (
    <div className="flex h-full">
      <div className="w-64 border-r border-border p-3 text-xs">
        <div className="mb-3 text-sm font-semibold">Image</div>
        <div className="mb-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="w-16">Width</span>
            <input
              className="h-7 w-24 rounded border border-input bg-background px-2 text-xs outline-none ring-0 focus:border-ring"
              value={width ?? ""}
              onChange={(e) => handleWidthChange(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="w-16">Height</span>
            <input
              className="h-7 w-24 rounded border border-input bg-background px-2 text-xs outline-none ring-0 focus:border-ring"
              value={height ?? ""}
              onChange={(e) => handleHeightChange(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={keepRatio}
              onChange={(e) => setKeepRatio(e.target.checked)}
            />
            <span>Keep ratio</span>
          </label>
        </div>
        <div className="mb-2">
          <div className="flex items-center justify-between gap-2">
            <span className="w-16">Size</span>
            <span className="text-xs">{formatBytes(sizeBytes)}</span>
          </div>
        </div>
        <div className="mb-2">
          <div className="mb-1">Color</div>
          <select
            className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none ring-0 focus:border-ring"
            value={colorMode}
            onChange={(e) =>
              setColorMode(e.target.value === "grayscale" ? "grayscale" : "original")
            }
          >
            <option value="original">Original</option>
            <option value="grayscale">Grayscale</option>
          </select>
        </div>
        <button
          className="mt-2 w-full rounded bg-secondary px-2 py-1 text-xs hover:bg-secondary/80"
          onClick={applyTransforms}
        >
          Apply
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center bg-black/40">
        {previewUrl ? (
          <div className="max-h-full max-w-full overflow-auto p-2">
            <img
              src={previewUrl}
              alt={tab.path}
              className="max-h-[80vh] max-w-full rounded border border-border bg-background"
            />
          </div>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">No preview</div>
        )}
      </div>
    </div>
  );
}

export default ImageEditor;
