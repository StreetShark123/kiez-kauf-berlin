# Modelo de presencia (v1)

Motor de búsqueda por defecto desde 2026-10. Sustituye la generación de "productos probables" por tienda
(reglas + IA → filas `establishment_product_*`) por una pregunta más honesta:

> ¿Qué probabilidad hay de que **esta tienda** tenga **este tipo de producto**, y qué evidencia lo respalda?

## Por qué

En el benchmark de abril (`data/berlin/reports/r0-persona-benchmark-gated-api.json`) el "hit rate" era 74 %,
pero contaba cualquier resultado no vacío. Re-puntuado con criterio de tienda correcta
(`data/eval/gold-queries.v1.json`) el primer resultado era correcto en **7/23 (30 %)**, y 6 respuestas
mandaban a un tipo de tienda equivocado (`garlic → panadería con "erdbeeren 500g"`,
`laundry detergent → tienda de bicis`). Causas: catálogo de SKUs (no de tipos), fallback a "otro producto
del mismo grupo", y suposiciones presentadas como datos.

## Piezas

| Pieza | Archivo | Qué es |
|---|---|---|
| Tipos de producto | `data/presence/product-types.v1.json` | ~300 tipos ("garlic", "batteries", "store_phone_repair") con nombres de/en/es y alias. `kind: store_type` = tipo de tienda o servicio. `specialty: true` = solo donde un prior lo nombra. |
| Modificadores | mismo archivo, `modifiers` | `organic`, `refill`, `halal`, `vegan`: multiplican la probabilidad según categoría/marca/tags OSM. |
| Priors | `data/presence/category-priors.v1.json` | P(tienda de categoría X tiene tipo T). Orden: marca.types > marca.groups > categoría.types > categoría.groups. |
| Evidencia | tabla `presence_evidence` (Supabase) o `.data/presence-evidence.json` (dev) | Una fila por observación: tienda, tipo, +1/−1, fuente, fecha, hash de dispositivo. |
| Motor | `lib/presence/*` | `catalog.ts` resuelve la consulta, `priors.ts` calcula el prior, `evidence.ts` lo combina con la evidencia, `search.ts` ordena. |
| Gold suite | `data/eval/gold-queries.v1.json` | 62 consultas con tipos de tienda correctos/incorrectos. Gate en `tests/presence-gold.test.ts`. |

## Cómo se calcula

1. **Resolver consulta** → tipos + modificadores. Alias más largo gana ("oat milk" > "milk"); tolera typos
   solo en palabras de ≥5 letras; plurales en inglés y "ae/oe/ue" alemanes se pliegan. Consulta desconocida
   → **cero resultados** (y queda registrada como demanda), nunca "algo del mismo grupo".
2. **Prior por tienda** desde la tabla de categorías/marcas (+ modificadores).
3. **Posterior** = Beta(prior·2, (1−prior)·2) actualizada con la evidencia, con decaimiento
   (usuarios: vida media 120 días; comerciante 240; admin 365). Pesos: usuario 1, web 1,5, comerciante 4, admin 6.
4. **Nivel**:
   - `confirmed`: evidencia positiva reciente (≤120 días) y p ≥ 0,5 → UI "Confirmado"
   - `likely`: p ≥ 0,65 → "Probable"
   - `possible`: p ≥ 0,3 → "Posible"
   - `reported_missing` / `unlikely`: no se muestra
5. **Orden**: `p / (1 + distancia/700 m)`; lo confirmado cuenta como p ≥ 0,85.

Ejemplos (tests en `tests/presence-evidence.test.ts`): un "lo vi" sobre un prior de 0,25 → 0,5 confirmado;
dos "no estaba" sobre 0,9 → 0,45 posible.

## Colaboración (fase 3)

- **"¿Tienen X aquí? Sí, lo vi / No lo tenían"** en la ficha del resultado seleccionado y por producto en
  la página de tienda (`components/PresenceFeedback.tsx`).
- `POST /api/presence/feedback` `{ storeId, productTypeId, found, query? }`.
  Cookie anónima `kk_did` (httpOnly) → se guarda solo `sha256(PRESENCE_DEVICE_SALT:id)`.
  Un voto vigente por dispositivo/tienda/tipo (30 días), 40 votos/día por dispositivo, 30/min por IP (middleware).
- `GET /api/presence/stores/:id` → lo que probablemente tiene una tienda, con nivel.
- Moderación: `GET/PATCH /api/admin/presence/evidence` (header `x-admin-key`): ver lo último y marcar
  filas (`is_flagged`) que dejan de contar al instante.

## Editar los datos (lo que más mejora la calidad)

1. ¿Una búsqueda devuelve una tienda mala? Busca la categoría OSM de esa tienda en `category-priors` y baja
   el tipo (`types`) o el grupo. ¿Es una cadena concreta? Añade/ajusta una entrada en `brands`.
2. ¿Una búsqueda no encuentra nada? Añade alias al tipo correcto o un tipo nuevo; si es un producto de
   nicho márcalo `specialty: true` y nómbralo en las categorías que sí lo venden.
3. Añade la consulta al gold suite con `good_categories` / `bad_categories`.
4. `npm run presence:format && npm test`. El test de integridad falla si un prior apunta a un tipo
   inexistente o si dos tipos comparten alias.

## Operación

```bash
# aplicar la migración (crea presence_evidence + vista presence_establishments)
supabase db push            # o ejecutar supabase/migrations/20261002090000_presence_evidence_v1.sql

# variables nuevas (servidor)
PRESENCE_DEVICE_SALT=<cadena aleatoria larga>
SEARCH_ENGINE=presence      # 'legacy' vuelve al motor anterior sin desplegar código

# comparar motores contra un entorno real
npm run eval:gold -- --base-url=https://<host> --engine=legacy
npm run eval:gold -- --base-url=https://<host> --engine=presence

# refrescar tiendas OSM (incluye ahora 1-euro, floristerías, mascotas, libros, juguetes, tabaco...)
npm run import:mitte              # a Supabase
npm run import:mitte:snapshot     # solo los JSON locales de data/berlin
```

Sin Supabase configurado, el motor usa los snapshots OSM de `data/berlin` y guarda la evidencia en
`.data/presence-evidence.json` (ignorado por git).

## Siguiente (fase 4)

- **Reputación**: peso por dispositivo según acuerdo con el consenso (hoy todos pesan 1).
- **Comerciantes**: reclamar tienda → evidencia `merchant` (peso 4) y edición de su surtido.
- **Siembra con evidencia existente**: convertir filas `website_extracted` / `merchant_added` /
  `user_validated` del pipeline anterior en evidencia (`source = website|merchant`).
- **Demanda**: los `unmatched_terms` de `/api/search` + `query_resolution_log` dicen qué tipos faltan.
- **Pedir evidencia donde más vale**: preguntar sobre pares con p≈0,5 cercanos (máxima información).
