import { z } from 'zod';
import { type AgentMessageV1 } from './messages.js';
export declare const AgentEnvelopeV1Schema: z.ZodEffects<z.ZodObject<{
    protocolVersion: z.ZodLiteral<"1.0">;
    messageId: z.ZodBranded<z.ZodString, "MessageId">;
    sessionId: z.ZodBranded<z.ZodString, "SessionId">;
    correlationId: z.ZodString;
    causationId: z.ZodString;
    recipientId: z.ZodString;
    tenantId: z.ZodOptional<z.ZodString>;
    deviceId: z.ZodOptional<z.ZodString>;
    sequence: z.ZodNumber;
    createdAt: z.ZodString;
    expiresAt: z.ZodNumber;
    payload: z.ZodEffects<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"session.open">;
        client: z.ZodEnum<["browser_extension", "desktop_connector", "orchestrator"]>;
        goal: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "session.open";
        client: "browser_extension" | "desktop_connector" | "orchestrator";
        goal: string;
    }, {
        type: "session.open";
        client: "browser_extension" | "desktop_connector" | "orchestrator";
        goal: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"session.accepted">;
        acceptedAt: z.ZodString;
        nextSequence: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        type: "session.accepted";
        acceptedAt: string;
        nextSequence: number;
    }, {
        type: "session.accepted";
        acceptedAt: string;
        nextSequence: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"observation.submitted">;
        observation: z.ZodEffects<z.ZodObject<{
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            capturedAt: z.ZodString;
            url: z.ZodEffects<z.ZodString, string, string>;
            title: z.ZodString;
            screenshot: z.ZodEffects<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                kind: z.ZodLiteral<"inline">;
                encoding: z.ZodEnum<["base64", "png", "jpeg", "webp"]>;
                data: z.ZodString;
                sha256: z.ZodString;
                width: z.ZodNumber;
                height: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                kind: "inline";
                encoding: "base64" | "png" | "jpeg" | "webp";
                data: string;
                sha256: string;
                width: number;
                height: number;
            }, {
                kind: "inline";
                encoding: "base64" | "png" | "jpeg" | "webp";
                data: string;
                sha256: string;
                width: number;
                height: number;
            }>, z.ZodObject<{
                kind: z.ZodLiteral<"artifact">;
                artifactId: z.ZodBranded<z.ZodString, "ArtifactId">;
                sha256: z.ZodString;
                width: z.ZodNumber;
                height: z.ZodNumber;
                encoding: z.ZodEnum<["png", "jpeg", "webp"]>;
            }, "strict", z.ZodTypeAny, {
                kind: "artifact";
                encoding: "png" | "jpeg" | "webp";
                sha256: string;
                width: number;
                height: number;
                artifactId: string & z.BRAND<"ArtifactId">;
            }, {
                kind: "artifact";
                encoding: "png" | "jpeg" | "webp";
                sha256: string;
                width: number;
                height: number;
                artifactId: string;
            }>]>, any, any>;
            viewport: z.ZodObject<{
                width: z.ZodNumber;
                height: z.ZodNumber;
                devicePixelRatio: z.ZodNumber;
                zoom: z.ZodNumber;
                scrollX: z.ZodNumber;
                scrollY: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                width: number;
                height: number;
                devicePixelRatio: number;
                zoom: number;
                scrollX: number;
                scrollY: number;
            }, {
                width: number;
                height: number;
                devicePixelRatio: number;
                zoom: number;
                scrollX: number;
                scrollY: number;
            }>;
            page: z.ZodObject<{
                tabId: z.ZodBranded<z.ZodString, "TabId">;
                frameId: z.ZodBranded<z.ZodString, "FrameId">;
                lifecycle: z.ZodEnum<["loading", "interactive", "complete", "frozen"]>;
                visibility: z.ZodEnum<["visible", "hidden", "prerender"]>;
            }, "strict", z.ZodTypeAny, {
                tabId: string & z.BRAND<"TabId">;
                frameId: string & z.BRAND<"FrameId">;
                lifecycle: "loading" | "interactive" | "complete" | "frozen";
                visibility: "visible" | "hidden" | "prerender";
            }, {
                tabId: string;
                frameId: string;
                lifecycle: "loading" | "interactive" | "complete" | "frozen";
                visibility: "visible" | "hidden" | "prerender";
            }>;
            semanticTargets: z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                stableRef: z.ZodOptional<z.ZodString>;
                tag: z.ZodString;
                role: z.ZodOptional<z.ZodString>;
                accessibleName: z.ZodOptional<z.ZodObject<{
                    source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                    text: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }>>;
                attributes: z.ZodOptional<z.ZodObject<{
                    "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }>>;
                control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"non_input">;
                }, "strict", z.ZodTypeAny, {
                    kind: "non_input";
                }, {
                    kind: "non_input";
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"input">;
                    inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }>]>;
                boundingBox: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }>;
                visible: z.ZodBoolean;
                framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"role_name">;
                    role: z.ZodEffects<z.ZodString, string, string>;
                    name: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"label">;
                    label: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"test_id">;
                    testId: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    kind: "test_id";
                    testId: string;
                }, {
                    kind: "test_id";
                    testId: string;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"safe_attribute">;
                    attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                    value: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }>]>, "many">;
            }, "strict", z.ZodTypeAny, {
                visible: boolean;
                targetId: string & z.BRAND<"SemanticTargetId">;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
            }, {
                visible: boolean;
                targetId: string;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: string[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: string[] | undefined;
            }>, any, any>, any, any>, "many">;
            accessibilityNodes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                axNodeId: z.ZodString;
                role: z.ZodString;
                name: z.ZodOptional<z.ZodString>;
                description: z.ZodOptional<z.ZodString>;
                value: z.ZodOptional<z.ZodString>;
                attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                bounds: z.ZodOptional<z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }>>;
                axPath: z.ZodArray<z.ZodObject<{
                    role: z.ZodString;
                    index: z.ZodNumber;
                    name: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    role: string;
                    index: number;
                    name?: string | undefined;
                }, {
                    role: string;
                    index: number;
                    name?: string | undefined;
                }>, "many">;
                attributeHash: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                role: string;
                axNodeId: string;
                axPath: {
                    role: string;
                    index: number;
                    name?: string | undefined;
                }[];
                attributeHash: string;
                value?: string | undefined;
                name?: string | undefined;
                attributes?: Record<string, string> | undefined;
                description?: string | undefined;
                bounds?: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                } | undefined;
            }, {
                role: string;
                axNodeId: string;
                axPath: {
                    role: string;
                    index: number;
                    name?: string | undefined;
                }[];
                attributeHash: string;
                value?: string | undefined;
                name?: string | undefined;
                attributes?: Record<string, string> | undefined;
                description?: string | undefined;
                bounds?: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                } | undefined;
            }>, "many">>;
        }, "strict", z.ZodTypeAny, {
            page: {
                tabId: string & z.BRAND<"TabId">;
                frameId: string & z.BRAND<"FrameId">;
                lifecycle: "loading" | "interactive" | "complete" | "frozen";
                visibility: "visible" | "hidden" | "prerender";
            };
            url: string;
            observationId: string & z.BRAND<"ObservationId">;
            capturedAt: string;
            title: string;
            viewport: {
                width: number;
                height: number;
                devicePixelRatio: number;
                zoom: number;
                scrollX: number;
                scrollY: number;
            };
            semanticTargets: any[];
            screenshot?: any;
            accessibilityNodes?: {
                role: string;
                axNodeId: string;
                axPath: {
                    role: string;
                    index: number;
                    name?: string | undefined;
                }[];
                attributeHash: string;
                value?: string | undefined;
                name?: string | undefined;
                attributes?: Record<string, string> | undefined;
                description?: string | undefined;
                bounds?: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                } | undefined;
            }[] | undefined;
        }, {
            page: {
                tabId: string;
                frameId: string;
                lifecycle: "loading" | "interactive" | "complete" | "frozen";
                visibility: "visible" | "hidden" | "prerender";
            };
            url: string;
            observationId: string;
            capturedAt: string;
            title: string;
            viewport: {
                width: number;
                height: number;
                devicePixelRatio: number;
                zoom: number;
                scrollX: number;
                scrollY: number;
            };
            semanticTargets: any[];
            screenshot?: any;
            accessibilityNodes?: {
                role: string;
                axNodeId: string;
                axPath: {
                    role: string;
                    index: number;
                    name?: string | undefined;
                }[];
                attributeHash: string;
                value?: string | undefined;
                name?: string | undefined;
                attributes?: Record<string, string> | undefined;
                description?: string | undefined;
                bounds?: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                } | undefined;
            }[] | undefined;
        }>, any, any>;
    }, "strict", z.ZodTypeAny, {
        type: "observation.submitted";
        observation?: any;
    }, {
        type: "observation.submitted";
        observation?: any;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"action.command">;
        proposal: z.ZodEffects<z.ZodObject<{
            kind: z.ZodLiteral<"action">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            proposedAt: z.ZodString;
            action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"left_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
            }, "strict", z.ZodTypeAny, {
                type: "left_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            }, {
                type: "left_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"double_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
            }, "strict", z.ZodTypeAny, {
                type: "double_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            }, {
                type: "double_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"right_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
            }, "strict", z.ZodTypeAny, {
                type: "right_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            }, {
                type: "right_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"drag">;
                startX: z.ZodNumber;
                startY: z.ZodNumber;
                endX: z.ZodNumber;
                endY: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                type: "drag";
                startX: number;
                startY: number;
                endX: number;
                endY: number;
            }, {
                type: "drag";
                startX: number;
                startY: number;
                endX: number;
                endY: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"mouse_move">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                type: "mouse_move";
                x: number;
                y: number;
            }, {
                type: "mouse_move";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"scroll">;
                deltaX: z.ZodNumber;
                deltaY: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                type: "scroll";
                deltaX: number;
                deltaY: number;
            }, {
                type: "scroll";
                deltaX: number;
                deltaY: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"key">;
                key: z.ZodString;
                modifiers: z.ZodOptional<z.ZodObject<{
                    ctrl: z.ZodOptional<z.ZodBoolean>;
                    shift: z.ZodOptional<z.ZodBoolean>;
                    alt: z.ZodOptional<z.ZodBoolean>;
                    meta: z.ZodOptional<z.ZodBoolean>;
                }, "strict", z.ZodTypeAny, {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                }, {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                }>>;
            }, "strict", z.ZodTypeAny, {
                type: "key";
                key: string;
                modifiers?: {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                } | undefined;
            }, {
                type: "key";
                key: string;
                modifiers?: {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                } | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"insert_text">;
                text: z.ZodString;
                targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
            }, "strict", z.ZodTypeAny, {
                type: "insert_text";
                text: string;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            }, {
                type: "insert_text";
                text: string;
                targetId?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"visit_url">;
                url: z.ZodEffects<z.ZodString, string, string>;
            }, "strict", z.ZodTypeAny, {
                type: "visit_url";
                url: string;
            }, {
                type: "visit_url";
                url: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"history_back">;
                steps: z.ZodDefault<z.ZodNumber>;
            }, "strict", z.ZodTypeAny, {
                type: "history_back";
                steps: number;
            }, {
                type: "history_back";
                steps?: number | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"wait">;
                durationMs: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                type: "wait";
                durationMs: number;
            }, {
                type: "wait";
                durationMs: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"ask_user_question">;
                question: z.ZodString;
                choices: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            }, "strict", z.ZodTypeAny, {
                type: "ask_user_question";
                question: string;
                choices?: string[] | undefined;
            }, {
                type: "ask_user_question";
                question: string;
                choices?: string[] | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"memorize_fact">;
                fact: z.ZodString;
                category: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                type: "memorize_fact";
                fact: string;
                category?: string | undefined;
            }, {
                type: "memorize_fact";
                fact: string;
                category?: string | undefined;
            }>]>;
        }, "strict", z.ZodTypeAny, {
            kind: "action";
            observationId: string & z.BRAND<"ObservationId">;
            action: {
                type: "left_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            } | {
                type: "double_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            } | {
                type: "right_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            } | {
                type: "drag";
                startX: number;
                startY: number;
                endX: number;
                endY: number;
            } | {
                type: "mouse_move";
                x: number;
                y: number;
            } | {
                type: "scroll";
                deltaX: number;
                deltaY: number;
            } | {
                type: "key";
                key: string;
                modifiers?: {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                } | undefined;
            } | {
                type: "insert_text";
                text: string;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            } | {
                type: "visit_url";
                url: string;
            } | {
                type: "history_back";
                steps: number;
            } | {
                type: "wait";
                durationMs: number;
            } | {
                type: "ask_user_question";
                question: string;
                choices?: string[] | undefined;
            } | {
                type: "memorize_fact";
                fact: string;
                category?: string | undefined;
            };
            proposedAt: string;
        }, {
            kind: "action";
            observationId: string;
            action: {
                type: "left_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            } | {
                type: "double_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            } | {
                type: "right_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            } | {
                type: "drag";
                startX: number;
                startY: number;
                endX: number;
                endY: number;
            } | {
                type: "mouse_move";
                x: number;
                y: number;
            } | {
                type: "scroll";
                deltaX: number;
                deltaY: number;
            } | {
                type: "key";
                key: string;
                modifiers?: {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                } | undefined;
            } | {
                type: "insert_text";
                text: string;
                targetId?: string | undefined;
            } | {
                type: "visit_url";
                url: string;
            } | {
                type: "history_back";
                steps?: number | undefined;
            } | {
                type: "wait";
                durationMs: number;
            } | {
                type: "ask_user_question";
                question: string;
                choices?: string[] | undefined;
            } | {
                type: "memorize_fact";
                fact: string;
                category?: string | undefined;
            };
            proposedAt: string;
        }>, {
            [x: string]: any;
        }, {
            [x: string]: any;
        }>;
        policyDecision: z.ZodEffects<z.ZodObject<{
            policyDecisionId: z.ZodBranded<z.ZodString, "PolicyDecisionId">;
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            decision: z.ZodEnum<["allowed", "denied", "approval_required"]>;
            decidedAt: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            observationId: string & z.BRAND<"ObservationId">;
            policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
            actionId: string & z.BRAND<"ActionId">;
            decision: "allowed" | "denied" | "approval_required";
            decidedAt: string;
        }, {
            observationId: string;
            policyDecisionId: string;
            actionId: string;
            decision: "allowed" | "denied" | "approval_required";
            decidedAt: string;
        }>, {
            [x: string]: any;
        }, {
            [x: string]: any;
        }>;
        command: z.ZodEffects<z.ZodObject<{
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            stepId: z.ZodBranded<z.ZodString, "StepId">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            sequence: z.ZodNumber;
            action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"left_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
            }, "strict", z.ZodTypeAny, {
                type: "left_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            }, {
                type: "left_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"double_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
            }, "strict", z.ZodTypeAny, {
                type: "double_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            }, {
                type: "double_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"right_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
            }, "strict", z.ZodTypeAny, {
                type: "right_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            }, {
                type: "right_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"drag">;
                startX: z.ZodNumber;
                startY: z.ZodNumber;
                endX: z.ZodNumber;
                endY: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                type: "drag";
                startX: number;
                startY: number;
                endX: number;
                endY: number;
            }, {
                type: "drag";
                startX: number;
                startY: number;
                endX: number;
                endY: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"mouse_move">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                type: "mouse_move";
                x: number;
                y: number;
            }, {
                type: "mouse_move";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"scroll">;
                deltaX: z.ZodNumber;
                deltaY: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                type: "scroll";
                deltaX: number;
                deltaY: number;
            }, {
                type: "scroll";
                deltaX: number;
                deltaY: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"key">;
                key: z.ZodString;
                modifiers: z.ZodOptional<z.ZodObject<{
                    ctrl: z.ZodOptional<z.ZodBoolean>;
                    shift: z.ZodOptional<z.ZodBoolean>;
                    alt: z.ZodOptional<z.ZodBoolean>;
                    meta: z.ZodOptional<z.ZodBoolean>;
                }, "strict", z.ZodTypeAny, {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                }, {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                }>>;
            }, "strict", z.ZodTypeAny, {
                type: "key";
                key: string;
                modifiers?: {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                } | undefined;
            }, {
                type: "key";
                key: string;
                modifiers?: {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                } | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"insert_text">;
                text: z.ZodString;
                targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
            }, "strict", z.ZodTypeAny, {
                type: "insert_text";
                text: string;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            }, {
                type: "insert_text";
                text: string;
                targetId?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"visit_url">;
                url: z.ZodEffects<z.ZodString, string, string>;
            }, "strict", z.ZodTypeAny, {
                type: "visit_url";
                url: string;
            }, {
                type: "visit_url";
                url: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"history_back">;
                steps: z.ZodDefault<z.ZodNumber>;
            }, "strict", z.ZodTypeAny, {
                type: "history_back";
                steps: number;
            }, {
                type: "history_back";
                steps?: number | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"wait">;
                durationMs: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                type: "wait";
                durationMs: number;
            }, {
                type: "wait";
                durationMs: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"ask_user_question">;
                question: z.ZodString;
                choices: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            }, "strict", z.ZodTypeAny, {
                type: "ask_user_question";
                question: string;
                choices?: string[] | undefined;
            }, {
                type: "ask_user_question";
                question: string;
                choices?: string[] | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"memorize_fact">;
                fact: z.ZodString;
                category: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                type: "memorize_fact";
                fact: string;
                category?: string | undefined;
            }, {
                type: "memorize_fact";
                fact: string;
                category?: string | undefined;
            }>]>;
            policyContext: z.ZodObject<{
                policyDecisionId: z.ZodBranded<z.ZodString, "PolicyDecisionId">;
                policyVersion: z.ZodString;
                approved: z.ZodBoolean;
                approvalId: z.ZodOptional<z.ZodBranded<z.ZodString, "ApprovalId">>;
            }, "strict", z.ZodTypeAny, {
                policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
                policyVersion: string;
                approved: boolean;
                approvalId?: (string & z.BRAND<"ApprovalId">) | undefined;
            }, {
                policyDecisionId: string;
                policyVersion: string;
                approved: boolean;
                approvalId?: string | undefined;
            }>;
            dispatchedAt: z.ZodString;
            expiresAt: z.ZodString;
            idempotencyKey: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            observationId: string & z.BRAND<"ObservationId">;
            action: {
                type: "left_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            } | {
                type: "double_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            } | {
                type: "right_click";
                x: number;
                y: number;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            } | {
                type: "drag";
                startX: number;
                startY: number;
                endX: number;
                endY: number;
            } | {
                type: "mouse_move";
                x: number;
                y: number;
            } | {
                type: "scroll";
                deltaX: number;
                deltaY: number;
            } | {
                type: "key";
                key: string;
                modifiers?: {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                } | undefined;
            } | {
                type: "insert_text";
                text: string;
                targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
            } | {
                type: "visit_url";
                url: string;
            } | {
                type: "history_back";
                steps: number;
            } | {
                type: "wait";
                durationMs: number;
            } | {
                type: "ask_user_question";
                question: string;
                choices?: string[] | undefined;
            } | {
                type: "memorize_fact";
                fact: string;
                category?: string | undefined;
            };
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            policyContext: {
                policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
                policyVersion: string;
                approved: boolean;
                approvalId?: (string & z.BRAND<"ApprovalId">) | undefined;
            };
            dispatchedAt: string;
            expiresAt: string;
            idempotencyKey: string;
        }, {
            observationId: string;
            action: {
                type: "left_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            } | {
                type: "double_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            } | {
                type: "right_click";
                x: number;
                y: number;
                targetId?: string | undefined;
            } | {
                type: "drag";
                startX: number;
                startY: number;
                endX: number;
                endY: number;
            } | {
                type: "mouse_move";
                x: number;
                y: number;
            } | {
                type: "scroll";
                deltaX: number;
                deltaY: number;
            } | {
                type: "key";
                key: string;
                modifiers?: {
                    shift?: boolean | undefined;
                    ctrl?: boolean | undefined;
                    alt?: boolean | undefined;
                    meta?: boolean | undefined;
                } | undefined;
            } | {
                type: "insert_text";
                text: string;
                targetId?: string | undefined;
            } | {
                type: "visit_url";
                url: string;
            } | {
                type: "history_back";
                steps?: number | undefined;
            } | {
                type: "wait";
                durationMs: number;
            } | {
                type: "ask_user_question";
                question: string;
                choices?: string[] | undefined;
            } | {
                type: "memorize_fact";
                fact: string;
                category?: string | undefined;
            };
            actionId: string;
            stepId: string;
            sequence: number;
            policyContext: {
                policyDecisionId: string;
                policyVersion: string;
                approved: boolean;
                approvalId?: string | undefined;
            };
            dispatchedAt: string;
            expiresAt: string;
            idempotencyKey: string;
        }>, {
            [x: string]: any;
        }, {
            [x: string]: any;
        }>;
    }, "strict", z.ZodTypeAny, {
        type: "action.command";
        proposal: {
            [x: string]: any;
        };
        policyDecision: {
            [x: string]: any;
        };
        command: {
            [x: string]: any;
        };
    }, {
        type: "action.command";
        proposal: {
            [x: string]: any;
        };
        policyDecision: {
            [x: string]: any;
        };
        command: {
            [x: string]: any;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"action.acknowledged">;
        actionId: z.ZodBranded<z.ZodString, "ActionId">;
        stepId: z.ZodBranded<z.ZodString, "StepId">;
        observationId: z.ZodBranded<z.ZodString, "ObservationId">;
        acknowledgedAt: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "action.acknowledged";
        actionId: string & z.BRAND<"ActionId">;
        stepId: string & z.BRAND<"StepId">;
        observationId: string & z.BRAND<"ObservationId">;
        acknowledgedAt: string;
    }, {
        type: "action.acknowledged";
        actionId: string;
        stepId: string;
        observationId: string;
        acknowledgedAt: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"action.completed">;
        result: z.ZodEffects<z.ZodUnion<[z.ZodObject<{
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            stepId: z.ZodBranded<z.ZodString, "StepId">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            sequence: z.ZodNumber;
            startedAt: z.ZodString;
            completedAt: z.ZodString;
            durationMs: z.ZodNumber;
            target: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                stableRef: z.ZodOptional<z.ZodString>;
                tag: z.ZodString;
                role: z.ZodOptional<z.ZodString>;
                accessibleName: z.ZodOptional<z.ZodObject<{
                    source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                    text: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }>>;
                attributes: z.ZodOptional<z.ZodObject<{
                    "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }>>;
                control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"non_input">;
                }, "strict", z.ZodTypeAny, {
                    kind: "non_input";
                }, {
                    kind: "non_input";
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"input">;
                    inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }>]>;
                boundingBox: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }>;
                visible: z.ZodBoolean;
                framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"role_name">;
                    role: z.ZodEffects<z.ZodString, string, string>;
                    name: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"label">;
                    label: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"test_id">;
                    testId: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    kind: "test_id";
                    testId: string;
                }, {
                    kind: "test_id";
                    testId: string;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"safe_attribute">;
                    attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                    value: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }>]>, "many">;
            }, "strict", z.ZodTypeAny, {
                visible: boolean;
                targetId: string & z.BRAND<"SemanticTargetId">;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
            }, {
                visible: boolean;
                targetId: string;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: string[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: string[] | undefined;
            }>, any, any>, any, any>>;
            navigation: z.ZodOptional<z.ZodObject<{
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                url: string;
                title?: string | undefined;
            }, {
                url: string;
                title?: string | undefined;
            }>>;
            dialog: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["alert", "confirm", "prompt", "beforeunload"]>;
                present: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }>>;
        } & {
            status: z.ZodLiteral<"succeeded">;
            postObservation: z.ZodEffects<z.ZodObject<{
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                capturedAt: z.ZodString;
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodString;
                screenshot: z.ZodEffects<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"inline">;
                    encoding: z.ZodEnum<["base64", "png", "jpeg", "webp"]>;
                    data: z.ZodString;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"artifact">;
                    artifactId: z.ZodBranded<z.ZodString, "ArtifactId">;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    encoding: z.ZodEnum<["png", "jpeg", "webp"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string & z.BRAND<"ArtifactId">;
                }, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string;
                }>]>, any, any>;
                viewport: z.ZodObject<{
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    devicePixelRatio: z.ZodNumber;
                    zoom: z.ZodNumber;
                    scrollX: z.ZodNumber;
                    scrollY: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }>;
                page: z.ZodObject<{
                    tabId: z.ZodBranded<z.ZodString, "TabId">;
                    frameId: z.ZodBranded<z.ZodString, "FrameId">;
                    lifecycle: z.ZodEnum<["loading", "interactive", "complete", "frozen"]>;
                    visibility: z.ZodEnum<["visible", "hidden", "prerender"]>;
                }, "strict", z.ZodTypeAny, {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }, {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }>;
                semanticTargets: z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                    targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                    stableRef: z.ZodOptional<z.ZodString>;
                    tag: z.ZodString;
                    role: z.ZodOptional<z.ZodString>;
                    accessibleName: z.ZodOptional<z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>>;
                    attributes: z.ZodOptional<z.ZodObject<{
                        "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                        "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                        "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                        "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                        "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    }, "strict", z.ZodTypeAny, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }>>;
                    control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"non_input">;
                    }, "strict", z.ZodTypeAny, {
                        kind: "non_input";
                    }, {
                        kind: "non_input";
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"input">;
                        inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }>]>;
                    boundingBox: z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>;
                    visible: z.ZodBoolean;
                    framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                    shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                    locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"role_name">;
                        role: z.ZodEffects<z.ZodString, string, string>;
                        name: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"label">;
                        label: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"test_id">;
                        testId: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "test_id";
                        testId: string;
                    }, {
                        kind: "test_id";
                        testId: string;
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"safe_attribute">;
                        attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                        value: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }>]>, "many">;
                }, "strict", z.ZodTypeAny, {
                    visible: boolean;
                    targetId: string & z.BRAND<"SemanticTargetId">;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
                }, {
                    visible: boolean;
                    targetId: string;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: string[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: string[] | undefined;
                }>, any, any>, any, any>, "many">;
                accessibilityNodes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    axNodeId: z.ZodString;
                    role: z.ZodString;
                    name: z.ZodOptional<z.ZodString>;
                    description: z.ZodOptional<z.ZodString>;
                    value: z.ZodOptional<z.ZodString>;
                    attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    bounds: z.ZodOptional<z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>>;
                    axPath: z.ZodArray<z.ZodObject<{
                        role: z.ZodString;
                        index: z.ZodNumber;
                        name: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }>, "many">;
                    attributeHash: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }>, "many">>;
            }, "strict", z.ZodTypeAny, {
                page: {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string & z.BRAND<"ObservationId">;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }, {
                page: {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }>, any, any>;
        }, "strict", z.ZodTypeAny, {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }, {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }>, z.ZodObject<{
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            stepId: z.ZodBranded<z.ZodString, "StepId">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            sequence: z.ZodNumber;
            startedAt: z.ZodString;
            completedAt: z.ZodString;
            durationMs: z.ZodNumber;
            target: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                stableRef: z.ZodOptional<z.ZodString>;
                tag: z.ZodString;
                role: z.ZodOptional<z.ZodString>;
                accessibleName: z.ZodOptional<z.ZodObject<{
                    source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                    text: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }>>;
                attributes: z.ZodOptional<z.ZodObject<{
                    "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }>>;
                control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"non_input">;
                }, "strict", z.ZodTypeAny, {
                    kind: "non_input";
                }, {
                    kind: "non_input";
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"input">;
                    inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }>]>;
                boundingBox: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }>;
                visible: z.ZodBoolean;
                framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"role_name">;
                    role: z.ZodEffects<z.ZodString, string, string>;
                    name: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"label">;
                    label: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"test_id">;
                    testId: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    kind: "test_id";
                    testId: string;
                }, {
                    kind: "test_id";
                    testId: string;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"safe_attribute">;
                    attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                    value: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }>]>, "many">;
            }, "strict", z.ZodTypeAny, {
                visible: boolean;
                targetId: string & z.BRAND<"SemanticTargetId">;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
            }, {
                visible: boolean;
                targetId: string;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: string[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: string[] | undefined;
            }>, any, any>, any, any>>;
            navigation: z.ZodOptional<z.ZodObject<{
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                url: string;
                title?: string | undefined;
            }, {
                url: string;
                title?: string | undefined;
            }>>;
            dialog: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["alert", "confirm", "prompt", "beforeunload"]>;
                present: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }>>;
        } & {
            status: z.ZodEnum<["failed_recoverable", "failed_terminal"]>;
            error: z.ZodObject<{
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                code: string;
                message: string;
                retryable: boolean;
            }, {
                code: string;
                message: string;
                retryable: boolean;
            }>;
            postObservation: z.ZodEffects<z.ZodObject<{
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                capturedAt: z.ZodString;
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodString;
                screenshot: z.ZodEffects<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"inline">;
                    encoding: z.ZodEnum<["base64", "png", "jpeg", "webp"]>;
                    data: z.ZodString;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"artifact">;
                    artifactId: z.ZodBranded<z.ZodString, "ArtifactId">;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    encoding: z.ZodEnum<["png", "jpeg", "webp"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string & z.BRAND<"ArtifactId">;
                }, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string;
                }>]>, any, any>;
                viewport: z.ZodObject<{
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    devicePixelRatio: z.ZodNumber;
                    zoom: z.ZodNumber;
                    scrollX: z.ZodNumber;
                    scrollY: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }>;
                page: z.ZodObject<{
                    tabId: z.ZodBranded<z.ZodString, "TabId">;
                    frameId: z.ZodBranded<z.ZodString, "FrameId">;
                    lifecycle: z.ZodEnum<["loading", "interactive", "complete", "frozen"]>;
                    visibility: z.ZodEnum<["visible", "hidden", "prerender"]>;
                }, "strict", z.ZodTypeAny, {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }, {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }>;
                semanticTargets: z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                    targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                    stableRef: z.ZodOptional<z.ZodString>;
                    tag: z.ZodString;
                    role: z.ZodOptional<z.ZodString>;
                    accessibleName: z.ZodOptional<z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>>;
                    attributes: z.ZodOptional<z.ZodObject<{
                        "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                        "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                        "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                        "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                        "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    }, "strict", z.ZodTypeAny, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }>>;
                    control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"non_input">;
                    }, "strict", z.ZodTypeAny, {
                        kind: "non_input";
                    }, {
                        kind: "non_input";
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"input">;
                        inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }>]>;
                    boundingBox: z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>;
                    visible: z.ZodBoolean;
                    framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                    shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                    locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"role_name">;
                        role: z.ZodEffects<z.ZodString, string, string>;
                        name: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"label">;
                        label: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"test_id">;
                        testId: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "test_id";
                        testId: string;
                    }, {
                        kind: "test_id";
                        testId: string;
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"safe_attribute">;
                        attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                        value: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }>]>, "many">;
                }, "strict", z.ZodTypeAny, {
                    visible: boolean;
                    targetId: string & z.BRAND<"SemanticTargetId">;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
                }, {
                    visible: boolean;
                    targetId: string;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: string[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: string[] | undefined;
                }>, any, any>, any, any>, "many">;
                accessibilityNodes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    axNodeId: z.ZodString;
                    role: z.ZodString;
                    name: z.ZodOptional<z.ZodString>;
                    description: z.ZodOptional<z.ZodString>;
                    value: z.ZodOptional<z.ZodString>;
                    attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    bounds: z.ZodOptional<z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>>;
                    axPath: z.ZodArray<z.ZodObject<{
                        role: z.ZodString;
                        index: z.ZodNumber;
                        name: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }>, "many">;
                    attributeHash: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }>, "many">>;
            }, "strict", z.ZodTypeAny, {
                page: {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string & z.BRAND<"ObservationId">;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }, {
                page: {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }>, any, any>;
        }, "strict", z.ZodTypeAny, {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }, {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }>, z.ZodObject<{
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            stepId: z.ZodBranded<z.ZodString, "StepId">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            sequence: z.ZodNumber;
            startedAt: z.ZodString;
            completedAt: z.ZodString;
            durationMs: z.ZodNumber;
            target: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                stableRef: z.ZodOptional<z.ZodString>;
                tag: z.ZodString;
                role: z.ZodOptional<z.ZodString>;
                accessibleName: z.ZodOptional<z.ZodObject<{
                    source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                    text: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }>>;
                attributes: z.ZodOptional<z.ZodObject<{
                    "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }>>;
                control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"non_input">;
                }, "strict", z.ZodTypeAny, {
                    kind: "non_input";
                }, {
                    kind: "non_input";
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"input">;
                    inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }>]>;
                boundingBox: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }>;
                visible: z.ZodBoolean;
                framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"role_name">;
                    role: z.ZodEffects<z.ZodString, string, string>;
                    name: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"label">;
                    label: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"test_id">;
                    testId: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    kind: "test_id";
                    testId: string;
                }, {
                    kind: "test_id";
                    testId: string;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"safe_attribute">;
                    attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                    value: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }>]>, "many">;
            }, "strict", z.ZodTypeAny, {
                visible: boolean;
                targetId: string & z.BRAND<"SemanticTargetId">;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
            }, {
                visible: boolean;
                targetId: string;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: string[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: string[] | undefined;
            }>, any, any>, any, any>>;
            navigation: z.ZodOptional<z.ZodObject<{
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                url: string;
                title?: string | undefined;
            }, {
                url: string;
                title?: string | undefined;
            }>>;
            dialog: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["alert", "confirm", "prompt", "beforeunload"]>;
                present: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }>>;
        } & {
            status: z.ZodEnum<["rejected_stale", "rejected_policy", "approval_required"]>;
            rejection: z.ZodObject<{
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                code: string;
                message: string;
                retryable: boolean;
            }, {
                code: string;
                message: string;
                retryable: boolean;
            }>;
        }, "strict", z.ZodTypeAny, {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        }, {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        }>, z.ZodObject<{
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            stepId: z.ZodBranded<z.ZodString, "StepId">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            sequence: z.ZodNumber;
            startedAt: z.ZodString;
            completedAt: z.ZodString;
            durationMs: z.ZodNumber;
            target: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                stableRef: z.ZodOptional<z.ZodString>;
                tag: z.ZodString;
                role: z.ZodOptional<z.ZodString>;
                accessibleName: z.ZodOptional<z.ZodObject<{
                    source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                    text: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }>>;
                attributes: z.ZodOptional<z.ZodObject<{
                    "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }>>;
                control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"non_input">;
                }, "strict", z.ZodTypeAny, {
                    kind: "non_input";
                }, {
                    kind: "non_input";
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"input">;
                    inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }>]>;
                boundingBox: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }>;
                visible: z.ZodBoolean;
                framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"role_name">;
                    role: z.ZodEffects<z.ZodString, string, string>;
                    name: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"label">;
                    label: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"test_id">;
                    testId: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    kind: "test_id";
                    testId: string;
                }, {
                    kind: "test_id";
                    testId: string;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"safe_attribute">;
                    attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                    value: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }>]>, "many">;
            }, "strict", z.ZodTypeAny, {
                visible: boolean;
                targetId: string & z.BRAND<"SemanticTargetId">;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
            }, {
                visible: boolean;
                targetId: string;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: string[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: string[] | undefined;
            }>, any, any>, any, any>>;
            navigation: z.ZodOptional<z.ZodObject<{
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                url: string;
                title?: string | undefined;
            }, {
                url: string;
                title?: string | undefined;
            }>>;
            dialog: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["alert", "confirm", "prompt", "beforeunload"]>;
                present: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }>>;
        } & {
            status: z.ZodLiteral<"cancelled">;
            cancellation: z.ZodObject<{
                reason: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                reason?: string | undefined;
            }, {
                reason?: string | undefined;
            }>;
            postObservation: z.ZodEffects<z.ZodObject<{
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                capturedAt: z.ZodString;
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodString;
                screenshot: z.ZodEffects<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"inline">;
                    encoding: z.ZodEnum<["base64", "png", "jpeg", "webp"]>;
                    data: z.ZodString;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"artifact">;
                    artifactId: z.ZodBranded<z.ZodString, "ArtifactId">;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    encoding: z.ZodEnum<["png", "jpeg", "webp"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string & z.BRAND<"ArtifactId">;
                }, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string;
                }>]>, any, any>;
                viewport: z.ZodObject<{
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    devicePixelRatio: z.ZodNumber;
                    zoom: z.ZodNumber;
                    scrollX: z.ZodNumber;
                    scrollY: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }>;
                page: z.ZodObject<{
                    tabId: z.ZodBranded<z.ZodString, "TabId">;
                    frameId: z.ZodBranded<z.ZodString, "FrameId">;
                    lifecycle: z.ZodEnum<["loading", "interactive", "complete", "frozen"]>;
                    visibility: z.ZodEnum<["visible", "hidden", "prerender"]>;
                }, "strict", z.ZodTypeAny, {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }, {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }>;
                semanticTargets: z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                    targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                    stableRef: z.ZodOptional<z.ZodString>;
                    tag: z.ZodString;
                    role: z.ZodOptional<z.ZodString>;
                    accessibleName: z.ZodOptional<z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>>;
                    attributes: z.ZodOptional<z.ZodObject<{
                        "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                        "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                        "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                        "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                        "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    }, "strict", z.ZodTypeAny, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }>>;
                    control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"non_input">;
                    }, "strict", z.ZodTypeAny, {
                        kind: "non_input";
                    }, {
                        kind: "non_input";
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"input">;
                        inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }>]>;
                    boundingBox: z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>;
                    visible: z.ZodBoolean;
                    framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                    shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                    locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"role_name">;
                        role: z.ZodEffects<z.ZodString, string, string>;
                        name: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"label">;
                        label: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"test_id">;
                        testId: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "test_id";
                        testId: string;
                    }, {
                        kind: "test_id";
                        testId: string;
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"safe_attribute">;
                        attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                        value: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }>]>, "many">;
                }, "strict", z.ZodTypeAny, {
                    visible: boolean;
                    targetId: string & z.BRAND<"SemanticTargetId">;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
                }, {
                    visible: boolean;
                    targetId: string;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: string[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: string[] | undefined;
                }>, any, any>, any, any>, "many">;
                accessibilityNodes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    axNodeId: z.ZodString;
                    role: z.ZodString;
                    name: z.ZodOptional<z.ZodString>;
                    description: z.ZodOptional<z.ZodString>;
                    value: z.ZodOptional<z.ZodString>;
                    attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    bounds: z.ZodOptional<z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>>;
                    axPath: z.ZodArray<z.ZodObject<{
                        role: z.ZodString;
                        index: z.ZodNumber;
                        name: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }>, "many">;
                    attributeHash: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }>, "many">>;
            }, "strict", z.ZodTypeAny, {
                page: {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string & z.BRAND<"ObservationId">;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }, {
                page: {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }>, any, any>;
        }, "strict", z.ZodTypeAny, {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }, {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }>]>, {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }, {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }>;
    }, "strict", z.ZodTypeAny, {
        type: "action.completed";
        result: {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        };
    }, {
        type: "action.completed";
        result: {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"approval.requested">;
        approvalId: z.ZodBranded<z.ZodString, "ApprovalId">;
        policyDecisionId: z.ZodBranded<z.ZodString, "PolicyDecisionId">;
        actionId: z.ZodBranded<z.ZodString, "ActionId">;
        observationId: z.ZodBranded<z.ZodString, "ObservationId">;
        requestedAt: z.ZodString;
        reason: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        reason: string;
        type: "approval.requested";
        actionId: string & z.BRAND<"ActionId">;
        observationId: string & z.BRAND<"ObservationId">;
        approvalId: string & z.BRAND<"ApprovalId">;
        policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
        requestedAt: string;
    }, {
        reason: string;
        type: "approval.requested";
        actionId: string;
        observationId: string;
        approvalId: string;
        policyDecisionId: string;
        requestedAt: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"approval.resolved">;
        resolution: z.ZodEffects<z.ZodObject<{
            approvalId: z.ZodBranded<z.ZodString, "ApprovalId">;
            policyDecisionId: z.ZodBranded<z.ZodString, "PolicyDecisionId">;
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            status: z.ZodEnum<["approved", "denied"]>;
            resolvedAt: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            status: "approved" | "denied";
            policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
            approvalId: string & z.BRAND<"ApprovalId">;
            actionId: string & z.BRAND<"ActionId">;
            resolvedAt: string;
        }, {
            status: "approved" | "denied";
            policyDecisionId: string;
            approvalId: string;
            actionId: string;
            resolvedAt: string;
        }>, {
            [x: string]: any;
        }, {
            [x: string]: any;
        }>;
    }, "strict", z.ZodTypeAny, {
        type: "approval.resolved";
        resolution: {
            [x: string]: any;
        };
    }, {
        type: "approval.resolved";
        resolution: {
            [x: string]: any;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"task.completed">;
        completion: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodObject<{
            kind: z.ZodLiteral<"completion">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            type: z.ZodLiteral<"terminate">;
            status: z.ZodEnum<["succeeded", "partial", "failed"]>;
            summary: z.ZodString;
            findings: z.ZodArray<z.ZodObject<{
                fact: z.ZodString;
                observationIds: z.ZodArray<z.ZodBranded<z.ZodString, "ObservationId">, "many">;
            }, "strict", z.ZodTypeAny, {
                fact: string;
                observationIds: (string & z.BRAND<"ObservationId">)[];
            }, {
                fact: string;
                observationIds: string[];
            }>, "many">;
            unmetCriteria: z.ZodArray<z.ZodString, "many">;
            confidence: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            type: "terminate";
            status: "succeeded" | "partial" | "failed";
            kind: "completion";
            observationId: string & z.BRAND<"ObservationId">;
            summary: string;
            findings: {
                fact: string;
                observationIds: (string & z.BRAND<"ObservationId">)[];
            }[];
            unmetCriteria: string[];
            confidence: number;
        }, {
            type: "terminate";
            status: "succeeded" | "partial" | "failed";
            kind: "completion";
            observationId: string;
            summary: string;
            findings: {
                fact: string;
                observationIds: string[];
            }[];
            unmetCriteria: string[];
            confidence: number;
        }>, {
            [x: string]: any;
        }, {
            [x: string]: any;
        }>, {
            [x: string]: any;
        }, {
            [x: string]: any;
        }>, {
            [x: string]: any;
        }, {
            [x: string]: any;
        }>;
    }, "strict", z.ZodTypeAny, {
        type: "task.completed";
        completion: {
            [x: string]: any;
        };
    }, {
        type: "task.completed";
        completion: {
            [x: string]: any;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"task.failed">;
        completion: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodObject<{
            kind: z.ZodLiteral<"completion">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            type: z.ZodLiteral<"terminate">;
            status: z.ZodEnum<["succeeded", "partial", "failed"]>;
            summary: z.ZodString;
            findings: z.ZodArray<z.ZodObject<{
                fact: z.ZodString;
                observationIds: z.ZodArray<z.ZodBranded<z.ZodString, "ObservationId">, "many">;
            }, "strict", z.ZodTypeAny, {
                fact: string;
                observationIds: (string & z.BRAND<"ObservationId">)[];
            }, {
                fact: string;
                observationIds: string[];
            }>, "many">;
            unmetCriteria: z.ZodArray<z.ZodString, "many">;
            confidence: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            type: "terminate";
            status: "succeeded" | "partial" | "failed";
            kind: "completion";
            observationId: string & z.BRAND<"ObservationId">;
            summary: string;
            findings: {
                fact: string;
                observationIds: (string & z.BRAND<"ObservationId">)[];
            }[];
            unmetCriteria: string[];
            confidence: number;
        }, {
            type: "terminate";
            status: "succeeded" | "partial" | "failed";
            kind: "completion";
            observationId: string;
            summary: string;
            findings: {
                fact: string;
                observationIds: string[];
            }[];
            unmetCriteria: string[];
            confidence: number;
        }>, {
            [x: string]: any;
        }, {
            [x: string]: any;
        }>, {
            [x: string]: any;
        }, {
            [x: string]: any;
        }>, {
            [x: string]: any;
        }, {
            [x: string]: any;
        }>;
    }, "strict", z.ZodTypeAny, {
        type: "task.failed";
        completion: {
            [x: string]: any;
        };
    }, {
        type: "task.failed";
        completion: {
            [x: string]: any;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"task.cancelled">;
        taskId: z.ZodBranded<z.ZodString, "TaskId">;
        occurredAt: z.ZodString;
        reason: z.ZodString;
        observationId: z.ZodOptional<z.ZodBranded<z.ZodString, "ObservationId">>;
        actionId: z.ZodOptional<z.ZodBranded<z.ZodString, "ActionId">>;
        stepId: z.ZodOptional<z.ZodBranded<z.ZodString, "StepId">>;
    }, "strict", z.ZodTypeAny, {
        reason: string;
        type: "task.cancelled";
        taskId: string & z.BRAND<"TaskId">;
        occurredAt: string;
        actionId?: (string & z.BRAND<"ActionId">) | undefined;
        stepId?: (string & z.BRAND<"StepId">) | undefined;
        observationId?: (string & z.BRAND<"ObservationId">) | undefined;
    }, {
        reason: string;
        type: "task.cancelled";
        taskId: string;
        occurredAt: string;
        actionId?: string | undefined;
        stepId?: string | undefined;
        observationId?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"reconcile.request">;
        lastReceivedSequence: z.ZodNumber;
        lastSentClientSequence: z.ZodNumber;
        pendingActionIds: z.ZodArray<z.ZodBranded<z.ZodString, "ActionId">, "many">;
        requestedAt: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "reconcile.request";
        requestedAt: string;
        lastReceivedSequence: number;
        lastSentClientSequence: number;
        pendingActionIds: (string & z.BRAND<"ActionId">)[];
    }, {
        type: "reconcile.request";
        requestedAt: string;
        lastReceivedSequence: number;
        lastSentClientSequence: number;
        pendingActionIds: string[];
    }>, z.ZodObject<{
        type: z.ZodLiteral<"reconcile.response">;
        nextSequence: z.ZodNumber;
        pendingActionIds: z.ZodArray<z.ZodBranded<z.ZodString, "ActionId">, "many">;
        requiresFreshObservation: z.ZodBoolean;
        authoritativeState: z.ZodEnum<["CREATED", "OBSERVING", "PLANNING", "VALIDATING", "POLICY_CHECK", "WAITING_FOR_APPROVAL", "WAITING_FOR_USER", "DISPATCHING", "EXECUTING", "VERIFYING", "COMPLETED", "FAILED", "CANCELLED"]>;
        command: z.ZodOptional<z.ZodObject<{
            type: z.ZodLiteral<"action.command">;
            proposal: z.ZodEffects<z.ZodObject<{
                kind: z.ZodLiteral<"action">;
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                proposedAt: z.ZodString;
                action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"left_click">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
                }, "strict", z.ZodTypeAny, {
                    type: "left_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                }, {
                    type: "left_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"double_click">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
                }, "strict", z.ZodTypeAny, {
                    type: "double_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                }, {
                    type: "double_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"right_click">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
                }, "strict", z.ZodTypeAny, {
                    type: "right_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                }, {
                    type: "right_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"drag">;
                    startX: z.ZodNumber;
                    startY: z.ZodNumber;
                    endX: z.ZodNumber;
                    endY: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    type: "drag";
                    startX: number;
                    startY: number;
                    endX: number;
                    endY: number;
                }, {
                    type: "drag";
                    startX: number;
                    startY: number;
                    endX: number;
                    endY: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"mouse_move">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    type: "mouse_move";
                    x: number;
                    y: number;
                }, {
                    type: "mouse_move";
                    x: number;
                    y: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"scroll">;
                    deltaX: z.ZodNumber;
                    deltaY: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    type: "scroll";
                    deltaX: number;
                    deltaY: number;
                }, {
                    type: "scroll";
                    deltaX: number;
                    deltaY: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"key">;
                    key: z.ZodString;
                    modifiers: z.ZodOptional<z.ZodObject<{
                        ctrl: z.ZodOptional<z.ZodBoolean>;
                        shift: z.ZodOptional<z.ZodBoolean>;
                        alt: z.ZodOptional<z.ZodBoolean>;
                        meta: z.ZodOptional<z.ZodBoolean>;
                    }, "strict", z.ZodTypeAny, {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    }, {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    }>>;
                }, "strict", z.ZodTypeAny, {
                    type: "key";
                    key: string;
                    modifiers?: {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    } | undefined;
                }, {
                    type: "key";
                    key: string;
                    modifiers?: {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    } | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"insert_text">;
                    text: z.ZodString;
                    targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
                }, "strict", z.ZodTypeAny, {
                    type: "insert_text";
                    text: string;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                }, {
                    type: "insert_text";
                    text: string;
                    targetId?: string | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"visit_url">;
                    url: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    type: "visit_url";
                    url: string;
                }, {
                    type: "visit_url";
                    url: string;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"history_back">;
                    steps: z.ZodDefault<z.ZodNumber>;
                }, "strict", z.ZodTypeAny, {
                    type: "history_back";
                    steps: number;
                }, {
                    type: "history_back";
                    steps?: number | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"wait">;
                    durationMs: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    type: "wait";
                    durationMs: number;
                }, {
                    type: "wait";
                    durationMs: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"ask_user_question">;
                    question: z.ZodString;
                    choices: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                }, "strict", z.ZodTypeAny, {
                    type: "ask_user_question";
                    question: string;
                    choices?: string[] | undefined;
                }, {
                    type: "ask_user_question";
                    question: string;
                    choices?: string[] | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"memorize_fact">;
                    fact: z.ZodString;
                    category: z.ZodOptional<z.ZodString>;
                }, "strict", z.ZodTypeAny, {
                    type: "memorize_fact";
                    fact: string;
                    category?: string | undefined;
                }, {
                    type: "memorize_fact";
                    fact: string;
                    category?: string | undefined;
                }>]>;
            }, "strict", z.ZodTypeAny, {
                kind: "action";
                observationId: string & z.BRAND<"ObservationId">;
                action: {
                    type: "left_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                } | {
                    type: "right_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                } | {
                    type: "drag";
                    startX: number;
                    startY: number;
                    endX: number;
                    endY: number;
                } | {
                    type: "mouse_move";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    deltaX: number;
                    deltaY: number;
                } | {
                    type: "key";
                    key: string;
                    modifiers?: {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    } | undefined;
                } | {
                    type: "insert_text";
                    text: string;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                } | {
                    type: "visit_url";
                    url: string;
                } | {
                    type: "history_back";
                    steps: number;
                } | {
                    type: "wait";
                    durationMs: number;
                } | {
                    type: "ask_user_question";
                    question: string;
                    choices?: string[] | undefined;
                } | {
                    type: "memorize_fact";
                    fact: string;
                    category?: string | undefined;
                };
                proposedAt: string;
            }, {
                kind: "action";
                observationId: string;
                action: {
                    type: "left_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                } | {
                    type: "right_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                } | {
                    type: "drag";
                    startX: number;
                    startY: number;
                    endX: number;
                    endY: number;
                } | {
                    type: "mouse_move";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    deltaX: number;
                    deltaY: number;
                } | {
                    type: "key";
                    key: string;
                    modifiers?: {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    } | undefined;
                } | {
                    type: "insert_text";
                    text: string;
                    targetId?: string | undefined;
                } | {
                    type: "visit_url";
                    url: string;
                } | {
                    type: "history_back";
                    steps?: number | undefined;
                } | {
                    type: "wait";
                    durationMs: number;
                } | {
                    type: "ask_user_question";
                    question: string;
                    choices?: string[] | undefined;
                } | {
                    type: "memorize_fact";
                    fact: string;
                    category?: string | undefined;
                };
                proposedAt: string;
            }>, {
                [x: string]: any;
            }, {
                [x: string]: any;
            }>;
            policyDecision: z.ZodEffects<z.ZodObject<{
                policyDecisionId: z.ZodBranded<z.ZodString, "PolicyDecisionId">;
                actionId: z.ZodBranded<z.ZodString, "ActionId">;
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                decision: z.ZodEnum<["allowed", "denied", "approval_required"]>;
                decidedAt: z.ZodString;
            }, "strict", z.ZodTypeAny, {
                observationId: string & z.BRAND<"ObservationId">;
                policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
                actionId: string & z.BRAND<"ActionId">;
                decision: "allowed" | "denied" | "approval_required";
                decidedAt: string;
            }, {
                observationId: string;
                policyDecisionId: string;
                actionId: string;
                decision: "allowed" | "denied" | "approval_required";
                decidedAt: string;
            }>, {
                [x: string]: any;
            }, {
                [x: string]: any;
            }>;
            command: z.ZodEffects<z.ZodObject<{
                actionId: z.ZodBranded<z.ZodString, "ActionId">;
                stepId: z.ZodBranded<z.ZodString, "StepId">;
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                sequence: z.ZodNumber;
                action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"left_click">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
                }, "strict", z.ZodTypeAny, {
                    type: "left_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                }, {
                    type: "left_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"double_click">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
                }, "strict", z.ZodTypeAny, {
                    type: "double_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                }, {
                    type: "double_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"right_click">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
                }, "strict", z.ZodTypeAny, {
                    type: "right_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                }, {
                    type: "right_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"drag">;
                    startX: z.ZodNumber;
                    startY: z.ZodNumber;
                    endX: z.ZodNumber;
                    endY: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    type: "drag";
                    startX: number;
                    startY: number;
                    endX: number;
                    endY: number;
                }, {
                    type: "drag";
                    startX: number;
                    startY: number;
                    endX: number;
                    endY: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"mouse_move">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    type: "mouse_move";
                    x: number;
                    y: number;
                }, {
                    type: "mouse_move";
                    x: number;
                    y: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"scroll">;
                    deltaX: z.ZodNumber;
                    deltaY: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    type: "scroll";
                    deltaX: number;
                    deltaY: number;
                }, {
                    type: "scroll";
                    deltaX: number;
                    deltaY: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"key">;
                    key: z.ZodString;
                    modifiers: z.ZodOptional<z.ZodObject<{
                        ctrl: z.ZodOptional<z.ZodBoolean>;
                        shift: z.ZodOptional<z.ZodBoolean>;
                        alt: z.ZodOptional<z.ZodBoolean>;
                        meta: z.ZodOptional<z.ZodBoolean>;
                    }, "strict", z.ZodTypeAny, {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    }, {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    }>>;
                }, "strict", z.ZodTypeAny, {
                    type: "key";
                    key: string;
                    modifiers?: {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    } | undefined;
                }, {
                    type: "key";
                    key: string;
                    modifiers?: {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    } | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"insert_text">;
                    text: z.ZodString;
                    targetId: z.ZodOptional<z.ZodBranded<z.ZodString, "SemanticTargetId">>;
                }, "strict", z.ZodTypeAny, {
                    type: "insert_text";
                    text: string;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                }, {
                    type: "insert_text";
                    text: string;
                    targetId?: string | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"visit_url">;
                    url: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    type: "visit_url";
                    url: string;
                }, {
                    type: "visit_url";
                    url: string;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"history_back">;
                    steps: z.ZodDefault<z.ZodNumber>;
                }, "strict", z.ZodTypeAny, {
                    type: "history_back";
                    steps: number;
                }, {
                    type: "history_back";
                    steps?: number | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"wait">;
                    durationMs: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    type: "wait";
                    durationMs: number;
                }, {
                    type: "wait";
                    durationMs: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"ask_user_question">;
                    question: z.ZodString;
                    choices: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                }, "strict", z.ZodTypeAny, {
                    type: "ask_user_question";
                    question: string;
                    choices?: string[] | undefined;
                }, {
                    type: "ask_user_question";
                    question: string;
                    choices?: string[] | undefined;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"memorize_fact">;
                    fact: z.ZodString;
                    category: z.ZodOptional<z.ZodString>;
                }, "strict", z.ZodTypeAny, {
                    type: "memorize_fact";
                    fact: string;
                    category?: string | undefined;
                }, {
                    type: "memorize_fact";
                    fact: string;
                    category?: string | undefined;
                }>]>;
                policyContext: z.ZodObject<{
                    policyDecisionId: z.ZodBranded<z.ZodString, "PolicyDecisionId">;
                    policyVersion: z.ZodString;
                    approved: z.ZodBoolean;
                    approvalId: z.ZodOptional<z.ZodBranded<z.ZodString, "ApprovalId">>;
                }, "strict", z.ZodTypeAny, {
                    policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
                    policyVersion: string;
                    approved: boolean;
                    approvalId?: (string & z.BRAND<"ApprovalId">) | undefined;
                }, {
                    policyDecisionId: string;
                    policyVersion: string;
                    approved: boolean;
                    approvalId?: string | undefined;
                }>;
                dispatchedAt: z.ZodString;
                expiresAt: z.ZodString;
                idempotencyKey: z.ZodString;
            }, "strict", z.ZodTypeAny, {
                observationId: string & z.BRAND<"ObservationId">;
                action: {
                    type: "left_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                } | {
                    type: "right_click";
                    x: number;
                    y: number;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                } | {
                    type: "drag";
                    startX: number;
                    startY: number;
                    endX: number;
                    endY: number;
                } | {
                    type: "mouse_move";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    deltaX: number;
                    deltaY: number;
                } | {
                    type: "key";
                    key: string;
                    modifiers?: {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    } | undefined;
                } | {
                    type: "insert_text";
                    text: string;
                    targetId?: (string & z.BRAND<"SemanticTargetId">) | undefined;
                } | {
                    type: "visit_url";
                    url: string;
                } | {
                    type: "history_back";
                    steps: number;
                } | {
                    type: "wait";
                    durationMs: number;
                } | {
                    type: "ask_user_question";
                    question: string;
                    choices?: string[] | undefined;
                } | {
                    type: "memorize_fact";
                    fact: string;
                    category?: string | undefined;
                };
                actionId: string & z.BRAND<"ActionId">;
                stepId: string & z.BRAND<"StepId">;
                sequence: number;
                policyContext: {
                    policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
                    policyVersion: string;
                    approved: boolean;
                    approvalId?: (string & z.BRAND<"ApprovalId">) | undefined;
                };
                dispatchedAt: string;
                expiresAt: string;
                idempotencyKey: string;
            }, {
                observationId: string;
                action: {
                    type: "left_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                } | {
                    type: "right_click";
                    x: number;
                    y: number;
                    targetId?: string | undefined;
                } | {
                    type: "drag";
                    startX: number;
                    startY: number;
                    endX: number;
                    endY: number;
                } | {
                    type: "mouse_move";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    deltaX: number;
                    deltaY: number;
                } | {
                    type: "key";
                    key: string;
                    modifiers?: {
                        shift?: boolean | undefined;
                        ctrl?: boolean | undefined;
                        alt?: boolean | undefined;
                        meta?: boolean | undefined;
                    } | undefined;
                } | {
                    type: "insert_text";
                    text: string;
                    targetId?: string | undefined;
                } | {
                    type: "visit_url";
                    url: string;
                } | {
                    type: "history_back";
                    steps?: number | undefined;
                } | {
                    type: "wait";
                    durationMs: number;
                } | {
                    type: "ask_user_question";
                    question: string;
                    choices?: string[] | undefined;
                } | {
                    type: "memorize_fact";
                    fact: string;
                    category?: string | undefined;
                };
                actionId: string;
                stepId: string;
                sequence: number;
                policyContext: {
                    policyDecisionId: string;
                    policyVersion: string;
                    approved: boolean;
                    approvalId?: string | undefined;
                };
                dispatchedAt: string;
                expiresAt: string;
                idempotencyKey: string;
            }>, {
                [x: string]: any;
            }, {
                [x: string]: any;
            }>;
        }, "strict", z.ZodTypeAny, {
            type: "action.command";
            proposal: {
                [x: string]: any;
            };
            policyDecision: {
                [x: string]: any;
            };
            command: {
                [x: string]: any;
            };
        }, {
            type: "action.command";
            proposal: {
                [x: string]: any;
            };
            policyDecision: {
                [x: string]: any;
            };
            command: {
                [x: string]: any;
            };
        }>>;
        storedResult: z.ZodOptional<z.ZodEffects<z.ZodUnion<[z.ZodObject<{
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            stepId: z.ZodBranded<z.ZodString, "StepId">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            sequence: z.ZodNumber;
            startedAt: z.ZodString;
            completedAt: z.ZodString;
            durationMs: z.ZodNumber;
            target: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                stableRef: z.ZodOptional<z.ZodString>;
                tag: z.ZodString;
                role: z.ZodOptional<z.ZodString>;
                accessibleName: z.ZodOptional<z.ZodObject<{
                    source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                    text: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }>>;
                attributes: z.ZodOptional<z.ZodObject<{
                    "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }>>;
                control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"non_input">;
                }, "strict", z.ZodTypeAny, {
                    kind: "non_input";
                }, {
                    kind: "non_input";
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"input">;
                    inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }>]>;
                boundingBox: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }>;
                visible: z.ZodBoolean;
                framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"role_name">;
                    role: z.ZodEffects<z.ZodString, string, string>;
                    name: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"label">;
                    label: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"test_id">;
                    testId: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    kind: "test_id";
                    testId: string;
                }, {
                    kind: "test_id";
                    testId: string;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"safe_attribute">;
                    attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                    value: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }>]>, "many">;
            }, "strict", z.ZodTypeAny, {
                visible: boolean;
                targetId: string & z.BRAND<"SemanticTargetId">;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
            }, {
                visible: boolean;
                targetId: string;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: string[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: string[] | undefined;
            }>, any, any>, any, any>>;
            navigation: z.ZodOptional<z.ZodObject<{
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                url: string;
                title?: string | undefined;
            }, {
                url: string;
                title?: string | undefined;
            }>>;
            dialog: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["alert", "confirm", "prompt", "beforeunload"]>;
                present: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }>>;
        } & {
            status: z.ZodLiteral<"succeeded">;
            postObservation: z.ZodEffects<z.ZodObject<{
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                capturedAt: z.ZodString;
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodString;
                screenshot: z.ZodEffects<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"inline">;
                    encoding: z.ZodEnum<["base64", "png", "jpeg", "webp"]>;
                    data: z.ZodString;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"artifact">;
                    artifactId: z.ZodBranded<z.ZodString, "ArtifactId">;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    encoding: z.ZodEnum<["png", "jpeg", "webp"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string & z.BRAND<"ArtifactId">;
                }, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string;
                }>]>, any, any>;
                viewport: z.ZodObject<{
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    devicePixelRatio: z.ZodNumber;
                    zoom: z.ZodNumber;
                    scrollX: z.ZodNumber;
                    scrollY: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }>;
                page: z.ZodObject<{
                    tabId: z.ZodBranded<z.ZodString, "TabId">;
                    frameId: z.ZodBranded<z.ZodString, "FrameId">;
                    lifecycle: z.ZodEnum<["loading", "interactive", "complete", "frozen"]>;
                    visibility: z.ZodEnum<["visible", "hidden", "prerender"]>;
                }, "strict", z.ZodTypeAny, {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }, {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }>;
                semanticTargets: z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                    targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                    stableRef: z.ZodOptional<z.ZodString>;
                    tag: z.ZodString;
                    role: z.ZodOptional<z.ZodString>;
                    accessibleName: z.ZodOptional<z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>>;
                    attributes: z.ZodOptional<z.ZodObject<{
                        "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                        "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                        "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                        "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                        "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    }, "strict", z.ZodTypeAny, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }>>;
                    control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"non_input">;
                    }, "strict", z.ZodTypeAny, {
                        kind: "non_input";
                    }, {
                        kind: "non_input";
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"input">;
                        inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }>]>;
                    boundingBox: z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>;
                    visible: z.ZodBoolean;
                    framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                    shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                    locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"role_name">;
                        role: z.ZodEffects<z.ZodString, string, string>;
                        name: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"label">;
                        label: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"test_id">;
                        testId: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "test_id";
                        testId: string;
                    }, {
                        kind: "test_id";
                        testId: string;
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"safe_attribute">;
                        attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                        value: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }>]>, "many">;
                }, "strict", z.ZodTypeAny, {
                    visible: boolean;
                    targetId: string & z.BRAND<"SemanticTargetId">;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
                }, {
                    visible: boolean;
                    targetId: string;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: string[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: string[] | undefined;
                }>, any, any>, any, any>, "many">;
                accessibilityNodes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    axNodeId: z.ZodString;
                    role: z.ZodString;
                    name: z.ZodOptional<z.ZodString>;
                    description: z.ZodOptional<z.ZodString>;
                    value: z.ZodOptional<z.ZodString>;
                    attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    bounds: z.ZodOptional<z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>>;
                    axPath: z.ZodArray<z.ZodObject<{
                        role: z.ZodString;
                        index: z.ZodNumber;
                        name: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }>, "many">;
                    attributeHash: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }>, "many">>;
            }, "strict", z.ZodTypeAny, {
                page: {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string & z.BRAND<"ObservationId">;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }, {
                page: {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }>, any, any>;
        }, "strict", z.ZodTypeAny, {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }, {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }>, z.ZodObject<{
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            stepId: z.ZodBranded<z.ZodString, "StepId">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            sequence: z.ZodNumber;
            startedAt: z.ZodString;
            completedAt: z.ZodString;
            durationMs: z.ZodNumber;
            target: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                stableRef: z.ZodOptional<z.ZodString>;
                tag: z.ZodString;
                role: z.ZodOptional<z.ZodString>;
                accessibleName: z.ZodOptional<z.ZodObject<{
                    source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                    text: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }>>;
                attributes: z.ZodOptional<z.ZodObject<{
                    "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }>>;
                control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"non_input">;
                }, "strict", z.ZodTypeAny, {
                    kind: "non_input";
                }, {
                    kind: "non_input";
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"input">;
                    inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }>]>;
                boundingBox: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }>;
                visible: z.ZodBoolean;
                framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"role_name">;
                    role: z.ZodEffects<z.ZodString, string, string>;
                    name: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"label">;
                    label: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"test_id">;
                    testId: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    kind: "test_id";
                    testId: string;
                }, {
                    kind: "test_id";
                    testId: string;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"safe_attribute">;
                    attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                    value: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }>]>, "many">;
            }, "strict", z.ZodTypeAny, {
                visible: boolean;
                targetId: string & z.BRAND<"SemanticTargetId">;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
            }, {
                visible: boolean;
                targetId: string;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: string[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: string[] | undefined;
            }>, any, any>, any, any>>;
            navigation: z.ZodOptional<z.ZodObject<{
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                url: string;
                title?: string | undefined;
            }, {
                url: string;
                title?: string | undefined;
            }>>;
            dialog: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["alert", "confirm", "prompt", "beforeunload"]>;
                present: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }>>;
        } & {
            status: z.ZodEnum<["failed_recoverable", "failed_terminal"]>;
            error: z.ZodObject<{
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                code: string;
                message: string;
                retryable: boolean;
            }, {
                code: string;
                message: string;
                retryable: boolean;
            }>;
            postObservation: z.ZodEffects<z.ZodObject<{
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                capturedAt: z.ZodString;
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodString;
                screenshot: z.ZodEffects<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"inline">;
                    encoding: z.ZodEnum<["base64", "png", "jpeg", "webp"]>;
                    data: z.ZodString;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"artifact">;
                    artifactId: z.ZodBranded<z.ZodString, "ArtifactId">;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    encoding: z.ZodEnum<["png", "jpeg", "webp"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string & z.BRAND<"ArtifactId">;
                }, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string;
                }>]>, any, any>;
                viewport: z.ZodObject<{
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    devicePixelRatio: z.ZodNumber;
                    zoom: z.ZodNumber;
                    scrollX: z.ZodNumber;
                    scrollY: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }>;
                page: z.ZodObject<{
                    tabId: z.ZodBranded<z.ZodString, "TabId">;
                    frameId: z.ZodBranded<z.ZodString, "FrameId">;
                    lifecycle: z.ZodEnum<["loading", "interactive", "complete", "frozen"]>;
                    visibility: z.ZodEnum<["visible", "hidden", "prerender"]>;
                }, "strict", z.ZodTypeAny, {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }, {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }>;
                semanticTargets: z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                    targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                    stableRef: z.ZodOptional<z.ZodString>;
                    tag: z.ZodString;
                    role: z.ZodOptional<z.ZodString>;
                    accessibleName: z.ZodOptional<z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>>;
                    attributes: z.ZodOptional<z.ZodObject<{
                        "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                        "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                        "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                        "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                        "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    }, "strict", z.ZodTypeAny, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }>>;
                    control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"non_input">;
                    }, "strict", z.ZodTypeAny, {
                        kind: "non_input";
                    }, {
                        kind: "non_input";
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"input">;
                        inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }>]>;
                    boundingBox: z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>;
                    visible: z.ZodBoolean;
                    framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                    shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                    locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"role_name">;
                        role: z.ZodEffects<z.ZodString, string, string>;
                        name: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"label">;
                        label: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"test_id">;
                        testId: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "test_id";
                        testId: string;
                    }, {
                        kind: "test_id";
                        testId: string;
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"safe_attribute">;
                        attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                        value: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }>]>, "many">;
                }, "strict", z.ZodTypeAny, {
                    visible: boolean;
                    targetId: string & z.BRAND<"SemanticTargetId">;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
                }, {
                    visible: boolean;
                    targetId: string;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: string[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: string[] | undefined;
                }>, any, any>, any, any>, "many">;
                accessibilityNodes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    axNodeId: z.ZodString;
                    role: z.ZodString;
                    name: z.ZodOptional<z.ZodString>;
                    description: z.ZodOptional<z.ZodString>;
                    value: z.ZodOptional<z.ZodString>;
                    attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    bounds: z.ZodOptional<z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>>;
                    axPath: z.ZodArray<z.ZodObject<{
                        role: z.ZodString;
                        index: z.ZodNumber;
                        name: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }>, "many">;
                    attributeHash: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }>, "many">>;
            }, "strict", z.ZodTypeAny, {
                page: {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string & z.BRAND<"ObservationId">;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }, {
                page: {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }>, any, any>;
        }, "strict", z.ZodTypeAny, {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }, {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }>, z.ZodObject<{
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            stepId: z.ZodBranded<z.ZodString, "StepId">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            sequence: z.ZodNumber;
            startedAt: z.ZodString;
            completedAt: z.ZodString;
            durationMs: z.ZodNumber;
            target: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                stableRef: z.ZodOptional<z.ZodString>;
                tag: z.ZodString;
                role: z.ZodOptional<z.ZodString>;
                accessibleName: z.ZodOptional<z.ZodObject<{
                    source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                    text: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }>>;
                attributes: z.ZodOptional<z.ZodObject<{
                    "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }>>;
                control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"non_input">;
                }, "strict", z.ZodTypeAny, {
                    kind: "non_input";
                }, {
                    kind: "non_input";
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"input">;
                    inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }>]>;
                boundingBox: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }>;
                visible: z.ZodBoolean;
                framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"role_name">;
                    role: z.ZodEffects<z.ZodString, string, string>;
                    name: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"label">;
                    label: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"test_id">;
                    testId: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    kind: "test_id";
                    testId: string;
                }, {
                    kind: "test_id";
                    testId: string;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"safe_attribute">;
                    attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                    value: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }>]>, "many">;
            }, "strict", z.ZodTypeAny, {
                visible: boolean;
                targetId: string & z.BRAND<"SemanticTargetId">;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
            }, {
                visible: boolean;
                targetId: string;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: string[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: string[] | undefined;
            }>, any, any>, any, any>>;
            navigation: z.ZodOptional<z.ZodObject<{
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                url: string;
                title?: string | undefined;
            }, {
                url: string;
                title?: string | undefined;
            }>>;
            dialog: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["alert", "confirm", "prompt", "beforeunload"]>;
                present: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }>>;
        } & {
            status: z.ZodEnum<["rejected_stale", "rejected_policy", "approval_required"]>;
            rejection: z.ZodObject<{
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                code: string;
                message: string;
                retryable: boolean;
            }, {
                code: string;
                message: string;
                retryable: boolean;
            }>;
        }, "strict", z.ZodTypeAny, {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        }, {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        }>, z.ZodObject<{
            actionId: z.ZodBranded<z.ZodString, "ActionId">;
            stepId: z.ZodBranded<z.ZodString, "StepId">;
            observationId: z.ZodBranded<z.ZodString, "ObservationId">;
            sequence: z.ZodNumber;
            startedAt: z.ZodString;
            completedAt: z.ZodString;
            durationMs: z.ZodNumber;
            target: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                stableRef: z.ZodOptional<z.ZodString>;
                tag: z.ZodString;
                role: z.ZodOptional<z.ZodString>;
                accessibleName: z.ZodOptional<z.ZodObject<{
                    source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                    text: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }, {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                }>>;
                attributes: z.ZodOptional<z.ZodObject<{
                    "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }, {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                }>>;
                control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"non_input">;
                }, "strict", z.ZodTypeAny, {
                    kind: "non_input";
                }, {
                    kind: "non_input";
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"input">;
                    inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }, {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                }>]>;
                boundingBox: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }, {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                }>;
                visible: z.ZodBoolean;
                framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"role_name">;
                    role: z.ZodEffects<z.ZodString, string, string>;
                    name: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"label">;
                    label: z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>;
                }, "strict", z.ZodTypeAny, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }, {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"test_id">;
                    testId: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    kind: "test_id";
                    testId: string;
                }, {
                    kind: "test_id";
                    testId: string;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"safe_attribute">;
                    attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                    value: z.ZodEffects<z.ZodString, string, string>;
                }, "strict", z.ZodTypeAny, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }, {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                }>]>, "many">;
            }, "strict", z.ZodTypeAny, {
                visible: boolean;
                targetId: string & z.BRAND<"SemanticTargetId">;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
            }, {
                visible: boolean;
                targetId: string;
                tag: string;
                control: {
                    kind: "non_input";
                } | {
                    kind: "input";
                    inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                };
                boundingBox: {
                    width: number;
                    height: number;
                    x: number;
                    y: number;
                };
                framePath: string[];
                locatorCandidates: ({
                    kind: "role_name";
                    role: string;
                    name: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "label";
                    label: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    };
                } | {
                    kind: "test_id";
                    testId: string;
                } | {
                    value: string;
                    kind: "safe_attribute";
                    attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                })[];
                role?: string | undefined;
                stableRef?: string | undefined;
                accessibleName?: {
                    source: "aria-label" | "aria-labelledby" | "visible_text";
                    text: string;
                } | undefined;
                attributes?: {
                    "aria-label"?: string | undefined;
                    "aria-describedby"?: string | undefined;
                    "aria-controls"?: string | undefined;
                    "aria-expanded"?: "true" | "false" | undefined;
                    "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                    "aria-selected"?: "true" | "false" | undefined;
                } | undefined;
                shadowPath?: string[] | undefined;
            }>, any, any>, any, any>>;
            navigation: z.ZodOptional<z.ZodObject<{
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                url: string;
                title?: string | undefined;
            }, {
                url: string;
                title?: string | undefined;
            }>>;
            dialog: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["alert", "confirm", "prompt", "beforeunload"]>;
                present: z.ZodBoolean;
            }, "strict", z.ZodTypeAny, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }, {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            }>>;
        } & {
            status: z.ZodLiteral<"cancelled">;
            cancellation: z.ZodObject<{
                reason: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                reason?: string | undefined;
            }, {
                reason?: string | undefined;
            }>;
            postObservation: z.ZodEffects<z.ZodObject<{
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                capturedAt: z.ZodString;
                url: z.ZodEffects<z.ZodString, string, string>;
                title: z.ZodString;
                screenshot: z.ZodEffects<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                    kind: z.ZodLiteral<"inline">;
                    encoding: z.ZodEnum<["base64", "png", "jpeg", "webp"]>;
                    data: z.ZodString;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }, {
                    kind: "inline";
                    encoding: "base64" | "png" | "jpeg" | "webp";
                    data: string;
                    sha256: string;
                    width: number;
                    height: number;
                }>, z.ZodObject<{
                    kind: z.ZodLiteral<"artifact">;
                    artifactId: z.ZodBranded<z.ZodString, "ArtifactId">;
                    sha256: z.ZodString;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    encoding: z.ZodEnum<["png", "jpeg", "webp"]>;
                }, "strict", z.ZodTypeAny, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string & z.BRAND<"ArtifactId">;
                }, {
                    kind: "artifact";
                    encoding: "png" | "jpeg" | "webp";
                    sha256: string;
                    width: number;
                    height: number;
                    artifactId: string;
                }>]>, any, any>;
                viewport: z.ZodObject<{
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                    devicePixelRatio: z.ZodNumber;
                    zoom: z.ZodNumber;
                    scrollX: z.ZodNumber;
                    scrollY: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }, {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                }>;
                page: z.ZodObject<{
                    tabId: z.ZodBranded<z.ZodString, "TabId">;
                    frameId: z.ZodBranded<z.ZodString, "FrameId">;
                    lifecycle: z.ZodEnum<["loading", "interactive", "complete", "frozen"]>;
                    visibility: z.ZodEnum<["visible", "hidden", "prerender"]>;
                }, "strict", z.ZodTypeAny, {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }, {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                }>;
                semanticTargets: z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                    targetId: z.ZodBranded<z.ZodString, "SemanticTargetId">;
                    stableRef: z.ZodOptional<z.ZodString>;
                    tag: z.ZodString;
                    role: z.ZodOptional<z.ZodString>;
                    accessibleName: z.ZodOptional<z.ZodObject<{
                        source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                        text: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }, {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    }>>;
                    attributes: z.ZodOptional<z.ZodObject<{
                        "aria-label": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-describedby": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-controls": z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                        "aria-expanded": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                        "aria-haspopup": z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                        "aria-current": z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                        "aria-pressed": z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                        "aria-selected": z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    }, "strict", z.ZodTypeAny, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }, {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    }>>;
                    control: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"non_input">;
                    }, "strict", z.ZodTypeAny, {
                        kind: "non_input";
                    }, {
                        kind: "non_input";
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"input">;
                        inputType: z.ZodEnum<["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }, {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    }>]>;
                    boundingBox: z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>;
                    visible: z.ZodBoolean;
                    framePath: z.ZodArray<z.ZodBranded<z.ZodString, "FramePathSegmentId">, "many">;
                    shadowPath: z.ZodOptional<z.ZodArray<z.ZodBranded<z.ZodString, "ShadowPathSegmentId">, "many">>;
                    locatorCandidates: z.ZodArray<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                        kind: z.ZodLiteral<"role_name">;
                        role: z.ZodEffects<z.ZodString, string, string>;
                        name: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"label">;
                        label: z.ZodObject<{
                            source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
                            text: z.ZodEffects<z.ZodString, string, string>;
                        }, "strict", z.ZodTypeAny, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }, {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        }>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }, {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"test_id">;
                        testId: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        kind: "test_id";
                        testId: string;
                    }, {
                        kind: "test_id";
                        testId: string;
                    }>, z.ZodObject<{
                        kind: z.ZodLiteral<"safe_attribute">;
                        attribute: z.ZodEnum<["aria-label", "aria-describedby", "aria-controls", "aria-current"]>;
                        value: z.ZodEffects<z.ZodString, string, string>;
                    }, "strict", z.ZodTypeAny, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }, {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    }>]>, "many">;
                }, "strict", z.ZodTypeAny, {
                    visible: boolean;
                    targetId: string & z.BRAND<"SemanticTargetId">;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: (string & z.BRAND<"FramePathSegmentId">)[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: (string & z.BRAND<"ShadowPathSegmentId">)[] | undefined;
                }, {
                    visible: boolean;
                    targetId: string;
                    tag: string;
                    control: {
                        kind: "non_input";
                    } | {
                        kind: "input";
                        inputType: "number" | "date" | "text" | "search" | "email" | "tel" | "url" | "checkbox" | "radio";
                    };
                    boundingBox: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    framePath: string[];
                    locatorCandidates: ({
                        kind: "role_name";
                        role: string;
                        name: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "label";
                        label: {
                            source: "aria-label" | "aria-labelledby" | "visible_text";
                            text: string;
                        };
                    } | {
                        kind: "test_id";
                        testId: string;
                    } | {
                        value: string;
                        kind: "safe_attribute";
                        attribute: "aria-label" | "aria-describedby" | "aria-controls" | "aria-current";
                    })[];
                    role?: string | undefined;
                    stableRef?: string | undefined;
                    accessibleName?: {
                        source: "aria-label" | "aria-labelledby" | "visible_text";
                        text: string;
                    } | undefined;
                    attributes?: {
                        "aria-label"?: string | undefined;
                        "aria-describedby"?: string | undefined;
                        "aria-controls"?: string | undefined;
                        "aria-expanded"?: "true" | "false" | undefined;
                        "aria-haspopup"?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                        "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                        "aria-pressed"?: "true" | "false" | "mixed" | undefined;
                        "aria-selected"?: "true" | "false" | undefined;
                    } | undefined;
                    shadowPath?: string[] | undefined;
                }>, any, any>, any, any>, "many">;
                accessibilityNodes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    axNodeId: z.ZodString;
                    role: z.ZodString;
                    name: z.ZodOptional<z.ZodString>;
                    description: z.ZodOptional<z.ZodString>;
                    value: z.ZodOptional<z.ZodString>;
                    attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    bounds: z.ZodOptional<z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                        width: z.ZodNumber;
                        height: z.ZodNumber;
                    }, "strict", z.ZodTypeAny, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }, {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    }>>;
                    axPath: z.ZodArray<z.ZodObject<{
                        role: z.ZodString;
                        index: z.ZodNumber;
                        name: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }, {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }>, "many">;
                    attributeHash: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }, {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }>, "many">>;
            }, "strict", z.ZodTypeAny, {
                page: {
                    tabId: string & z.BRAND<"TabId">;
                    frameId: string & z.BRAND<"FrameId">;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string & z.BRAND<"ObservationId">;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }, {
                page: {
                    tabId: string;
                    frameId: string;
                    lifecycle: "loading" | "interactive" | "complete" | "frozen";
                    visibility: "visible" | "hidden" | "prerender";
                };
                url: string;
                observationId: string;
                capturedAt: string;
                title: string;
                viewport: {
                    width: number;
                    height: number;
                    devicePixelRatio: number;
                    zoom: number;
                    scrollX: number;
                    scrollY: number;
                };
                semanticTargets: any[];
                screenshot?: any;
                accessibilityNodes?: {
                    role: string;
                    axNodeId: string;
                    axPath: {
                        role: string;
                        index: number;
                        name?: string | undefined;
                    }[];
                    attributeHash: string;
                    value?: string | undefined;
                    name?: string | undefined;
                    attributes?: Record<string, string> | undefined;
                    description?: string | undefined;
                    bounds?: {
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    } | undefined;
                }[] | undefined;
            }>, any, any>;
        }, "strict", z.ZodTypeAny, {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }, {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }>]>, {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }, {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        }>>;
        terminal: z.ZodOptional<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"task.completed">;
            completion: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                kind: z.ZodLiteral<"completion">;
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                type: z.ZodLiteral<"terminate">;
                status: z.ZodEnum<["succeeded", "partial", "failed"]>;
                summary: z.ZodString;
                findings: z.ZodArray<z.ZodObject<{
                    fact: z.ZodString;
                    observationIds: z.ZodArray<z.ZodBranded<z.ZodString, "ObservationId">, "many">;
                }, "strict", z.ZodTypeAny, {
                    fact: string;
                    observationIds: (string & z.BRAND<"ObservationId">)[];
                }, {
                    fact: string;
                    observationIds: string[];
                }>, "many">;
                unmetCriteria: z.ZodArray<z.ZodString, "many">;
                confidence: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                type: "terminate";
                status: "succeeded" | "partial" | "failed";
                kind: "completion";
                observationId: string & z.BRAND<"ObservationId">;
                summary: string;
                findings: {
                    fact: string;
                    observationIds: (string & z.BRAND<"ObservationId">)[];
                }[];
                unmetCriteria: string[];
                confidence: number;
            }, {
                type: "terminate";
                status: "succeeded" | "partial" | "failed";
                kind: "completion";
                observationId: string;
                summary: string;
                findings: {
                    fact: string;
                    observationIds: string[];
                }[];
                unmetCriteria: string[];
                confidence: number;
            }>, {
                [x: string]: any;
            }, {
                [x: string]: any;
            }>, {
                [x: string]: any;
            }, {
                [x: string]: any;
            }>, {
                [x: string]: any;
            }, {
                [x: string]: any;
            }>;
        }, "strict", z.ZodTypeAny, {
            type: "task.completed";
            completion: {
                [x: string]: any;
            };
        }, {
            type: "task.completed";
            completion: {
                [x: string]: any;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"task.failed">;
            completion: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                kind: z.ZodLiteral<"completion">;
                observationId: z.ZodBranded<z.ZodString, "ObservationId">;
                type: z.ZodLiteral<"terminate">;
                status: z.ZodEnum<["succeeded", "partial", "failed"]>;
                summary: z.ZodString;
                findings: z.ZodArray<z.ZodObject<{
                    fact: z.ZodString;
                    observationIds: z.ZodArray<z.ZodBranded<z.ZodString, "ObservationId">, "many">;
                }, "strict", z.ZodTypeAny, {
                    fact: string;
                    observationIds: (string & z.BRAND<"ObservationId">)[];
                }, {
                    fact: string;
                    observationIds: string[];
                }>, "many">;
                unmetCriteria: z.ZodArray<z.ZodString, "many">;
                confidence: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                type: "terminate";
                status: "succeeded" | "partial" | "failed";
                kind: "completion";
                observationId: string & z.BRAND<"ObservationId">;
                summary: string;
                findings: {
                    fact: string;
                    observationIds: (string & z.BRAND<"ObservationId">)[];
                }[];
                unmetCriteria: string[];
                confidence: number;
            }, {
                type: "terminate";
                status: "succeeded" | "partial" | "failed";
                kind: "completion";
                observationId: string;
                summary: string;
                findings: {
                    fact: string;
                    observationIds: string[];
                }[];
                unmetCriteria: string[];
                confidence: number;
            }>, {
                [x: string]: any;
            }, {
                [x: string]: any;
            }>, {
                [x: string]: any;
            }, {
                [x: string]: any;
            }>, {
                [x: string]: any;
            }, {
                [x: string]: any;
            }>;
        }, "strict", z.ZodTypeAny, {
            type: "task.failed";
            completion: {
                [x: string]: any;
            };
        }, {
            type: "task.failed";
            completion: {
                [x: string]: any;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"task.cancelled">;
            taskId: z.ZodBranded<z.ZodString, "TaskId">;
            occurredAt: z.ZodString;
            reason: z.ZodString;
            observationId: z.ZodOptional<z.ZodBranded<z.ZodString, "ObservationId">>;
            actionId: z.ZodOptional<z.ZodBranded<z.ZodString, "ActionId">>;
            stepId: z.ZodOptional<z.ZodBranded<z.ZodString, "StepId">>;
        }, "strict", z.ZodTypeAny, {
            reason: string;
            type: "task.cancelled";
            taskId: string & z.BRAND<"TaskId">;
            occurredAt: string;
            actionId?: (string & z.BRAND<"ActionId">) | undefined;
            stepId?: (string & z.BRAND<"StepId">) | undefined;
            observationId?: (string & z.BRAND<"ObservationId">) | undefined;
        }, {
            reason: string;
            type: "task.cancelled";
            taskId: string;
            occurredAt: string;
            actionId?: string | undefined;
            stepId?: string | undefined;
            observationId?: string | undefined;
        }>]>>;
        respondedAt: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "reconcile.response";
        nextSequence: number;
        pendingActionIds: (string & z.BRAND<"ActionId">)[];
        requiresFreshObservation: boolean;
        authoritativeState: "CREATED" | "OBSERVING" | "PLANNING" | "VALIDATING" | "POLICY_CHECK" | "WAITING_FOR_APPROVAL" | "WAITING_FOR_USER" | "DISPATCHING" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
        respondedAt: string;
        command?: {
            type: "action.command";
            proposal: {
                [x: string]: any;
            };
            policyDecision: {
                [x: string]: any;
            };
            command: {
                [x: string]: any;
            };
        } | undefined;
        storedResult?: {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | undefined;
        terminal?: {
            type: "task.completed";
            completion: {
                [x: string]: any;
            };
        } | {
            type: "task.failed";
            completion: {
                [x: string]: any;
            };
        } | {
            reason: string;
            type: "task.cancelled";
            taskId: string & z.BRAND<"TaskId">;
            occurredAt: string;
            actionId?: (string & z.BRAND<"ActionId">) | undefined;
            stepId?: (string & z.BRAND<"StepId">) | undefined;
            observationId?: (string & z.BRAND<"ObservationId">) | undefined;
        } | undefined;
    }, {
        type: "reconcile.response";
        nextSequence: number;
        pendingActionIds: string[];
        requiresFreshObservation: boolean;
        authoritativeState: "CREATED" | "OBSERVING" | "PLANNING" | "VALIDATING" | "POLICY_CHECK" | "WAITING_FOR_APPROVAL" | "WAITING_FOR_USER" | "DISPATCHING" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
        respondedAt: string;
        command?: {
            type: "action.command";
            proposal: {
                [x: string]: any;
            };
            policyDecision: {
                [x: string]: any;
            };
            command: {
                [x: string]: any;
            };
        } | undefined;
        storedResult?: {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | undefined;
        terminal?: {
            type: "task.completed";
            completion: {
                [x: string]: any;
            };
        } | {
            type: "task.failed";
            completion: {
                [x: string]: any;
            };
        } | {
            reason: string;
            type: "task.cancelled";
            taskId: string;
            occurredAt: string;
            actionId?: string | undefined;
            stepId?: string | undefined;
            observationId?: string | undefined;
        } | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"heartbeat">;
        sentAt: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "heartbeat";
        sentAt: string;
    }, {
        type: "heartbeat";
        sentAt: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"protocol.error">;
        code: z.ZodString;
        message: z.ZodString;
        retryable: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    }, "strict", z.ZodTypeAny, {
        code: string;
        message: string;
        type: "protocol.error";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }, {
        code: string;
        message: string;
        type: "protocol.error";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }>]>, {
        type: "session.open";
        client: "browser_extension" | "desktop_connector" | "orchestrator";
        goal: string;
    } | {
        type: "session.accepted";
        acceptedAt: string;
        nextSequence: number;
    } | {
        type: "observation.submitted";
        observation?: any;
    } | {
        type: "action.command";
        proposal: {
            [x: string]: any;
        };
        policyDecision: {
            [x: string]: any;
        };
        command: {
            [x: string]: any;
        };
    } | {
        type: "action.acknowledged";
        actionId: string & z.BRAND<"ActionId">;
        stepId: string & z.BRAND<"StepId">;
        observationId: string & z.BRAND<"ObservationId">;
        acknowledgedAt: string;
    } | {
        type: "action.completed";
        result: {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        };
    } | {
        reason: string;
        type: "approval.requested";
        actionId: string & z.BRAND<"ActionId">;
        observationId: string & z.BRAND<"ObservationId">;
        approvalId: string & z.BRAND<"ApprovalId">;
        policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
        requestedAt: string;
    } | {
        type: "approval.resolved";
        resolution: {
            [x: string]: any;
        };
    } | {
        type: "task.completed";
        completion: {
            [x: string]: any;
        };
    } | {
        type: "task.failed";
        completion: {
            [x: string]: any;
        };
    } | {
        reason: string;
        type: "task.cancelled";
        taskId: string & z.BRAND<"TaskId">;
        occurredAt: string;
        actionId?: (string & z.BRAND<"ActionId">) | undefined;
        stepId?: (string & z.BRAND<"StepId">) | undefined;
        observationId?: (string & z.BRAND<"ObservationId">) | undefined;
    } | {
        type: "reconcile.request";
        requestedAt: string;
        lastReceivedSequence: number;
        lastSentClientSequence: number;
        pendingActionIds: (string & z.BRAND<"ActionId">)[];
    } | {
        type: "reconcile.response";
        nextSequence: number;
        pendingActionIds: (string & z.BRAND<"ActionId">)[];
        requiresFreshObservation: boolean;
        authoritativeState: "CREATED" | "OBSERVING" | "PLANNING" | "VALIDATING" | "POLICY_CHECK" | "WAITING_FOR_APPROVAL" | "WAITING_FOR_USER" | "DISPATCHING" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
        respondedAt: string;
        command?: {
            type: "action.command";
            proposal: {
                [x: string]: any;
            };
            policyDecision: {
                [x: string]: any;
            };
            command: {
                [x: string]: any;
            };
        } | undefined;
        storedResult?: {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | undefined;
        terminal?: {
            type: "task.completed";
            completion: {
                [x: string]: any;
            };
        } | {
            type: "task.failed";
            completion: {
                [x: string]: any;
            };
        } | {
            reason: string;
            type: "task.cancelled";
            taskId: string & z.BRAND<"TaskId">;
            occurredAt: string;
            actionId?: (string & z.BRAND<"ActionId">) | undefined;
            stepId?: (string & z.BRAND<"StepId">) | undefined;
            observationId?: (string & z.BRAND<"ObservationId">) | undefined;
        } | undefined;
    } | {
        type: "heartbeat";
        sentAt: string;
    } | {
        code: string;
        message: string;
        type: "protocol.error";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }, {
        type: "session.open";
        client: "browser_extension" | "desktop_connector" | "orchestrator";
        goal: string;
    } | {
        type: "session.accepted";
        acceptedAt: string;
        nextSequence: number;
    } | {
        type: "observation.submitted";
        observation?: any;
    } | {
        type: "action.command";
        proposal: {
            [x: string]: any;
        };
        policyDecision: {
            [x: string]: any;
        };
        command: {
            [x: string]: any;
        };
    } | {
        type: "action.acknowledged";
        actionId: string;
        stepId: string;
        observationId: string;
        acknowledgedAt: string;
    } | {
        type: "action.completed";
        result: {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        };
    } | {
        reason: string;
        type: "approval.requested";
        actionId: string;
        observationId: string;
        approvalId: string;
        policyDecisionId: string;
        requestedAt: string;
    } | {
        type: "approval.resolved";
        resolution: {
            [x: string]: any;
        };
    } | {
        type: "task.completed";
        completion: {
            [x: string]: any;
        };
    } | {
        type: "task.failed";
        completion: {
            [x: string]: any;
        };
    } | {
        reason: string;
        type: "task.cancelled";
        taskId: string;
        occurredAt: string;
        actionId?: string | undefined;
        stepId?: string | undefined;
        observationId?: string | undefined;
    } | {
        type: "reconcile.request";
        requestedAt: string;
        lastReceivedSequence: number;
        lastSentClientSequence: number;
        pendingActionIds: string[];
    } | {
        type: "reconcile.response";
        nextSequence: number;
        pendingActionIds: string[];
        requiresFreshObservation: boolean;
        authoritativeState: "CREATED" | "OBSERVING" | "PLANNING" | "VALIDATING" | "POLICY_CHECK" | "WAITING_FOR_APPROVAL" | "WAITING_FOR_USER" | "DISPATCHING" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
        respondedAt: string;
        command?: {
            type: "action.command";
            proposal: {
                [x: string]: any;
            };
            policyDecision: {
                [x: string]: any;
            };
            command: {
                [x: string]: any;
            };
        } | undefined;
        storedResult?: {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | undefined;
        terminal?: {
            type: "task.completed";
            completion: {
                [x: string]: any;
            };
        } | {
            type: "task.failed";
            completion: {
                [x: string]: any;
            };
        } | {
            reason: string;
            type: "task.cancelled";
            taskId: string;
            occurredAt: string;
            actionId?: string | undefined;
            stepId?: string | undefined;
            observationId?: string | undefined;
        } | undefined;
    } | {
        type: "heartbeat";
        sentAt: string;
    } | {
        code: string;
        message: string;
        type: "protocol.error";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }>;
    signature: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    protocolVersion: "1.0";
    sessionId: string & z.BRAND<"SessionId">;
    payload: {
        type: "session.open";
        client: "browser_extension" | "desktop_connector" | "orchestrator";
        goal: string;
    } | {
        type: "session.accepted";
        acceptedAt: string;
        nextSequence: number;
    } | {
        type: "observation.submitted";
        observation?: any;
    } | {
        type: "action.command";
        proposal: {
            [x: string]: any;
        };
        policyDecision: {
            [x: string]: any;
        };
        command: {
            [x: string]: any;
        };
    } | {
        type: "action.acknowledged";
        actionId: string & z.BRAND<"ActionId">;
        stepId: string & z.BRAND<"StepId">;
        observationId: string & z.BRAND<"ObservationId">;
        acknowledgedAt: string;
    } | {
        type: "action.completed";
        result: {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        };
    } | {
        reason: string;
        type: "approval.requested";
        actionId: string & z.BRAND<"ActionId">;
        observationId: string & z.BRAND<"ObservationId">;
        approvalId: string & z.BRAND<"ApprovalId">;
        policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
        requestedAt: string;
    } | {
        type: "approval.resolved";
        resolution: {
            [x: string]: any;
        };
    } | {
        type: "task.completed";
        completion: {
            [x: string]: any;
        };
    } | {
        type: "task.failed";
        completion: {
            [x: string]: any;
        };
    } | {
        reason: string;
        type: "task.cancelled";
        taskId: string & z.BRAND<"TaskId">;
        occurredAt: string;
        actionId?: (string & z.BRAND<"ActionId">) | undefined;
        stepId?: (string & z.BRAND<"StepId">) | undefined;
        observationId?: (string & z.BRAND<"ObservationId">) | undefined;
    } | {
        type: "reconcile.request";
        requestedAt: string;
        lastReceivedSequence: number;
        lastSentClientSequence: number;
        pendingActionIds: (string & z.BRAND<"ActionId">)[];
    } | {
        type: "reconcile.response";
        nextSequence: number;
        pendingActionIds: (string & z.BRAND<"ActionId">)[];
        requiresFreshObservation: boolean;
        authoritativeState: "CREATED" | "OBSERVING" | "PLANNING" | "VALIDATING" | "POLICY_CHECK" | "WAITING_FOR_APPROVAL" | "WAITING_FOR_USER" | "DISPATCHING" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
        respondedAt: string;
        command?: {
            type: "action.command";
            proposal: {
                [x: string]: any;
            };
            policyDecision: {
                [x: string]: any;
            };
            command: {
                [x: string]: any;
            };
        } | undefined;
        storedResult?: {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | undefined;
        terminal?: {
            type: "task.completed";
            completion: {
                [x: string]: any;
            };
        } | {
            type: "task.failed";
            completion: {
                [x: string]: any;
            };
        } | {
            reason: string;
            type: "task.cancelled";
            taskId: string & z.BRAND<"TaskId">;
            occurredAt: string;
            actionId?: (string & z.BRAND<"ActionId">) | undefined;
            stepId?: (string & z.BRAND<"StepId">) | undefined;
            observationId?: (string & z.BRAND<"ObservationId">) | undefined;
        } | undefined;
    } | {
        type: "heartbeat";
        sentAt: string;
    } | {
        code: string;
        message: string;
        type: "protocol.error";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    messageId: string & z.BRAND<"MessageId">;
    correlationId: string;
    causationId: string;
    recipientId: string;
    sequence: number;
    createdAt: string;
    expiresAt: number;
    tenantId?: string | undefined;
    deviceId?: string | undefined;
    signature?: string | undefined;
}, {
    protocolVersion: "1.0";
    sessionId: string;
    payload: {
        type: "session.open";
        client: "browser_extension" | "desktop_connector" | "orchestrator";
        goal: string;
    } | {
        type: "session.accepted";
        acceptedAt: string;
        nextSequence: number;
    } | {
        type: "observation.submitted";
        observation?: any;
    } | {
        type: "action.command";
        proposal: {
            [x: string]: any;
        };
        policyDecision: {
            [x: string]: any;
        };
        command: {
            [x: string]: any;
        };
    } | {
        type: "action.acknowledged";
        actionId: string;
        stepId: string;
        observationId: string;
        acknowledgedAt: string;
    } | {
        type: "action.completed";
        result: {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        };
    } | {
        reason: string;
        type: "approval.requested";
        actionId: string;
        observationId: string;
        approvalId: string;
        policyDecisionId: string;
        requestedAt: string;
    } | {
        type: "approval.resolved";
        resolution: {
            [x: string]: any;
        };
    } | {
        type: "task.completed";
        completion: {
            [x: string]: any;
        };
    } | {
        type: "task.failed";
        completion: {
            [x: string]: any;
        };
    } | {
        reason: string;
        type: "task.cancelled";
        taskId: string;
        occurredAt: string;
        actionId?: string | undefined;
        stepId?: string | undefined;
        observationId?: string | undefined;
    } | {
        type: "reconcile.request";
        requestedAt: string;
        lastReceivedSequence: number;
        lastSentClientSequence: number;
        pendingActionIds: string[];
    } | {
        type: "reconcile.response";
        nextSequence: number;
        pendingActionIds: string[];
        requiresFreshObservation: boolean;
        authoritativeState: "CREATED" | "OBSERVING" | "PLANNING" | "VALIDATING" | "POLICY_CHECK" | "WAITING_FOR_APPROVAL" | "WAITING_FOR_USER" | "DISPATCHING" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
        respondedAt: string;
        command?: {
            type: "action.command";
            proposal: {
                [x: string]: any;
            };
            policyDecision: {
                [x: string]: any;
            };
            command: {
                [x: string]: any;
            };
        } | undefined;
        storedResult?: {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | undefined;
        terminal?: {
            type: "task.completed";
            completion: {
                [x: string]: any;
            };
        } | {
            type: "task.failed";
            completion: {
                [x: string]: any;
            };
        } | {
            reason: string;
            type: "task.cancelled";
            taskId: string;
            occurredAt: string;
            actionId?: string | undefined;
            stepId?: string | undefined;
            observationId?: string | undefined;
        } | undefined;
    } | {
        type: "heartbeat";
        sentAt: string;
    } | {
        code: string;
        message: string;
        type: "protocol.error";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    messageId: string;
    correlationId: string;
    causationId: string;
    recipientId: string;
    sequence: number;
    createdAt: string;
    expiresAt: number;
    tenantId?: string | undefined;
    deviceId?: string | undefined;
    signature?: string | undefined;
}>, {
    protocolVersion: "1.0";
    sessionId: string & z.BRAND<"SessionId">;
    payload: {
        type: "session.open";
        client: "browser_extension" | "desktop_connector" | "orchestrator";
        goal: string;
    } | {
        type: "session.accepted";
        acceptedAt: string;
        nextSequence: number;
    } | {
        type: "observation.submitted";
        observation?: any;
    } | {
        type: "action.command";
        proposal: {
            [x: string]: any;
        };
        policyDecision: {
            [x: string]: any;
        };
        command: {
            [x: string]: any;
        };
    } | {
        type: "action.acknowledged";
        actionId: string & z.BRAND<"ActionId">;
        stepId: string & z.BRAND<"StepId">;
        observationId: string & z.BRAND<"ObservationId">;
        acknowledgedAt: string;
    } | {
        type: "action.completed";
        result: {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        };
    } | {
        reason: string;
        type: "approval.requested";
        actionId: string & z.BRAND<"ActionId">;
        observationId: string & z.BRAND<"ObservationId">;
        approvalId: string & z.BRAND<"ApprovalId">;
        policyDecisionId: string & z.BRAND<"PolicyDecisionId">;
        requestedAt: string;
    } | {
        type: "approval.resolved";
        resolution: {
            [x: string]: any;
        };
    } | {
        type: "task.completed";
        completion: {
            [x: string]: any;
        };
    } | {
        type: "task.failed";
        completion: {
            [x: string]: any;
        };
    } | {
        reason: string;
        type: "task.cancelled";
        taskId: string & z.BRAND<"TaskId">;
        occurredAt: string;
        actionId?: (string & z.BRAND<"ActionId">) | undefined;
        stepId?: (string & z.BRAND<"StepId">) | undefined;
        observationId?: (string & z.BRAND<"ObservationId">) | undefined;
    } | {
        type: "reconcile.request";
        requestedAt: string;
        lastReceivedSequence: number;
        lastSentClientSequence: number;
        pendingActionIds: (string & z.BRAND<"ActionId">)[];
    } | {
        type: "reconcile.response";
        nextSequence: number;
        pendingActionIds: (string & z.BRAND<"ActionId">)[];
        requiresFreshObservation: boolean;
        authoritativeState: "CREATED" | "OBSERVING" | "PLANNING" | "VALIDATING" | "POLICY_CHECK" | "WAITING_FOR_APPROVAL" | "WAITING_FOR_USER" | "DISPATCHING" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
        respondedAt: string;
        command?: {
            type: "action.command";
            proposal: {
                [x: string]: any;
            };
            policyDecision: {
                [x: string]: any;
            };
            command: {
                [x: string]: any;
            };
        } | undefined;
        storedResult?: {
            status: "succeeded";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string & z.BRAND<"ObservationId">;
            durationMs: number;
            actionId: string & z.BRAND<"ActionId">;
            stepId: string & z.BRAND<"StepId">;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | undefined;
        terminal?: {
            type: "task.completed";
            completion: {
                [x: string]: any;
            };
        } | {
            type: "task.failed";
            completion: {
                [x: string]: any;
            };
        } | {
            reason: string;
            type: "task.cancelled";
            taskId: string & z.BRAND<"TaskId">;
            occurredAt: string;
            actionId?: (string & z.BRAND<"ActionId">) | undefined;
            stepId?: (string & z.BRAND<"StepId">) | undefined;
            observationId?: (string & z.BRAND<"ObservationId">) | undefined;
        } | undefined;
    } | {
        type: "heartbeat";
        sentAt: string;
    } | {
        code: string;
        message: string;
        type: "protocol.error";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    messageId: string & z.BRAND<"MessageId">;
    correlationId: string;
    causationId: string;
    recipientId: string;
    sequence: number;
    createdAt: string;
    expiresAt: number;
    tenantId?: string | undefined;
    deviceId?: string | undefined;
    signature?: string | undefined;
}, {
    protocolVersion: "1.0";
    sessionId: string;
    payload: {
        type: "session.open";
        client: "browser_extension" | "desktop_connector" | "orchestrator";
        goal: string;
    } | {
        type: "session.accepted";
        acceptedAt: string;
        nextSequence: number;
    } | {
        type: "observation.submitted";
        observation?: any;
    } | {
        type: "action.command";
        proposal: {
            [x: string]: any;
        };
        policyDecision: {
            [x: string]: any;
        };
        command: {
            [x: string]: any;
        };
    } | {
        type: "action.acknowledged";
        actionId: string;
        stepId: string;
        observationId: string;
        acknowledgedAt: string;
    } | {
        type: "action.completed";
        result: {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        };
    } | {
        reason: string;
        type: "approval.requested";
        actionId: string;
        observationId: string;
        approvalId: string;
        policyDecisionId: string;
        requestedAt: string;
    } | {
        type: "approval.resolved";
        resolution: {
            [x: string]: any;
        };
    } | {
        type: "task.completed";
        completion: {
            [x: string]: any;
        };
    } | {
        type: "task.failed";
        completion: {
            [x: string]: any;
        };
    } | {
        reason: string;
        type: "task.cancelled";
        taskId: string;
        occurredAt: string;
        actionId?: string | undefined;
        stepId?: string | undefined;
        observationId?: string | undefined;
    } | {
        type: "reconcile.request";
        requestedAt: string;
        lastReceivedSequence: number;
        lastSentClientSequence: number;
        pendingActionIds: string[];
    } | {
        type: "reconcile.response";
        nextSequence: number;
        pendingActionIds: string[];
        requiresFreshObservation: boolean;
        authoritativeState: "CREATED" | "OBSERVING" | "PLANNING" | "VALIDATING" | "POLICY_CHECK" | "WAITING_FOR_APPROVAL" | "WAITING_FOR_USER" | "DISPATCHING" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
        respondedAt: string;
        command?: {
            type: "action.command";
            proposal: {
                [x: string]: any;
            };
            policyDecision: {
                [x: string]: any;
            };
            command: {
                [x: string]: any;
            };
        } | undefined;
        storedResult?: {
            status: "succeeded";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "failed_recoverable" | "failed_terminal";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            error: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | {
            status: "approval_required" | "rejected_stale" | "rejected_policy";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            rejection: {
                code: string;
                message: string;
                retryable: boolean;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
        } | {
            status: "cancelled";
            observationId: string;
            durationMs: number;
            actionId: string;
            stepId: string;
            sequence: number;
            startedAt: string;
            completedAt: string;
            cancellation: {
                reason?: string | undefined;
            };
            dialog?: {
                kind: "alert" | "confirm" | "prompt" | "beforeunload";
                present: boolean;
            } | undefined;
            target?: any;
            navigation?: {
                url: string;
                title?: string | undefined;
            } | undefined;
            postObservation?: any;
        } | undefined;
        terminal?: {
            type: "task.completed";
            completion: {
                [x: string]: any;
            };
        } | {
            type: "task.failed";
            completion: {
                [x: string]: any;
            };
        } | {
            reason: string;
            type: "task.cancelled";
            taskId: string;
            occurredAt: string;
            actionId?: string | undefined;
            stepId?: string | undefined;
            observationId?: string | undefined;
        } | undefined;
    } | {
        type: "heartbeat";
        sentAt: string;
    } | {
        code: string;
        message: string;
        type: "protocol.error";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    messageId: string;
    correlationId: string;
    causationId: string;
    recipientId: string;
    sequence: number;
    createdAt: string;
    expiresAt: number;
    tenantId?: string | undefined;
    deviceId?: string | undefined;
    signature?: string | undefined;
}>;
export type AgentEnvelopeV1 = z.infer<typeof AgentEnvelopeV1Schema>;
export interface EnvelopeSigner {
    sign(canonicalBytes: Uint8Array): Promise<string>;
    verify(canonicalBytes: Uint8Array, signature: string): Promise<boolean>;
}
export interface CreateEnvelopeInput {
    messageId: string;
    sessionId: string;
    correlationId: string;
    causationId: string;
    recipientId: string;
    tenantId?: string;
    deviceId?: string;
    sequence: number;
    createdAt: string;
    expiresAt: number;
    payload: AgentMessageV1;
}
export declare function createEnvelope(input: CreateEnvelopeInput): AgentEnvelopeV1;
/** UTF-8 bytes for deterministic signing. The signature itself is not signed. */
export declare function canonicalEnvelopeBytes(envelope: AgentEnvelopeV1): Uint8Array;
export declare function signEnvelope(envelope: AgentEnvelopeV1, signer: EnvelopeSigner): Promise<AgentEnvelopeV1>;
export declare function verifyEnvelopeSignature(envelope: AgentEnvelopeV1, signer: EnvelopeSigner): Promise<boolean>;
//# sourceMappingURL=envelope.d.ts.map