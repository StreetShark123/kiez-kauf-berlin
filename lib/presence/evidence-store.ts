import fs from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceSource, PresenceEvidence } from "@/lib/presence/evidence";
import { getServerSupabaseClient } from "@/lib/presence/stores";

export const MAX_SIGNALS_PER_DEVICE_PER_DAY = 40;
// One device = one current vote per (store, type). A newer vote replaces the older one.
const VOTE_REPLACE_WINDOW_DAYS = 30;

export type NewEvidence = {
  storeId: string;
  productTypeId: string;
  signal: 1 | -1;
  source: EvidenceSource;
  deviceHash: string | null;
  interactionId?: string | null;
  query?: string | null;
};

export type AddEvidenceResult = { ok: true } | { ok: false; reason: "rate_limited" | "invalid_store" | "storage_error" };

export interface EvidenceRepository {
  kind: "supabase" | "local_file" | "memory";
  listForTypes(productTypeIds: string[]): Promise<PresenceEvidence[]>;
  listForStore(storeId: string): Promise<PresenceEvidence[]>;
  add(evidence: NewEvidence): Promise<AddEvidenceResult>;
  listRecent(limit: number): Promise<Array<PresenceEvidence & { id: string; query: string | null }>>;
  setFlag(id: string, flagged: boolean): Promise<boolean>;
}

type StoredRow = PresenceEvidence & { id: string; query: string | null; interactionId: string | null };

const dayAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export class MemoryEvidenceRepository implements EvidenceRepository {
  kind: EvidenceRepository["kind"] = "memory";
  protected rows: StoredRow[] = [];

  constructor(initial: StoredRow[] = []) {
    this.rows = initial;
  }

  protected async persist(): Promise<void> {}

  protected async load(): Promise<void> {}

  async listForTypes(productTypeIds: string[]) {
    await this.load();
    const wanted = new Set(productTypeIds);
    return this.rows.filter((row) => wanted.has(row.productTypeId));
  }

  async listForStore(storeId: string) {
    await this.load();
    return this.rows.filter((row) => row.storeId === storeId);
  }

  async add(evidence: NewEvidence): Promise<AddEvidenceResult> {
    await this.load();
    const snapshot = [...this.rows];
    if (evidence.deviceHash) {
      const since = dayAgoIso(1);
      const recent = this.rows.filter((row) => row.deviceHash === evidence.deviceHash && row.createdAt >= since);
      if (recent.length >= MAX_SIGNALS_PER_DEVICE_PER_DAY) {
        return { ok: false, reason: "rate_limited" };
      }
      const replaceSince = dayAgoIso(VOTE_REPLACE_WINDOW_DAYS);
      this.rows = this.rows.filter(
        (row) =>
          !(
            row.deviceHash === evidence.deviceHash &&
            row.storeId === evidence.storeId &&
            row.productTypeId === evidence.productTypeId &&
            row.createdAt >= replaceSince
          )
      );
    }
    this.rows.push({
      id: crypto.randomUUID(),
      storeId: evidence.storeId,
      productTypeId: evidence.productTypeId,
      signal: evidence.signal,
      source: evidence.source,
      deviceHash: evidence.deviceHash,
      createdAt: new Date().toISOString(),
      flagged: false,
      query: evidence.query ?? null,
      interactionId: evidence.interactionId ?? null
    });
    try {
      await this.persist();
    } catch (error) {
      // e.g. read-only filesystem on serverless hosts without the Supabase table yet
      console.warn("[presence] could not persist evidence:", error instanceof Error ? error.message : error);
      this.rows = snapshot;
      return { ok: false, reason: "storage_error" };
    }
    return { ok: true };
  }

  async listRecent(limit: number) {
    await this.load();
    return [...this.rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async setFlag(id: string, flagged: boolean) {
    await this.load();
    const row = this.rows.find((entry) => entry.id === id);
    if (!row) {
      return false;
    }
    row.flagged = flagged;
    await this.persist();
    return true;
  }
}

// Dev-only persistence so feedback survives `next dev` restarts without a database.
class LocalFileEvidenceRepository extends MemoryEvidenceRepository {
  kind: EvidenceRepository["kind"] = "local_file";
  private loaded = false;

  constructor(private readonly filePath: string) {
    super();
  }

  protected async load() {
    if (this.loaded) {
      return;
    }
    try {
      this.rows = JSON.parse(await fs.readFile(this.filePath, "utf8")) as StoredRow[];
    } catch {
      this.rows = [];
    }
    this.loaded = true;
  }

  protected async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.rows, null, 2));
  }
}

type SupabaseEvidenceRow = {
  id: number;
  establishment_id: number;
  product_type_id: string;
  signal: number;
  source: EvidenceSource;
  weight: number | null;
  device_hash: string | null;
  query: string | null;
  is_flagged: boolean;
  created_at: string;
};

