"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://pwfgcblgjgoywefsotga.supabase.co";
const supabaseAnonKey = "sb_publishable_bxNlGwXE0k5_ByUleNkLSA_RB09gPQI";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);