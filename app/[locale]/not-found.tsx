"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { getDefaultLocale, isSupportedLocale } from "@/lib/locale";

export default function LocaleNotFoundPage() {
  const pathname = usePathname();
  const candidate = pathname.split("/").filter(Boolean)[0] ?? "";
  const locale = isSupportedLocale(candidate) ? candidate : getDefaultLocale();
  const dictionary = getDictionary(locale);

  return (
    <main className="surface-card p-6 text-center md:p-8">
      <p className="section-title">Error</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">{dictionary.notFoundTitle}</h2>
      <p className="muted-text mt-2 text-sm">{dictionary.notFoundDescription}</p>
      <Link href="/" className="btn-primary mt-5 inline-flex px-4 py-2 text-sm font-medium">
        {dictionary.backHome}
      </Link>
    </main>
  );
}
