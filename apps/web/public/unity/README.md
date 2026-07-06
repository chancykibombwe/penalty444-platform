# apps/web/public/unity — future Unity WebGL build output

> Placeholder / documentation only. No Unity build output is committed here yet.

This directory marks where the Penalty444 Unity WebGL build will be placed for
dev testing. Files under `apps/web/public/` are served statically by Next.js, so
a build copied to:

```
apps/web/public/unity/penalty444/
```

is served at the URL path `/unity/penalty444/`.

## Rules

- The generated WebGL build is a **build artifact** — do not commit heavy/binary
  output (or `penalty444/`) unless a small, explicitly-approved dev build is
  intended.
- Loading this build is a later phase (B3: dev-only route; B5+: optional live
  match visual mode behind a feature flag). It is **not** wired into the live
  match page now.
- The build stays passive: no socket, no auth tokens, no Supabase writes, no
  picks, no official result computation. See `docs/unity-webgl-prototype-plan.md`
  and `docs/unity-webgl-build-pipeline.md`.
