import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/container.yml"),
  "utf8",
);

describe("release candidate workflow", () => {
  it("dispatches the successful manual-main publication identity", () => {
    const publishJob = workflow.match(
      /^  publish:\n[\s\S]*?(?=^  notify-release-candidate:)/m,
    )?.[0];
    const notifyJob = workflow.match(/^  notify-release-candidate:\n[\s\S]*$/m)?.[0];
    expect(publishJob).toBeDefined();
    expect(notifyJob).toBeDefined();
    expect(publishJob).toMatch(
      /    outputs:\n      digest: \$\{\{ steps\.build\.outputs\.digest \}\}\n      source_sha: \$\{\{ steps\.source\.outputs\.source_sha \}\}/,
    );
    expect(notifyJob).toMatch(/needs: publish/);
    expect(notifyJob).toMatch(
      /if: \$\{\{ needs\.publish\.result == 'success' && github\.ref == 'refs\/heads\/main' \}\}/,
    );
    expect(notifyJob).toMatch(/DIGEST: \$\{\{ needs\.publish\.outputs\.digest \}\}/);
    expect(notifyJob).toMatch(/SOURCE_SHA: \$\{\{ needs\.publish\.outputs\.source_sha \}\}/);
    expect(notifyJob).toMatch(/client_payload\[component\]=relay-webapp/);
    expect(notifyJob).toMatch(/client_payload\[digest\]=\$DIGEST/);
    expect(notifyJob).toMatch(/client_payload\[source_sha\]=\$SOURCE_SHA/);
    expect(notifyJob).toMatch(/repos\/AgentWorkforce\/infra\/dispatches/);
  });
});
