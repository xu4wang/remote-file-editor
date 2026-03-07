import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import Database from "better-sqlite3";
import crypto from "crypto";
import { marked } from "marked";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5174;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const baseDir = process.env.WORKSPACE_DIR || process.cwd();
const WWWROOT = (process.env.WWWROOT || "").replace(/\/+$/, "");

const dbPath = path.join(baseDir, "remote-editor-share.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id TEXT NOT NULL UNIQUE,
    file_path TEXT NOT NULL,
    username TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    html_content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    theme TEXT
  );
  CREATE TABLE IF NOT EXISTS share_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id TEXT NOT NULL,
    username TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS share_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    username_attempt TEXT,
    success INTEGER NOT NULL,
    error TEXT
  );
`);

try {
  db.exec("ALTER TABLE shares ADD COLUMN theme TEXT");
} catch (e) {
}

function getShareUsers(shareId) {
  return db
    .prepare(
      "SELECT username, password_salt, password_hash, created_at, active FROM share_users WHERE share_id = ?"
    )
    .all(shareId);
}

function resolveSafe(p = "") {
  const full = path.resolve(baseDir, p);
  if (!full.startsWith(path.resolve(baseDir))) {
    throw new Error("Invalid path");
  }
  return full;
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  const parts = header.split(";");
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());
    if (!key) continue;
    result[key] = value;
  }
  return result;
}

function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  const buf = crypto.scryptSync(password, salt, 64);
  return buf.toString("hex");
}

function verifyPassword(password, salt, hash) {
  const hashed = hashPassword(password, salt);
  return hashed === hash;
}

function generateShareId() {
  return crypto.randomBytes(8).toString("hex");
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0].split(",")[0].trim();
  }
  if (req.socket && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }
  return "";
}

function logShareEvent(shareId, req, success, usernameAttempt, error) {
  const createdAt = new Date().toISOString();
  const ip = getClientIp(req);
  const userAgent = req.headers["user-agent"] || "";
  db.prepare(
    "INSERT INTO share_logs (share_id, created_at, ip, user_agent, username_attempt, success, error) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(shareId, createdAt, ip, userAgent, usernameAttempt || null, success ? 1 : 0, error || null);
}

function getShareById(shareId) {
  return db.prepare("SELECT * FROM shares WHERE share_id = ?").get(shareId);
}

function getActiveShareByPath(filePath) {
  return db.prepare("SELECT * FROM shares WHERE file_path = ? AND active = 1").get(filePath);
}

function isShareExpired(share) {
  if (!share || !share.expires_at) return false;
  const dt = new Date(share.expires_at);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getTime() < Date.now();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownForShare(filePath, markdown, shareId) {
  const renderer = new marked.Renderer();
  renderer.image = (href, title, text) => {
    let src = "";
    if (typeof href === "string") {
      src = href;
    } else if (href && typeof href === "object") {
      if (typeof href.href === "string") {
        src = href.href;
      } else if (typeof href.text === "string") {
        src = href.text;
      }
    }
    const safeAlt = escapeHtml(text || "");
    const safeTitle = title ? ` title="${escapeHtml(title)}"` : "";
    if (!src || src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
      const safeSrc = escapeHtml(src);
      return `<img src="${safeSrc}" alt="${safeAlt}"${safeTitle}>`;
    }
    const baseDirPath = path.dirname(filePath || "");
    const joined = baseDirPath ? path.join(baseDirPath, src) : src;
    const normalized = joined.replace(/\\/g, "/");
    const imgUrl = `/share/${shareId}/image?path=${encodeURIComponent(normalized)}`;
    const safeSrc = escapeHtml(imgUrl);
    return `<img src="${safeSrc}" alt="${safeAlt}"${safeTitle}>`;
  };
  return marked.parse(markdown, { renderer });
}

function makeShareUrl(req, shareId) {
  const root = WWWROOT || `${req.protocol}://${req.get("host")}`;
  const trimmed = root.replace(/\/+$/, "");
  return `${trimmed}/share/${shareId}`;
}

