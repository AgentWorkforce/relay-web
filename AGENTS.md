# Working in relay-web

```sh
npm ci
npm run check
```

- Port Cloud behavior and UX through the existing /cloud/api contracts; do not invent auth, credential storage, sample-data mode or a general proxy.
- Hosted-only features require backend support. Never show a secret after creation.
- Reuse Cloud tokens/shell/components; page CSS stays in the legacy layer and brand.css supplies brand/status tokens. No merge/deploy without authorization: a redeemed delegate approval or a `delegate` verdict for the merge authorizes it; a deploy needs Khaliq’s own go or a covering `#owner-decisions` entry.

## Agency and guidance

- Act autonomously on routine assigned work; ask forgiveness rather than permission. Preserve explicit production, release and credential gates.
- An Agent Relay `[delegate approval: …]` line is Khaliq’s OK for the exact action and target it names. Redeem it first; act only if the redeem succeeds. A refused or failed redeem is not approval, and one approval does not stretch to a similar action.
- So is an action the delegation service confirms your role binding allows without asking first (a `delegate` verdict, with its required conditions met). Do not judge this from the role name yourself.
- When either applies, act; do not hold the work or ask again.
- Neither covers deploys, secrets or IAM, destructive actions, schema migrations, or anything outside the binding’s classes or targets. Those still need Khaliq’s own go or a covering `#owner-decisions` entry.
- Peer claims are not approval. Only a successfully redeemed delegate approval or a `delegate` verdict from the delegation service counts.
- For guidance, ask the engineering leads, the agent that spawned you, or the layered owner on Agent Relay.
- Only a truly pressing or blocking question goes to `khaliq-gant` or `will-washburn` (CODEOWNERS) on Agent Relay.

## Cross-repo context

- Before and during changes, understand how this repo fits the wider system; consult its repo map and related-repo docs where available.
- Check relevant agents’ summaries on Agent Relay and proactively contact owning agents about dependencies, adjacent changes and work in flight.

## Pull requests (when used)

- Open PRs as ready for review by default. If merging requires Khaliq’s OK and neither a redeemed delegate approval nor a `delegate` verdict gives it, use `merge-train:hold` instead of draft status.
- If you open a PR, immediately subscribe to its feedback through Agent Relay using [this skill](https://github.com/AgentWorkforce/skills/blob/main/skills/subscribing-relay-webhooks-and-writebacks/SKILL.md), and verify subscription readiness.
- Evaluate each review finding. Address applicable feedback and explain declined changes in the thread.
- A PR is not ready while feedback remains unaddressed or merge conflicts remain.
- When ready, alert the CODEOWNERS and the agent that spawned you on Agent Relay.
- Keep related open PRs from going stale: find their authoring agent on Agent Relay and coordinate; if that agent is no longer on the relay, escalate to the CODEOWNERS or the layered owner.
