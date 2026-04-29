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
- `POST /api/analytics/search`
- `GET /api/admin/insights`
- `GET /api/admin/catalog`
- `GET /api/admin/establishments`
- `GET/PATCH /api/admin/establishments/:id`
- `POST/PATCH/DELETE /api/admin/establishments/:id/products`
- `GET /api/admin/canonical-products`
- `POST /api/admin/canonical-products/aliases`
- `GET/POST /api/admin/curation/suggestions`
- `POST /api/admin/rebuild-search-dataset`

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
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_PANEL_KEY=
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
npm run seed:lean-catalog-v1
npm run generate:rule-candidates
npm run generate:ai-candidates
npm run profile:stores:llm
npm run cleanup:legacy-ai
npm run merge:candidates
npm run build:search-dataset
```

Orquestacion completa:

```bash
npm run refresh:berlin
```

Orquestacion lean-v1 (menos ruido + menos escrituras + prune):

```bash
npm run refresh:berlin:lean-v1
```

Ejecucion por lotes y reanudacion:

```bash
npm run import:berlin -- --batch-size=250 --resume
npm run classify:establishments -- --batch-size=300 --resume
npm run enrich:websites -- --batch-size=25 --stale-days=10 --resume
npm run generate:rule-candidates -- --batch-size=350 --resume
npm run generate:ai-candidates -- --batch-size=120 --resume
npm run profile:stores:llm -- --district-scope=moabit --postal-code-scope=10553 --batch-size=120 --max-establishments=250 --max-cost-usd-per-run=1.2 --max-cost-usd-per-day=2 --require-website-signals=true --only-ambiguous=true --profile-version=v1 --resume
npm run merge:candidates -- --batch-size=500 --resume
```

Curacion progresiva Moabit + anillo cercano (Mitte subzonas):

```bash
npm run curate:moabit:ring
# corrida diaria mas corta
npm run curate:moabit:ring:daily
```

Benchmark + demanda no resuelta (gates de calidad):

```bash
# benchmark de personas (usa suite fija y genera reporte)
npm run benchmark:personas -- --min-hit-rate=0.65 --fail-on-below-threshold=true

# reporte de zero-results para expansion dirigida de catalogo
npm run report:zero-results-demand -- --window-days=21 --district-scope=mitte
```

Pruning de auditoria (control de crecimiento):

```bash
npm run maintenance:prune-audit -- --keep-latest-per-candidate=2
npm run maintenance:prune-nonserving-candidates
# opcional compactacion fisica agresiva:
npm run maintenance:prune-nonserving-candidates -- --vacuum-full=true
```

Curation feedback loop (P1/P2):

```bash
# 1) generar sugerencias desde acciones manuales del admin
npm run generate:curation-rule-suggestions -- --window-days=90 --min-support=20 --min-positive=10 --min-precision=0.9

# 2) aplicar de forma conservadora solo reglas con señal fuerte
npm run apply:curation-rules -- --window-days=90 --min-support=20 --min-positive=10 --min-precision=0.9 --max-apply=120

# 3) refrescar serving dataset
npm run build:search-dataset
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

Pack lean-v1:

- Guia operativa: `docs/lean-v1.md`
- Migracion guardrails: `supabase/migrations/20260419092218_lean_v1_guardrails.sql`
- Modelo de catalogo Phase A (core + tablas hijas): `docs/db/catalog-model-phase-a.md`
- Modelo de curation feedback loop Phase F: `docs/db/admin-curation-phase-f.md`

## Admin panel

Ruta:

- `/admin` (redirecciona a `/{locale}/admin`)

Objetivo:

- Insights de uso (terminos mas buscados, no resueltos, tasa de no resultado)
- Catalogo interno (categorias actuales, productos por grupo)
- Edicion manual de negocios (categorias, estado, horarios, website, telefono)
- Alta manual de productos por negocio (trazable como `merchant_added`)
- Boton para refrescar dataset de busqueda (`refresh_search_product_establishment_mv`)

Requisitos:

1. Configurar `ADMIN_PANEL_KEY` en servidor.
2. Configurar `SUPABASE_SERVICE_ROLE_KEY` en servidor.
3. Entrar en `/admin` e introducir la clave de admin.

Notas:

- Sin `ADMIN_PANEL_KEY`, la API de admin responde `503`.
- Sin `SUPABASE_SERVICE_ROLE_KEY`, la API de admin no puede editar datos.
- El panel no usa login de usuarios final todavia; usa clave administrativa por header.

## Product UX docs

- Personas + JTBD (living doc): `docs/ux/personas-mvp.md`
