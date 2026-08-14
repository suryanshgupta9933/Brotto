/**
 * Tool Call Parser and Validator
 *
 * Parses Brotto tool calls and validates arguments using brotto-action-schema
 * as specified in ARCHITECTURE.md section 3.2 and 3.5
 *
 * Per ARCHITECTURE.md section 3.2, the orchestrator must:
 * - Parse Brotto tool calls
 * - Validate all model arguments
 * - NOT let the model directly control dangerous actions
 */
import { ActionType, validateActionArgs, tryValidateActionArgs, validateCoordinatesInBounds, } from '@brotto/brotto-action-schema';
/**
 * Action type mapping from tool names
 */
const TOOL_NAME_TO_ACTION_TYPE = {
    left_click: ActionType.LEFT_CLICK,
    double_click: ActionType.DOUBLE_CLICK,
    right_click: ActionType.RIGHT_CLICK,
    drag: ActionType.DRAG,
    mouse_move: ActionType.MOUSE_MOVE,
    scroll: ActionType.SCROLL,
    key: ActionType.KEY,
    insert_text: ActionType.INSERT_TEXT,
    visit_url: ActionType.VISIT_URL,
    history_back: ActionType.HISTORY_BACK,
    screenshot: ActionType.SCREENSHOT,
    wait: ActionType.WAIT,
    ask_user_question: ActionType.ASK_USER_QUESTION,
    terminate: ActionType.TERMINATE,
    pause_and_memorize_fact: ActionType.PAUSE_AND_MEMORIZE_FACT,
    memorize_fact: ActionType.MEMORIZE_FACT,
    // ponytail: long-horizon tools. Mirror of tool-schemas.ts buildToolSchemas().
    // If you add a tool to one, add it here too — the model sees the schema
    // list, the parser sees this map, and any mismatch surfaces as
    // "Unknown tool '<name>'" rejections that the model can't recover from.
    read_scratchpad: ActionType.READ_SCRATCHPAD,
    verify_completion: ActionType.VERIFY_COMPLETION,
};
/**
 * Actions that are never allowed to be controlled by the model
 * Per ARCHITECTURE.md section 3.2 and 8.6
 */
const BLOCKED_TOOL_NAMES = new Set([
    'browser_run_code_unsafe',
    'shell',
    'exec',
    'run_code',
    'execute_script',
    'system_command',
]);
/**
 * Actions that require coordinate validation
 */
const COORDINATE_REQUIRING_ACTIONS = new Set([
    ActionType.LEFT_CLICK,
    ActionType.DOUBLE_CLICK,
    ActionType.RIGHT_CLICK,
    ActionType.DRAG,
    ActionType.MOUSE_MOVE,
    ActionType.SCROLL,
]);
/**
 * URL validation regex for visit_url action
 */
const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
/**
 * Parse error codes
 */
export var ParseErrorCode;
(function (ParseErrorCode) {
    ParseErrorCode["UNKNOWN_TOOL"] = "UNKNOWN_TOOL";
    ParseErrorCode["INVALID_ARGUMENTS"] = "INVALID_ARGUMENTS";
    ParseErrorCode["BLOCKED_TOOL"] = "BLOCKED_TOOL";
    ParseErrorCode["COORDINATES_OUT_OF_BOUNDS"] = "COORDINATES_OUT_OF_BOUNDS";
    ParseErrorCode["INVALID_URL"] = "INVALID_URL";
    ParseErrorCode["MISSING_REQUIRED_FIELD"] = "MISSING_REQUIRED_FIELD";
    ParseErrorCode["STALE_OBSERVATION"] = "STALE_OBSERVATION";
    ParseErrorCode["STALE_TARGET"] = "STALE_TARGET";
})(ParseErrorCode || (ParseErrorCode = {}));
function isParseError(value) {
    return 'toolCall' in value && 'error' in value && 'code' in value;
}
/**
 * Tool call parser and validator
 */
