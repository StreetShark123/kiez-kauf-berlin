import type { Locale } from "@/lib/types";

// Human names for OSM shop categories, shown on result cards instead of raw tags.
const LABELS: Record<string, [de: string, en: string, es: string]> = {
  supermarket: ["Supermarkt", "Supermarket", "Supermercado"],
  convenience: ["Späti", "Corner shop", "Tienda 24h"],
  kiosk: ["Kiosk", "Kiosk", "Quiosco"],
  newsagent: ["Zeitungsladen", "Newsagent", "Prensa"],
  tobacco: ["Tabakladen", "Tobacconist", "Estanco"],
  variety_store: ["1-Euro-Laden", "Variety store", "Bazar"],
  bakery: ["Bäckerei", "Bakery", "Panadería"],
  pastry: ["Konditorei", "Pastry shop", "Pastelería"],
  confectionery: ["Süßwaren", "Sweet shop", "Dulcería"],
  butcher: ["Metzgerei", "Butcher", "Carnicería"],
  seafood: ["Fischladen", "Fishmonger", "Pescadería"],
  deli: ["Feinkost", "Deli", "Delicatessen"],
  greengrocer: ["Obst & Gemüse", "Greengrocer", "Frutería"],
  health_food: ["Bioladen", "Organic shop", "Tienda ecológica"],
  organic: ["Bioladen", "Organic shop", "Tienda ecológica"],
  zero_waste: ["Unverpackt-Laden", "Zero-waste shop", "Tienda a granel"],
  beverages: ["Getränkemarkt", "Drinks shop", "Tienda de bebidas"],
  alcohol: ["Spirituosen", "Off-licence", "Licorería"],
  wine: ["Weinhandlung", "Wine shop", "Vinoteca"],
  coffee: ["Kaffeeladen", "Coffee shop", "Tienda de café"],
  tea: ["Teeladen", "Tea shop", "Tienda de té"],
  chemist: ["Drogerie", "Drugstore", "Droguería"],
  drugstore: ["Drogerie", "Drugstore", "Droguería"],
  pharmacy: ["Apotheke", "Pharmacy", "Farmacia"],
  medical_supply: ["Sanitätshaus", "Medical supplies", "Ortopedia"],
  beauty: ["Kosmetikstudio", "Beauty salon", "Salón de belleza"],
  cosmetics: ["Kosmetik", "Cosmetics", "Cosmética"],
  perfumery: ["Parfümerie", "Perfumery", "Perfumería"],
  clothes: ["Kleidung", "Clothing", "Ropa"],
  shoes: ["Schuhe", "Shoes", "Zapatería"],
  second_hand: ["Secondhand", "Second-hand", "Segunda mano"],
  charity: ["Sozialkaufhaus", "Charity shop", "Tienda solidaria"],
  department_store: ["Kaufhaus", "Department store", "Grandes almacenes"],
  mall: ["Einkaufszentrum", "Shopping centre", "Centro comercial"],
  stationery: ["Schreibwaren", "Stationery", "Papelería"],
  copyshop: ["Copyshop", "Copy shop", "Copistería"],
  craft: ["Bastelladen", "Craft shop", "Manualidades"],
  art: ["Kunst & Galerie", "Art & gallery", "Arte y galería"],
  antiques: ["Antiquitäten", "Antiques", "Antigüedades"],
  books: ["Buchhandlung", "Bookshop", "Librería"],
  toys: ["Spielwaren", "Toy shop", "Juguetería"],
  baby_goods: ["Babybedarf", "Baby shop", "Tienda de bebé"],
  mobile_phone: ["Handyladen", "Phone shop", "Tienda de móviles"],
  electronics: ["Elektronik", "Electronics", "Electrónica"],
  computer: ["Computerladen", "Computer shop", "Informática"],
  electronics_repair: ["Reparatur", "Repair shop", "Reparaciones"],
  bicycle: ["Fahrradladen", "Bike shop", "Tienda de bicis"],
  bicycle_repair: ["Fahrradwerkstatt", "Bike repair", "Taller de bicis"],
  hardware: ["Eisenwaren", "Hardware store", "Ferretería"],
  doityourself: ["Baumarkt", "DIY store", "Bricolaje"],
  household: ["Haushaltswaren", "Homeware", "Menaje"],
  houseware: ["Haushaltswaren", "Homeware", "Menaje"],
  locksmith: ["Schlüsseldienst", "Locksmith", "Cerrajería"],
  key_cutter: ["Schlüsseldienst", "Key cutting", "Copia de llaves"],
  shoemaker: ["Schuster", "Shoe repair", "Zapatero"],
  tailor: ["Schneiderei", "Tailor", "Arreglos"],
  internet_cafe: ["Internetcafé", "Internet café", "Cibercafé"],
  florist: ["Blumenladen", "Florist", "Floristería"],
  garden_centre: ["Gartencenter", "Garden centre", "Vivero"],
  pet: ["Tierbedarf", "Pet shop", "Tienda de mascotas"],
  optician: ["Optiker", "Optician", "Óptica"]
};

const LOCALE_INDEX: Record<Locale, 0 | 1 | 2> = { de: 0, en: 1, es: 2 };

export function categoryLabel(category: string | null | undefined, locale: Locale): string | null {
  if (!category) {
    return null;
  }
  const entry = LABELS[category.trim().toLowerCase()];
  return entry ? entry[LOCALE_INDEX[locale]] : null;
}
