import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const realtimeInternalSecret =
  process.env.REALTIME_INTERNAL_SECRET ?? "";

export const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

export const PICK_TIMEOUT_MS = 10000;
export const EARLY_CANCEL_MS = 5000;
export const MAX_SUDDEN_DEATH_CYCLES = 10;
// Covers the full client reveal cycle before the inter-round pause fires:
// casual = 3000ms REVEALING + 1500ms REVEALED; tournament timeout path uses this too.
export const RESULT_REVEAL_PAUSE_MS = 4500;
// "Get ready" window between reveal completing and the 10s pick timer starting.
// Server emits match:interRound then waits this long before startRoundTimer().
export const INTER_ROUND_PAUSE_MS = 1000;
