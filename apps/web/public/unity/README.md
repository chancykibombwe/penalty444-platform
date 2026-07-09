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

## Status (B3 dry run)

A local WebGL build **succeeds** with Unity **6000.4.2f1** + WebGL Build Support.
Output is placed here for dev testing but is **never committed**:

```
apps/web/public/unity/penalty444/
```

**Git protection (PR #194):** this folder is **git-ignored** (root `.gitignore`),
so build files cannot be committed by accident. This `README.md` stays tracked.

Full build steps, generated-file checklist, and clean instructions:
`docs/unity-webgl-build-pipeline.md` §6.

**Dev-only viewer (PR #196):** with the local build present, view it at

```
/dev/unity/penalty444
```

That route loads `/unity/penalty444/index.html` in an iframe for manual viewing
only. It is 404 in production unless explicitly enabled on the server, is not
linked from any public page, and is passive (no `postMessage`, no Socket.IO, no
Supabase, no live match state). The build output stays **git-ignored and
uncommitted**; if it is missing the route shows a "run the B3 build" message.
