"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
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
    <main className="surface-card p-6 text-center md:p-8">
      <p className="section-title">Error</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">{dictionary.errorTitle}</h2>
      <p className="muted-text mt-2 text-sm">{dictionary.errorDescription}</p>
      <p className="status-text mt-2">{dictionary.errorJoke}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className="btn-primary inline-flex px-4 py-2 text-sm font-medium">
          {dictionary.retryAction}
        </button>
        <Link href={`/${locale}`} className="btn-ghost inline-flex px-4 py-2 text-sm font-medium">
          {dictionary.backHome}
        </Link>
      </div>
    </main>
  );
}
