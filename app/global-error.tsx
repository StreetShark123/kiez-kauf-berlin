"use client";

import { useEffect } from "react";
import { ErrorPixelNoteScreen } from "@/components/ErrorPixelNoteScreen";
import { getDictionary } from "@/lib/i18n";
import { getDefaultLocale } from "@/lib/locale";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const dictionary = getDictionary(getDefaultLocale());

  useEffect(() => {
    console.error("Global app error boundary caught an exception", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <ErrorPixelNoteScreen
          title={dictionary.errorTitle}
          description={dictionary.errorDescription}
          joke={dictionary.errorJoke}
          hint={dictionary.errorCanvasHint}
          retryLabel={dictionary.retryAction}
          clearLabel={dictionary.clearNoteAction}
          exitLabel={dictionary.backHome}
          exitHref="/"
          onRetry={reset}
        />
      </body>
    </html>
  );
}
