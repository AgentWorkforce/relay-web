# Design workbench (development tooling)

Run `npm ci`, then `npm run design` from the repository root. Open
http://127.0.0.1:5174/. This uses the locked Vite/React/Tailwind dependencies;
it needs no backend, secrets, extra packages or login. The
[designer brief](../../docs/designer-onboarding.md) is the starting guide.

## Architecture

- `vite.config.ts`: a separate, loopback-only development server and HTML roots.
  It does not load the product Vite config or its backend proxy environment.
  Building this config is refused. The normal `npm run build` still has only
  the production entry.
- `main.tsx` and the tooling panels: the workbench, catalog and hand-authored operator concept. They use
  the production theme tokens, Button and Card components.
- `preview-navigation.ts`: reports the frame’s push/replace/hash routes and
  accepts validated theme messages. The frame stays mounted across panels;
  explicit scenario/surface commands reset it. Open preview and Data follow
  the current route, including drill-downs and restored links.
- `preview.tsx`: the **actual production App**, with its existing shell,
  usage/person/session pages and transcript renderer. Runtime flags are set
  before mount, analytics stays off, and direct reader mode stays off. The
  existing Control-shaped session paths are sufficient for this first set.
- `styles.css`: imports the product theme and explicitly scans `src/` for
  Tailwind utilities. The separate Vite root otherwise omits the production
  component classes, including icon sizing and filter-row layout. Test files
  are excluded so CSS assertions cannot supply their own utility candidates.
- `transport.ts`: an entry-local fetch replacement. Only enumerated GET routes
  for the fictional workspace are supported. Unknown routes, external URLs and
  every mutation return a fixture refusal; there is no fetch fallback, backend
  proxy, browser credential or service credential. Backend paths on the Vite
  server itself also return 404. The frame’s CSP limits connections to this
  origin and the local HMR socket. This is a UI iteration fixture, not a
  security sandbox or an integration test.
- `fixtures/northstar.json`: fictional work, people, machines and projects.
  Reserved `example.test` addresses and URLs are not customer data. Do not copy
  real session exports, private conversations or credentials into this public repo.
- `scenarios.ts`: response generation and seven deterministic scenario states.
  Initiative proposal fields live separately from API response rows.
- `catalog.ts`: source links, field meanings, permissions, coverage warnings and
  synthetic examples. Fleet is explicitly documentation-shaped and overlaps
  points to the existing experimental contract; neither is enabled by the kit.
- `contracts.test.ts`: fixtures exercised through production API clients and
  parsers, plus linked evidence, pagination, error, refusal and abort coverage.

All generated rows use the reference clock shown in the UI, anchored at noon
on the current UTC day so fresh previews stay within the activity window. Thirty busy-team
sessions span three pages. Person counts and summary links come from that same
dataset. Partial coverage preserves `null`, `unavailable` and `truncated`.

## Extending it

Add a story to the JSON and a state to `scenarios.ts`. For another dashboard
surface, add only the exact response routes it needs in `transport.ts`, with
its proper organization/workspace identity, and validate the answers through
the production client/parser in the contract tests. Do not respond to arbitrary
paths with empty success objects. An unsupported setting may display an error;
this kit intentionally does not stub every admin or mutation workflow.

Add a catalog entry alongside a new domain. Label deployed support unverified
until someone checks it. Distinguish recorded facts, derived estimates and
proposed fields; preserve freshness and coverage in each design. If backend
contracts change, update the source-owned schema first, then the fixtures.
The fleet example has no production dashboard parser and is labelled accordingly.

`npm run design:check` typechecks tooling plus product imports. `npm run check`
also lints both, runs the contract tests with the existing suite, and builds the
production application. `npm run design:isolation` checks the built assets
for workbench and fixture markers and runs at the end of `npm run check`. No fixture module is imported
from `src/`, no production route enables this tooling, and nothing from this
workbench is a published product preview.

Desktop context is included in the story and brief. Native SwiftUI previews,
platform builds and cloud/local session unification need their own subsequent
Desktop task; there are no native code changes in this kit.
