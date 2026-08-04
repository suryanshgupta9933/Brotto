import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("canonical extension distribution surface", () => {
  it("declares no legacy options page, redundant activeTab, content script, or missing icon assets", () => {
    const manifest = JSON.parse(read("manifest.json")) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty("options_page");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("icons");
    expect(manifest.action).not.toHaveProperty("default_icon");
    expect(manifest.permissions).toEqual(["debugger", "tabs", "storage"]);
  });

  it("exposes only canonical runtime state and durable complete terminal details", () => {
    const background = read("src/background.ts");
    const popup = read("src/popup.js");
    expect(background).not.toMatch(/EventSource|\/connect|\/task|ActionExecutor|from ["']\.\/relay/);
    expect(background).toContain("terminal: state.terminal");
    expect(background).toContain("approval: state.approval");
    expect(popup).toContain("response.status?.terminal");
    expect(popup).toContain("response.status?.approval");
    expect(popup).toContain("Confidence");
    expect(popup).toContain("Evidence observations");
    expect(popup).toContain("Observation");
  });

  it("uses a test runner that normalizes pnpm forwarded arguments and a strict asset build", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const build = read("build.mjs");
    expect(pkg.scripts.test).toBe("node test.mjs");
    expect(build).not.toContain("existsSync(src)");
    expect(build).not.toContain("iconsDir");
    expect(build).toContain("requiredRuntimeFiles");
  });
});