export class ToolCallParser {
    coordinateBounds = null;
    currentObservationId = null;
    // ponytail: semantic targets from the most recent observation. Used to
    // resolve click tool calls' targetId to (x, y) bbox centers. Model
    // passes the element id (e.g. "f377c754f377c754"); harness looks it up
    // here and clicks the center. Enriched with tag/role/accessibleName
    // so the parser can reject row-container clicks (div + role=link +
    // long name + no action verb) — these have role=link but no actual
    // click handler in Gmail / Outlook / GitHub lists.
    lastSemanticTargets = [];
    /**
     * Set viewport bounds for coordinate validation
     */
    setViewportBounds(bounds) {
        this.coordinateBounds = bounds;
    }
    /**
     * Set current observation ID for staleness checking
     */
    setCurrentObservationId(id) {
        this.currentObservationId = id;
    }
    // ponytail: feed the most recent observation's semantic targets so the
    // parser can resolve targetId clicks. Call once per planning cycle.
    setLastSemanticTargets(targets) {
        this.lastSemanticTargets = targets;
    }
    /**
     * Clear viewport bounds
     */
    clearBounds() {
        this.coordinateBounds = null;
        this.currentObservationId = null;
    }
    // ponytail: targetId → (x, y) bbox center + the bbox itself. Exact
    // match on stableRef or targetId only. Earlier permissive endsWith
    // fallback caused collisions when two targets shared a hex suffix — a
    // 4-char fragment could resolve to the wrong element. Returns null when
    // no match; caller falls back to args.x/args.y.
    resolveTargetId(targetId) {
        const tid = targetId.toLowerCase();
        for (const t of this.lastSemanticTargets) {
            const fullId = t.targetId.toLowerCase();
            const stable = (t.stableRef ?? "").toLowerCase();
            if (fullId === tid || stable === tid) {
                const cx = Math.round(t.boundingBox.x + t.boundingBox.width / 2);
                const cy = Math.round(t.boundingBox.y + t.boundingBox.height / 2);
                return { x: cx, y: cy, bbox: t.boundingBox, tag: t.tag, role: t.role, name: t.accessibleName?.text };
            }
        }
        return null;
    }
    // ponytail: detect row containers in email / list views. A row div
    // typically has role="link" + long accessible name (subject + preview
    // + sender, >80 chars) + NO action verb. Clicking it dispatches but
    // doesn't navigate on Gmail / Outlook / GitHub lists because the click
    // handler is on an inner element (subject link, View order button).
    // Returns the target info when it's a container, null otherwise.
    // Generic — no vendor names in the heuristic.
    isRowContainer(t) {
        if (t.tag !== "div")
            return null;
        if ((t.role ?? "").toLowerCase() !== "link")
            return null;
        const name = t.name ?? "";
        if (name.length <= 80)
            return null;
        if (/\b(View|View order|Track|Open|Read more|Inspect|Source|Details|Continue)\b/i.test(name))
            return null;
        return { name };
    }
    /**
     * Parse and validate tool calls from Brotto inference
     *
     * Per ARCHITECTURE.md section 3.2:
     * - Parse Brotto tool calls
     * - Validate all model arguments
     * - Reject dangerous actions
     */
    parse(toolCalls) {
        const actions = [];
        const errors = [];
        for (const toolCall of toolCalls) {
            const result = this.parseSingle(toolCall);
            if (result.action) {
                actions.push(result.action);
            }
            else if (result.error) {
                errors.push(result.error);
            }
        }
        return { actions, errors };
    }
    /**
     * Parse a single tool call
     */
    parseSingle(toolCall) {
        const { name, arguments: args } = toolCall;
        // Check for blocked tools
        if (BLOCKED_TOOL_NAMES.has(name.toLowerCase())) {
            return {
                error: {
                    toolCall,
                    error: `Tool '${name}' is not available. This type of action is not permitted for security reasons.`,
                    code: ParseErrorCode.BLOCKED_TOOL,
                },
            };
        }
        // Map tool name to action type
        const actionType = TOOL_NAME_TO_ACTION_TYPE[name.toLowerCase()];
        if (!actionType) {
            return {
                error: {
                    toolCall,
                    error: `Unknown tool '${name}'. Available tools are: ${Object.keys(TOOL_NAME_TO_ACTION_TYPE).join(', ')}`,
                    code: ParseErrorCode.UNKNOWN_TOOL,
                },
            };
        }
        // Build action arguments
        const actionArgs = this.buildActionArgs(actionType, args, toolCall);
        if (isParseError(actionArgs)) {
            return { error: actionArgs };
        }
        // Validate URL if required
        if (actionArgs.type === ActionType.VISIT_URL) {
            const urlValidation = this.validateUrl(actionArgs.url, toolCall);
            if (urlValidation.error) {
                return { error: urlValidation.error };
            }
        }
        // Validate arguments against schema
        const validationResult = tryValidateActionArgs(actionArgs);
        if (!validationResult) {
            try {
                validateActionArgs(actionArgs);
            }
            catch (e) {
                return {
                    error: {
                        toolCall,
                        error: `Invalid arguments: ${e.message}`,
                        code: ParseErrorCode.INVALID_ARGUMENTS,
                    },
                };
            }
        }
        // Validate coordinates if required
        const warnings = [];
        if (COORDINATE_REQUIRING_ACTIONS.has(actionType) && this.coordinateBounds) {
            const coordValidation = this.validateCoordinates(actionArgs, toolCall);
            if (coordValidation.error) {
                return { error: coordValidation.error };
            }
            if (coordValidation.warning) {
                warnings.push(coordValidation.warning);
            }
        }
        // Create the Brotto action object
        const action = this.createFaraAction(actionArgs);
        return {
            action: {
                action,
                validationWarnings: warnings,
                rawToolCall: toolCall,
            },
        };
    }
    /**
     * Build action arguments from tool call args
     */
    buildActionArgs(actionType, args, toolCall) {
        const baseArgs = {
            id: this.generateActionId(),
            observationId: this.currentObservationId ?? 0,
            timestamp: Date.now(),
            // ponytail: per-step reasoning. Model is told to always provide it; we
            // coerce to string and fall back to "" if missing so old prompts parse.
            reasoning: typeof args.reasoning === "string" ? args.reasoning : "",
            // ponytail: clientText is the user-facing one-line update. Optional —
            // omitted when the model is on an older prompt. The sidepanel falls
            // back to reasoning when clientText is missing so old outputs still
            // render cleanly.
            clientText: typeof args.clientText === "string" ? args.clientText : undefined,
        };
        switch (actionType) {
            case ActionType.LEFT_CLICK:
            case ActionType.DOUBLE_CLICK:
            case ActionType.RIGHT_CLICK:
            case ActionType.MOUSE_MOVE: {
                // ponytail: resolve click coordinates. The model passes either
                // targetId (preferred — element id from INTERACTIVE ELEMENTS) or
                // raw x/y. Try targetId lookup first; fall back to x/y when the
                // element isn't in the observation (canvas, drawn content, etc.).
                //
                // Fidelity check: when the model supplies BOTH targetId AND x/y,
                // verify the model's x/y lies inside the resolved bbox. If not,
                // the targetId is stale or the model miscomputed — emit STALE_TARGET
                // so the planner injects a corrective forcing re-snapshot. Mirrors
                // verifyTargetFidelity in the extension's canonical pipeline.
                const targetId = typeof args.targetId === "string" ? args.targetId.trim() : "";
                const resolved = targetId ? this.resolveTargetId(targetId) : null;
                const hasModelX = typeof args.x === "number";
                const hasModelY = typeof args.y === "number";
                // ponytail: specific error message when targetId is provided but
                // the harness couldn't resolve it AND the model didn't include x/y
                // as fallback. The previous logic called `numberArg` first which
                // throws a generic "missing field: x" — that didn't tell the
                // model to either pick a different targetId from INTERACTIVE
                // ELEMENTS or include x/y. Now: emit the specific corrective.
                if (targetId && !resolved && !hasModelX && !hasModelY) {
                    return {
                        toolCall,
                        error: `${actionType}: targetId "${targetId}" is not in the current INTERACTIVE ELEMENTS. The harness could not find an element with that ID in the latest observation. Either pass x/y coordinates matching the element's location, or pick a different targetId from the latest INTERACTIVE ELEMENTS block.`,
                        code: ParseErrorCode.MISSING_REQUIRED_FIELD,
                    };
                }
                if (!targetId && !hasModelX && !hasModelY) {
                    return {
                        toolCall,
                        error: `${actionType} requires either targetId (from INTERACTIVE ELEMENTS) OR x/y coordinates.`,
                        code: ParseErrorCode.MISSING_REQUIRED_FIELD,
                    };
                }
                if (resolved && hasModelX && hasModelY) {
                    const b = resolved.bbox;
                    const modelX = args.x;
                    const modelY = args.y;
                    if (modelX < b.x || modelX > b.x + b.width || modelY < b.y || modelY > b.y + b.height) {
                        return {
                            toolCall,
                            error: `${actionType}: targetId "${targetId}" resolved to bbox (${b.x}, ${b.y}, ${b.width}x${b.height}) but the model's x/y (${modelX}, ${modelY}) fall outside it. The page may have re-rendered. Re-snapshot the page (targetId + bbox) and re-issue the click using only the targetId, or pass x/y that match the current bbox.`,
                            code: ParseErrorCode.STALE_TARGET,
                        };
                    }
                }
                // ponytail: row-container rejection. Gmail / Outlook / GitHub list
                // views often have role="link" on the OUTER row div, but the actual
                // click handler is on an INNER element (subject, View order, Track).
                // Clicking the row container dispatches but doesn't navigate. Detect
                // this generic pattern (div + role=link + long name + no action verb)
                // and reject the action with a corrective telling the model to pick
                // an inner link instead. Generic — no vendor names.
                if (resolved) {
                    const containerCheck = this.isRowContainer(resolved);
                    if (containerCheck) {
                        return {
                            toolCall,
                            error: `${actionType}: targetId "${targetId}" is a row container, not a navigable link. Row containers in email / list views have role="link" but no click handler — clicking them dispatches but doesn't navigate. Find an INNER element of this row that IS navigable: a "View order" / "Track package" / "View" / "Open" / "Subject" link or button. The rendered INTERACTIVE ELEMENTS block lists these as separate elements (different targetId) at coordinates adjacent to the container. Pick one of those instead. The container's name was: "${(containerCheck.name ?? "").slice(0, 80)}".`,
                            code: ParseErrorCode.STALE_TARGET,
                        };
                    }
                }
                const finalX = resolved?.x ?? this.numberArg(args.x, "x", toolCall);
                const finalY = resolved?.y ?? this.numberArg(args.y, "y", toolCall);
                return {
                    ...baseArgs,
                    type: actionType,
                    coordinates: {
                        x: finalX,
                        y: finalY,
                    },
                    viewport: {
                        viewportWidth: this.numberArg(args.viewportWidth || args.viewport_width, 'viewportWidth', toolCall, 1920),
                        viewportHeight: this.numberArg(args.viewportHeight || args.viewport_height, 'viewportHeight', toolCall, 1080),
                    },
                };
            }
            case ActionType.DRAG:
                return {
                    ...baseArgs,
                    type: ActionType.DRAG,
                    coordinates: {
                        start: {
                            x: this.numberArg(args.startX || args.start_x, 'startX', toolCall),
                            y: this.numberArg(args.startY || args.start_y, 'startY', toolCall),
                        },
                        end: {
                            x: this.numberArg(args.endX || args.end_x, 'endX', toolCall),
                            y: this.numberArg(args.endY || args.end_y, 'endY', toolCall),
                        },
                    },
                    viewport: {
                        viewportWidth: this.numberArg(args.viewportWidth || 1920, 'viewportWidth', toolCall, 1920),
                        viewportHeight: this.numberArg(args.viewportHeight || 1080, 'viewportHeight', toolCall, 1080),
                    },
                };
            case ActionType.SCROLL:
                // ponytail: x/y are optional on scroll — the harness scrolls at
                // the viewport center when the model omits them. The previous
                // implementation required both fields and threw "Missing
                // required field: x" on legitimate scroll calls like
                // {deltaX:0, deltaY:-300, reasoning:"..."}. Defaults: x/y → 0
                // (center); deltaX → 0; deltaY → 100 (small downward nudge).
                return {
                    ...baseArgs,
                    type: ActionType.SCROLL,
                    coordinates: {
                        x: this.numberArg(args.x, 'x', toolCall, 0),
                        y: this.numberArg(args.y, 'y', toolCall, 0),
                    },
                    delta: {
                        deltaX: this.numberArg(args.deltaX ?? args.delta_x, 'deltaX', toolCall, 0),
                        deltaY: this.numberArg(args.deltaY ?? args.delta_y, 'deltaY', toolCall, 100),
                    },
                    viewport: {
                        viewportWidth: this.numberArg(args.viewportWidth ?? args.viewport_width, 'viewportWidth', toolCall, 1920),
                        viewportHeight: this.numberArg(args.viewportHeight ?? args.viewport_height, 'viewportHeight', toolCall, 1080),
                    },
                };
            case ActionType.KEY:
                return {
                    ...baseArgs,
                    type: ActionType.KEY,
                    key: this.stringArg(args.key, 'key', toolCall),
                    modifiers: args.modifiers,
                };
            case ActionType.INSERT_TEXT:
                return {
                    ...baseArgs,
                    type: ActionType.INSERT_TEXT,
                    text: this.stringArg(args.text, 'text', toolCall),
                };
            case ActionType.MEMORIZE_FACT:
                return {
                    ...baseArgs,
                    type: ActionType.MEMORIZE_FACT,
                    fact: this.stringArg(args.fact, 'fact', toolCall),
                    category: args.category ? this.stringArg(args.category, 'category', toolCall) : undefined,
                };
            case ActionType.VISIT_URL:
                return {
                    ...baseArgs,
                    type: ActionType.VISIT_URL,
                    url: this.stringArg(args.url, 'url', toolCall),
                    timeout: args.timeout ? this.numberArg(args.timeout, 'timeout', toolCall) : undefined,
                };
            case ActionType.HISTORY_BACK:
                return {
                    ...baseArgs,
                    type: ActionType.HISTORY_BACK,
                    steps: args.steps ? this.numberArg(args.steps, 'steps', toolCall) : undefined,
                };
            case ActionType.SCREENSHOT:
                return {
                    ...baseArgs,
                    type: ActionType.SCREENSHOT,
                    fullPage: args.fullPage,
                };
            case ActionType.WAIT:
                return {
                    ...baseArgs,
                    type: ActionType.WAIT,
                    durationMs: this.numberArg(args.durationMs, 'durationMs', toolCall, 1000),
                };
            case ActionType.ASK_USER_QUESTION:
                return {
                    ...baseArgs,
                    type: ActionType.ASK_USER_QUESTION,
                    question: this.stringArg(args.question, 'question', toolCall),
                    context: args.context,
                    choices: args.choices,
                };
            case ActionType.TERMINATE:
                return {
                    ...baseArgs,
                    type: ActionType.TERMINATE,
                    // ponytail: accept either `finalAnswer` (new) or `answer` (legacy
                    // demo-server / local-driver). The planner now emits finalAnswer
                    // but we don't want to break old prompts that still say `answer`.
                    finalAnswer: args.finalAnswer ?? args.answer,
                };
            case ActionType.PAUSE_AND_MEMORIZE_FACT:
                return {
                    ...baseArgs,
                    type: ActionType.PAUSE_AND_MEMORIZE_FACT,
                    fact: this.stringArg(args.fact, 'fact', toolCall),
                    category: args.category,
                };
            // ponytail: long-horizon tools. Both pass through the parser — the
            // orchestrator handles them via getActionExecutionType() → ORCHESTRATOR_HANDLED.
            case ActionType.READ_SCRATCHPAD:
                return {
                    ...baseArgs,
                    type: ActionType.READ_SCRATCHPAD,
                };
            case ActionType.VERIFY_COMPLETION:
                return {
                    ...baseArgs,
                    type: ActionType.VERIFY_COMPLETION,
                    criterionId: this.stringArg(args.criterionId, 'criterionId', toolCall),
                    satisfied: typeof args.satisfied === "boolean" ? args.satisfied : false,
                    evidence: this.stringArg(args.evidence, 'evidence', toolCall),
                };
            default:
                return {
                    toolCall,
                    error: `Unhandled action type: ${actionType}`,
                    code: ParseErrorCode.UNKNOWN_TOOL,
                };
        }
    }
    /**
     * Get a string argument
     */
    stringArg(value, fieldName, toolCall) {
        if (typeof value !== 'string' || value.length === 0) {
            throw {
                toolCall,
                error: `Missing or invalid required field: ${fieldName}`,
                code: ParseErrorCode.MISSING_REQUIRED_FIELD,
            };
        }
        return value;
    }
    /**
     * Get a number argument
     */
    numberArg(value, fieldName, toolCall, defaultValue) {
        if (value === undefined && defaultValue !== undefined) {
            return defaultValue;
        }
        if (typeof value !== 'number' || isNaN(value)) {
            throw {
                toolCall,
                error: `Missing or invalid required field: ${fieldName} (expected number)`,
                code: ParseErrorCode.MISSING_REQUIRED_FIELD,
            };
        }
        return value;
    }
    /**
     * Validate coordinates are within bounds
     */
    validateCoordinates(args, toolCall) {
        if (!this.coordinateBounds) {
            return {};
        }
        const { width, height } = this.coordinateBounds;
        switch (args.type) {
            case ActionType.LEFT_CLICK:
            case ActionType.DOUBLE_CLICK:
            case ActionType.RIGHT_CLICK:
            case ActionType.MOUSE_MOVE:
                if (!validateCoordinatesInBounds(args.coordinates.x, args.coordinates.y, width, height)) {
                    return {
                        error: {
                            toolCall,
                            error: `Coordinates (${args.coordinates.x}, ${args.coordinates.y}) are out of bounds for viewport ${width}x${height}`,
                            code: ParseErrorCode.COORDINATES_OUT_OF_BOUNDS,
                        },
                    };
                }
                break;
            case ActionType.DRAG:
                if (!validateCoordinatesInBounds(args.coordinates.start.x, args.coordinates.start.y, width, height)) {
                    return {
                        error: {
                            toolCall,
                            error: `Start coordinates out of bounds`,
                            code: ParseErrorCode.COORDINATES_OUT_OF_BOUNDS,
                        },
                    };
                }
                if (!validateCoordinatesInBounds(args.coordinates.end.x, args.coordinates.end.y, width, height)) {
                    return {
                        error: {
                            toolCall,
                            error: `End coordinates out of bounds`,
                            code: ParseErrorCode.COORDINATES_OUT_OF_BOUNDS,
                        },
                    };
                }
                break;
            case ActionType.SCROLL:
                // Scroll coordinates don't strictly need to be in bounds
                break;
        }
        return {};
    }
    /**
     * Validate URL
     */
    validateUrl(url, toolCall) {
        if (!URL_REGEX.test(url)) {
            return {
                error: {
                    toolCall,
                    error: `Invalid URL format: ${url}. Only http and https URLs are allowed.`,
                    code: ParseErrorCode.INVALID_URL,
                },
            };
        }
        // Check for dangerous URL schemes
        const dangerousSchemes = ['javascript:', 'data:', 'file:', 'ftp:'];
        for (const scheme of dangerousSchemes) {
            if (url.toLowerCase().startsWith(scheme)) {
                return {
                    error: {
                        toolCall,
                        error: `URL scheme '${scheme}' is not permitted for security reasons.`,
                        code: ParseErrorCode.INVALID_URL,
                    },
                };
            }
        }
        return {};
    }
    /**
     * Create Brotto action from validated args
     */
    createFaraAction(args) {
        // This is a simplified version - in practice we'd use the schema to create proper typed objects
        return args;
    }
    /**
     * Generate a unique action ID
     */
    generateActionId() {
        return `act_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    /**
     * Check if a tool name is blocked
     */
    isBlockedTool(toolName) {
        return BLOCKED_TOOL_NAMES.has(toolName.toLowerCase());
    }
    /**
     * Get list of available tool names
     */
    getAvailableTools() {
        return Object.keys(TOOL_NAME_TO_ACTION_TYPE);
    }
}
/**
 * Create a default parser instance
 */
export function createToolCallParser() {
    return new ToolCallParser();
}
//# sourceMappingURL=parser.js.map