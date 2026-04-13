# KiezKauf Berlin MVP

MVP web responsive para buscar productos concretos y encontrar tiendas de barrio cercanas en Berlin.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Supabase (Postgres + PostGIS)
- MapLibre + OpenStreetMap
- i18n: Aleman e Ingles
- Vercel Web Analytics + Speed Insights

## Flujo MVP

1. Usuario busca producto exacto.
2. App usa geolocalizacion del navegador o fallback por direccion.
3. API `/api/search` devuelve tiendas relevantes ordenadas por match exacto, distancia y frescura del dato.
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

Para capa GPT (opcional pero recomendada para enriquecimiento):

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
SUPABASE_ACCESS_TOKEN=
```

## Observabilidad en Vercel

La app incluye:

- `@vercel/analytics` para eventos de uso
- `@vercel/speed-insights` para rendimiento de frontend

Eventos custom de cliente actualmente enviados:

- `search_submit`
- `search_success`
- `search_error`
- `geolocation_request`
- `geolocation_success`
- `geolocation_error`
- `theme_changed`

## Base de datos (Supabase SQL)

Ejecuta en este orden:

1. `db/schema.sql`
2. `db/seed.sql`

## Tests

```bash
npm test
```

Incluye pruebas de ranking y detalle de tienda.

## Vocabulary extension (EN-first)

Busqueda y matching de intencion usan un vocabulario central en:

- `data/berlin/vocabulary.en.json`

El archivo soporta:

- `groups`: terminos por `product_group`
- `typo_corrections`: correcciones conservadoras de errores comunes (`mjlk -> milk`)
- `generic_terms`: consultas demasiado genericas que se filtran para evitar ruido

Al ampliar vocabulario:

1. Anade terminos en `groups` (preferir EN durante desarrollo).
2. Anade solo typos reales y frecuentes en `typo_corrections`.
3. Corre `npm run vocab:lint` para validar calidad y consistencia del vocabulario.
4. Corre `npm test` para validar regresion de matching.

## Data pipeline (Moabit)

Genera automaticamente una base inicial de tiendas y plantilla de relaciones producto-tienda:

```bash
npm run data:moabit
```

Archivos de salida:

- `data/moabit/stores.csv` (tiendas de Moabit desde OpenStreetMap)
- `data/moabit/products.csv` (catalogo de productos ancla)
- `data/moabit/store_products_template.csv` (plantilla de relaciones tienda-producto para verificacion)

## Berlin pipeline (establecimientos reales + productos probables)

Este pipeline usa OSM (Overpass) para traer establecimientos reales de Berlin, clasificarlos y generar productos probables con trazabilidad.

Fases:

1. Importar y normalizar establecimientos reales (`berlin_establishment_stage` + `establishments`)
2. Clasificar establecimientos en categorias internas (`app_categories` + `app_category_taxonomy`)
3. Enriquecer websites oficiales (`establishment_website_enrichment`)
4. Sembrar catalogo canonico (`canonical_products`)
5. Generar candidatos por reglas (`source_type = rules_generated`)
6. Generar candidatos enriquecidos:
   - `website_extracted` para señales directas de web/schema
   - `ai_generated` solo si se usa modelo real
   - fallback conservador como `rules_generated` (sin etiqueta engañosa)
7. Fusionar candidatos sin duplicados (`establishment_product_merged`)
8. Materializar dataset de busqueda (`search_product_establishment_mv`)

Comandos:

```bash
npm run import:berlin
npm run classify:establishments
npm run enrich:websites
npm run seed:canonical-products
npm run generate:rule-candidates
npm run generate:ai-candidates
npm run cleanup:legacy-ai
npm run merge:candidates
npm run build:search-dataset
```

Orquestacion completa:

```bash
npm run refresh:berlin
```

Ejecucion por lotes y reanudacion:

```bash
npm run import:berlin -- --batch-size=250 --resume
npm run classify:establishments -- --batch-size=300 --resume
npm run enrich:websites -- --batch-size=25 --stale-days=10 --resume
npm run generate:rule-candidates -- --batch-size=350 --resume
npm run generate:ai-candidates -- --batch-size=120 --resume
npm run merge:candidates -- --batch-size=500 --resume
```

Reporte before/after de calidad (20-30 tiendas):

```bash
npm run audit:enrichment -- --mode=baseline --sample-size=25
# correr refresh/enrichment
npm run audit:enrichment -- --mode=after
npm run audit:enrichment -- --mode=compare
```

Checkpoint de estado:

- `data/berlin/.pipeline-state.json`

Salida para buscador:

- Materialized view: `search_product_establishment_mv`
- View conveniente: `search_product_establishment_dataset`
