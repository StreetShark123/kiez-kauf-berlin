import Link from "next/link";
import { SUPPORTED_LOCALES } from "@/lib/locale";
import type { Locale } from "@/lib/types";

export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  return (
    <nav className="mono flex items-center gap-2 text-xs" aria-label={label}>
      <span className="text-neutral-700">{label}:</span>
      {SUPPORTED_LOCALES.map((item) => {
        const active = item === locale;

        return (
          <Link
            key={item}
            href={`/${item}`}
            className={`rounded-full border px-3 py-1 transition ${
              active
                ? "border-black bg-black text-white"
                : "border-black/30 bg-white text-neutral-700 hover:border-black hover:text-black"
            }`}
          >
            {item.toUpperCase()}
          </Link>
        );
      })}
    </nav>
  );
}
