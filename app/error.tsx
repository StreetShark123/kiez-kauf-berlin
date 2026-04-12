"use client";

import { useEffect } from "react";
import { ErrorPixelNoteScreen } from "@/components/ErrorPixelNoteScreen";
import { getDictionary } from "@/lib/i18n";
import { getDefaultLocale } from "@/lib/locale";

export default function RootErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const dictionary = getDictionary(getDefaultLocale());

  useEffect(() => {
    console.error("Root app error boundary caught an exception", error);
  }, [error]);

  return (
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
  );
}
