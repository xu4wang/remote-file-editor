type ConfirmCloseDialogProps = {
  path: string | null;
  onSaveAndClose: (path: string | null) => void | Promise<void>;
  onDiscard: (path: string | null) => void;
  onCancel: () => void;
};

function ConfirmCloseDialog(props: ConfirmCloseDialogProps) {
  const { path, onSaveAndClose, onDiscard, onCancel } = props;

  if (!path) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-md border border-border bg-background p-4">
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span>⚠️</span>
          <span>Unsaved changes</span>
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1 text-sm hover:bg-secondary"
            onClick={() => onSaveAndClose(path)}
            title="Save & Close"
          >
            💾
          </button>
          <button
            className="rounded px-3 py-1 text-sm hover:bg-secondary"
            onClick={() => onDiscard(path)}
            title="Don’t Save"
          >
            ✖
          </button>
          <button
            className="rounded px-3 py-1 text-sm hover:bg-secondary"
            onClick={onCancel}
            title="Cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmCloseDialog;

