import Link from "next/link";
import { notFound } from "next/navigation";
import { buildDirectionsUrl } from "@/lib/maps";
import { getStoreDetail } from "@/lib/data";
import { getDictionary } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";

export default async function StoreDetailPage({
  params
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);
  const detail = await getStoreDetail(id);

  if (!detail) {
    notFound();
  }

  return (
    <main className="space-y-4">
      <Link href={`/${locale}`} className="mono text-sm text-neutral-700 hover:text-black">
        {"<-"} {dictionary.searchButton}
      </Link>

      <section className="note-card note-tape p-5">
        <span className="stamp">Store Note</span>
        <h2 className="mt-3 text-2xl font-semibold">{detail.store.name}</h2>
        <p className="mt-1 text-neutral-700">{detail.store.address}</p>
        <p className="mono text-xs text-neutral-600">{detail.store.openingHours}</p>

        <a
          href={buildDirectionsUrl({
            destinationLat: detail.store.lat,
            destinationLng: detail.store.lng
          })}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex rounded-xl border border-black bg-black px-4 py-2 text-white transition hover:bg-white hover:text-black"
        >
          {dictionary.routeAction}
        </a>
      </section>

      <section className="note-card paper-lines p-5">
        <h3 className="mb-3 text-xl font-semibold">{dictionary.resultsTitle}</h3>
        <ul className="space-y-3">
          {detail.offers.map((item, index) => (
            <li key={item.offer.id} className="rounded-xl border border-black/30 bg-white p-3">
              <p className="mono mb-1 text-[0.7rem] uppercase tracking-[0.16em] text-neutral-500">
                Item {String(index + 1).padStart(2, "0")}
              </p>
              <p className="font-medium">{item.product.normalizedName}</p>
              <p className="text-sm text-neutral-700">
                {typeof item.offer.priceOptional === "number"
                  ? `${item.offer.priceOptional.toFixed(2)} EUR`
                  : dictionary.priceUnknown}
              </p>
              <p className="mono text-xs text-neutral-600">
                {dictionary.updatedLabel}: {new Date(item.offer.updatedAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
