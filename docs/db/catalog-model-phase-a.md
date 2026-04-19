# Catalog DB Model (Phase A)

Objetivo de esta fase: dejar una base **lean, extensible y compatible** para evolucionar el catalogo de productos sin romper el pipeline actual.

## Principios de diseno

- `canonical_products` queda como tabla **core** de familias.
- Alias, facets y use-cases viven en tablas hijas para evitar inflar una sola fila.
- Se mantiene compatibilidad temporal con el pipeline actual (`product_group`, `synonyms`).
- Sin ranking nuevo ni logica de matching compleja en esta fase.

## Tablas

## 1) `public.canonical_products` (core)

Campos core (v1):

- `id` (PK)
- `group_key` (grupo funcional principal; normalizado en minusculas)
- `family_slug` (identificador estable de familia; unico)
- `normalized_name` (compatibilidad y identificador historico actual)
- `display_name_en`, `display_name_de`, `display_name_es`
- `is_active` (boolean)
- `priority` (`0..100`)
- `coverage_tier` (`core | extended | edge`)
- `created_at`, `updated_at`

Compatibilidad temporal:

- `product_group` (deprecated, espejo de `group_key`)
- `synonyms` (deprecated, reemplazado por `canonical_product_aliases`)

## 2) `public.canonical_product_aliases`

Terminos de busqueda por idioma:

- `id` (PK)
- `canonical_product_id` (FK -> `canonical_products.id`)
- `lang` (`en`, `de`, `es`, `und`, ...)
- `alias`
- `alias_normalized` (generated column)
- `priority` (`0..100`)
- `is_active`
- `created_at`, `updated_at`

Uso: matching textual, sinonimos, tolerancia idiomatica.

## 3) `public.canonical_product_facets`

Clasificacion funcional estable:

- `id` (PK)
- `canonical_product_id` (FK)
- `facet`
- `facet_normalized` (generated column)
- `created_at`, `updated_at`

Uso: filtros y agrupaciones funcionales (`kitchen`, `cleaning`, `health`, `office`, etc.).

## 4) `public.canonical_product_use_cases`

Lenguaje de intencion del usuario:

- `id` (PK)
- `canonical_product_id` (FK)
- `lang`
- `use_case_term`
- `use_case_normalized` (generated column)
- `priority` (`0..100`)
- `is_active`
- `created_at`, `updated_at`

Uso: consultas por necesidad (`cold relief`, `school`, `party`, etc.) sin mezclarlo con facets.

## Constraints y unicidad

- `canonical_products.family_slug` unico.
- `canonical_products.group_key` normalizado (`lower(trim(...))`).
- `canonical_products.priority` en rango `0..100`.
- `canonical_products.coverage_tier` limitado a `core|extended|edge`.
- `canonical_product_aliases` unico por (`canonical_product_id`, `lang`, `alias_normalized`).
- `canonical_product_facets` unico por (`canonical_product_id`, `facet_normalized`).
- `canonical_product_use_cases` unico por (`canonical_product_id`, `lang`, `use_case_normalized`).

## Indices minimos utiles

- `canonical_products(family_slug)` unico.
- `canonical_products(group_key, is_active, priority desc)`.
- `canonical_products(coverage_tier, priority desc)`.
- `canonical_product_aliases(lang, alias_normalized)` parcial (`is_active = true`).
- `canonical_product_aliases` GIN trigram sobre `alias_normalized` (parcial activo).
- `canonical_product_facets(facet_normalized)`.
- `canonical_product_use_cases(lang, use_case_normalized)` parcial (`is_active = true`).

## Compatibilidad con pipeline actual

Durante Phase A:

- `product_group` y `synonyms` siguen existiendo para no romper scripts actuales.
- Trigger `sync_canonical_products_core_fields` mantiene `product_group` alineado con `group_key`.
- Seed actual (`seed-canonical-products`) ya escribe los campos core nuevos.

## Backfill aplicado en migracion

- `group_key` <- `product_group`
- `family_slug` generado desde `normalized_name`
- seed inicial de `canonical_product_aliases` desde:
  - `normalized_name`
  - `display_name_en/de/es`
  - `synonyms`
- seed inicial de `canonical_product_facets` desde `group_key`

## Convencion de modelado para siguientes fases

- **Family**: entidad canonica de producto (`family_slug`).
- **Alias**: terminos de busqueda concretos por idioma.
- **Facet**: clasificacion funcional estable (pocas y reutilizables).
- **Use-case**: intencion contextual del usuario (dinamica, no estructural).

Regla practica:

- Si sirve para filtrar y agrupar de forma permanente -> `facet`.
- Si es lenguaje de consulta contextual -> `use_case_term`.
- Si es sinonimo ortografico/idiomatico -> `alias`.

## Runbook minimo

1. Aplicar migraciones:

```bash
supabase db push
```

2. Re-seed de catalogo (compat y core):

```bash
npm run seed:canonical-products
```

3. Validacion rapida SQL:

```sql
select count(*) from public.canonical_products;
select count(*) from public.canonical_product_aliases;
select count(*) from public.canonical_product_facets;
select count(*) from public.canonical_product_use_cases;
```

## Siguiente fase (B)

- Cargar `lean_catalog_v1` en tablas hijas (aliases/facets/use-cases) por lotes.
- Empezar a migrar matching a aliases/facets sin depender de `synonyms`.
- Cuando el pipeline nuevo este estable, retirar columnas legacy.

Comando de seed de Phase B:

```bash
npm run seed:lean-catalog-v1
```

Fuente por defecto:

- `data/berlin/lean-catalog-v1.seed.json`

## Phase C y D (estado actual)

Avance ya aplicado:

- **Phase C**: matching y generadores usan `group_key` + `canonical_product_aliases` con fallback legacy.
- **Phase D**: estrategia `group_keyword` y reglas pasan a modo **facet-first**:
  - Search intenta primero `canonical_product_facets` -> `canonical_product_id`.
  - Si no hay facets o no aplica, fallback a `product_group`.
  - Regla por categoria usa union de:
    - match por `group_key`
    - match por `canonical_product_facets.facet_normalized`

Resultado: el catalogo queda listo para familias multi-contexto (una familia puede vivir en varias facets) sin romper compatibilidad.
