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
