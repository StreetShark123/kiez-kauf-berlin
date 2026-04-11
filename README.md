# KiezKauf Berlin MVP

MVP web responsive para buscar productos concretos y encontrar tiendas de barrio cercanas en Berlin.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Supabase (Postgres + PostGIS)
- MapLibre + OpenStreetMap
- i18n: Aleman e Ingles

## Flujo MVP

1. Usuario busca producto exacto.
2. App usa geolocalizacion del navegador o fallback por direccion.
3. API `/api/search` devuelve ofertas ordenadas por match exacto, distancia y frescura del dato.
4. Usuario pulsa `Route starten / Get directions`.
5. API `/api/analytics/route-click` registra evento unico por `interactionId`.

## Endpoints

- `GET /api/search?q=&lat=&lng=&radius=`
- `GET /api/stores/:id`
- `POST /api/analytics/route-click`

## Setup local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Variables de entorno

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_DEFAULT_LOCALE=de
NEXT_PUBLIC_MAP_STYLE_URL=https://demotiles.maplibre.org/style.json
```

Si no hay credenciales de Supabase, la app usa dataset mock para desarrollo.

## Base de datos (Supabase SQL)

Ejecuta en este orden:

1. `db/schema.sql`
2. `db/seed.sql`

## Tests

```bash
npm test
```

Incluye pruebas de ranking y detalle de tienda.
