import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/container.yml"),
  "utf8",
);

describe("release candidate workflow", () => {
  it("dispatches the successful manual-main publication identity", () => {
    expect(workflow).toMatch(/needs: publish/);
    expect(workflow).toMatch(
      /if: \$\{\{ needs\.publish\.result == 'success' && github\.ref == 'refs\/heads\/main' \}\}/,
    );
    expect(workflow).toMatch(/digest: \$\{\{ steps\.build\.outputs\.digest \}\}/);
    expect(workflow).toMatch(/source_sha: \$\{\{ steps\.source\.outputs\.source_sha \}\}/);
    expect(workflow).toMatch(/client_payload\[component\]=relay-webapp/);
    expect(workflow).toMatch(/client_payload\[digest\]=\$DIGEST/);
    expect(workflow).toMatch(/client_payload\[source_sha\]=\$SOURCE_SHA/);
    expect(workflow).toMatch(/repos\/AgentWorkforce\/infra\/dispatches/);
  });
});
