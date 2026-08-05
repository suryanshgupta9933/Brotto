// Tool definitions exposed to OpenAI-compatible models via the tool-calling API.
// All tool schemas derive from fara-action-schema action types so every model
// sees the same surface — a model swap never changes the action vocabulary.

export interface ToolFunctionSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolSchema {
  type: "function";
  function: ToolFunctionSchema;
}

const BROWSER_ACTIONS = [
  "left_click", "double_click", "right_click", "drag",
  "key", "type", "scroll", "wait", "visit_url",
  "history_back", "screenshot",
] as const;

export function buildToolSchemas(): ToolSchema[] {
  return [
    {
      type: "function",
      function: {
        name: "browser_action",
        description: "Perform an action on the current browser page",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: [...BROWSER_ACTIONS] },
            coordinate: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["x", "y"],
            },
            text: { type: "string" },
            key: { type: "string" },
            url: { type: "string", format: "uri" },
          },
          required: ["action"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish",
        description: "Mark the task complete and return the final answer",
        parameters: {
          type: "object",
          properties: {
            answer: { type: "string", description: "Final answer or summary" },
          },
          required: ["answer"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ask_user_question",
        description: "Ask the user a clarifying question",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string" },
            choices: {
              type: "array",
              items: { type: "string" },
              description: "Optional multiple-choice options",
            },
          },
          required: ["question"],
        },
      },
    },
  ];
}
