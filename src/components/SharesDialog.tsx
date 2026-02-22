import { useEffect, useState } from "react";
import { Button } from "./ui";
import type { ShareInfo } from "../types";

type ShareRow = ShareInfo & {
  active: boolean;
  expired: boolean;
};

type SharesDialogProps = {
  open: boolean;
  authedHeaders: Record<string, string>;
  onClose: () => void;
  onEditShare: (path: string) => void;
};

function SharesDialog(props: SharesDialogProps) {
  const { open, authedHeaders, onClose, onEditShare } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ShareRow[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/share/list", {
      headers: { ...authedHeaders },
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load shares");
        }
        return res.json();
      })
      .then((data) => {
        const rawList = data.shares as Array<{
          shareId: string;
          path: string;
          username: string;
          createdAt: string;
          expiresAt: string | null;
          url?: string | null;
          theme?: "light" | "dark" | null;
          active: boolean | number;
          expired: boolean | number;
          users?: { username: string }[];
        }>;
        const list: ShareRow[] = (rawList || []).map((row) => ({
          shareId: row.shareId,
          path: row.path,
          username: row.username,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt ?? null,
          url: row.url || "",
          theme: row.theme || null,
          active: !!row.active,
          expired: !!row.expired,
        }));
        setItems(list);
      })
      .catch((e) => {
        setError(e.message || "Failed to load shares");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, authedHeaders]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-3xl rounded-md border border-border bg-background p-4 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-semibold">All Shares</div>
          <button
            className="rounded px-2 py-1 text-xs hover:bg-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {error && (
          <div className="mb-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {loading && (
          <div className="text-xs text-muted-foreground">Loading...</div>
        )}
        {!loading && items.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No shares yet. Open a markdown file and use Share to create one.
          </div>
        )}
        {!loading && items.length > 0 && (
          <div className="max-h-80 overflow-auto rounded border border-border">
            <table className="min-w-full border-collapse text-[11px]">
              <thead className="bg-muted/40">
                <tr>
                  <th className="border-b border-border px-2 py-1 text-left font-medium">
                    Path
                  </th>
                  <th className="border-b border-border px-2 py-1 text-left font-medium">
                    User
                  </th>
                  <th className="border-b border-border px-2 py-1 text-left font-medium">
                    Created
                  </th>
                  <th className="border-b border-border px-2 py-1 text-left font-medium">
                    Expires
                  </th>
                  <th className="border-b border-border px-2 py-1 text-left font-medium">
                    Status
                  </th>
                  <th className="border-b border-border px-2 py-1 text-left font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const created = new Date(s.createdAt).toLocaleString();
                  const expires = s.expiresAt
                    ? new Date(s.expiresAt).toLocaleString()
                    : "-";
                  let status = "Active";
                  if (!s.active) status = "Disabled";
                  else if (s.expired) status = "Expired";
                  return (
                    <tr key={s.shareId} className="odd:bg-muted/10">
                      <td className="border-b border-border px-2 py-1 align-top">
                        <div className="max-w-[220px] truncate font-mono">
                          {s.path}
                        </div>
                      </td>
                      <td className="border-b border-border px-2 py-1 align-top">
                        {s.username}
                      </td>
                      <td className="border-b border-border px-2 py-1 align-top">
                        {created}
                      </td>
                      <td className="border-b border-border px-2 py-1 align-top">
                        {expires}
                      </td>
                      <td className="border-b border-border px-2 py-1 align-top">
                        {status}
                      </td>
                      <td className="border-b border-border px-2 py-1 align-top">
                        <div className="flex flex-wrap items-center gap-1">
                          <Button
                            type="button"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => onEditShare(s.path)}
                          >
                            Edit
                          </Button>
                          {s.url && (
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-secondary"
                            >
                              Open
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default SharesDialog;
