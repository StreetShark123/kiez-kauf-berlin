import Link from "next/link";
import { SUPPORTED_LOCALES } from "@/lib/locale";
import type { Locale } from "@/lib/types";

export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  return (
    <nav className="language-switch" aria-label={label}>
      <span className="mono language-switch-label">{label}</span>
      {SUPPORTED_LOCALES.map((item) => {
        const active = item === locale;

        return (
          <Link
            key={item}
            href={`/${item}`}
            className={`mono language-switch-link ${
              active ? "language-switch-link-active" : "language-switch-link-idle"
            }`}
          >
            {item.toUpperCase()}
          </Link>
        );
      })}
    </nav>
  );
}