function fromSupabaseRow(row: SupabaseEvidenceRow) {
  return {
    id: String(row.id),
    storeId: String(row.establishment_id),
    productTypeId: row.product_type_id,
    signal: (row.signal > 0 ? 1 : -1) as 1 | -1,
    source: row.source,
    weight: row.weight,
    deviceHash: row.device_hash,
    createdAt: row.created_at,
    flagged: row.is_flagged,
    query: row.query
  };
}

const EVIDENCE_COLUMNS = "id, establishment_id, product_type_id, signal, source, weight, device_hash, query, is_flagged, created_at";
// Evidence older than this has decayed below ~6% weight for users; skip it at read time.
const READ_WINDOW_DAYS = 480;

class SupabaseEvidenceRepository implements EvidenceRepository {
  kind: EvidenceRepository["kind"] = "supabase";

  constructor(private readonly client: SupabaseClient) {}

  async listForTypes(productTypeIds: string[]) {
    if (productTypeIds.length === 0) {
      return [];
    }
    const { data, error } = await this.client
      .from("presence_evidence")
      .select(EVIDENCE_COLUMNS)
      .in("product_type_id", productTypeIds)
      .eq("is_flagged", false)
      .gte("created_at", dayAgoIso(READ_WINDOW_DAYS))
      .limit(20000);
    if (error) {
      console.warn("[presence] evidence read failed:", error.message);
      return [];
    }
    return ((data ?? []) as SupabaseEvidenceRow[]).map(fromSupabaseRow);
  }

  async listForStore(storeId: string) {
    const establishmentId = Number(storeId);
    if (!Number.isFinite(establishmentId)) {
      return [];
    }
    const { data, error } = await this.client
      .from("presence_evidence")
      .select(EVIDENCE_COLUMNS)
      .eq("establishment_id", establishmentId)
      .eq("is_flagged", false)
      .gte("created_at", dayAgoIso(READ_WINDOW_DAYS))
      .limit(5000);
    if (error) {
      console.warn("[presence] evidence read failed:", error.message);
      return [];
    }
    return ((data ?? []) as SupabaseEvidenceRow[]).map(fromSupabaseRow);
  }

  async add(evidence: NewEvidence): Promise<AddEvidenceResult> {
    const establishmentId = Number(evidence.storeId);
    if (!Number.isFinite(establishmentId)) {
      return { ok: false, reason: "invalid_store" };
    }
    if (evidence.deviceHash) {
      const { count, error: countError } = await this.client
        .from("presence_evidence")
        .select("id", { count: "exact", head: true })
        .eq("device_hash", evidence.deviceHash)
        .gte("created_at", dayAgoIso(1));
      if (countError) {
        return { ok: false, reason: "storage_error" };
      }
      if ((count ?? 0) >= MAX_SIGNALS_PER_DEVICE_PER_DAY) {
        return { ok: false, reason: "rate_limited" };
      }
      await this.client
        .from("presence_evidence")
        .delete()
        .eq("device_hash", evidence.deviceHash)
        .eq("establishment_id", establishmentId)
        .eq("product_type_id", evidence.productTypeId)
        .gte("created_at", dayAgoIso(VOTE_REPLACE_WINDOW_DAYS));
    }
    const { error } = await this.client.from("presence_evidence").insert({
      establishment_id: establishmentId,
      product_type_id: evidence.productTypeId,
      signal: evidence.signal,
      source: evidence.source,
      device_hash: evidence.deviceHash,
      interaction_id: evidence.interactionId ?? null,
      query: evidence.query ? evidence.query.slice(0, 200) : null
    });
    if (error) {
      console.warn("[presence] evidence insert failed:", error.message);
      return { ok: false, reason: error.code === "23503" ? "invalid_store" : "storage_error" };
    }
    return { ok: true };
  }

  async listRecent(limit: number) {
    const { data, error } = await this.client
      .from("presence_evidence")
      .select(EVIDENCE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      return [];
    }
    return ((data ?? []) as SupabaseEvidenceRow[]).map(fromSupabaseRow);
  }

  async setFlag(id: string, flagged: boolean) {
    const { error, count } = await this.client
      .from("presence_evidence")
      .update({ is_flagged: flagged }, { count: "exact" })
      .eq("id", Number(id));
    return !error && (count ?? 0) > 0;
  }
}

let repository: EvidenceRepository | null = null;

export function getEvidenceRepository(storeSource: "supabase" | "local_osm"): EvidenceRepository {
  if (repository && (storeSource === "supabase") === (repository.kind === "supabase")) {
    return repository;
  }
  const client = storeSource === "supabase" ? getServerSupabaseClient() : null;
  repository = client
    ? new SupabaseEvidenceRepository(client)
    : new LocalFileEvidenceRepository(path.join(process.cwd(), ".data", "presence-evidence.json"));
  return repository;
}

export function setEvidenceRepositoryForTests(next: EvidenceRepository | null) {
  repository = next;
}
