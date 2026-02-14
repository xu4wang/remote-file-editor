import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5174;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const baseDir = process.env.WORKSPACE_DIR || process.cwd();

function resolveSafe(p = "") {
  const full = path.resolve(baseDir, p);
  if (!full.startsWith(path.resolve(baseDir))) {
    throw new Error("Invalid path");
  }
  return full;
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
  const target = resolveSafe(rel);
  try {
    function readDir(p) {
      const stats = fs.statSync(p);
      if (stats.isDirectory()) {
        const items = fs.readdirSync(p);
        return {
          type: "dir",
          name: path.basename(p),
          path: path.relative(baseDir, p) || "",
          children: items
            .map((name) => path.join(p, name))
            .map((child) => readDir(child)),
        };
      } else {
        return {
          type: "file",
          name: path.basename(p),
          path: path.relative(baseDir, p),
          size: stats.size,
        };
      }
    }
    const tree = readDir(target);
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, baseDir });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