function renderShareLoginPage(shareId, message) {
  const safeMessage = message || "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Protected document</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
body{margin:0;padding:24px;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#020617;color:#e5e7eb;}
.card{max-width:420px;margin:40px auto;padding:24px;border-radius:8px;background:#020617;border:1px solid #1f2937;box-shadow:0 10px 30px rgba(0,0,0,0.45);}
h1{margin:0 0 16px;font-size:20px;}
label{display:block;margin-bottom:12px;font-size:14px;}
input{width:100%;padding:6px 10px;margin-top:4px;border-radius:4px;border:1px solid #4b5563;background:#020617;color:#e5e7eb;}
button{margin-top:8px;width:100%;padding:8px 10px;border-radius:4px;border:none;background:#3b82f6;color:white;font-size:14px;cursor:pointer;}
button:hover{background:#2563eb;}
.error{margin-bottom:12px;padding:8px 10px;border-radius:4px;background:#7f1d1d;color:#fecaca;font-size:13px;}
.hint{margin-top:12px;font-size:12px;color:#9ca3af;}
</style>
</head>
<body>
<div class="card">
<h1>Protected document</h1>
${safeMessage ? `<div class="error">${escapeHtml(safeMessage)}</div>` : ""}
<form method="post" action="/share/${shareId}/login">
<label>Username<input name="username" autocomplete="username" /></label>
<label>Password<input type="password" name="password" autocomplete="current-password" /></label>
<button type="submit">Sign in</button>
</form>
<div class="hint">This link is protected. Ask the owner for username and password.</div>
</div>
</body>
</html>`;
}

function renderSharedHtmlPage(share) {
  const title = escapeHtml(path.basename(share.file_path || "Shared document"));
  const theme = share.theme === "light" ? "light" : "dark";
  const bg = theme === "light" ? "#f9fafb" : "#020617";
  const fg = theme === "light" ? "#020617" : "#e5e7eb";
  const border = theme === "light" ? "#e5e7eb" : "#1f2937";
  const muted = theme === "light" ? "#6b7280" : "#9ca3af";
  const accent = theme === "light" ? "#2563eb" : "#60a5fa";
  const tableRowAlt = theme === "light" ? "rgba(249,250,251,1)" : "rgba(15,23,42,0.6)";
  const tableRowHover = theme === "light" ? "rgba(219,234,254,1)" : "rgba(30,64,175,0.45)";
  // Code blocks use dark mode as requested, but inline code and mermaid use defaults
  const prismTheme = "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css";
  const mermaidTheme = "default";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${prismTheme}" />
<style>
body{margin:0;padding:24px;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:${bg};color:${fg};}
.container{max-width:960px;margin:0 auto;}
main{margin-top:8px;}
a{color:${accent};}
img{max-width:100%;height:auto;display:block;margin:12px 0;}
pre{border-radius:4px;padding:12px;overflow:auto;margin:16px 0 !important;background:#1f2937 !important;border:1px solid #374151 !important;}
code{font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;}
:not(pre) > code{background:rgba(148,163,184,0.1);padding:2px 4px;border-radius:4px;}
.mermaid{background:transparent;display:flex;justify-content:center;margin:16px 0;}
.table-wrapper{width:100%;overflow-x:auto;margin:16px 0;}
table{width:100%;border-collapse:collapse;border-spacing:0;font-size:13px;margin:0;}
thead{background:${bg};}
th,td{padding:8px 10px;border-bottom:1px solid ${border};text-align:left;vertical-align:top;}
th{font-weight:600;color:${fg};white-space:nowrap;}
tbody tr:nth-child(even){background:${tableRowAlt};}
tbody tr:hover{background:${tableRowHover};}
.table-wrapper table{margin:0;}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:10px 0 6px;border-bottom:1px solid ${border};font-size:14px;position:sticky;top:0;background:${bg};z-index:10;}
.topbar-title{font-weight:600;color:${fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;}
.toc-toggle{border:none;background:transparent;color:${muted};font-size:12px;cursor:pointer;padding:4px 10px;border-radius:999px;display:inline-flex;align-items:center;gap:4px;}
.toc-toggle:hover{background:rgba(148,163,184,0.15);}
.layout{display:flex;gap:32px;margin-top:12px;}
.content{flex:1;min-width:0;}
.toc-desktop{width:220px;font-size:12px;color:${muted};display:none;position:sticky;top:56px;align-self:flex-start;max-height:calc(100vh - 72px);overflow:auto;padding-left:16px;border-left:1px solid ${border};}
.toc-title{font-weight:600;margin-bottom:6px;color:${muted};text-transform:uppercase;letter-spacing:0.04em;font-size:11px;}
.toc-list{list-style:none;padding:0;margin:0;}
.toc-item{margin-bottom:3px;line-height:1.4;}
.toc-item a{text-decoration:none;color:${muted};}
.toc-item a:hover{text-decoration:underline;color:${fg};}
.toc-level-1{font-weight:500;margin-top:8px;}
.toc-level-2{margin-left:10px;font-size:11px;}
.toc-level-3{margin-left:18px;font-size:11px;opacity:0.9;}
.toc-mobile{position:fixed;inset:0;z-index:40;display:none;background:rgba(0,0,0,0.75);}
.toc-mobile.open{display:block;}
.toc-mobile-inner{position:absolute;inset:auto 0 0 0;background:${bg};border-top:1px solid ${border};max-height:60vh;padding:12px 16px;display:flex;flex-direction:column;}
.toc-mobile-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-shrink:0;}
.toc-mobile-title{font-size:13px;font-weight:600;color:${fg};}
.toc-close{border:none;background:transparent;color:${muted};font-size:18px;cursor:pointer;padding:0 4px;}
#tocMobileBody{flex:1;overflow:auto;margin-top:4px;}
@media (min-width: 1024px){
  .layout{align-items:flex-start;}
  .toc-desktop{display:block;}
  .toc-toggle{display:none;}
  .toc-mobile{display:none;}
}
</style>
</head>
<body>
<div class="container">
<div class="topbar">
<div class="topbar-title">${title}</div>
<button id="tocToggle" class="toc-toggle" type="button">☰ Table of contents</button>
</div>
<div class="layout">
<main id="content" class="content">
${share.html_content}
</main>
<aside class="toc-desktop">
<div class="toc-title">Table of contents</div>
<nav id="tocDesktop"></nav>
</aside>
</div>
<div id="tocMobile" class="toc-mobile">
<div class="toc-mobile-inner">
<div class="toc-mobile-header">
<div class="toc-mobile-title">Table of contents</div>
<button id="tocClose" class="toc-close" type="button">×</button>
</div>
<nav id="tocMobileBody"></nav>
</div>
</div>
</div>
<script>
(function(){
  function slugify(text){
    return String(text || "")
      .trim()
      .replace(/\\s+/g,"-");
  }
  var content=document.getElementById("content");
  if(!content)return;
  var headings=content.querySelectorAll("h1, h2, h3");
  if(!headings.length)return;
  var items=[];
  var usedIds={};
  for(var i=0;i<headings.length;i++){
    var el=headings[i];
    var level=parseInt(el.tagName.substring(1),10);
    var text=el.textContent||"";
    var id=el.id;
    if(!id){
      var baseId=slugify(text);
      if(!baseId){
        baseId="section";
      }
      id=baseId;
      var n=1;
      while(usedIds[id]){
        n+=1;
        id=baseId+"-"+n;
      }
      el.id=id;
    }
    usedIds[id]=true;
    items.push({id:id,text:text,level:level});
  }
  function buildList(container){
    if(!container)return;
    var ul=document.createElement("ul");
    ul.className="toc-list";
    for(var j=0;j<items.length;j++){
      var item=items[j];
      var li=document.createElement("li");
      li.className="toc-item toc-level-"+item.level;
      var a=document.createElement("a");
      a.href="#"+item.id;
      a.textContent=item.text;
      li.appendChild(a);
      ul.appendChild(li);
    }
    container.innerHTML="";
    container.appendChild(ul);
  }
  buildList(document.getElementById("tocDesktop"));
  var tocMobileBody=document.getElementById("tocMobileBody");
  buildList(tocMobileBody);
  var toggle=document.getElementById("tocToggle");
  var mobile=document.getElementById("tocMobile");
  var close=document.getElementById("tocClose");
  if(toggle&&mobile){
    toggle.addEventListener("click",function(){
      if(mobile.classList.contains("open")){
        mobile.classList.remove("open");
      }else{
        mobile.classList.add("open");
      }
    });
  }
  if(close&&mobile){
    close.addEventListener("click",function(){
      mobile.classList.remove("open");
    });
  }
  if(mobile){
    mobile.addEventListener("click",function(e){
      if(e.target===mobile){
        mobile.classList.remove("open");
      }
    });
  }
  if(mobile&&tocMobileBody){
    tocMobileBody.addEventListener("click",function(e){
      var target=e.target;
      while(target&&target!==tocMobileBody){
        if(target.tagName&&target.tagName.toLowerCase()==="a"){
          mobile.classList.remove("open");
          break;
        }
        target=target.parentNode;
      }
    });
  }
})();
</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: '${mermaidTheme}' });
  
  // Handle any mermaid blocks that marked might have wrapped in pre/code
  document.querySelectorAll('pre code.language-mermaid').forEach($el => {
    const $pre = $el.parentElement;
    const chart = $el.textContent;
    const $div = document.createElement('div');
    $div.className = 'mermaid';
    $div.textContent = chart;
    $pre.replaceWith($div);
  });
  // If they are just divs with class mermaid (some renderers do this)
  mermaid.run();
</script>
</body>
</html>`;
}

function authMiddleware(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) {
    return res.status(401).json({ error: "Missing token" });
  }
  const parts = header.split(" ");
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
}

app.post("/api/auth/login", (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: "Password required" });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
});

app.get("/api/fs/tree", authMiddleware, (req, res) => {
  const rel = req.query.path || "";
  const depth = Math.max(0, parseInt(req.query.depth || "1", 10) || 1);
  const offset = Math.max(0, parseInt(req.query.offset || "0", 10) || 0);
  const limit = Math.max(1, Math.min(2000, parseInt(req.query.limit || "200", 10) || 200));
  const target = resolveSafe(rel);
  try {
    function readNode(p, d, off = 0, lim = limit) {
      const stats = fs.statSync(p);
      const base = {
        name: path.basename(p),
        path: path.relative(baseDir, p) || "",
      };
      if (stats.isDirectory()) {
        const node = { type: "dir", ...base };
        if (d <= 0) {
          return node;
        }
        const items = fs.readdirSync(p);
        const slice = items.slice(off, off + lim);
        const children = slice.map((name) => {
          const childPath = path.join(p, name);
          const st = fs.statSync(childPath);
          if (st.isDirectory()) {
            return {
              type: "dir",
              name,
              path: path.relative(baseDir, childPath),
            };
          } else {
            return {
              type: "file",
              name,
              path: path.relative(baseDir, childPath),
              size: st.size,
            };
          }
        });
        const hasMore = off + slice.length < items.length;
        return {
          ...node,
          children,
          hasMore,
          offset: off,
          limit: lim,
          total: items.length,
          nextOffset: hasMore ? off + slice.length : undefined,
        };
      } else {
        return {
          type: "file",
          ...base,
          size: stats.size,
        };
      }
    }
    const tree = readNode(target, depth, offset, limit);
    res.json(tree);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/fs/read", authMiddleware, (req, res) => {
  const rel = req.query.path;
  if (!rel) return res.status(400).json({ error: "path required" });
  try {
    const p = resolveSafe(rel);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: "path is a directory" });
    }
    const content = fs.readFileSync(p, "utf8");
    res.json({ content });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/fs/read-binary", authMiddleware, (req, res) => {
  const rel = req.query.path;
  if (!rel) return res.status(400).json({ error: "path required" });
  try {
    const p = resolveSafe(rel);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: "path is a directory" });
    }
    const ext = path.extname(p).toLowerCase();
    const mimeMap = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".bmp": "image/bmp",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };
    const type = mimeMap[ext] || "application/octet-stream";
    res.setHeader("Content-Type", type);
    const stream = fs.createReadStream(p);
    stream.on("error", (e) => {
      res.status(400).json({ error: e.message });
    });
    stream.pipe(res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/fs/save", authMiddleware, (req, res) => {
  const { path: rel, content } = req.body || {};
  if (!rel) return res.status(400).json({ error: "path required" });
  try {
    const p = resolveSafe(rel);
    fs.writeFileSync(p, content ?? "", "utf8");
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/fs/save-binary", authMiddleware, (req, res) => {
  const { path: rel, dataUrl } = req.body || {};
  if (!rel) return res.status(400).json({ error: "path required" });
  if (typeof dataUrl !== "string") {
    return res.status(400).json({ error: "dataUrl required" });
  }
  const idx = dataUrl.indexOf(",");
  if (idx === -1) {
    return res.status(400).json({ error: "invalid dataUrl" });
  }
  try {
    const p = resolveSafe(rel);
    const base64 = dataUrl.slice(idx + 1);
    const buf = Buffer.from(base64, "base64");
    fs.writeFileSync(p, buf);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/fs/chdir", authMiddleware, (req, res) => {
  const cwdRel = req.query.cwd || "";
  const target = req.query.target || "";
  try {
    const from = resolveSafe(cwdRel);
    const destAbs = path.resolve(from, target || ".");
    if (!destAbs.startsWith(path.resolve(baseDir))) {
      return res.status(400).json({ error: "Invalid path" });
    }
    const st = fs.statSync(destAbs);
    if (!st.isDirectory()) {
      return res.status(400).json({ error: "Not a directory" });
    }
    const newRel = path.relative(baseDir, destAbs);
    res.json({ cwd: newRel });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/share", authMiddleware, (req, res) => {
  const rel = req.query.path;
  if (!rel) {
    return res.status(400).json({ error: "path required" });
  }
  try {
    const row = getActiveShareByPath(rel);
    if (!row || isShareExpired(row)) {
      return res.json({ share: null });
    }
    const userRows = getShareUsers(row.share_id).filter((u) => u.active);
    const url = makeShareUrl(req, row.share_id);
    res.json({
      share: {
        shareId: row.share_id,
        path: row.file_path,
        username: row.username,
        createdAt: row.created_at,
        expiresAt: row.expires_at || null,
        url,
        theme: row.theme || null,
        users: userRows.map((u) => ({ username: u.username })),
      },
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to load share" });
  }
});

app.post("/api/share", authMiddleware, (req, res) => {
  const { path: rel, username, password, expiresAt, theme, users } = req.body || {};
  if (!rel) {
    return res.status(400).json({ error: "path required" });
  }
  const lower = String(rel).toLowerCase();
  if (!lower.endsWith(".md") && !lower.endsWith(".markdown")) {
    return res.status(400).json({ error: "only markdown files can be shared" });
  }
  try {
    const p = resolveSafe(rel);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: "path is a directory" });
    }
    const markdown = fs.readFileSync(p, "utf8");
    const now = new Date().toISOString();
    let expireIso = null;
    if (expiresAt) {
      const dt = new Date(expiresAt);
      if (!Number.isNaN(dt.getTime())) {
        expireIso = dt.toISOString();
      }
    }
    const themeValue = theme === "light" || theme === "dark" ? theme : null;
    const existing = getActiveShareByPath(rel);
    const incomingUsers = Array.isArray(users) ? users.filter((u) => u && typeof u.username === "string") : null;
    if (!incomingUsers || incomingUsers.length === 0) {
      if (!username) {
        return res.status(400).json({ error: "username required" });
      }
    }
    let shareId;
    let createdAt = now;
    if (existing) {
      shareId = existing.share_id;
      createdAt = existing.created_at || now;
      const html = renderMarkdownForShare(rel, markdown, shareId);
      let salt = existing.password_salt;
      let hash = existing.password_hash;
      if (password && String(password).length > 0) {
        salt = generateSalt();
        hash = hashPassword(password, salt);
      }
      db.prepare(
        "UPDATE shares SET username = ?, password_salt = ?, password_hash = ?, html_content = ?, expires_at = ?, theme = ?, active = 1 WHERE share_id = ?"
      ).run(username || existing.username, salt, hash, html, expireIso, themeValue, shareId);
    } else {
      if ((!incomingUsers || incomingUsers.length === 0) && (!password || String(password).length === 0)) {
        return res.status(400).json({ error: "password required for new share" });
      }
      shareId = generateShareId();
      const html = renderMarkdownForShare(rel, markdown, shareId);
      let salt = "";
      let hash = "";
      if (password && String(password).length > 0 && username) {
        salt = generateSalt();
        hash = hashPassword(password, salt);
      } else {
        salt = generateSalt();
        hash = hashPassword(generateShareId(), salt);
      }
      db.prepare(
        "INSERT INTO shares (share_id, file_path, username, password_salt, password_hash, html_content, created_at, expires_at, active, theme) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)"
      ).run(shareId, rel, username || "", salt, hash, html, now, expireIso, themeValue);
    }

    if (incomingUsers && incomingUsers.length > 0) {
      const existingUsers = getShareUsers(shareId);
      const byName = new Map();
      for (const u of existingUsers) {
        byName.set(u.username, u);
      }
      const seen = new Set();
      for (const u of incomingUsers) {
        const name = String(u.username || "").trim();
        if (!name) continue;
        seen.add(name);
        const pw = typeof u.password === "string" ? u.password : "";
        const existingUser = byName.get(name);
        if (!existingUser) {
          if (!pw) {
            return res.status(400).json({ error: "password required for new user" });
          }
          const saltU = generateSalt();
          const hashU = hashPassword(pw, saltU);
          db.prepare(
            "INSERT INTO share_users (share_id, username, password_salt, password_hash, created_at, active) VALUES (?, ?, ?, ?, ?, 1)"
          ).run(shareId, name, saltU, hashU, now);
        } else {
          let saltU = existingUser.password_salt;
          let hashU = existingUser.password_hash;
          if (pw) {
            saltU = generateSalt();
            hashU = hashPassword(pw, saltU);
          }
          db.prepare(
            "UPDATE share_users SET password_salt = ?, password_hash = ?, active = 1 WHERE share_id = ? AND username = ?"
          ).run(saltU, hashU, shareId, name);
        }
      }
      for (const u of existingUsers) {
        if (!seen.has(u.username) && u.active) {
          db.prepare("UPDATE share_users SET active = 0 WHERE share_id = ? AND username = ?").run(shareId, u.username);
        }
      }
    }
    const row = getShareById(shareId);
    const url = makeShareUrl(req, row.share_id);
    res.json({
      share: {
        shareId: row.share_id,
        path: row.file_path,
        username: row.username,
        createdAt: row.created_at,
        expiresAt: row.expires_at || null,
        url,
        theme: row.theme || null,
        users: (incomingUsers && incomingUsers.length > 0
          ? incomingUsers.map((u) => ({ username: String(u.username || "").trim() })).filter((u) => u.username)
          : getShareUsers(row.share_id).filter((u) => u.active).map((u) => ({ username: u.username }))),
      },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/share/:shareId/logs", authMiddleware, (req, res) => {
  const { shareId } = req.params;
  const rawLimit = req.query.limit;
  const limit = Math.max(1, Math.min(200, parseInt(String(rawLimit || "50"), 10) || 50));
  try {
    const rows = db
      .prepare(
        "SELECT created_at, ip, user_agent, username_attempt, success, error FROM share_logs WHERE share_id = ? ORDER BY id DESC LIMIT ?"
      )
      .all(shareId, limit);
    const logs = rows.map((row) => ({
      createdAt: row.created_at,
      ip: row.ip || "",
      userAgent: row.user_agent || "",
      usernameAttempt: row.username_attempt || "",
      success: row.success ? 1 : 0,
      error: row.error || "",
    }));
    res.json({ logs });
  } catch (e) {
    res.status(500).json({ error: "Failed to load logs" });
  }
});

app.get("/api/share/list", authMiddleware, (req, res) => {
  const onlyActive = String(req.query.active || "").trim() === "1";
  try {
    const rows = db
      .prepare(
        `SELECT share_id, file_path, username, created_at, expires_at, active, theme
         FROM shares
         ${onlyActive ? "WHERE active = 1" : ""}
         ORDER BY created_at DESC`
      )
      .all();
    const shares = rows.map((row) => {
      const expired = isShareExpired(row);
      const users = getShareUsers(row.share_id).filter((u) => u.active);
      return {
        shareId: row.share_id,
        path: row.file_path,
        username: row.username,
        createdAt: row.created_at,
        expiresAt: row.expires_at || null,
        active: !!row.active,
        expired,
        url: null,
        theme: row.theme || null,
         users: users.map((u) => ({ username: u.username })),
      };
    });
    res.json({ shares });
  } catch (e) {
    res.status(500).json({ error: "Failed to list shares" });
  }
});

app.delete("/api/share/:shareId", authMiddleware, (req, res) => {
  const { shareId } = req.params;
  try {
    db.prepare("UPDATE shares SET active = 0 WHERE share_id = ?").run(shareId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to delete share" });
  }
});

app.post("/api/exec", authMiddleware, (req, res) => {
  const { cmd, args = [], cwd = "" } = req.body || {};
  if (!cmd) return res.status(400).json({ error: "cmd required" });
  try {
    const safeCwd = resolveSafe(cwd);
    const child = spawn(cmd, Array.isArray(args) ? args : [], {
      cwd: safeCwd,
      shell: true,
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => {
      res.json({ code, output });
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/share/:shareId/image", (req, res) => {
  const { shareId } = req.params;
  const rel = req.query.path;
  if (!rel) {
    return res.status(400).send("path required");
  }
  try {
    const share = getShareById(shareId);
    if (!share || !share.active || isShareExpired(share)) {
      return res.status(404).send("Not found");
    }
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[`share_${shareId}`];
    if (!token) {
      return res.status(403).send("Forbidden");
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (!payload || payload.shareId !== shareId) {
        return res.status(403).send("Forbidden");
      }
    } catch {
      return res.status(403).send("Forbidden");
    }
    const p = resolveSafe(String(rel));
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      return res.status(400).send("path is a directory");
    }
    const ext = path.extname(p).toLowerCase();
    const mimeMap = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".bmp": "image/bmp",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };
    const type = mimeMap[ext] || "application/octet-stream";
    res.setHeader("Content-Type", type);
    const stream = fs.createReadStream(p);
    stream.on("error", () => {
      res.status(500).send("Failed to read image");
    });
    stream.pipe(res);
  } catch {
    res.status(500).send("Server error");
  }
});

app.get("/share/:shareId", (req, res) => {
  const { shareId } = req.params;
  try {
    const share = getShareById(shareId);
    if (!share || !share.active || isShareExpired(share)) {
      return res.status(404).send("Not found");
    }
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[`share_${shareId}`];
    let authorized = false;
    let usernameFromToken = "";
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.shareId === shareId) {
          authorized = true;
          if (payload.username && typeof payload.username === "string") {
            usernameFromToken = payload.username;
          }
        }
      } catch {
      }
    }
    if (!authorized) {
      const error = req.query.error ? String(req.query.error) : "";
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(renderShareLoginPage(shareId, error));
    }
    logShareEvent(shareId, req, true, usernameFromToken || share.username, "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(renderSharedHtmlPage(share));
  } catch (e) {
    res.status(500).send("Server error");
  }
});

app.post("/share/:shareId/login", (req, res) => {
  const { shareId } = req.params;
  const body = req.body || {};
  const username = body.username || "";
  const password = body.password || "";
  try {
    const share = getShareById(shareId);
    if (!share || !share.active || isShareExpired(share)) {
      logShareEvent(shareId, req, false, username, "Share not found");
      return res.status(404).send("Not found");
    }
    if (!username || !password) {
      logShareEvent(shareId, req, false, username, "Missing credentials");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(renderShareLoginPage(shareId, "Username and password are required"));
    }
    const users = getShareUsers(shareId).filter((u) => u.active);
    let ok = false;
    let matchedUsername = "";
    if (users.length > 0) {
      const found = users.find((u) => u.username === username);
      if (found) {
        if (verifyPassword(password, found.password_salt, found.password_hash)) {
          ok = true;
          matchedUsername = found.username;
        }
      }
    } else {
      const okUser = username === share.username;
      const okPass = verifyPassword(password, share.password_salt, share.password_hash);
      if (okUser && okPass) {
        ok = true;
        matchedUsername = username;
      }
    }
    if (!ok) {
      logShareEvent(shareId, req, false, username, "Invalid credentials");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(renderShareLoginPage(shareId, "Invalid username or password"));
    }
    logShareEvent(shareId, req, true, matchedUsername || username, "");
    const token = jwt.sign({ shareId, username: matchedUsername || username }, JWT_SECRET, { expiresIn: "12h" });
    res.cookie(`share_${shareId}`, token, { httpOnly: false, sameSite: "lax" });
    return res.redirect(`/share/${shareId}`);
  } catch (e) {
    res.status(500).send("Server error");
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, baseDir });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
