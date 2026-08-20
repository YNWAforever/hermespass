"use client";

import Link from "next/link";
import { useEffect } from "react";

type ErrorPanelProps = {
  error?: Error & { digest?: string };
  reset?: () => void;
  statusCode?: number;
  title?: string;
  message?: string;
};

export function ErrorPanel({
  error,
  reset,
  statusCode,
  title = "This page didn't load",
  message = "Something went wrong on our end. You can try refreshing or head back home.",
}: ErrorPanelProps) {
  useEffect(() => {
    if (error) console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        {statusCode ? (
          <>
            <h1 className="text-7xl font-bold text-foreground">{statusCode}</h1>
            <h2 className="mt-4 text-xl font-semibold text-foreground">{title}</h2>
          </>
        ) : (
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        )}
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {reset ? (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
          ) : null}
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
