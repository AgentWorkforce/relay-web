import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  CLASS_LABELS,
  CoverageStrip,
  SessionIntelPanel,
  alertClassLabel,
  coverageNotes,
  groupAlerts,
} from "./SessionIntelPanel";
import { sessionIntelResponseSchema } from "./session-intel-api";
import {
  SESSION_INTEL_NOW,
  emptySessionIntelFixture,
  sessionIntelFixture,
} from "./session-intel-fixture";

const panel = (data = sessionIntelFixture) => (
  <SessionIntelPanel
    workspaceId="fake-workspace"
    query=""
    data={data}
    loading={false}
    error={null}
    now={SESSION_INTEL_NOW}
  />
);

const coverage = sessionIntelFixture.coverage;

it("maps alert classes to plain labels", () => {
  expect(alertClassLabel("constraint_violation")).toBe("Rule broken");
  expect(alertClassLabel("intent_conflict")).toBe("Conflicting decisions");
  expect(alertClassLabel("collision")).toBe("Duplicate work");
  expect(alertClassLabel("overlap")).toBe("Working nearby");
  expect(alertClassLabel(null)).toBe("Unclassified");
  expect(alertClassLabel("a_future_class")).toBe("Unclassified");
  expect(alertClassLabel("toString")).toBe("Unclassified");
  expect(Object.keys(CLASS_LABELS).slice(0, 4)).toEqual([
    "constraint_violation",
    "intent_conflict",
    "collision",
    "overlap",
  ]);
});

it("the fixture matches the contract", () => {
  expect(sessionIntelResponseSchema.parse(sessionIntelFixture)).toEqual(sessionIntelFixture);
  expect(sessionIntelResponseSchema.parse(emptySessionIntelFixture)).toEqual(emptySessionIntelFixture);
});

it("puts every high alert before any low one, then orders classes, newest first", () => {
  const base = sessionIntelFixture.alerts[1]!;
  const alert = (advisoryId: string, urgency: "high" | "low", cls: string | null, createdAt: string) => ({
    ...base,
    advisoryId,
    urgency,
    class: cls,
    createdAt,
  });
  const groups = groupAlerts([
    alert("fake-low-rule", "low", "constraint_violation", "2026-10-01T11:59:00.000Z"),
    alert("fake-high-dup-old", "high", "collision", "2026-10-01T10:00:00.000Z"),
    alert("fake-low-none", "low", null, "2026-10-01T11:00:00.000Z"),
    alert("fake-high-dup-new", "high", "collision", "2026-10-01T11:00:00.000Z"),
    alert("fake-high-plans", "high", "planned_fleet", "2026-10-01T11:00:00.000Z"),
    alert("fake-high-other", "high", "none", "2026-10-01T11:00:00.000Z"),
    alert("fake-high-nearby", "high", "overlap", "2026-10-01T11:00:00.000Z"),
    alert("fake-high-intent", "high", "intent_conflict", "2026-10-01T11:00:00.000Z"),
  ]);
  expect(groups.map((group) => `${group.urgency} ${group.label}`)).toEqual([
    "high Conflicting decisions",
    "high Duplicate work",
    "high Working nearby",
    "high Conflicting plans",
    "high Other",
    "low Rule broken",
    "low Unclassified",
  ]);
  expect(groups[1]!.alerts.map((item) => item.advisoryId)).toEqual([
    "fake-high-dup-new",
    "fake-high-dup-old",
  ]);
});

it("renders a high Duplicate work alert above a low Rule broken one", () => {
  const data = structuredClone(sessionIntelFixture);
  data.alerts = [
    { ...data.alerts[2]!, advisoryId: "fake-low-rule", urgency: "low" },
    { ...data.alerts[1]!, advisoryId: "fake-high-dup" },
  ];
  render(panel(data));
  const alerts = screen.getByRole("region", { name: "Alerts" });
  expect(
    within(alerts).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
  ).toEqual(["High · Duplicate work (1)", "Low · Rule broken (1)"]);
});

