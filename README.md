# Agent Relay Dashboard

A React/Vite page for Agent Relay sessions: the session list with filters,
full transcripts (prompts, replies, tool calls and results, diffs, subagents),
message search, and team activity. It uses the existing login and HttpOnly
session cookie and reads only the `/cloud/api` session routes, which scope every
read to the signed-in workspace. Session links are `?session=<id>&source=<source>`
on the app's base path; hosted `/dashboard/sessions/<id>?source=` links also open.
No separate authentication, preview mode, or production-data proxy.

## Product analytics

Analytics is off by default. Set `DASHBOARD_ANALYTICS_ENABLED=true` in a self-hosted
image's runtime environment to enable the typed browser adapter. Control must also
have its analytics destination configured. The browser sends only registered
`dashboard.page_viewed` and `dashboard.session_opened` events to the same-origin
`/cloud/api/v1/analytics/events` gateway using the existing HttpOnly session cookie.
Control authenticates the caller, derives workspace/organization attribution,
and selects its collector or PostHog adapter. The browser receives no producer
credential, PostHog key, or destination URL, and never falls back to a hosted sink.

Only fixed page categories and entry-source enums are exported. Session opens
are captured after a transcript read succeeds; a failed read emits nothing.
An explicit `from` list filter distinguishes search/list entry; other opens use
`link`. IDs, URLs, search text, titles, transcript content and exceptions are
excluded. Category page views are emitted when the authenticated shell changes
category. Account/workspace changes or shell teardown discard pending work.
The in-memory buffer is capped at 32 events, three attempts and a 20-second
delivery budget per event; requests time out after three seconds. Authentication,
authority or a disabled gateway stops delivery until the context changes.
A gateway `202` means the gateway accepted the request, not that the collector
has persisted it. Collector durability requires independent file readback.

## Run

Install dependencies here with `npm ci`, then run `npm run dev` from the Cloud
checkout. Open the printed gateway URL, normally http://localhost:3100/dashboard/.
Cloud starts Vite and marketing proxies `/dashboard` to it. `/login` and
`/cloud/api` remain on the shared origin. Opening Vite directly does not provide
a login or backend.

The same arrangement applies in production at agentrelay.com/dashboard/.
`npm run build` produces static assets; `wrangler.jsonc` is the static host config.

Self-hosted images serve the SPA at `/` next to a chart-rendered
`/runtime-config.js` (`window.__AGENT_RELAY_DASHBOARD_CONFIG__` with `appPath`,
`apiBasePath`, `loginPath`). Build them with:

```sh
DASHBOARD_BASE_PATH=/ DASHBOARD_RUNTIME_CONFIG_URL=/runtime-config.js npm run build
```

`DASHBOARD_BASE_PATH` sets the asset base (default `/dashboard/`) and must match
the runtime `appPath`. The SPA reads `appPath` and `loginPath`; it always calls
the API at `/cloud/api` on its own origin, so route that prefix to relaycontrol
(`apiBasePath` in the config is informational). `DASHBOARD_RUNTIME_CONFIG_URL` adds the config script to
`index.html`; leave it unset for hosted builds. Routes are `#/flows…`,
`#/settings/<section>`, and query parameters for sessions, so no history
fallback is needed.

### Customer profile (enterprise branding)

