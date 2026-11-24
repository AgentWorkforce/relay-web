# Source-owned synthesis fixture

Synthetic only. These are the first `workspace-synthesis/1` artifact and source cohort from
pipeline review commit `1e6d6e46e8008fb399cd79ae59182bb734b28e4e`. This commit was **unlanded**
when imported; it adds no verified live endpoint or real-data availability to this workbench.

- `cohort.json` and `expected-synthesis.json` are byte-for-byte copies from
  `src/session-intel/__tests__/fixtures/synthesis/` in that source commit.
- `schema.json` serializes `WORKSPACE_SYNTHESIS_SCHEMA` from the same commit's
  `src/session-intel/synthesis/schema.ts`. No schema fields are manually redefined here.
- `provenance.json` records the repository, exact commit, paths, SHA-256 hashes, byte counts
  and independent source-test result. The fixture hash test catches local drift. A `.gitattributes` `-text` rule prevents
  checkout line-ending conversion, and the sample/catalog copy and download paths preserve
  the source text bytes.

Independent proof: in a temporary detached worktree at that exact source commit,
`bun test src/session-intel/__tests__/synthesis.test.ts` passed 30 tests / 386 assertions.
That source suite exercises the actual F1 envelope/evidence/semantic decoders, golden output,
JSON schema, independent coverage axes, missing/empty watermarks, refusals and bounds.
The temporary worktree was removed after the run; no source pipeline checkout was changed.

The cohort has 53 considered entries out of 60 eligible; **40** contribute to the aggregate.
The other 13 are skipped, including deliberately malformed inputs, unsupported versions and
out-of-window cases. Do not describe all 53 as valid F1 results. Seven eligible sessions were
not supplied. `truncated: false` means no configured cap was reached, not complete coverage.

The frozen window is 1–8 November 2026, half-open. Freshness is relative to the injected
8 November generation time, not the workbench's current-day clock. Stale analyses remain in
this retrospective aggregate. Categories partition the included analyses; issue evidence IDs
refer to F1 references, with transcript locators inside those references. Scope groups use
repository/project/source keys; that proxy does not prove independent humans or agent fleets.

Open **Pipeline sample** for local category → analysis → evidence drill-downs and downloads.
This separate cohort is not adapted into the Northstar production-App fixture transport.
`pipeline-sample-data.ts` projects this trusted pinned fixture; it is not a backend decoder.
Never copy real customer data into this public repository. For a future backend integration,
use the source-owned decoder and existing workspace authorization, freshness and erase rules.

## Provisional v2 producer preview

`expected-synthesis-v2.json`, `expected-stage2-input.json` and `stage2-reply.json` are byte-identical
copies from pipeline review commit `923778b559c6090565814e90cfaf3c49684da98d`.
`provenance-v2.json` records their hashes. This is a **provisional, unlanded** contract under review.
The synthetic cohort and v1 golden above are unchanged at the reviewed Stage 1 head `d75b6320`.
The v1 JSON schema source is also unchanged from the original pin.

The v2 producer constructs its input from F1 claim texts, then validates a **hand-written fake
model reply**. No model was called. Removing `stage2` and `stage2Reason` and changing `contract`
back to `/1` yields the v1 golden exactly. Independent source tests at the v2 pin:
`bun test src/session-intel/__tests__/synthesis.test.ts src/session-intel/__tests__/synthesis-stage2.test.ts`
passed 63 tests / 920 assertions. This proves contract and reference handling, not real-world model quality.

`titleRef` identifies a per-session claim: `i` intent, `d` decision, `b` blocker, `o` outcome assessment,
followed by its one-based position. Resolve that claim's `evidenceIds` to F1 references and then transcript
locators. It is neither a transcript event ID nor a v1 recurrence-candidate `eventId`.

The preview exposes its actual initiative/theme/hypothesis fields and rejected-item counts separately
from the broader Northstar product proposal. `stage2.usage` is simulated synthesis-call telemetry,
not team token consumption. Neither version provides project/team attribution or deduplicated spend.
The source pin has no runtime model transport, durable budget ledger or v2 serving. No verified real
populated F1/aggregate accompanies either pack.
