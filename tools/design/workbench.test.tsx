import { GuidePanel } from "./guide-panel";
import { operatorData } from "./operator-data";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Workbench } from "./workbench";

beforeEach(() => {
  history.replaceState(null, "", "/");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

it("changes the actual App preview’s scenario, surface and width", () => {
  render(<Workbench />);
  const frame = () => screen.getByTitle("Real dashboard with synthetic data");
  expect(frame()).toHaveAttribute("src", "/preview/small/#/settings/usage");
  fireEvent.change(screen.getByRole("combobox", { name: "Scenario" }), {
    target: { value: "busy" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
  expect(frame()).toHaveAttribute("src", "/preview/busy/");
  fireEvent.change(screen.getByRole("combobox", { name: "Width" }), {
    target: { value: "mobile" },
  });
  expect(frame()).toHaveClass("design-preview-mobile");
});

it("opens a proposed project and drills into the same session evidence", () => {
  render(<Workbench />);
  fireEvent.click(screen.getByRole("button", { name: /Operator concept/ }));
  fireEvent.click(screen.getByRole("button", { name: "Edge migration" }));
  const project = screen.getByRole("region", {
    name: "Proposed project drill-down",
  });
  expect(
    within(project).getByText("Proposed decision needed"),
  ).toBeInTheDocument();
  expect(
    within(project).getByText(/Asset routing is implemented/),
  ).toBeInTheDocument();
  fireEvent.click(
    within(project).getAllByRole("button", { name: "Inspect transcript" })[0]!,
  );
  expect(
    screen.getByTitle("Real dashboard with synthetic data"),
  ).toHaveAttribute(
    "src",
    "/preview/small/?session=design-session-1&source=codex",
  );
  expect(new URLSearchParams(location.search).get("preview")).toContain(
    "design-session-1",
  );
});

it("restores a copied filtered preview link", () => {
  const preview =
    "/preview/busy/?q=cache&session=design-session-2&source=claude";
  history.replaceState(
    null,
    "",
    `/?scenario=busy&view=Dashboard&preview=${encodeURIComponent(preview)}`,
  );
  render(<Workbench />);
  expect(
    screen.getByTitle("Real dashboard with synthetic data"),
  ).toHaveAttribute("src", preview);
});

it("keeps proposed fields distinct and copies the selected JSON", async () => {
  render(<Workbench />);
  fireEvent.click(screen.getByRole("button", { name: /Data catalog/ }));
  fireEvent.click(
    screen.getByRole("button", { name: /Initiatives & decisions/ }),
  );
  expect(screen.getByText("No current operator endpoint")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
  expect(await screen.findByText("Copied")).toBeInTheDocument();
  const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0];
  expect(JSON.parse(copied)).toMatchObject({ designProposal: true });
});

it("retains in-frame drill-downs across theme and catalog changes and selects the matching data", async () => {
  render(<Workbench />);
  const frame = screen.getByTitle(
    "Real dashboard with synthetic data",
  ) as HTMLIFrameElement;
  const route = "/preview/small/?session=design-session-2&source=claude";
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: frame.contentWindow,
        data: { type: "design-route", route },
      }),
    ),
  );
  expect(screen.getByRole("link", { name: "Open preview" })).toHaveAttribute(
    "href",
    route,
  );
  fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
  expect(screen.getByTitle("Real dashboard with synthetic data")).toBe(frame);
  fireEvent.click(screen.getByRole("button", { name: "Data" }));
  expect(
    screen.getByRole("heading", { name: "Transcript evidence" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /01Dashboard/ }));
  expect(screen.getByTitle("Real dashboard with synthetic data")).toBe(frame);
  expect(screen.getByRole("link", { name: "Open preview" })).toHaveAttribute(
    "href",
    route,
  );
  fireEvent.click(screen.getByRole("button", { name: "Team usage" }));
  expect(screen.getByTitle("Real dashboard with synthetic data")).not.toBe(
    frame,
  );
  expect(screen.getByRole("link", { name: "Open preview" })).toHaveAttribute(
    "href",
    "/preview/small/#/settings/usage",
  );
});

it("does not present a server contract for proposed fields", () => {
  history.replaceState(null, "", "/?view=Data+catalog&data=initiatives");
  render(<Workbench />);
  expect(
    screen.queryByRole("link", { name: "Source contract" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/No server contract or deployed capability is asserted/),
  ).toBeInTheDocument();
});

it.each(["Pipeline synthesis v1", "Pipeline synthesis v2 preview"])("keeps %s frozen without discarding the selected operator project", title => {
  history.replaceState(null, "", "/?view=Operator+concept&project=Edge+migration&scenario=small");
  render(<Workbench />);
  expect(screen.getByRole("region", {name: "Proposed project drill-down"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: /Data catalog/}));
  fireEvent.click(within(screen.getByRole("navigation", {name: "Data domains"})).getByRole("button", {name: new RegExp(title)}));
  expect(screen.getByRole("combobox", {name: "Scenario"})).toBeDisabled();
  expect(screen.getByText("Frozen source cohort; the scenario selector does not apply.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: /Operator concept/}));
  expect(screen.getByRole("region", {name: "Proposed project drill-down"})).toBeInTheDocument();
  expect(screen.getByRole("combobox", {name: "Scenario"})).toBeEnabled();
});

it("drills a work category into the actual supporting human prompt", () => {
  render(<Workbench />);
  fireEvent.click(screen.getByRole("button", { name: /Operator concept/ }));
  fireEvent.click(screen.getByRole("button", { name: "testing (1)" }));
  const detail = screen.getByLabelText("Work category drill-down");
  expect(within(detail).getByText("Validate the edge migration against the cache contract.")).toBeInTheDocument();
  fireEvent.click(within(detail).getByRole("button", { name: /Open prompt evidence/ }));
  expect(screen.getByTitle("Real dashboard with synthetic data")).toHaveAttribute("src", "/preview/small/?session=design-session-2&source=claude");
});

it("uses the full busy cohort in initiative cards and project drill-downs", () => {
  history.replaceState(null, "", "/?view=Operator+concept&scenario=busy");
  render(<Workbench />);
  expect(screen.getAllByRole("button", {name: "View all 10 supporting sessions"})).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", {name: "Edge migration"}));
  expect(within(screen.getByRole("region", {name: "Proposed project drill-down"})).getAllByRole("button", {name: "Inspect transcript"})).toHaveLength(10);
});

it("does not show current initiative cards or restored project detail without current analysis", () => {
  for (const scenario of ["stale", "partial"]) {
    history.replaceState(null, "", `/?view=Operator+concept&scenario=${scenario}&project=Edge+migration`);
    const rendered = render(<Workbench />);
    expect(screen.getByText("Current initiative analysis is unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("region", {name: "Proposed project drill-down"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Edge migration"})).not.toBeInTheDocument();
    expect(screen.queryByText("Routing implemented; staging validation pending")).not.toBeInTheDocument();
    rendered.unmount();
  }
});

it("downloads the same cohort and analysis availability from the onboarding guide", () => {
  for (const scenario of ["busy", "stale", "partial", "empty"] as const) {
    const download = vi.fn();
    const rendered = render(<GuidePanel scenario={scenario} onConcept={vi.fn()} onDownload={download} />);
    fireEvent.click(screen.getByRole("button", {name: "Download scenario pack"}));
    const [pack, filename] = download.mock.calls[0]!;
    const analysis = operatorData(scenario);
    expect(pack.proposedInitiatives).toEqual(analysis.initiatives);
    expect(pack.operatorAnalysis).toEqual(analysis);
    expect(pack.sessions).toHaveLength(analysis.coverage.recordedSessions);
    expect(filename).toBe(`relay-${scenario}-design-pack.json`);
    rendered.unmount();
  }
});
