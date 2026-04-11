import { SearchExperience } from "@/components/SearchExperience";
import { getBerlinCenter } from "@/lib/data";
import { getDictionary } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { notFound } from "next/navigation";

export default async function LocaleHomePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return (
    <SearchExperience
      locale={locale}
      dictionary={getDictionary(locale)}
      initialCenter={getBerlinCenter()}
    />
  );
}
