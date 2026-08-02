/**
 * B6D3B PR-1 — deterministic registration shim for the artifact route tests.
 *
 * The artifact route lives in a Next.js dynamic-segment directory named
 * `[...path]`. That name is GLOB MAGIC (`[...]` is a character class), so passing
 * the literal path to `node --test` / `tsx --test` silently matches ZERO files and
 * the suite never runs. A static import specifier is not globbed, so importing the
 * colocated test module here registers every one of its tests reliably on every
 * platform — no shell quoting or glob escaping required.
 *
 * Keep this file listed in the `test:unity-security-delivery` script instead of the
 * bracketed path.
 */

import "../../app/unity-arena/artifact/[...path]/route.test";
