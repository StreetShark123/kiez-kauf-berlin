"use client";

import Link from "next/link";
import { useEffect } from "react";
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
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6">
      <section className="surface-card w-full p-8 text-center">
        <p className="section-title">Error</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{dictionary.errorTitle}</h1>
        <p className="muted-text mt-2 text-sm">{dictionary.errorDescription}</p>
        <p className="status-text mt-2">{dictionary.errorJoke}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reset} className="btn-primary inline-flex px-4 py-2 text-sm font-medium">
            {dictionary.retryAction}
          </button>
          <Link href="/" className="btn-ghost inline-flex px-4 py-2 text-sm font-medium">
            {dictionary.backHome}
          </Link>
        </div>
      </section>
    </main>
  );
}
