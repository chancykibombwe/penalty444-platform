# AGENTS.md

## Cursor Cloud specific instructions

This is a **npm monorepo** ("444 Arena" / Penalty444) — a real-time 1v1 penalty-shootout game platform. It has **three independently-installed npm packages** (no workspaces): the repo root (Supabase CLI only), `apps/web` (Next.js 16 + React 19 frontend/API), and `apps/realtime-server` (Express + Socket.IO authoritative game server). See `apps/web/AGENTS.md` for a warning that this Next.js version has breaking changes — read `node_modules/next/dist/docs/` before editing web code.

### Services

| Service | Dir | Dev command | Port | Required? |
| --- | --- | --- | --- | --- |
| Web app | `apps/web` | `npm run dev` | 3000 | Yes |
| Realtime server | `apps/realtime-server` | `npm run dev` | 4000 (hardcoded) | Yes |
| Supabase | `supabase/` | hosted (see below) | — | Only for auth/multiplayer |

The dependency install step (`npm install` in all three package dirs) is handled by the Cursor update script; you do not need to run it manually.

### Env files (not committed; gitignored)

The apps need local env files that are **not** in git. They are created once during environment setup and persist in the VM snapshot. If they are missing, recreate them from `/.env.example` and `apps/realtime-server/.env.example`:

- `apps/web/.env.local`
- `apps/realtime-server/.env`

Key non-obvious points:
- `REALTIME_INTERNAL_SECRET` **must be identical** in both files (it authenticates web↔realtime `/internal/*` traffic).
- For local dev without a Supabase service-role key, set `SOCKET_JWT_ENFORCE=false` in both files so guest/anonymous sockets keep working (JWT checks become soft/log-only). Never use `false` in staging/production.
- `apps/web/src/lib/supabase/client.ts` **hardcodes** the browser Supabase URL + anon key (a hosted project), so the browser auth client ignores `NEXT_PUBLIC_SUPABASE_*`. Those env vars are still read by web server routes.
- `SUPABASE_SERVICE_ROLE_KEY` is not available in this environment; the realtime server logs a warning and cannot write to RLS-protected Supabase tables, but still boots and runs free-play/guest flows.

### Running / testing notes

- Standard scripts live in each `package.json`. Web: `dev`, `build`, `start`, `lint`, `test:unity-presentation`. Realtime: `dev`, `build`, `start`.
- Web typecheck: `npx tsc --noEmit -p apps/web/tsconfig.json`.
- Automated tests: `cd apps/web && npm run test:unity-presentation` (Node test runner via `tsx`, 149 tests). Realtime server has no test script — validate it with `npm run build`.
- **Lint is intentionally NOT a CI blocker** — `apps/web` currently has pre-existing lint errors (`npm run lint` exits non-zero). CI (`.github/workflows/ci.yml`) runs `test:unity-presentation` → `tsc --noEmit` → `next build` for web and `build` for realtime; it does not gate on lint.
- Realtime health check: `curl http://localhost:4000/health`.
- **No-login core gameplay demo:** `http://localhost:3000/guest` is a self-contained penalty-shootout vs AI (no Supabase/realtime needed). Full multiplayer (lobby, ranked, rooms, tournaments) is gated behind Supabase login (`RequireAuth`) and requires the realtime server.
- The Unity WebGL client (`unity/`) is a presentation-only prototype, not wired into the live app; not needed to run/test the core product.
