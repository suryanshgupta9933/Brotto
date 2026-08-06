// Tool definitions exposed to OpenAI-compatible models via the tool-calling API.
// Each Brotto action is exposed as its own tool function so the model picks the
// action via tool name (matching FaraInferenceClient's tool-call format that
// ToolCallParser expects). All schemas derive from brotto-action-schema so a
// model swap never changes the action vocabulary.

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

const COORDINATE_PROPS = {
  x: { type: "number", description: "X coordinate in CSS pixels" },
  y: { type: "number", description: "Y coordinate in CSS pixels" },
} as const;

// ponytail: every tool call carries a one-sentence `reasoning` field. The
// model is told to populate it before each tool call; the parser falls back
// to "" if missing so older prompts / models that omit it still parse.
const REASONING_PROP = {
  reasoning: {
    type: "string",
    description: "One sentence in plain English describing what you observe and what this action is doing (e.g. 'Navigating to the GitHub profile to find the follower count.').",
  },
} as const;

const TARGET_ID_PROP = {
  targetId: {
    type: "string",
    description: "Optional semantic target id for stable references",
  },
} as const;

// ponytail: every tool's required array must include "reasoning". gpt-4o-mini
// silently drops optional fields — making reasoning required forces the model
// to produce the one-sentence user-facing description. Terminate additionally
// requires "finalAnswer" so the user actually gets their answer.
function withReasoning(required: string[] = []): string[] {
  return Array.from(new Set([...required, "reasoning"]));
}

export function buildToolSchemas(): ToolSchema[] {
  return [
    {
      type: "function",
      function: {
        name: "left_click",
        description: "Left-click at the given viewport coordinate.",
        parameters: {
          type: "object",
          properties: { ...COORDINATE_PROPS, ...TARGET_ID_PROP, ...REASONING_PROP },
          required: withReasoning(["x", "y"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "double_click",
        description: "Double-click at the given viewport coordinate.",
        parameters: {
          type: "object",
          properties: { ...COORDINATE_PROPS, ...TARGET_ID_PROP, ...REASONING_PROP },
          required: withReasoning(["x", "y"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "right_click",
        description: "Right-click at the given viewport coordinate.",
        parameters: {
          type: "object",
          properties: { ...COORDINATE_PROPS, ...TARGET_ID_PROP, ...REASONING_PROP },
          required: withReasoning(["x", "y"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "drag",
        description: "Drag from start coordinate to end coordinate.",
        parameters: {
          type: "object",
          properties: {
            startX: { type: "number" },
            startY: { type: "number" },
            endX: { type: "number" },
            endY: { type: "number" },
            ...REASONING_PROP,
          },
          required: withReasoning(["startX", "startY", "endX", "endY"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mouse_move",
        description: "Move the mouse to the given viewport coordinate.",
        parameters: {
          type: "object",
          properties: { ...COORDINATE_PROPS, ...REASONING_PROP },
          required: withReasoning(["x", "y"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "scroll",
        description: "Scroll the page by the given pixel deltas.",
        parameters: {
          type: "object",
          properties: {
            deltaX: { type: "number", description: "Horizontal scroll delta" },
            deltaY: { type: "number", description: "Vertical scroll delta" },
            ...REASONING_PROP,
          },
          required: withReasoning(["deltaX", "deltaY"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "key",
        description: "Press a keyboard key with optional modifiers.",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "Key name (e.g. 'Enter', 'Tab', 'a')" },
            modifiers: {
              type: "array",
              items: { type: "string", enum: ["ctrl", "shift", "alt", "meta"] },
              description: "Optional key modifiers",
            },
            ...REASONING_PROP,
          },
          required: withReasoning(["key"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "insert_text",
        description: "Type text into the currently focused input or contentEditable element.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to type" },
            ...TARGET_ID_PROP,
            ...REASONING_PROP,
          },
          required: withReasoning(["text"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "visit_url",
        description: "Navigate to an HTTP(S) URL.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri", description: "Absolute HTTP(S) URL" },
            ...REASONING_PROP,
          },
          required: withReasoning(["url"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "history_back",
        description: "Navigate back in browser history.",
        parameters: {
          type: "object",
          properties: {
            steps: { type: "number", description: "Number of steps back (default 1, max 20)" },
            ...REASONING_PROP,
          },
          required: withReasoning(),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "screenshot",
        description: "Capture a screenshot of the current viewport.",
        parameters: { type: "object", properties: { ...REASONING_PROP }, required: withReasoning() },
      },
    },
    {
      type: "function",
      function: {
        name: "wait",
        description: "Pause for the given duration in milliseconds.",
        parameters: {
          type: "object",
          properties: {
            durationMs: { type: "number", description: "Duration to wait in ms (max 60000)" },
            ...REASONING_PROP,
          },
          required: withReasoning(["durationMs"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ask_user_question",
        description: "Ask the user a clarifying question.",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string" },
            choices: { type: "array", items: { type: "string" } },
            ...REASONING_PROP,
          },
          required: withReasoning(["question"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "memorize_fact",
        description: "Store a fact in working memory for later steps.",
        parameters: {
          type: "object",
          properties: {
            fact: { type: "string" },
            category: { type: "string" },
            ...REASONING_PROP,
          },
          required: withReasoning(["fact"]),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "terminate",
        description: "Mark the task complete with a final answer.",
        parameters: {
          type: "object",
          properties: {
            finalAnswer: { type: "string", description: "The user's answer in plain English (their actual question, e.g. 'You have 12 followers.'). REQUIRED — this is what the user sees." },
            answer: { type: "string", description: "Legacy alias for finalAnswer; prefer finalAnswer." },
            ...REASONING_PROP,
          },
          required: withReasoning(["finalAnswer"]),
        },
      },
    },
  ];
}
