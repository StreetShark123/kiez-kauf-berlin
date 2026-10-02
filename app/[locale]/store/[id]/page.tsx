import Link from "next/link";
import { notFound } from "next/navigation";
import { PresenceFeedback } from "@/components/PresenceFeedback";
import { buildDirectionsUrl } from "@/lib/maps";
import { getStoreDetail } from "@/lib/data";
import { getDictionary } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import type { StorePresenceItem } from "@/lib/presence/search";
import { getStorePresence, selectedEngine } from "@/lib/presence/server";

function displayProductName(
  product: { displayName?: string | null; normalizedName: string }
) {
  const label = (product.displayName ?? product.normalizedName)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label || product.normalizedName;
}

function groupItems(items: StorePresenceItem[]) {
  const groups = new Map<string, { name: string; items: StorePresenceItem[] }>();
  for (const item of items) {
    const entry = groups.get(item.group) ?? { name: item.groupName, items: [] };
    entry.items.push(item);
    groups.set(item.group, entry);
  }
  return Array.from(groups.values());
}

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
  const presence = selectedEngine(null) === "presence" ? await getStorePresence(id, locale) : null;
  const detail = presence ? null : await getStoreDetail(id);

  if (!presence && !detail) {
    notFound();
  }

  const store = presence
    ? {
        name: presence.store.name,
        address: presence.store.address,
        openingHours: presence.store.openingHours,
        lat: presence.store.lat,
        lng: presence.store.lng
      }
    : detail!.store;

  const tierLabel = {
    confirmed: dictionary.validationValidated,
    likely: dictionary.validationLikely,
    possible: dictionary.validationUnvalidated,
    reported_missing: dictionary.validationRejected,
    unlikely: dictionary.validationRejected
  } as const;

  return (
    <main className="space-y-4">
      <Link href={`/${locale}`} className="mono back-link text-sm">
        {"<-"} {dictionary.backToSearch}
      </Link>

      <section className="tool-block">
        <div className="tool-row p-4">
          <h2 className="text-xl font-medium tracking-tight">{store.name}</h2>
          <p className="detail-address mt-1 text-sm">{store.address}</p>
          {store.openingHours ? (
            <p className="status-text mt-1">
              {dictionary.openingHoursLabel}: {store.openingHours}
            </p>
          ) : null}
        </div>
        <div className="p-4">
          <a
            href={buildDirectionsUrl({
              destinationLat: store.lat,
              destinationLng: store.lng
            })}
            target="_blank"
            rel="noreferrer"
            className="btn-primary inline-flex"
          >
            {dictionary.routeAction}
          </a>
        </div>
      </section>

      {presence ? (
        <section className="space-y-3">
          <h3 className="text-base font-medium">{dictionary.storeProductsTitle}</h3>
          <p className="status-text text-[0.72rem]">{dictionary.presenceHint}</p>
          {groupItems(presence.items).map((group) => (
            <div key={group.name}>
              <h4 className="mb-1 text-sm font-medium">{group.name}</h4>
              <ul className="detail-list border-y">
                {group.items.map((item) => (
                  <li key={item.typeId} className="result-row flex items-center justify-between gap-2">
                    <span className="text-sm">{item.name}</span>
                    <span className="inline-flex items-center gap-2">
                      <span className="status-text text-[0.68rem]">{tierLabel[item.estimate.tier]}</span>
                      <PresenceFeedback
                        compact
                        dictionary={dictionary}
                        storeId={presence.store.id}
                        productTypeId={item.typeId}
                        productLabel={item.name}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : (
        <section>
          <h3 className="mb-2 text-base font-medium">{dictionary.storeProductsTitle}</h3>
          <ul className="detail-list border-y">
            {detail!.offers.map((item, index) => (
              <li key={item.offer.id} className="result-row">
                <p className="status-text mb-1">
                  {dictionary.itemLabel} {String(index + 1).padStart(2, "0")}
                </p>
                <p className="text-sm">{displayProductName(item.product)}</p>
                <p className="status-text mt-1">{dictionary.storeCategoryLabel}: {item.product.category}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
