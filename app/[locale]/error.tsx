"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ErrorPixelNoteScreen } from "@/components/ErrorPixelNoteScreen";
import { getDictionary } from "@/lib/i18n";
import { getDefaultLocale, isSupportedLocale } from "@/lib/locale";

export default function LocaleErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const candidate = pathname.split("/").filter(Boolean)[0] ?? "";
  const locale = isSupportedLocale(candidate) ? candidate : getDefaultLocale();
  const dictionary = getDictionary(locale);

  useEffect(() => {
    console.error("Locale app error boundary caught an exception", error);
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
      exitHref={`/${locale}`}
      onRetry={reset}
    />
  );
}
