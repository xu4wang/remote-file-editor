import React from "react";

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      {...rest}
      className={`inline-flex h-9 items-center justify-center rounded-md bg-secondary px-3 text-sm text-foreground hover:bg-secondary/80 disabled:opacity-50 ${className || ""}`}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-0 focus:border-ring ${className || ""}`}
    />
  );
}

