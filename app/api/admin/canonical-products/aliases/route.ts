import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { recordCurationEvent } from "@/lib/admin-curation";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type AliasPayload = {
  canonicalProductId?: number;
  alias?: string;
  lang?: string;
  priority?: number;
  isActive?: boolean;
};

const ALLOWED_LANGS = new Set(["und", "en", "de", "es"]);

function sanitizeAlias(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function sanitizeLang(value: unknown) {
  const lang = String(value ?? "und")
    .trim()
    .toLowerCase();
  if (!ALLOWED_LANGS.has(lang)) {
    return "und";
  }
  return lang;
}

function sanitizePriority(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 75;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export async function POST(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json()) as AliasPayload;
    const canonicalProductId = Number(body.canonicalProductId);
    const alias = sanitizeAlias(body.alias);
    const lang = sanitizeLang(body.lang);
    const priority = sanitizePriority(body.priority);
    const isActive = body.isActive !== false;

    if (!Number.isFinite(canonicalProductId)) {
      return NextResponse.json({ error: "canonicalProductId is required." }, { status: 400 });
    }
    if (!alias || alias.length < 2) {
      return NextResponse.json({ error: "alias is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    const { data: canonicalProduct, error: canonicalError } = await supabase
      .from("canonical_products")
      .select("id, normalized_name, group_key, product_group")
      .eq("id", canonicalProductId)
      .maybeSingle();

    if (canonicalError) {
      throw new Error(canonicalError.message);
    }
    if (!canonicalProduct) {
      return NextResponse.json({ error: "Canonical product not found." }, { status: 404 });
    }

    const { data: existingAlias, error: existingAliasError } = await supabase
      .from("canonical_product_aliases")
      .select("id, canonical_product_id, alias, lang, priority, is_active")
      .eq("canonical_product_id", canonicalProductId)
      .eq("lang", lang)
      .ilike("alias", alias)
      .maybeSingle();

    if (existingAliasError) {
      throw new Error(existingAliasError.message);
    }

    if (existingAlias?.id) {
      const { data: updatedAlias, error: updateError } = await supabase
        .from("canonical_product_aliases")
        .update({
          priority,
          is_active: isActive
        })
        .eq("id", existingAlias.id)
        .select("id, canonical_product_id, alias, lang, priority, is_active, updated_at")
        .single();

      if (updateError) {
        throw new Error(updateError.message);
      }

      await recordCurationEvent(supabase, {
        eventType: "alias_add",
        entityType: "alias",
        canonicalProductId,
        productGroup: String(canonicalProduct.group_key ?? canonicalProduct.product_group ?? "uncategorized"),
        reason: `Alias ${isActive ? "updated" : "deactivated"} in admin panel.`,
        beforeState: {
          alias: existingAlias.alias,
          lang: existingAlias.lang,
          priority: existingAlias.priority,
          is_active: existingAlias.is_active
        },
        afterState: {
          alias: updatedAlias.alias,
          lang: updatedAlias.lang,
          priority: updatedAlias.priority,
          is_active: updatedAlias.is_active
        },
        metadata: {
          canonical_normalized_name: canonicalProduct.normalized_name
        }
      });

      return NextResponse.json({
        status: "updated",
        alias: updatedAlias,
        canonical_product: canonicalProduct
      });
    }

    const { data: insertedAlias, error: insertError } = await supabase
      .from("canonical_product_aliases")
      .insert({
        canonical_product_id: canonicalProductId,
        alias,
        lang,
        priority,
        is_active: isActive
      })
      .select("id, canonical_product_id, alias, lang, priority, is_active, updated_at")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    await recordCurationEvent(supabase, {
      eventType: "alias_add",
      entityType: "alias",
      canonicalProductId,
      productGroup: String(canonicalProduct.group_key ?? canonicalProduct.product_group ?? "uncategorized"),
      reason: "Alias inserted in admin panel.",
      beforeState: {},
      afterState: {
        alias: insertedAlias.alias,
        lang: insertedAlias.lang,
        priority: insertedAlias.priority,
        is_active: insertedAlias.is_active
      },
      metadata: {
        canonical_normalized_name: canonicalProduct.normalized_name
      }
    });

    return NextResponse.json({
      status: "inserted",
      alias: insertedAlias,
      canonical_product: canonicalProduct
    });
  } catch (error) {
    return adminInternalError(error);
  }
}
