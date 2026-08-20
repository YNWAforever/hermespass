"use client";

import { ErrorPanel } from "@/components/errors/error-panel";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <ErrorPanel error={error} reset={reset} />
      </body>
    </html>
  );
}
