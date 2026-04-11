import Link from "next/link";
import { SUPPORTED_LOCALES } from "@/lib/locale";
import type { Locale } from "@/lib/types";

export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs" aria-label={label}>
      <span className="mono text-[0.68rem] uppercase tracking-[0.12em] text-neutral-500">{label}</span>
      {SUPPORTED_LOCALES.map((item) => {
        const active = item === locale;

        return (
          <Link
            key={item}
            href={`/${item}`}
            className={`mono rounded-md border px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.08em] transition ${
              active
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:border-neutral-900 hover:text-neutral-900"
            }`}
          >
            {item.toUpperCase()}
          </Link>
        );
      })}
    </nav>
  );
}
