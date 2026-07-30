/**
 * B6D3B — deterministic registration shim for the PROOF route tests.
 *
 * The proof route lives in Next.js dynamic-segment directories named `[transport]`
 * and `[...path]`. Those names are GLOB MAGIC (`[...]` is a character class), so
 * passing the literal path to `node --test` / `tsx --test` matches ZERO files and
 * the route suite silently never ran in CI. A static import specifier is not
 * globbed, so importing the colocated test module here registers every one of its
 * tests reliably on every platform, with no shell quoting or glob escaping.
 *
 * CI lists THIS file instead of the bracketed path. The route tests themselves are
 * unchanged and are not duplicated here.
 */

import "../../app/api/dev/unity-stream-proof/[transport]/[...path]/route.test";