it("renders alerts grouped by class with urgency, artifact, times, both session links and delivery", () => {
  render(panel());
  const alerts = screen.getByRole("region", { name: "Alerts" });
  expect(
    within(alerts).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
  ).toEqual([
    "High · Rule broken (1)",
    "High · Conflicting decisions (1)",
    "High · Duplicate work (1)",
    "Low · Working nearby (1)",
  ]);
  const collision = within(alerts).getByText("migrations/0001_fake.sql").closest("[class*='p-4']")!;
  const card = within(collision as HTMLElement);
  expect(card.getByText("High")).toBeVisible();
  expect(card.getByText("Created")).toBeVisible();
  expect(card.getByText("Delivered")).toBeVisible();
  const links = card.getAllByRole("link").map((link) => link.getAttribute("href"));
  expect(links).toEqual([
    "/?session=fake-session-a&source=codex&workspace=fake-workspace&from=tab%3Dintel",
    "/?session=fake-session-b&source=claude&workspace=fake-workspace&from=tab%3Dintel",
    "/?session=fake-session-b&source=claude&workspace=fake-workspace&event=fake-event-b&from=tab%3Dintel",
  ]);
  // A known title names the session; an untitled one falls back to its harness and id.
  expect(card.getAllByText("Build the fake parser").length).toBeGreaterThan(0);
  const delivery = card.getByRole("list", { name: "Delivery" });
  expect(delivery).toHaveTextContent("Build the fake parser: acked");
  expect(delivery).toHaveTextContent(/fake-session-b: not acked/);
  // An undelivered alert says so.
  const nearby = within(alerts).getByText("src/example-nearby.ts").closest("[class*='p-4']")!;
  expect(nearby).toHaveTextContent(/Delivered\s*not yet/);
  expect(within(nearby as HTMLElement).getByText("Low")).toBeVisible();
});

it("renders live status with summaries, an explicit missing summary and unknown claims", () => {
  render(panel());
  const table = screen.getByRole("table");
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(3);
  expect(rows[1]).toHaveTextContent("Build the fake parser");
  expect(rows[1]).toHaveTextContent("Adds a parser for the synthetic format.");
  expect(rows[1]).toHaveTextContent("Active");
  expect(rows[1]).toHaveTextContent("2m ago");
  expect(rows[1]).toHaveTextContent("Ship the fake parser");
  expect(rows[2]).toHaveTextContent("No summary yet");
  expect(rows[2]).toHaveTextContent("Idle");
  expect(rows[2]).toHaveTextContent("unknown");
  expect(within(rows[1]!).getByRole("link")).toHaveAttribute(
    "href",
    "/?session=fake-session-a&source=codex&workspace=fake-workspace&from=tab%3Dintel",
  );
});

it("renders handoffs with summary, decisions and open intents", () => {
  render(panel());
  const handoffs = screen.getByRole("region", { name: "Handoffs" });
  expect(handoffs).toHaveTextContent("Update the fake schema");
  expect(handoffs).toHaveTextContent("Done");
  expect(handoffs).toHaveTextContent("Moved the synthetic schema to version two.");
  expect(handoffs).toHaveTextContent("Keep version one readable");
  expect(handoffs).toHaveTextContent("Remove version one later");
  expect(within(handoffs).getByRole("link")).toHaveAttribute(
    "href",
    "/?session=fake-session-c&source=gemini&workspace=fake-workspace&from=tab%3Dintel",
  );
});

it("shows claims as unavailable, never as zero, when the claims read failed", () => {
  render(<CoverageStrip coverage={coverage} now={SESSION_INTEL_NOW} />);
  const strip = screen.getByRole("region", { name: "Coverage" });
  expect(strip).toHaveTextContent("Summaries: 1 of 2 active sessions, newest 5m ago");
  expect(strip).toHaveTextContent("Intents/decisions: unavailable");
  expect(strip).toHaveTextContent("Claim extraction: unknown");
  expect(strip).toHaveTextContent("Claims couldn't be read");
  expect(strip).not.toHaveTextContent("summaries/search");
});

it("never guesses an evidence link when two harnesses share a session id", () => {
  const data = structuredClone(sessionIntelFixture);
  data.alerts = [
    {
      ...data.alerts[1]!,
      advisoryId: "fake-shared-id",
      sessions: [
        { source: "claude", sessionId: "fake-shared-session" },
        { source: "codex", sessionId: "fake-shared-session" },
        { source: "gemini", sessionId: "fake-unique-session" },
      ],
      acked: [],
      evidence: [
        { sessionId: "fake-shared-session", eventId: "fake-event-shared", ts: "2026-10-01T11:39:00.000Z", kind: "tool_result" },
        { sessionId: "fake-unique-session", eventId: "fake-event-unique", ts: "2026-10-01T11:38:00.000Z", kind: "file_edit" },
      ],
    },
  ];
  render(panel(data));
  const alerts = screen.getByRole("region", { name: "Alerts" });
  const hrefs = within(alerts).getAllByRole("link").map((link) => link.getAttribute("href"));
  // Both harnesses' sessions are linked separately.
  expect(hrefs).toContain("/?session=fake-shared-session&source=claude&workspace=fake-workspace&from=tab%3Dintel");
  expect(hrefs).toContain("/?session=fake-shared-session&source=codex&workspace=fake-workspace&from=tab%3Dintel");
  // The ambiguous evidence is text, not a link to either harness.
  expect(hrefs.filter((href) => href!.includes("fake-event-shared"))).toEqual([]);
  expect(within(alerts).getByText(/tool result .*\(source\s+ambiguous\)/)).toBeVisible();
  // Unambiguous evidence still links to its one session.
  expect(hrefs).toContain(
    "/?session=fake-unique-session&source=gemini&workspace=fake-workspace&event=fake-event-unique&from=tab%3Dintel",
  );
});

