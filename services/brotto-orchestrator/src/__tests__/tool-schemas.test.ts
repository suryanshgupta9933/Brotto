import { buildToolSchemas } from "../prompts/tool-schemas";

describe("buildToolSchemas", () => {
  it("returns at least three tool definitions", () => {
    const schemas = buildToolSchemas();
    expect(schemas.length).toBeGreaterThanOrEqual(3);
  });

  it("each tool has type=function and function.name + parameters", () => {
    for (const schema of buildToolSchemas()) {
      expect(schema.type).toBe("function");
      expect(typeof schema.function.name).toBe("string");
      expect(schema.function.name.length).toBeGreaterThan(0);
      expect(schema.function.parameters.type).toBe("object");
      expect(typeof schema.function.parameters.properties).toBe("object");
    }
  });

  it("includes left_click with x and y required", () => {
    const schemas = buildToolSchemas();
    const tool = schemas.find((s) => s.function.name === "left_click");
    expect(tool).toBeDefined();
    expect(tool!.function.parameters.required).toEqual(expect.arrayContaining(["x", "y"]));
  });

  it("includes terminate with finalAnswer property", () => {
    // ponytail: Slice C — terminate now exposes `finalAnswer` (the user's
    // plain-English answer). The model is told to populate it; we no longer
    // mark it required so old prompts that omit it still parse.
    const schemas = buildToolSchemas();
    const finish = schemas.find((s) => s.function.name === "terminate");
    expect(finish).toBeDefined();
    expect(finish!.function.parameters.properties).toHaveProperty("finalAnswer");
    // legacy `answer` is also accepted as an alias
    expect(finish!.function.parameters.properties).toHaveProperty("answer");
  });

  it("includes ask_user_question requiring question", () => {
    const schemas = buildToolSchemas();
    const ask = schemas.find((s) => s.function.name === "ask_user_question");
    expect(ask).toBeDefined();
    expect(ask!.function.parameters.required).toContain("question");
  });

  it("returns a new array each call (no shared mutable state)", () => {
    const a = buildToolSchemas();
    const b = buildToolSchemas();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
