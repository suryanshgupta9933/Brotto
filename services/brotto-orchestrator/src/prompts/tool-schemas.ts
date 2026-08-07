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
  x: { type: "number", description: "X coordinate in CSS pixels. Optional when targetId is provided." },
  y: { type: "number", description: "Y coordinate in CSS pixels. Optional when targetId is provided." },
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
    description: "REQUIRED. Semantic target id from the observation's INTERACTIVE ELEMENTS list (e.g. 'f377c754f377c754'). The harness resolves it to the element's bounding-box center and clicks there.",
  },
} as const;

// ponytail: x and y are now OPTIONAL. Click tools accept element
// references (targetId) as the primary path, mirroring browser-use /
// computer-use. The model MUST pass targetId from the rendered
// INTERACTIVE ELEMENTS section. x/y are kept as a fallback for
// elements that don't appear in the AX tree (canvas, drawn content).
const CLICK_REQUIRED = ["targetId"];

// ponytail: structured working-memory updates. Optional on every action — the
// model records durable findings (e.g. key='answer', value='33', evidence='profile header')
// and the harness merges them, dedupes by key, and renders them in every prompt.
// Replaces the old `memorize_fact` tool, which produced a no-op action that
// the model kept calling forever because it didn't change loop state.
const MEMORY_UPDATE_PROP = {
  memoryUpdates: {
    type: "array",
    description: "Optional structured findings to merge into working memory. Use {key, value, evidence} — key is stable (e.g. 'answer'), value is the fact, evidence is the source.",
    items: {
      type: "object",
      properties: {
        key: { type: "string", description: "Stable identifier (e.g. 'answer', 'repo_name')." },
        value: { type: "string", description: "The fact itself (the user's answer goes here)." },
        evidence: { type: "string", description: "Short source of where you saw this (e.g. 'GitHub profile sidebar')." },
      },
      required: ["key", "value"],
    },
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
        description: "Left-click. Pass the targetId from INTERACTIVE ELEMENTS (preferred — harness resolves to bbox center) OR fall back to x/y for canvas content.",
        parameters: {
          type: "object",
          properties: { ...COORDINATE_PROPS, ...TARGET_ID_PROP, ...REASONING_PROP, ...MEMORY_UPDATE_PROP },
          required: withReasoning(CLICK_REQUIRED),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "double_click",
        description: "Double-click. Pass targetId (preferred) or x/y.",
        parameters: {
          type: "object",
          properties: { ...COORDINATE_PROPS, ...TARGET_ID_PROP, ...REASONING_PROP, ...MEMORY_UPDATE_PROP },
          required: withReasoning(CLICK_REQUIRED),
        },
      },
    },
    {
      type: "function",
      function: {
        name: "right_click",
        description: "Right-click. Pass targetId (preferred) or x/y.",
        parameters: {
          type: "object",
          properties: { ...COORDINATE_PROPS, ...TARGET_ID_PROP, ...REASONING_PROP, ...MEMORY_UPDATE_PROP },
          required: withReasoning(CLICK_REQUIRED),
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
            ...MEMORY_UPDATE_PROP,
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
          properties: { ...COORDINATE_PROPS, ...REASONING_PROP, ...MEMORY_UPDATE_PROP },
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
            ...MEMORY_UPDATE_PROP,
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
            ...MEMORY_UPDATE_PROP,
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
            ...MEMORY_UPDATE_PROP,
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
            ...MEMORY_UPDATE_PROP,
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
            ...MEMORY_UPDATE_PROP,
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
        parameters: {
          type: "object",
          properties: { ...REASONING_PROP, ...MEMORY_UPDATE_PROP },
          required: withReasoning(),
        },
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
            ...MEMORY_UPDATE_PROP,
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
            ...MEMORY_UPDATE_PROP,
          },
          required: withReasoning(["question"]),
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
            ...MEMORY_UPDATE_PROP,
          },
          required: withReasoning(["finalAnswer"]),
        },
      },
    },
  ];
}
