/**
 * One-off maintenance script:
 *   update tournaments
 *   set status = 'cancelled', updated_at = now()
 *   where status in ('registration','check_in','in_progress')
 *     and updated_at < now() - interval '6 hours';
 *
 * Run from apps/web:
 *   npx tsx scripts/cancelStaleTournaments.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const cutoffIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error: selectError } = await supabase
    .from("tournaments")
    .select("id, name, status, updated_at")
    .in("status", ["registration", "check_in", "in_progress"])
    .lt("updated_at", cutoffIso);

  if (selectError) {
    console.error("Select failed:", selectError.message);
    process.exit(1);
  }

  if (!candidates || candidates.length === 0) {
    console.log("No stale tournaments to cancel.");
    return;
  }

  console.log(`Found ${candidates.length} stale tournament(s):`);
  console.table(
    candidates.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      updated_at: t.updated_at,
    }))
  );

  const { data: updated, error: updateError } = await supabase
    .from("tournaments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .in("status", ["registration", "check_in", "in_progress"])
    .lt("updated_at", cutoffIso)
    .select("id, name, status, updated_at");

  if (updateError) {
    console.error("Update failed:", updateError.message);
    process.exit(1);
  }

  console.log(`Cancelled ${updated?.length ?? 0} tournament(s):`);
  console.table(
    (updated ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      updated_at: t.updated_at,
    }))
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
