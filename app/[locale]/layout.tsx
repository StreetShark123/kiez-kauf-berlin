import { notFound } from "next/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeSwitch } from "@/components/ThemeSwitch";
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
    <div className="mx-auto flex min-h-screen w-full max-w-[1080px] flex-col px-4 pb-7 pt-5 md:px-6 md:pb-8 md:pt-6">
      <main className="flex-1">{children}</main>
      <footer className="mt-9 border-t border-neutral-300 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="mono text-[0.71rem] uppercase tracking-[0.13em] text-neutral-500">{dictionary.appTitle}</p>
          <div className="flex flex-wrap items-center gap-3">
            <ThemeSwitch label={dictionary.themeLabel} darkModeLabel={dictionary.darkModeLabel} />
            <LanguageSwitcher locale={locale} label={dictionary.languageLabel} />
          </div>
        </div>
      </footer>
    </div>
  );
}
