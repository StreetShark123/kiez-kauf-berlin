import { notFound } from "next/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getDictionary } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1160px] flex-col px-4 pb-6 pt-4 md:px-6 md:pt-5">
      <main className="flex-1">{children}</main>
      <footer className="mt-8 border-t border-neutral-300 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="mono text-[0.72rem] uppercase tracking-[0.12em] text-neutral-500">{dictionary.appTitle}</p>
          <LanguageSwitcher locale={locale} label={dictionary.languageLabel} />
        </div>
      </footer>
    </div>
  );
}
