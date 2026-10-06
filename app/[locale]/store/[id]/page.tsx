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

  const tierClass = {
    confirmed: "is-confirmed",
    likely: "is-likely",
    possible: "is-possible",
    reported_missing: "is-possible",
    unlikely: "is-possible"
  } as const;

  return (
    <main className="nb space-y-5 pt-2">
      <Link href={`/${locale}`} className="nb-link mono text-sm">
        ← {dictionary.backToSearch}
      </Link>

      <header className="space-y-2">
        <h1 className="nb-store-title">{store.name}</h1>
        <p className="nb-why">{store.address}</p>
        {store.openingHours ? (
          <p className="nb-card-foot mono">
            {dictionary.openingHoursLabel}: {store.openingHours}
          </p>
        ) : null}
        <a
          href={buildDirectionsUrl({
            destinationLat: store.lat,
            destinationLng: store.lng
          })}
          target="_blank"
          rel="noreferrer"
          className="nb-btn nb-btn-primary nb-btn-small"
        >
          {dictionary.directionsAction} ↗
        </a>
      </header>

      {presence ? (
        <section>
          <h2 className="nb-results-heading">{dictionary.storeProductsTitle}</h2>
          <p className="nb-feedback-hint">{dictionary.presenceHint}</p>
          {groupItems(presence.items).map((group) => (
            <div key={group.name}>
              <h3 className="nb-store-group mono">{group.name}</h3>
              <ul className="m-0 list-none p-0">
                {group.items.map((item) => (
                  <li key={item.typeId} className="nb-store-row">
                    <span className="nb-store-row-name">{item.name}</span>
                    <span className="nb-store-row-side">
                      <span className={`nb-tier ${tierClass[item.estimate.tier]}`}>{tierLabel[item.estimate.tier]}</span>
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
          <h2 className="nb-results-heading">{dictionary.storeProductsTitle}</h2>
          <ul className="m-0 list-none p-0">
            {detail!.offers.map((item) => (
              <li key={item.offer.id} className="nb-store-row">
                <span className="nb-store-row-name">{displayProductName(item.product)}</span>
                <span className="nb-store-row-side nb-muted">{item.product.category}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
