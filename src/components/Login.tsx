import { useState } from "react";
import { Button, Input } from "./ui";

type LoginProps = {
  onLogin: (password: string) => void;
};

function Login({ onLogin }: LoginProps) {
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!pwd || loading) return;
    setLoading(true);
    setError(null);
    try {
      await onLogin(pwd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen w-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border p-4">
        <div className="mb-4 text-lg font-semibold">Sign In</div>
        <div className="space-y-3">
          <Input
            type="password"
            placeholder="Enter password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          {error && <div className="text-sm text-red-400">{error}</div>}
          <Button
            disabled={!pwd || loading}
            onClick={handleSubmit}
          >
            Sign In
          </Button>
          <div className="text-xs text-muted-foreground">
            Default dev password: admin. Set ADMIN_PASSWORD to override.
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
