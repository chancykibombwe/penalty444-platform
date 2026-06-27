"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase/client";
import AdminBetaDashboard from "../../../components/admin/AdminBetaDashboard";
import type { AdminBetaDashboardResponse } from "../../api/admin/beta-dashboard/route";

type PageState =
  | "loading"
  | "unauthenticated"
  | "forbidden"
  | "service_unavailable"
  | "error"
  | "ready";

function GateScreen({
  title,
  body,
  color,
}: {
  title: string;
  body: string;
  color: string;
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-xl font-black" style={{ color }}>
        {title}
      </h1>
      <p className="mt-3 text-sm text-zinc-400">{body}</p>
    </div>
  );
}

export default function AdminBetaPage() {
  const [state, setState] = useState<PageState>("loading");
  const [data, setData] = useState<AdminBetaDashboardResponse | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setState("unauthenticated");
          return;
        }

        const res = await fetch("/api/admin/beta-dashboard", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });

        if (res.status === 401) {
          setState("unauthenticated");
          return;
        }
        if (res.status === 403) {
          setState("forbidden");
          return;
        }
        if (res.status === 503) {
          setState("service_unavailable");
          return;
        }
        if (!res.ok) {
          setState("error");
          return;
        }

        const json = (await res.json()) as AdminBetaDashboardResponse;
        setData(json);
        setState("ready");
      } catch {
        setState("error");
      }
    }

    void load();
  }, []);

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center text-sm text-zinc-500">
        Loading admin dashboard…
      </div>
    );
  }

  if (state === "unauthenticated") {
    return (
      <GateScreen
        title="Sign In Required"
        body="Please sign in to access the admin dashboard."
        color="#60a5fa"
      />
    );
  }

  if (state === "forbidden") {
    return (
      <GateScreen
        title="Not authorized."
        body="Your account does not have admin access. Contact the operator to add your email to ADMIN_EMAILS."
        color="#f87171"
      />
    );
  }

  if (state === "service_unavailable") {
    return (
      <GateScreen
        title="Admin Unavailable"
        body="SUPABASE_SERVICE_ROLE_KEY is not configured on this environment. Set it in server-side env vars."
        color="#fbbf24"
      />
    );
  }

  if (state === "error" || !data) {
    return (
      <GateScreen
        title="Could not load admin dashboard."
        body="Please try again or check server logs."
        color="#f87171"
      />
    );
  }

  return <AdminBetaDashboard data={data} />;
}
