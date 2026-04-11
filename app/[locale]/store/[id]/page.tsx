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
      <Link href={`/${locale}`} className="mono text-sm text-neutral-600 hover:text-neutral-900">
        {"<-"} {dictionary.backToSearch}
      </Link>

      <section className="tool-block">
        <div className="tool-row p-4">
          <h2 className="text-xl font-medium tracking-tight">{detail.store.name}</h2>
          <p className="mt-1 text-sm text-neutral-700">{detail.store.address}</p>
          {detail.store.openingHours ? <p className="status-text mt-1">{detail.store.openingHours}</p> : null}
        </div>
        <div className="p-4">
          <a
            href={buildDirectionsUrl({
              destinationLat: detail.store.lat,
              destinationLng: detail.store.lng
            })}
            target="_blank"
            rel="noreferrer"
            className="btn-primary inline-flex"
          >
            {dictionary.routeAction}
          </a>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-base font-medium">{dictionary.storeProductsTitle}</h3>
        <ul className="border-y border-neutral-300">
          {detail.offers.map((item, index) => (
            <li key={item.offer.id} className="result-row">
              <p className="status-text mb-1">
                {dictionary.itemLabel} {String(index + 1).padStart(2, "0")}
              </p>
              <p className="text-sm">{item.product.normalizedName}</p>
              <p className="status-text mt-1">{dictionary.storeCategoryLabel}: {item.product.category}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
