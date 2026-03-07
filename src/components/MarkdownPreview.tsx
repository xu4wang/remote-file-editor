import React, { useEffect, useMemo, useRef } from "react";
import MarkdownIt from "markdown-it";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore no types for this plugin
import taskLists from "markdown-it-task-lists";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import mermaid from "mermaid";
import "highlight.js/styles/vs2015.css";

type Props = {
  markdown: string;
  theme: "light" | "dark";
  className?: string;
  containerRef?: React.Ref<HTMLDivElement>;
};

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MarkdownPreview: React.FC<Props> = ({ markdown, theme, className, containerRef }) => {
  const localRef = useRef<HTMLDivElement>(null);
  const setRefs = (el: HTMLDivElement | null) => {
    if (typeof containerRef === "function") (containerRef as (el: HTMLDivElement | null) => void)(el);
    else if (containerRef && (containerRef as React.MutableRefObject<HTMLDivElement | null>).current !== undefined) {
      (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    }
    localRef.current = el;
  };

  const md = useMemo(() => {
    const instance = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: false,
      highlight(code: string, lang: string) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            const out = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
            return `<pre><code class="hljs language-${lang}">${out}</code></pre>`;
          } catch {}
        }
        const escaped = escapeHtml(code);
        return `<pre><code class="hljs language-${lang || "plaintext"}">${escaped}</code></pre>`;
      },
    });
    // GFM task lists
    instance.use(taskLists, { label: true, checkbox: true });
    // Mermaid: convert fenced block to <div class="mermaid">...</div>
    const defaultFence = instance.renderer.rules.fence!;
    instance.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, self: any) => {
      const token = tokens[idx];
      const info = (token.info || "").trim();
      const lang = info.split(/\s+/g)[0];
      if (lang === "mermaid") {
        return `<div class="mermaid">${escapeHtml(token.content)}</div>`;
      }
      return defaultFence(tokens, idx, options, env, self);
    };
    return instance;
  }, []);

  useEffect(() => {
    if (!localRef.current) return;
    const rawHtml = md.render(markdown || "");
    const clean = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["class", "target", "rel", "aria-hidden"],
    });
    localRef.current.innerHTML = clean;
    // Add ids for inline code tokens (e.g., table names) to support anchors like #crm_customer_xxx
    try {
      const usedIds = new Set<string>();
      const existing = Array.from(localRef.current.querySelectorAll("[id]")) as HTMLElement[];
      existing.forEach((el) => usedIds.add(el.id));
      const inlineCodes = Array.from(
        localRef.current.querySelectorAll(":not(pre) > code")
      ) as HTMLElement[];
      inlineCodes.forEach((el) => {
        const txt = (el.textContent || "").trim();
        if (!txt) return;
        // Only create ids for safe tokens (letters, numbers, underscore, dash)
        if (!/^[A-Za-z0-9_\-]+$/.test(txt)) return;
        let id = txt;
        if (usedIds.has(id)) {
          let n = 2;
          while (usedIds.has(`${id}-${n}`)) n++;
          id = `${id}-${n}`;
        }
        el.id = id;
        usedIds.add(id);
      });
    } catch {
      // ignore
    }
    // init mermaid
    try {
      mermaid.initialize({ startOnLoad: false, theme: theme === "dark" ? "dark" : "default", securityLevel: "loose" });
      // Transform any pre>code.language-mermaid into div.mermaid
      const pres = Array.from(localRef.current.querySelectorAll("pre code.language-mermaid"));
      pres.forEach((code) => {
        const pre = code.parentElement!;
        const chart = code.textContent || "";
        const div = document.createElement("div");
        div.className = "mermaid";
        div.textContent = chart;
        pre.replaceWith(div);
      });
      mermaid.run({ nodes: localRef.current.querySelectorAll(".mermaid") as any });
    } catch {
      // ignore mermaid errors
    }
  }, [markdown, md, theme]);

  return <div ref={setRefs} className={className} />;
};

export default MarkdownPreview;
