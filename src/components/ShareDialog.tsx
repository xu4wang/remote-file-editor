import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Input } from "./ui";
import type { ShareInfo, ShareLog } from "../types";

type ShareDialogProps = {
  path: string | null;
  authedHeaders: Record<string, string>;
  onClose: () => void;
  theme: "light" | "dark";
};

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function ShareDialog(props: ShareDialogProps) {
  const { path, authedHeaders, onClose, theme } = props;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [users, setUsers] = useState<{ id: string; username: string; password: string; existing: boolean }[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [logs, setLogs] = useState<ShareLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function loadLogs(shareId: string) {
    setLogsLoading(true);
    fetch(`/api/share/${encodeURIComponent(shareId)}/logs?limit=100`, {
      headers: { ...authedHeaders },
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load logs");
        }
        return res.json();
      })
      .then((data) => {
        const items: ShareLog[] = data.logs || [];
        setLogs(items);
      })
      .catch((e) => {
        setError(e.message || "Failed to load logs");
      })
      .finally(() => {
        setLogsLoading(false);
      });
  }

  useEffect(() => {
    if (!path) return;
    fetch(`/api/share?path=${encodeURIComponent(path)}`, {
      headers: { ...authedHeaders },
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load share info");
        }
        return res.json();
      })
      .then((data) => {
        const info: ShareInfo | null = data.share ?? null;
        setError(null);
        setSuccessMessage(null);
        setShare(info);
        if (info) {
          if (info.users && info.users.length > 0) {
            setUsers(
              info.users.map((u, idx) => ({
                id: `existing-${idx}`,
                username: u.username,
                password: "",
                existing: true,
              }))
            );
          } else if (info.username) {
            setUsers([
              {
                id: "existing-0",
                username: info.username,
                password: "",
                existing: true,
              },
            ]);
          } else {
            setUsers([]);
          }
          setExpiresAt(formatDate(info.expiresAt));
          loadLogs(info.shareId);
        } else {
          setUsers([]);
          setExpiresAt("");
          setLogs([]);
        }
      })
      .catch((e) => {
        setError(e.message || "Failed to load share info");
      })
      .finally(() => {
      });
  }, [path, authedHeaders]);

  if (!path) return null;

  const shareUrl = share?.url || "";

  function addUserRow() {
    setUsers((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${prev.length}`,
        username: "",
        password: "",
        existing: false,
      },
    ]);
  }

  function removeUserRow(id: string) {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!path) return;
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    const body: {
      path: string;
      username?: string;
      password?: string;
      expiresAt?: string | null;
      theme?: "light" | "dark";
      users?: { username: string; password?: string }[];
    } = {
      path,
    };
    body.theme = theme;
    const cleanedUsers = users
      .map((u) => ({
        username: u.username.trim(),
        password: u.password,
        existing: u.existing,
      }))
      .filter((u) => u.username);
    if (cleanedUsers.length === 0) {
      setSaving(false);
      setError("At least one user is required");
      return;
    }
    body.users = cleanedUsers.map((u) => ({
      username: u.username,
      password: u.password || undefined,
    }));
    if (!share && cleanedUsers.length === 1 && cleanedUsers[0].password) {
      body.username = cleanedUsers[0].username;
      body.password = cleanedUsers[0].password;
    }
    if (expiresAt) {
      body.expiresAt = new Date(expiresAt).toISOString();
    } else {
      body.expiresAt = null;
    }
    fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authedHeaders },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to save share");
        }
        return res.json();
      })
      .then((data) => {
        const info: ShareInfo = data.share;
        setShare(info);
        if (info.users && info.users.length > 0) {
          setUsers(
            info.users.map((u, idx) => ({
              id: `existing-${idx}`,
              username: u.username,
              password: "",
              existing: true,
            }))
          );
        } else if (info.username) {
          setUsers([
            {
              id: "existing-0",
              username: info.username,
              password: "",
              existing: true,
            },
          ]);
        } else {
          setUsers([]);
        }
        setExpiresAt(formatDate(info.expiresAt));
        setSuccessMessage("Share saved");
        loadLogs(info.shareId);
      })
      .catch((e) => {
        setError(e.message || "Failed to save share");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  function handleDelete() {
    if (!share) {
      onClose();
      return;
    }
    setDeleting(true);
    setError(null);
    setSuccessMessage(null);
    fetch(`/api/share/${encodeURIComponent(share.shareId)}`, {
      method: "DELETE",
      headers: { ...authedHeaders },
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to delete share");
        }
        return res.json();
      })
      .then(() => {
        setShare(null);
        setLogs([]);
        setUsers([]);
        setExpiresAt("");
        setSuccessMessage("Share disabled");
      })
      .catch((e) => {
        setError(e.message || "Failed to delete share");
      })
      .finally(() => {
        setDeleting(false);
      });
  }

  function copyUrl() {
    if (!shareUrl) return;
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setSuccessMessage("Share URL copied");
      })
      .catch(() => {
        setError("Failed to copy URL");
      });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-md border border-border bg-background p-4 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-semibold">Share Markdown</div>
          <button
            className="rounded px-2 py-1 text-xs hover:bg-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mb-3 text-xs text-muted-foreground break-all">
          File: <span className="font-mono">{path}</span>
        </div>
        {error && (
          <div className="mb-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="mb-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
            {successMessage}
          </div>
        )}
        <form onSubmit={handleSave} className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <div className="mb-1 text-xs text-muted-foreground">Users</div>
              <div className="max-h-40 overflow-auto rounded border border-border">
                <table className="min-w-full border-collapse text-[11px]">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="border-b border-border px-2 py-1 text-left font-medium">
                        Username
                      </th>
                      <th className="border-b border-border px-2 py-1 text-left font-medium">
                        Password
                      </th>
                      <th className="border-b border-border px-2 py-1 text-left font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="odd:bg-muted/10">
                        <td className="border-b border-border px-2 py-1 align-top">
                          <Input
                            value={u.username}
                            onChange={(e) =>
                              setUsers((prev) =>
                                prev.map((row) =>
                                  row.id === u.id ? { ...row, username: e.target.value } : row
                                )
                              )
                            }
                            placeholder="Username"
                            className="h-7 text-[11px]"
                          />
                        </td>
                        <td className="border-b border-border px-2 py-1 align-top">
                          <Input
                            type="password"
                            value={u.password}
                            onChange={(e) =>
                              setUsers((prev) =>
                                prev.map((row) =>
                                  row.id === u.id ? { ...row, password: e.target.value } : row
                                )
                              )
                            }
                            placeholder={
                              u.existing ? "Leave blank to keep current" : "Password"
                            }
                            className="h-7 text-[11px]"
                          />
                        </td>
                        <td className="border-b border-border px-2 py-1 align-top">
                          <button
                            type="button"
                            className="rounded px-2 py-1 text-[11px] hover:bg-secondary"
                            onClick={() => removeUserRow(u.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr>
                        <td
                          className="border-b border-border px-2 py-2 text-[11px] text-muted-foreground"
                          colSpan={3}
                        >
                          No users yet. Add at least one user to enable the share.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div>
                <Button
                  type="button"
                  className="h-7 px-2 text-[11px]"
                  onClick={addUserRow}
                >
                  Add user
                </Button>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">
                  Expires at (optional)
                </div>
                <Input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
            </div>
            <div className="w-64 space-y-2">
              <div className="mb-1 text-xs text-muted-foreground">Share URL</div>
              <div className="flex items-center gap-1">
                <input
                  className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  value={shareUrl || "(not created yet)"}
                  readOnly
                />
                <Button
                  type="button"
                  disabled={!shareUrl}
                  onClick={copyUrl}
                  className="h-9 px-2 text-xs"
                >
                  Copy
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                URL will be available to anyone who knows it and has the correct
                username and password.
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={saving} className="h-8 px-3 text-xs">
                {share ? "Update share" : "Create share"}
              </Button>
              {share && (
                <Button
                  type="button"
                  disabled={deleting}
                  onClick={handleDelete}
                  className="h-8 px-3 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/80"
                >
                  Disable share
                </Button>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              The HTML content is generated from the current file when saving.
            </div>
          </div>
        </form>
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-muted-foreground">Recent access logs</div>
            <button
              className="rounded px-2 py-1 text-[11px] hover:bg-secondary"
              onClick={() => share && loadLogs(share.shareId)}
              disabled={!share || logsLoading}
            >
              Refresh
            </button>
          </div>
          {logsLoading && (
            <div className="text-xs text-muted-foreground">Loading logs...</div>
          )}
          {!logsLoading && logs.length === 0 && (
            <div className="text-xs text-muted-foreground">No logs yet.</div>
          )}
          {!logsLoading && logs.length > 0 && (
            <div className="max-h-48 overflow-auto rounded border border-border">
              <table className="min-w-full border-collapse text-[11px]">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="border-b border-border px-2 py-1 text-left font-medium">
                      Time
                    </th>
                    <th className="border-b border-border px-2 py-1 text-left font-medium">
                      IP
                    </th>
                    <th className="border-b border-border px-2 py-1 text-left font-medium">
                      User
                    </th>
                    <th className="border-b border-border px-2 py-1 text-left font-medium">
                      Result
                    </th>
                    <th className="border-b border-border px-2 py-1 text-left font-medium">
                      Error
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, idx) => (
                    <tr key={`${log.createdAt}-${idx}`} className="odd:bg-muted/10">
                      <td className="border-b border-border px-2 py-1 align-top">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="border-b border-border px-2 py-1 align-top">
                        {log.ip || "-"}
                      </td>
                      <td className="border-b border-border px-2 py-1 align-top">
                        {log.usernameAttempt || "-"}
                      </td>
                      <td className="border-b border-border px-2 py-1 align-top">
                        {log.success ? "OK" : "Fail"}
                      </td>
                      <td className="border-b border-border px-2 py-1 align-top">
                        {log.error || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ShareDialog;
