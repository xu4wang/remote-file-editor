export type TreeNode = {
  type: "dir" | "file";
  name: string;
  path: string;
  children?: TreeNode[];
  size?: number;
  hasMore?: boolean;
  offset?: number;
  limit?: number;
  nextOffset?: number;
};

export type Tab =
  | {
      kind: "text";
      path: string;
      content: string;
      originalContent: string;
      dirty: boolean;
    }
  | {
      kind: "image";
      path: string;
      dataUrl: string;
      originalDataUrl: string;
      dirty: boolean;
    };

export type WorkspaceFile = {
  rootPath: string | null;
  openFiles: string[];
  activePath: string | null;
};

export type ShareInfo = {
  shareId: string;
  path: string;
  username: string;
  createdAt: string;
  expiresAt: string | null;
  url: string;
  theme: "light" | "dark" | null;
};

export type ShareLog = {
  createdAt: string;
  ip: string;
  userAgent: string;
  usernameAttempt: string;
  success: number;
  error: string;
};
