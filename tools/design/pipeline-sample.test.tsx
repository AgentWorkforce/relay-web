import { CatalogPanel } from "./catalog-panel";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PipelineSample } from "./pipeline-sample";
import { cohort, synthesis, provenance, pipelineDownloads, pipelineAnalysis, pipelineReference } from "./pipeline-sample-data";
import { Workbench } from "./workbench";

it("keeps the exact source fixture bytes and exported schema pinned to their provenance", () => {
  for (const [name, receipt] of Object.entries(provenance.files)) {
    const bytes = readFileSync(join(process.cwd(), "tools/design/fixtures/synthesis", name));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(receipt.sha256);
    expect(bytes.length).toBe(receipt.bytes);
    const download = Object.values(pipelineDownloads).find(item => item.name === name)!;
    expect(Buffer.from(download.text).equals(bytes)).toBe(true);
  }
});

it("preserves the source output denominators, independent coverage axes and source-qualified references", () => {
  expect(cohort.sessions).toHaveLength(synthesis.inputs.considered);
  expect(synthesis.inputs.considered).toBe(synthesis.inputs.analyzed + Object.values(synthesis.inputs.skipped).reduce((a,b) => a+b, 0));
  expect(synthesis.inputs.eligible - synthesis.inputs.considered).toBe(7);
  expect(synthesis.categories.reduce((sum, item) => sum + item.count, 0)).toBe(synthesis.inputs.analyzed);
  for (const usage of Object.values(synthesis.usageCoverage)) {
    expect(usage.observed + usage.unobserved).toBe(usage.analyzed);
    expect(usage.knownCost + usage.nullCost).toBe(usage.analyzed);
  }
  for (const category of synthesis.categories) {
    for (const ref of category.sessions) expect(pipelineAnalysis(ref)).toMatchObject({source: ref.source, sessionId: ref.sessionId});
  }
  for (const issue of synthesis.issues) {
    for (const ref of issue.evidence) {
      const evidence = pipelineReference(ref, ref.eventId);
      expect(evidence?.id).toBe(ref.eventId);
      expect(evidence?.source).toBe(ref.source);
    }
  }
  expect(pipelineAnalysis({source: "wrong-source", sessionId: "fx-s01"})).toBeNull();
  expect(pipelineAnalysis({source: "fx-codex", sessionId: "fx-bad-identity"})).toBeNull();
  expect(pipelineReference(synthesis.issues[0]!.evidence[0]!, "missing-reference")).toBeNull();
});

it("drills a source work category into an included F1 analysis", () => {
  render(<PipelineSample onDownload={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox", {name: "Pipeline work category"}), {target: {value: "planning/blocked"}});
  fireEvent.click(within(screen.getByLabelText("Pipeline category sessions")).getByRole("button", {name: "Inspect fx-claude / fx-s01"}));
  const detail = screen.getByRole("region", {name: "Pipeline analysis drill-down"});
  expect(within(detail).getByRole("heading", {name: "Fixture session fx-s01"})).toBeInTheDocument();
  expect(within(detail).getByText("Fixture intent of the session. (observed, high)")).toBeInTheDocument();
  expect(within(detail).getAllByRole("button", {name: /Inspect .* ·/}).length).toBeGreaterThan(0);
});

it("opens a recurrence candidate by its F1 reference rather than guessing a transcript URL", () => {
  const download = vi.fn();
  render(<PipelineSample onDownload={download} />);
  const ref = synthesis.issues[0]!.evidence[0]!;
  fireEvent.click(screen.getAllByRole("button", {name: `Evidence · ${ref.source} / ${ref.sessionId}`})[0]!);
  const detail = screen.getByLabelText("Pipeline evidence reference");
  expect(within(detail).getByText(ref.eventId)).toBeInTheDocument();
  expect(within(detail).getByText(pipelineReference(ref, ref.eventId)!.summary)).toBeInTheDocument();
  expect(screen.queryByRole("link", {name: /transcript/i})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Back to session evidence"}));
  expect(screen.queryByLabelText("Pipeline evidence reference")).not.toBeInTheDocument();
  const prompt = pipelineAnalysis(ref)!.evidence.references.find(item => item.kind === "human-message")!;
  fireEvent.click(screen.getByRole("button", {name: `Inspect human-message · ${prompt.id}`}));
  expect(within(screen.getByLabelText("Pipeline evidence reference")).getByText(prompt.summary)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Download computed output"}));
  expect(download).toHaveBeenCalledWith(pipelineDownloads.synthesis.text, "expected-synthesis.json", true);
});

it("keeps the frozen pipeline cohort independent of the Northstar scenario selector", () => {
  history.replaceState(null, "", "/?view=Pipeline+sample&scenario=empty");
  render(<Workbench />);
  expect(screen.getByRole("combobox", {name: "Scenario"})).toBeDisabled();
  expect(screen.getByText(/40 analyzed/)).toBeInTheDocument();
  expect(screen.getByRole("region", {name: "Source-owned pipeline sample"})).toBeInTheDocument();
  expect(screen.getByText(/separate frozen synthetic pipeline cohort/)).toBeInTheDocument();
  expect(screen.queryByText("Everything here belongs to the fictional Northstar Studio.")).not.toBeInTheDocument();
});

it("preserves source bytes through the catalog copy and download actions", () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  const download = vi.fn();
  render(<CatalogPanel scenario="small" entryId="pipeline-synthesis" copy="" onSelect={vi.fn()} onCopy={copy} onDownload={download} />);
  fireEvent.click(screen.getByRole("button", {name: "Copy JSON"}));
  expect(copy).toHaveBeenCalledWith(pipelineDownloads.synthesis.text);
  fireEvent.click(screen.getByRole("button", {name: "JSON"}));
  expect(download).toHaveBeenCalledWith(pipelineDownloads.synthesis.text, "expected-synthesis.json", true);
});
