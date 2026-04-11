import type { Locale } from "@/lib/types";

export const SUPPORTED_LOCALES: Locale[] = ["de", "en"];

export function isSupportedLocale(locale: string): locale is Locale {
  return SUPPORTED_LOCALES.includes(locale as Locale);
}

export function getDefaultLocale(): Locale {
  const env = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
  return env === "en" ? "en" : "de";
}
