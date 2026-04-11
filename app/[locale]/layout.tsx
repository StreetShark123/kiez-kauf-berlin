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
    <div className="mx-auto min-h-screen w-full max-w-6xl px-4 pb-10 pt-6 md:px-8">
      <header className="note-card note-tape mb-8 overflow-hidden p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/10 pb-4">
          <div>
            <span className="stamp">Berlin Pilot</span>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{dictionary.appTitle}</h1>
            <p className="mt-1 max-w-xl text-sm text-neutral-700">{dictionary.appSubtitle}</p>
          </div>
          <LanguageSwitcher locale={locale} label={dictionary.languageLabel} />
        </div>

        <div className="mono mt-4 flex flex-wrap gap-3 text-xs text-neutral-700">
          <p>Listo para buscar producto exacto y comprar cerca.</p>
          <p>Sin registro. Rapido. De barrio.</p>
        </div>
      </header>
      {children}
    </div>
  );
}
