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
