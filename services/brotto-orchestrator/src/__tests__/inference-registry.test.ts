import { createPlanner, inferFamilyFromEnv, type InferenceConfig } from "../inference-registry";

describe("createPlanner", () => {
  it("returns a BrottoPlanner for family=fara", () => {
    const config: InferenceConfig = {
      family: "brotto",
      endpoint: "http://localhost:8000",
    };
    const planner = createPlanner(config);
    expect(planner).toBeDefined();
    expect(planner.plan).toBeInstanceOf(Function);
  });

  it("returns an OpenAICompatiblePlanner for family=openai-compatible", () => {
    const config: InferenceConfig = {
      family: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    };
    const planner = createPlanner(config);
    expect(planner).toBeDefined();
    expect(planner.plan).toBeInstanceOf(Function);
  });
});

describe("inferFamilyFromEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 'fara' when BROTTO_ENDPOINT is set", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.OLLAMA_HOST;
    process.env.BROTTO_ENDPOINT = "http://localhost:8000";
    expect(inferFamilyFromEnv()).toBe("brotto");
  });

  it("returns 'openai-compatible' when OPENAI_API_KEY is set", () => {
    delete process.env.BROTTO_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.OLLAMA_HOST;
    process.env.OPENAI_API_KEY = "sk-test";
    expect(inferFamilyFromEnv()).toBe("openai-compatible");
  });

  it("returns 'openai-compatible' when OLLAMA_HOST is set", () => {
    delete process.env.BROTTO_ENDPOINT;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    process.env.OLLAMA_HOST = "http://localhost:11434";
    expect(inferFamilyFromEnv()).toBe("openai-compatible");
  });

  it("BROTTO_ENDPOINT takes precedence over OPENAI_API_KEY", () => {
    process.env.BROTTO_ENDPOINT = "http://localhost:8000";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(inferFamilyFromEnv()).toBe("brotto");
  });

  it("throws when no inference env vars are set", () => {
    delete process.env.BROTTO_ENDPOINT;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.OLLAMA_HOST;
    expect(() => inferFamilyFromEnv()).toThrow();
  });
});
