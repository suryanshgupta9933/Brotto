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

  it("includes a browser_action tool with action enum", () => {
    const schemas = buildToolSchemas();
    const browser = schemas.find((s) => s.function.name === "browser_action");
    expect(browser).toBeDefined();
    const actionProp = browser!.function.parameters.properties.action as { enum: string[] };
    expect(actionProp.enum).toEqual(expect.arrayContaining(["left_click", "type", "scroll"]));
  });

  it("includes a finish tool requiring answer string", () => {
    const schemas = buildToolSchemas();
    const finish = schemas.find((s) => s.function.name === "finish");
    expect(finish).toBeDefined();
    expect(finish!.function.parameters.required).toContain("answer");
  });

  it("includes an ask_user_question tool requiring question", () => {
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