Self-hosted images can carry a customer's brand without a rebuild. Set
`DASHBOARD_CUSTOMER_PROFILE` (the chart's `customerProfile` value) to one JSON
object. The image writes it into `/runtime-config.js` as `customerProfile`, and
the SPA validates each field and ignores the ones it can't use:

| field | effect |
| --- | --- |
| `productName` | Replaces "Agent Relay" in the sidebar, the device page and labels (when there is no logo, the name is shown in place of the wordmark). |
| `title` | Document title (defaults to `productName` when set, otherwise `Agent Relay · Dashboard`). |
| `logo` | `{ "light": url, "dark": url }`, or one URL for both themes. Replaces the mark and wordmark. |
| `favicon` | Favicon URL. |
| `accentColor` | Links, focus rings and active navigation (`#hex`, `rgb()`, `hsl()`, `oklch()`, `oklab()`). |
| `brandColor` | The solid primary button. |
| `supportUrl` | Adds Support to the account menu and the device page (`https`, `http`, `mailto:` or a same-origin path). |
| `poweredByAgentRelay` | `false` hides the "Powered by Agent Relay" line shown under a custom brand. |
| `desktop` | `{ "urlScheme": "agentrelay-acme", "siteUrl": "https://relay.acme.example" }`: the Agent Relay Desktop deep links (see below). Does not count as branding. |

Logo and favicon URLs may be `https`/`http`, same-origin paths or supported
`data:image` types (PNG, SVG, JPEG, WebP, GIF or icons, up to about 60 KB).
Colors must be `#hex`, `rgb()`, `hsl()`, `oklch()` or `oklab()` values the
browser accepts; any other value keeps the default, and the primary button's
text turns dark on a light `brandColor`. Without a profile
(and always in the hosted build, which has no runtime config) the dashboard
looks exactly as before.

The container refuses to start when `DASHBOARD_CUSTOMER_PROFILE` is not a
single-line JSON object or is larger than 64 KiB. A value that is shaped like
an object but is not valid JSON starts normally with the default branding.
Example:

```sh
DASHBOARD_CUSTOMER_PROFILE='{"productName":"Acme Relay","logo":{"light":"https://acme.example/logo-dark-text.svg","dark":"https://acme.example/logo-light-text.svg"},"favicon":"https://acme.example/favicon.svg","accentColor":"#7c3aed","brandColor":"#5b21b6","supportUrl":"mailto:support@acme.example","poweredByAgentRelay":true}'
```

#### Agent Relay Desktop links

Settings › Workspace shows **Connect your agents** with an
`<urlScheme>://connect?site=<siteUrl>&account=<user>&workspace=<workspace>`
link that opens Agent Relay Desktop signed in to this deployment
(`src/shell/desktop-links.ts` also builds `<urlScheme>://message?to=<agent@machine>&site=<siteUrl>`).
A Desktop built for one deployment registers its own scheme and refuses a link
naming another site, so set both to what that build uses. `urlScheme` must be a
lowercase scheme (`^[a-z][a-z0-9+.-]{0,63}$`, not `http`, `https`, `file`,
`javascript` and the like) and defaults to `agentrelay`; `siteUrl` must be a
bare `https` origin (`http` only for localhost). It defaults to the dashboard's
own origin when that origin qualifies; a dashboard served over plain `http`
(other than localhost) shows no Desktop links unless `siteUrl` names a valid
`https` origin. Invalid fields fall back on their own. The hosted build shows no
Desktop links here.

`npm run check` runs lint, tests and the production build. Apache-2.0.

### Session visualizations

`DASHBOARD_SESSION_READ_API_ENABLED=true` (default false) reads list, search, activity, turns and events directly from the session read API, using the access token Control hands the page at `POST /cloud/api/v1/workspaces/:id/session-read/session`. The refresh token stays server side. A first page that the read API can't serve falls back to the existing `/cloud/api` path; timing, output and catalog always use it. The read API must allow the dashboard origin in CORS and expose `X-Relayhistory-Workspace-Id`. In this mode people's names come from Control's `GET /cloud/api/v1/workspaces/:id/sessions/members`; that needs relay-control 0.5.8 or later, and an older version shows no names.

Recorded agent names can appear beneath a session title alongside its harness and model. Enable `DASHBOARD_SESSION_AGENT_NAMES_ENABLED=true` only after both Control and the session reader support the `includeAgentName=recorded` list opt-in. It is off by default, keeping legacy list requests unchanged. The container accepts only literal `true` or `false` (unset defaults to false); static hosts can supply the strict boolean `sessionAgentNames` in the existing runtime config. A missing or malformed runtime value stays off. This requests optional top-level recorded metadata on both Control and direct-reader lists; it adds no catalog fetches and does not infer a name from historical actors or session titles. Missing names are omitted. Deploy compatible Control and reader versions before enabling this flag; it does not enable backend support by itself.

The Timeline, Decision tree and Work graph views are ported from Cloud. They are off by default. Set `DASHBOARD_SESSION_VISUALIZATIONS_ENABLED=true` in the container to emit the strict boolean `sessionVisualizations` in the existing runtime config. Static-host configurations can supply that boolean directly. Missing, false or malformed values retain Conversation and never mount graph reads.

Work graph requires the relaycontrol catalog identity contract (`sessionId`, `source`, `workspaceId`, `found`). Every request uses the existing `/cloud/api` cookie and workspace routes; the dashboard does not contact History directly. Explicit workspace links must match the signed-in workspace. Links to another workspace show a mismatch message without issuing session reads; relaycontrol has no workspace-switch endpoint.

Discovery uses exact recorded catalog/replay identities, at most 80 additional related sessions, four concurrent sessions and ten event/turn pages per session. It does not infer causality from a shared PR or nearby timestamps. Failed/partial evidence is visible and can be retried. Hosted Cloud SQL-only PR attribution is not invented when the server does not supply it.

Session details also read a recorded model summary through relaycontrol's
workspace-scoped `/sessions/:sessionId/summary` route, matching Cloud #6011.
The summary loads independently of the transcript and overview. Missing History
support renders no summary block; an empty stored result says “No summary yet”.
A failed read cannot delay the transcript or invent a summary. This requires
the companion relaycontrol summary route; existing login and cookies are reused.

## Password sign-in (self-hosted)

When relaycontrol lists `password` in `SELFHOST_SIGNIN_METHODS`, signed-out
visitors land on `#/sign-in`, with `#/register` and `#/forgot-password` beside
it. The page reads the public `/cloud/api/v1/auth/login-config` and shows only
the configured methods. Any install without passwords, and any custom
`DASHBOARD_LOGIN_PATH`, goes to relaycontrol's `/login` as before. The emailed
`/login/password/verify` and `/login/password/reset` links stay on
relaycontrol's own pages, so their tokens never reach this app.

## Relay Chief

### Feature availability

The dashboard reads the installation's capabilities from the signed-in,
same-origin `GET /cloud/api/v1/capabilities` endpoint, which reports what
`SELFHOST_FEATURES` selects. Flows and Chief are hidden from navigation and
their route components do not mount until the server returns the corresponding
boolean as true. Workflow token creation is also hidden when Flows is off;
existing tokens remain available for inspection and revocation. Environment,
account connections and general token controls remain available.

On the first read, missing endpoints, invalid responses, signed-out requests,
pending reads and an eight-second timeout keep both features off. Returning to
the app checks again behind the current state, so an open page keeps unsaved
work; only the server saying the feature is off, or that the session ended,
closes it. There is no runtime-config, URL or local-storage override. Control
remains responsible for authenticated API enforcement.

A Control version without this endpoint keeps these features unavailable.

`#/chief` provides project setup (project, operating policy, review) and the chief
detail view: readiness, assignments, verification, reservations and decisions.
It calls relaycontrol's workspace-scoped `/cloud/api/v1/workspaces/:id/chiefs`
routes with the existing cookie session. The server supplies environment and
readiness status; there are no browser-side fixtures or credential stores.

For standalone local development, `DASHBOARD_API_ORIGIN` may point to a local
relaycontrol origin. Vite forwards only `/cloud/api` and `/login`. When using a
preview, set `DASHBOARD_PREVIEW_HOST` to its exact host. Without the variable,
the existing Cloud gateway development path is unchanged.
