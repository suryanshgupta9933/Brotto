import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("canonical extension distribution surface", () => {
  it("declares no legacy popup, side panel is the primary surface, debugger permission granted", () => {
    const manifest = JSON.parse(read("manifest.json")) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty("options_page");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("icons");
    expect(manifest.action).not.toHaveProperty("default_icon");
    expect(manifest.action).not.toHaveProperty("default_popup");
    expect(manifest).toHaveProperty("side_panel");
    expect(manifest.permissions).toContain("debugger");
    expect(manifest.permissions).toContain("sidePanel");
  });

  it("side panel renders live activity stream with login + approval prompts", () => {
    const background = read("src/background.ts");
    const sidepanel = read("src/sidepanel.js");
    expect(background).not.toMatch(/EventSource|\/connect|from ["']\.\/relay/);
    expect(background).toContain("run_local_task");
    expect(background).toContain("login_required");
    expect(background).toContain("sidePanel.setPanelBehavior");
    expect(background).toContain("openPanelOnActionClick");
    expect(sidepanel).toContain("canonical_step");
    expect(sidepanel).toContain("login_required");
    expect(sidepanel).toContain("canonical_approval");
    expect(sidepanel).toContain("task_completed");
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