it("shows zero claims and an off extractor as they are", () => {
  render(
    <CoverageStrip
      coverage={{ ...coverage, sessionsWithClaims: 0, claimsExtraction: "off", notes: [] }}
      now={SESSION_INTEL_NOW}
    />,
  );
  const strip = screen.getByRole("region", { name: "Coverage" });
  expect(strip).toHaveTextContent("Intents/decisions: 0 of 2");
  expect(strip).toHaveTextContent("Claim extraction: off");
  expect(strip).toHaveTextContent("depend on claim extraction");
});

it("shows partial claims and never implies full coverage, even when every count matches", () => {
  const { unmount } = render(
    <CoverageStrip coverage={{ ...coverage, sessionsWithClaims: 1, notes: [] }} now={SESSION_INTEL_NOW} />,
  );
  expect(screen.getByRole("region", { name: "Coverage" })).toHaveTextContent("Intents/decisions: 1 of 2");
  unmount();
  render(
    <CoverageStrip
      coverage={{ ...coverage, sessionsWithSummary: 2, sessionsWithClaims: 2, claimsExtraction: "on", notes: [] }}
      now={SESSION_INTEL_NOW}
    />,
  );
  const strip = screen.getByRole("region", { name: "Coverage" });
  expect(strip).not.toHaveTextContent("Claim extraction");
  expect(strip).toHaveTextContent("may be incomplete");
});

it("rewrites the fixed notes in plain words and keeps unknown ones", () => {
  expect(
    coverageNotes([
      "alerts capped at 100",
      "handoff search is not served here; use GET /v1/sessions/summaries/search",
      "a new note",
    ]),
  ).toEqual(["Only the newest 100 alerts are shown; there may be more.", "a new note"]);
});

it("shows the empty states with the coverage caveat", () => {
  render(panel(emptySessionIntelFixture));
  expect(screen.getByText("No alerts")).toBeVisible();
  expect(screen.getByText(/doesn't mean there are none/)).toBeVisible();
  expect(screen.getByText("No active sessions in the last 2 hours.")).toBeVisible();
  expect(screen.getByText("No idle or ended sessions in the last 7 days.")).toBeVisible();
  expect(screen.getByRole("region", { name: "Coverage" })).toHaveTextContent(
    "Summaries: 0 of 0 active sessions, newest none",
  );
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("renders hostile titles, summaries and artifacts as text, and links only from ids", () => {
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const data = structuredClone(sessionIntelFixture);
  data.status[0]!.title = hostile;
  data.status[0]!.shortSummary = hostile;
  data.status[0]!.openIntents = [hostile];
  data.handoffs[0]!.decisions = [hostile];
  data.alerts[0]!.artifact = hostile;
  data.alerts[0]!.sessions[0] = { source: "javascript:alert(3)//", sessionId: '"><script>' };
  const { container } = render(panel(data));
  expect(container.querySelector("script, [onerror], img[src='x']")).toBeNull();
  expect(screen.getAllByText(hostile).length).toBeGreaterThan(3);
  for (const link of container.querySelectorAll("a")) {
    const href = link.getAttribute("href")!;
    expect(href.startsWith("/?session=")).toBe(true);
  }
});

it("shows read errors and a loading state", () => {
  const { rerender } = render(
    <SessionIntelPanel workspaceId="fake-workspace" query="" data={undefined} loading error={null} />,
  );
  expect(screen.getByRole("status", { name: "Loading session intelligence…" })).toBeVisible();
  rerender(
    <SessionIntelPanel
      workspaceId="fake-workspace"
      query=""
      data={undefined}
      loading={false}
      error={new Error("Session history is temporarily unavailable. Please try again.")}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");
});
