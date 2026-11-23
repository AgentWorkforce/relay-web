// @vitest-environment node
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { expect, it } from "vitest";

it("generates the production dashboard’s icon and layout utilities from the design root", async () => {
  const server = await createServer({
    configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
    logLevel: "silent",
    server: { port: 0, strictPort: false },
  });
  try {
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
    await server.close();
  }
});
