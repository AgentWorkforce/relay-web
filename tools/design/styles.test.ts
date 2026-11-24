// @vitest-environment node
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { expect, it } from "vitest";

it("generates the production dashboard’s icon and layout utilities from the design root", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "relay-design-css-"));
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
      cacheDir,
      logLevel: "silent",
      server: { port: 0, strictPort: false },
    });
    await server.listen();
    const transformed = await server.transformRequest("/styles.css");
    const css = transformed?.code ?? "";
    // These live in src/, not just in the workbench controls. Without them,
    // the logo grows to its intrinsic size and filter icons stack above labels.
    expect(css).toContain(".h-5");
    expect(css).toContain(".size-4");
    expect(css).toContain(".inline-flex");
    expect(css).toContain(".items-center");
    expect(css).toContain("svg:not");
  } finally {
    try {
      await server?.close();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
});
