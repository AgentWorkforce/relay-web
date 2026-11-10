import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  OverlapsPanel,
  PartialCoverageNotice,
  formatDuplicateCost,
  formatUsdMicros,
  leadTimeText,
} from "./OverlapsPanel";
import { overlapsResponseSchema } from "./overlaps-api";
import { overlapsFixture } from "./overlaps-fixture";

it("formats duplicated cost without turning unknown values into zero", () => {
  expect(formatUsdMicros(12_345_678)).toBe("$12.35");
  expect(formatUsdMicros(null)).toBe("unknown");
  expect(formatDuplicateCost(null, null)).toBe("unknown");
  expect(formatDuplicateCost(null, 2_500)).toBe("unknown · 2,500 tokens");
});

it("formats the lead time as a direct explanation", () => {
  expect(leadTimeText(7_500_000)).toBe(
    "Could have been flagged 2h 5m before harm.",
  );
  expect(leadTimeText(null)).toBeNull();
});

it("preserves the detector's finding order", () => {
  const parsed = overlapsResponseSchema.parse(overlapsFixture);
  expect(parsed.findings.map((finding) => finding.id)).toEqual([
    "fake-finding-first",
    "fake-finding-second",
  ]);
});

it("shows a clear partial coverage notice and its notes", () => {
  render(<PartialCoverageNotice coverage={overlapsFixture.coverage} />);
  expect(screen.getByRole("status")).toHaveTextContent("Partial data");
  expect(screen.getByRole("status")).toHaveTextContent(
    "more sessions exist but were left out because a read limit was reached.",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Two synthetic sessions ended before their uploads completed.",
  );
});

it("renders findings in response order and resolves known member names", () => {
  render(
    <OverlapsPanel
      workspaceId="fake-workspace"
      query=""
      onQuery={() => undefined}
      range={7}
      onRange={() => undefined}
      data={{
        report: overlapsFixture,
        members: [
          { id: "fake-user-one", name: "Example One" },
          { id: "fake-user-two", name: "Example Two" },
        ],
      }}
      loading={false}
      error={null}
    />,
  );
  const headings = screen.getAllByRole("heading", { level: 3 });
  expect(headings.map((heading) => heading.textContent)).toEqual([
    "Duplicate work",
    "Stale base",
  ]);
  expect(screen.getAllByText(/Example One/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/fake-user-one/)).not.toBeInTheDocument();
});

it("treats truncation as a flag, not a session count", () => {
  render(
    <PartialCoverageNotice
      coverage={{ ...overlapsFixture.coverage, sessionsTruncated: 1 }}
    />,
  );
  expect(screen.getByRole("status")).not.toHaveTextContent("1 sessions");
});
