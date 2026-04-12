import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { getDefaultLocale } from "@/lib/locale";

export default function NotFoundPage() {
  const dictionary = getDictionary(getDefaultLocale());

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6">
      <section className="surface-card w-full p-8 text-center">
        <p className="section-title">Error</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{dictionary.notFoundTitle}</h1>
        <p className="muted-text mt-2 text-sm">{dictionary.notFoundDescription}</p>
        <p className="status-text mt-2">{dictionary.notFoundJoke}</p>
        <Link href="/" className="btn-primary mt-5 inline-flex px-4 py-2 text-sm font-medium">
          {dictionary.backHome}
        </Link>
      </section>
    </main>
  );
}
