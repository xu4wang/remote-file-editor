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
