import { z } from 'zod';

declare const SessionIdSchema: z.ZodBranded<z.ZodString, "SessionId">;
declare const RunIdSchema: z.ZodBranded<z.ZodString, "RunId">;
declare const TaskIdSchema: z.ZodBranded<z.ZodString, "TaskId">;
declare const StepIdSchema: z.ZodBranded<z.ZodString, "StepId">;
declare const ObservationIdSchema: z.ZodBranded<z.ZodString, "ObservationId">;
declare const ActionIdSchema: z.ZodBranded<z.ZodString, "ActionId">;
declare const PolicyDecisionIdSchema: z.ZodBranded<z.ZodString, "PolicyDecisionId">;
declare const EventIdSchema: z.ZodBranded<z.ZodString, "EventId">;
declare const MessageIdSchema: z.ZodBranded<z.ZodString, "MessageId">;
declare const ArtifactIdSchema: z.ZodBranded<z.ZodString, "ArtifactId">;
declare const SemanticTargetIdSchema: z.ZodBranded<z.ZodString, "SemanticTargetId">;
declare const TabIdSchema: z.ZodBranded<z.ZodString, "TabId">;
declare const FrameIdSchema: z.ZodBranded<z.ZodString, "FrameId">;
declare const FramePathSegmentIdSchema: z.ZodBranded<z.ZodString, "FramePathSegmentId">;
declare const ShadowPathSegmentIdSchema: z.ZodBranded<z.ZodString, "ShadowPathSegmentId">;
declare const ApprovalIdSchema: z.ZodBranded<z.ZodString, "ApprovalId">;
declare const SequenceSchema: z.ZodNumber;
declare const IdempotencyKeySchema: z.ZodString;
type SessionId = z.infer<typeof SessionIdSchema>;
type RunId = z.infer<typeof RunIdSchema>;
type TaskId = z.infer<typeof TaskIdSchema>;
type StepId = z.infer<typeof StepIdSchema>;
type ObservationId$1 = z.infer<typeof ObservationIdSchema>;
type ActionId = z.infer<typeof ActionIdSchema>;
type PolicyDecisionId = z.infer<typeof PolicyDecisionIdSchema>;
type EventId = z.infer<typeof EventIdSchema>;
type MessageId = z.infer<typeof MessageIdSchema>;
type ArtifactId = z.infer<typeof ArtifactIdSchema>;
type SemanticTargetId = z.infer<typeof SemanticTargetIdSchema>;
type TabId = z.infer<typeof TabIdSchema>;
type FrameId = z.infer<typeof FrameIdSchema>;
type FramePathSegmentId = z.infer<typeof FramePathSegmentIdSchema>;
type ShadowPathSegmentId = z.infer<typeof ShadowPathSegmentIdSchema>;
type ApprovalId = z.infer<typeof ApprovalIdSchema>;
type Sequence = z.infer<typeof SequenceSchema>;

declare const FORBIDDEN_BROWSER_DATA_KEYS: Set<string>;
declare class ForbiddenBrowserDataError extends Error {
    readonly keyPath: string;
    constructor(keyPath: string);
}
declare function isHttpUrl(url: string): boolean;
/** Rejects browser-secret shaped keys anywhere in a value before serialization. */
declare function assertNoForbiddenBrowserData(value: unknown): void;
declare const SanitizedAccessibleNameSchema: z.ZodObject<{
    source: z.ZodEnum<["aria-label", "aria-labelledby", "visible_text"]>;
    text: z.ZodEffects<z.ZodString, string, string>;
}, "strict", z.ZodTypeAny, {
    source: "aria-label" | "aria-labelledby" | "visible_text";
    text: string;
}, {
    source: "aria-label" | "aria-labelledby" | "visible_text";
    text: string;
}>;
declare const LocatorCandidateV1Schema: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
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
}>]>;
declare const ControlMetadataSchema: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
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
declare const ScreenshotSchema: z.ZodEffects<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
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
declare const ViewportSchema: z.ZodObject<{
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
declare const PageStateSchema: z.ZodObject<{
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
declare const BoundingBoxSchema: z.ZodObject<{
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
declare const SemanticTargetSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
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
        'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
        'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
        'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
        'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
        'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
    }, "strict", z.ZodTypeAny, {
        'aria-label'?: string | undefined;
        'aria-describedby'?: string | undefined;
        'aria-controls'?: string | undefined;
        'aria-expanded'?: "true" | "false" | undefined;
        'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
        'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
        'aria-pressed'?: "true" | "false" | "mixed" | undefined;
        'aria-selected'?: "true" | "false" | undefined;
    }, {
        'aria-label'?: string | undefined;
        'aria-describedby'?: string | undefined;
        'aria-controls'?: string | undefined;
        'aria-expanded'?: "true" | "false" | undefined;
        'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
        'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
        'aria-pressed'?: "true" | "false" | "mixed" | undefined;
        'aria-selected'?: "true" | "false" | undefined;
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
        'aria-label'?: string | undefined;
        'aria-describedby'?: string | undefined;
        'aria-controls'?: string | undefined;
        'aria-expanded'?: "true" | "false" | undefined;
        'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
        'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
        'aria-pressed'?: "true" | "false" | "mixed" | undefined;
        'aria-selected'?: "true" | "false" | undefined;
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
        'aria-label'?: string | undefined;
        'aria-describedby'?: string | undefined;
        'aria-controls'?: string | undefined;
        'aria-expanded'?: "true" | "false" | undefined;
        'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
        'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
        'aria-pressed'?: "true" | "false" | "mixed" | undefined;
        'aria-selected'?: "true" | "false" | undefined;
    } | undefined;
    shadowPath?: string[] | undefined;
}>, any, any>, any, any>;
declare const AXTupleSchema: z.ZodObject<{
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
}>;
declare const AccessibilityNodeSchema: z.ZodObject<{
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
}>;
declare const ObservationV1Schema: z.ZodEffects<z.ZodObject<{
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
            'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
            'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
            'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
            'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
        }, "strict", z.ZodTypeAny, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
        }, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
type Screenshot = z.infer<typeof ScreenshotSchema>;
type PageState = z.infer<typeof PageStateSchema>;
type SemanticTarget = z.infer<typeof SemanticTargetSchema>;
type SanitizedAccessibleName = z.infer<typeof SanitizedAccessibleNameSchema>;
type LocatorCandidateV1 = z.infer<typeof LocatorCandidateV1Schema>;
type ControlMetadata = z.infer<typeof ControlMetadataSchema>;
type ObservationV1 = z.infer<typeof ObservationV1Schema>;
type AXTuple = z.infer<typeof AXTupleSchema>;
type AccessibilityNode = z.infer<typeof AccessibilityNodeSchema>;

declare const ExecutableActionV1Schema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
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
declare const ActionProposalV1Schema: z.ZodEffects<z.ZodObject<{
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
declare const CompletionFindingV1Schema: z.ZodObject<{
    fact: z.ZodString;
    observationIds: z.ZodArray<z.ZodBranded<z.ZodString, "ObservationId">, "many">;
}, "strict", z.ZodTypeAny, {
    fact: string;
    observationIds: (string & z.BRAND<"ObservationId">)[];
}, {
    fact: string;
    observationIds: string[];
}>;
declare const CompletionProposalV1Schema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
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
}>;
declare const AgentProposalV1Schema: z.ZodUnion<[z.ZodEffects<z.ZodObject<{
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
}>, z.ZodEffects<z.ZodEffects<z.ZodObject<{
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
}>]>;
declare const PolicyContextV1Schema: z.ZodObject<{
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
declare const PolicyDecisionV1Schema: z.ZodEffects<z.ZodObject<{
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
declare const ApprovalResolutionV1Schema: z.ZodEffects<z.ZodObject<{
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
declare const ActionCommandV1Schema: z.ZodEffects<z.ZodObject<{
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
type ExecutableActionV1 = z.infer<typeof ExecutableActionV1Schema>;
type ActionProposalV1 = z.infer<typeof ActionProposalV1Schema>;
type CompletionFindingV1 = z.infer<typeof CompletionFindingV1Schema>;
type CompletionProposalV1 = z.infer<typeof CompletionProposalV1Schema>;
type AgentProposalV1 = z.infer<typeof AgentProposalV1Schema>;
type PolicyContextV1 = z.infer<typeof PolicyContextV1Schema>;
type PolicyDecisionV1 = z.infer<typeof PolicyDecisionV1Schema>;
type ApprovalResolutionV1 = z.infer<typeof ApprovalResolutionV1Schema>;
type ActionCommandV1 = z.infer<typeof ActionCommandV1Schema>;

declare const ActionResultStatusV1Schema: z.ZodEnum<["succeeded", "failed_recoverable", "failed_terminal", "rejected_stale", "rejected_policy", "approval_required", "cancelled"]>;
declare const ActionErrorV1Schema: z.ZodObject<{
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
declare const NavigationEffectV1Schema: z.ZodObject<{
    url: z.ZodEffects<z.ZodString, string, string>;
    title: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    url: string;
    title?: string | undefined;
}, {
    url: string;
    title?: string | undefined;
}>;
declare const DialogEffectV1Schema: z.ZodObject<{
    kind: z.ZodEnum<["alert", "confirm", "prompt", "beforeunload"]>;
    present: z.ZodBoolean;
}, "strict", z.ZodTypeAny, {
    kind: "alert" | "confirm" | "prompt" | "beforeunload";
    present: boolean;
}, {
    kind: "alert" | "confirm" | "prompt" | "beforeunload";
    present: boolean;
}>;
declare const SucceededActionResultV1Schema: z.ZodObject<{
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
            'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
            'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
            'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
            'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
        }, "strict", z.ZodTypeAny, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
        }, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
}>;
declare const FailedActionResultV1Schema: z.ZodObject<{
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
            'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
            'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
            'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
            'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
        }, "strict", z.ZodTypeAny, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
        }, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
}>;
declare const RejectedActionResultV1Schema: z.ZodObject<{
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
            'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
            'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
            'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
            'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
        }, "strict", z.ZodTypeAny, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
        }, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
}>;
declare const CancelledActionResultV1Schema: z.ZodObject<{
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
            'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
            'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
            'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
            'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
        }, "strict", z.ZodTypeAny, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
        }, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
}>;
declare const ActionResultV1Schema: z.ZodEffects<z.ZodUnion<[z.ZodObject<{
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
            'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
            'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
            'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
            'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
        }, "strict", z.ZodTypeAny, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
        }, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
            'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
            'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
            'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
        }, "strict", z.ZodTypeAny, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
        }, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
            'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
            'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
            'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
        }, "strict", z.ZodTypeAny, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
        }, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
            'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
            'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
            'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
        }, "strict", z.ZodTypeAny, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
        }, {
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
            'aria-label'?: string | undefined;
            'aria-describedby'?: string | undefined;
            'aria-controls'?: string | undefined;
            'aria-expanded'?: "true" | "false" | undefined;
            'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
            'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
            'aria-pressed'?: "true" | "false" | "mixed" | undefined;
            'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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

type ActionResultStatusV1 = z.infer<typeof ActionResultStatusV1Schema>;
type ActionErrorV1 = z.infer<typeof ActionErrorV1Schema>;
type NavigationEffectV1 = z.infer<typeof NavigationEffectV1Schema>;
type DialogEffectV1 = z.infer<typeof DialogEffectV1Schema>;
type ActionResultV1 = z.infer<typeof ActionResultV1Schema>;

declare const TrajectoryEventKindV1Schema: z.ZodEnum<["session_lifecycle", "observation_captured", "model_request", "model_response", "model_parse_failure", "action_proposed", "policy_decided", "approval_requested", "approval_resolved", "action_dispatched", "action_acknowledged", "action_completed", "verification_result", "task_terminal_outcome"]>;
declare const TrajectoryEventV1Schema: z.ZodEffects<z.ZodObject<{
    eventId: z.ZodBranded<z.ZodString, "EventId">;
    sessionId: z.ZodBranded<z.ZodString, "SessionId">;
    taskId: z.ZodBranded<z.ZodString, "TaskId">;
    stepId: z.ZodOptional<z.ZodBranded<z.ZodString, "StepId">>;
    actionId: z.ZodOptional<z.ZodBranded<z.ZodString, "ActionId">>;
    observationId: z.ZodOptional<z.ZodBranded<z.ZodString, "ObservationId">>;
    correlationId: z.ZodOptional<z.ZodString>;
    causationId: z.ZodOptional<z.ZodBranded<z.ZodString, "EventId">>;
    sequence: z.ZodNumber;
    occurredAt: z.ZodString;
    kind: z.ZodEnum<["session_lifecycle", "observation_captured", "model_request", "model_response", "model_parse_failure", "action_proposed", "policy_decided", "approval_requested", "approval_resolved", "action_dispatched", "action_acknowledged", "action_completed", "verification_result", "task_terminal_outcome"]>;
    summary: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    kind: "session_lifecycle" | "observation_captured" | "model_request" | "model_response" | "model_parse_failure" | "action_proposed" | "policy_decided" | "approval_requested" | "approval_resolved" | "action_dispatched" | "action_acknowledged" | "action_completed" | "verification_result" | "task_terminal_outcome";
    sequence: number;
    eventId: string & z.BRAND<"EventId">;
    sessionId: string & z.BRAND<"SessionId">;
    taskId: string & z.BRAND<"TaskId">;
    occurredAt: string;
    observationId?: (string & z.BRAND<"ObservationId">) | undefined;
    summary?: string | undefined;
    actionId?: (string & z.BRAND<"ActionId">) | undefined;
    stepId?: (string & z.BRAND<"StepId">) | undefined;
    correlationId?: string | undefined;
    causationId?: (string & z.BRAND<"EventId">) | undefined;
}, {
    kind: "session_lifecycle" | "observation_captured" | "model_request" | "model_response" | "model_parse_failure" | "action_proposed" | "policy_decided" | "approval_requested" | "approval_resolved" | "action_dispatched" | "action_acknowledged" | "action_completed" | "verification_result" | "task_terminal_outcome";
    sequence: number;
    eventId: string;
    sessionId: string;
    taskId: string;
    occurredAt: string;
    observationId?: string | undefined;
    summary?: string | undefined;
    actionId?: string | undefined;
    stepId?: string | undefined;
    correlationId?: string | undefined;
    causationId?: string | undefined;
}>, {
    kind: "session_lifecycle" | "observation_captured" | "model_request" | "model_response" | "model_parse_failure" | "action_proposed" | "policy_decided" | "approval_requested" | "approval_resolved" | "action_dispatched" | "action_acknowledged" | "action_completed" | "verification_result" | "task_terminal_outcome";
    sequence: number;
    eventId: string & z.BRAND<"EventId">;
    sessionId: string & z.BRAND<"SessionId">;
    taskId: string & z.BRAND<"TaskId">;
    occurredAt: string;
    observationId?: (string & z.BRAND<"ObservationId">) | undefined;
    summary?: string | undefined;
    actionId?: (string & z.BRAND<"ActionId">) | undefined;
    stepId?: (string & z.BRAND<"StepId">) | undefined;
    correlationId?: string | undefined;
    causationId?: (string & z.BRAND<"EventId">) | undefined;
}, {
    kind: "session_lifecycle" | "observation_captured" | "model_request" | "model_response" | "model_parse_failure" | "action_proposed" | "policy_decided" | "approval_requested" | "approval_resolved" | "action_dispatched" | "action_acknowledged" | "action_completed" | "verification_result" | "task_terminal_outcome";
    sequence: number;
    eventId: string;
    sessionId: string;
    taskId: string;
    occurredAt: string;
    observationId?: string | undefined;
    summary?: string | undefined;
    actionId?: string | undefined;
    stepId?: string | undefined;
    correlationId?: string | undefined;
    causationId?: string | undefined;
}>;
declare const TrajectoryLinkageV1Schema: z.ZodEffects<z.ZodObject<{
    sourceObservation: z.ZodEffects<z.ZodObject<{
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
    approvalResolution: z.ZodOptional<z.ZodEffects<z.ZodObject<{
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
    }>>;
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                    'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
                }, {
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
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
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
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
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                    'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
                }, {
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
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
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
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
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            }, "strict", z.ZodTypeAny, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
            }, {
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                'aria-label'?: string | undefined;
                'aria-describedby'?: string | undefined;
                'aria-controls'?: string | undefined;
                'aria-expanded'?: "true" | "false" | undefined;
                'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                'aria-selected'?: "true" | "false" | undefined;
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
                    'aria-label': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    'aria-describedby': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    'aria-controls': z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                    'aria-expanded': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                    'aria-haspopup': z.ZodOptional<z.ZodEnum<["true", "false", "menu", "listbox", "tree", "grid", "dialog"]>>;
                    'aria-current': z.ZodOptional<z.ZodEnum<["true", "false", "page", "step", "location", "date", "time"]>>;
                    'aria-pressed': z.ZodOptional<z.ZodEnum<["true", "false", "mixed"]>>;
                    'aria-selected': z.ZodOptional<z.ZodEnum<["true", "false"]>>;
                }, "strict", z.ZodTypeAny, {
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
                }, {
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
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
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
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
                    'aria-label'?: string | undefined;
                    'aria-describedby'?: string | undefined;
                    'aria-controls'?: string | undefined;
                    'aria-expanded'?: "true" | "false" | undefined;
                    'aria-haspopup'?: "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
                    'aria-current'?: "true" | "false" | "page" | "step" | "location" | "date" | "time" | undefined;
                    'aria-pressed'?: "true" | "false" | "mixed" | undefined;
                    'aria-selected'?: "true" | "false" | undefined;
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
    proposal: {
        [x: string]: any;
    };
    command: {
        [x: string]: any;
    };
    policyDecision: {
        [x: string]: any;
    };
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
    sourceObservation?: any;
    approvalResolution?: {
        [x: string]: any;
    } | undefined;
}, {
    proposal: {
        [x: string]: any;
    };
    command: {
        [x: string]: any;
    };
    policyDecision: {
        [x: string]: any;
    };
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
    sourceObservation?: any;
    approvalResolution?: {
        [x: string]: any;
    } | undefined;
}>, {
    proposal: {
        [x: string]: any;
    };
    command: {
        [x: string]: any;
    };
    policyDecision: {
        [x: string]: any;
    };
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
    sourceObservation?: any;
    approvalResolution?: {
        [x: string]: any;
    } | undefined;
}, {
    proposal: {
        [x: string]: any;
    };
    command: {
        [x: string]: any;
    };
    policyDecision: {
        [x: string]: any;
    };
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
    sourceObservation?: any;
    approvalResolution?: {
        [x: string]: any;
    } | undefined;
}>;
type TrajectoryEventKindV1 = z.infer<typeof TrajectoryEventKindV1Schema>;
type TrajectoryEventV1 = z.infer<typeof TrajectoryEventV1Schema>;
type TrajectoryLinkageV1 = z.infer<typeof TrajectoryLinkageV1Schema>;

/**
 * Coordinate and viewport types for Brotto actions.
 * All coordinates are in viewport pixel space (not device pixels).
 */
/**
 * Represents a 2D point in viewport coordinates.
 */
interface Coordinates {
    x: number;
    y: number;
}
/**
 * Represents a bounding box in viewport coordinates.
 */
interface BoundingBox {
    /** Top-left x coordinate */
    x: number;
    /** Top-left y coordinate */
    y: number;
    /** Width of the bounding box */
    width: number;
    /** Height of the bounding box */
    height: number;
}
/**
 * Viewport dimensions.
 */
interface Viewport {
    /** Viewport width in pixels */
    width: number;
    /** Viewport height in pixels */
    height: number;
}
/**
 * Viewport configuration with scale factor.
 * Device pixel ratio for converting between device and CSS pixels.
 */
interface ViewportConfig extends Viewport {
    /** Device pixel ratio (default: 1.0) */
    devicePixelRatio: number;
}
/**
 * Normalized coordinates used in model observations.
 * These are coordinates normalized to a fixed model canvas size.
 */
interface NormalizedCoordinates {
    /** X coordinate normalized to [0, 1] range */
    normalizedX: number;
    /** Y coordinate normalized to [0, 1] range */
    normalizedY: number;
}
/**
 * Drag start and end coordinates.
 */
interface DragCoordinates {
    /** Starting coordinate */
    start: Coordinates;
    /** Ending coordinate */
    end: Coordinates;
}
/**
 * Scroll direction and amount.
 */
interface ScrollDelta {
    /** Horizontal scroll amount (positive = right, negative = left) */
    deltaX: number;
    /** Vertical scroll amount (positive = down, negative = up) */
    deltaY: number;
}
/**
 * Viewport bounds for coordinate validation.
 * Coordinates must fall within these bounds to be valid.
 */
interface ViewportBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
/**
 * Creates a default empty viewport.
 */
declare function createDefaultViewport(): Viewport;
/**
 * Creates a default viewport config.
 */
declare function createDefaultViewportConfig(): ViewportConfig;

/**
 * Observation ID types for Brotto actions.
 * Observation IDs are monotonically increasing integers used to track
 * the sequence of observations in a session.
 */
/**
 * A monotonically increasing observation identifier.
 * Each new observation received from the browser increments this value.
 */
interface ObservationId {
    /** The numeric ID value (monotonically increasing) */
    readonly value: number;
}
/**
 * Creates a new observation ID from a number.
 */
declare function createObservationId(value: number): ObservationId;
/**
 * Compares two observation IDs.
 * Returns negative if a < b, zero if a === b, positive if a > b.
 */
declare function compareObservationIds(a: ObservationId, b: ObservationId): number;
/**
 * Checks if an observation ID is validly formed (non-negative integer).
 */
declare function isValidObservationId(value: number): boolean;
/**
 * The next observation ID in sequence from a given ID.
 */
declare function getNextObservationId(current: ObservationId): ObservationId;
/**
 * Observation ID counter for generating new IDs.
 */
declare class ObservationIdCounter {
    private currentValue;
    /**
     * Creates a new counter starting at 0 (or a given initial value).
     */
    constructor(initialValue?: number);
    /**
     * Returns the next observation ID and increments the counter.
     */
    next(): ObservationId;
    /**
     * Returns the current ID without incrementing.
     */
    peek(): ObservationId;
    /**
     * Resets the counter to a specific value.
     */
    reset(value?: number): void;
    /**
     * Returns the current raw value.
     */
    getCurrentValue(): number;
}

/**
 * Brotto action type definitions.
 * Defines all actions the Brotto model can produce for browser automation.
 */

/**
 * Enum of all Brotto action types.
 */
declare enum ActionType {
    LEFT_CLICK = "left_click",
    DOUBLE_CLICK = "double_click",
    RIGHT_CLICK = "right_click",
    DRAG = "drag",
    MOUSE_MOVE = "mouse_move",
    SCROLL = "scroll",
    KEY = "key",
    INSERT_TEXT = "insert_text",
    VISIT_URL = "visit_url",
    HISTORY_BACK = "history_back",
    SCREENSHOT = "screenshot",
    WAIT = "wait",
    ASK_USER_QUESTION = "ask_user_question",
    TERMINATE = "terminate",
    PAUSE_AND_MEMORIZE_FACT = "pause_and_memorize_fact",
    MEMORIZE_FACT = "memorize_fact"
}
/**
 * Base interface for all Brotto actions.
 */
interface BaseAction<T extends ActionType> {
    /** Unique identifier for this action instance */
    readonly id: string;
    /** The type of action */
    readonly type: T;
    /** Observation ID this action is based on */
    readonly observationId: ObservationId;
    /** Timestamp when action was created (Unix epoch ms) */
    readonly timestamp: number;
}
/**
 * Action arguments that include viewport context.
 */
interface ViewportContext {
    /** Viewport width at time of action */
    viewportWidth: number;
    /** Viewport height at time of action */
    viewportHeight: number;
}
/**
 * Left click action - clicks at viewport coordinates.
 */
interface LeftClickAction extends BaseAction<ActionType.LEFT_CLICK> {
    /** Target coordinates in viewport space */
    coordinates: Coordinates;
    /** Viewport context */
    viewport: ViewportContext;
}
/**
 * Double click action - double-clicks at viewport coordinates.
 */
interface DoubleClickAction extends BaseAction<ActionType.DOUBLE_CLICK> {
    /** Target coordinates in viewport space */
    coordinates: Coordinates;
    /** Viewport context */
    viewport: ViewportContext;
}
/**
 * Right click action - right-clicks at viewport coordinates.
 */
interface RightClickAction extends BaseAction<ActionType.RIGHT_CLICK> {
    /** Target coordinates in viewport space */
    coordinates: Coordinates;
    /** Viewport context */
    viewport: ViewportContext;
}
/**
 * Drag action - drags from one coordinate to another.
 */
interface DragAction extends BaseAction<ActionType.DRAG> {
    /** Start and end coordinates */
    coordinates: DragCoordinates;
    /** Viewport context */
    viewport: ViewportContext;
}
/**
 * Mouse move action - moves cursor to viewport coordinates.
 */
interface MouseMoveAction extends BaseAction<ActionType.MOUSE_MOVE> {
    /** Target coordinates in viewport space */
    coordinates: Coordinates;
    /** Viewport context */
    viewport: ViewportContext;
}
/**
 * Scroll action - scrolls at viewport coordinates.
 */
interface ScrollAction extends BaseAction<ActionType.SCROLL> {
    /** Target coordinates in viewport space */
    coordinates: Coordinates;
    /** Scroll delta */
    delta: ScrollDelta;
    /** Viewport context */
    viewport: ViewportContext;
}
/**
 * Key action - presses a keyboard key.
 */
interface KeyAction extends BaseAction<ActionType.KEY> {
    /** Key identifier (e.g., 'Enter', 'Escape', 'Control+a') */
    key: string;
    /** Optional modifiers (ctrl, shift, alt, meta) */
    modifiers?: KeyModifiers;
}
/**
 * Keyboard modifiers.
 */
interface KeyModifiers {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
}
/**
 * Visit URL action - navigates to a URL.
 */
interface VisitUrlAction extends BaseAction<ActionType.VISIT_URL> {
    /** Target URL */
    url: string;
    /** Optional timeout in milliseconds */
    timeout?: number;
}
/**
 * History back action - navigates back in browser history.
 */
interface HistoryBackAction extends BaseAction<ActionType.HISTORY_BACK> {
    /** Optional number of pages to go back (default: 1) */
    steps?: number;
}
/**
 * Screenshot action - captures the current viewport.
 */
interface ScreenshotAction extends BaseAction<ActionType.SCREENSHOT> {
    /** Optional full page screenshot (default: false) */
    fullPage?: boolean;
}
/**
 * Wait action - pauses for a specified duration.
 */
interface WaitAction extends BaseAction<ActionType.WAIT> {
    /** Duration to wait in milliseconds */
    duration: number;
}
/**
 * Ask user question action - requests user input or approval.
 */
interface AskUserQuestionAction extends BaseAction<ActionType.ASK_USER_QUESTION> {
    /** The question to ask the user */
    question: string;
    /** Optional context about the current state */
    context?: string;
    /** Optional set of choices if applicable */
    choices?: string[];
}
/**
 * Terminate action - ends the automation session.
 */
interface TerminateAction extends BaseAction<ActionType.TERMINATE> {
    /** Optional reason for termination */
    reason?: string;
}
/**
 * Pause and memorize fact action - stores information in session memory.
 */
interface PauseAndMemorizeFactAction extends BaseAction<ActionType.PAUSE_AND_MEMORIZE_FACT> {
    /** The fact to memorize */
    fact: string;
    /** Optional category or tag for the fact */
    category?: string;
}
/**
 * Union type of all Brotto actions.
 */
type FaraAction = LeftClickAction | DoubleClickAction | RightClickAction | DragAction | MouseMoveAction | ScrollAction | KeyAction | VisitUrlAction | HistoryBackAction | ScreenshotAction | WaitAction | AskUserQuestionAction | TerminateAction | PauseAndMemorizeFactAction;
/**
 * Type guard to check if an action is a viewport-based action.
 */
declare function isViewportAction(action: FaraAction): action is LeftClickAction | DoubleClickAction | RightClickAction | DragAction | MouseMoveAction | ScrollAction;
/**
 * Type guard to check if an action is a navigation action.
 */
declare function isNavigationAction(action: FaraAction): action is VisitUrlAction | HistoryBackAction;

/**
 * Action result types for Brotto actions.
 * Defines success and failure states for action execution.
 */

/**
 * Error codes for action failures.
 */
declare enum ActionErrorCode {
    /** Action execution timed out */
    TIMEOUT = "timeout",
    /** Target element not found */
    ELEMENT_NOT_FOUND = "element_not_found",
    /** Invalid coordinates (out of bounds) */
    INVALID_COORDINATES = "invalid_coordinates",
    /** Invalid URL format */
    INVALID_URL = "invalid_url",
    /** Navigation failed */
    NAVIGATION_FAILED = "navigation_failed",
    /** Permission denied */
    PERMISSION_DENIED = "permission_denied",
    /** Action cancelled */
    CANCELLED = "cancelled",
    /** Action not supported */
    NOT_SUPPORTED = "not_supported",
    /** Unknown error */
    UNKNOWN = "unknown"
}
/**
 * Error details for action failures.
 */
interface ActionError {
    /** Error code */
    code: ActionErrorCode;
    /** Human-readable error message */
    message: string;
    /** Optional additional context */
    details?: Record<string, unknown>;
}
/**
 * Base interface for action results.
 */
interface BaseActionResult<T extends ActionType> {
    /** The action this result corresponds to */
    readonly actionType: T;
    /** Whether the action succeeded */
    readonly success: boolean;
    /** Timestamp when result was generated (Unix epoch ms) */
    readonly timestamp: number;
}
/**
 * Success result for an action.
 */
interface ActionSuccessResult<T extends ActionType> extends BaseActionResult<T> {
    /** Always true for success */
    readonly success: true;
    /** Optional data returned by the action */
    readonly data?: ActionSuccessData;
}
/**
 * Data returned by successful action execution.
 */
interface ActionSuccessData {
    /** Screenshot data if screenshot was taken (base64 encoded) */
    screenshot?: string;
    /** Page title if navigation occurred */
    pageTitle?: string;
    /** URL after navigation */
    url?: string;
    /** Console messages if captured */
    consoleMessages?: string[];
}
/**
 * Failure result for an action.
 */
interface ActionFailureResult<T extends ActionType> extends BaseActionResult<T> {
    /** Always false for failure */
    readonly success: false;
    /** Error information */
    readonly error: ActionError;
}
/**
 * Union type of all action results.
 */
type ActionResult = ActionSuccessResult<ActionType> | ActionFailureResult<ActionType>;
/**
 * Result for left click action.
 */
type LeftClickResult = ActionSuccessResult<ActionType.LEFT_CLICK> | ActionFailureResult<ActionType.LEFT_CLICK>;
/**
 * Result for double click action.
 */
type DoubleClickResult = ActionSuccessResult<ActionType.DOUBLE_CLICK> | ActionFailureResult<ActionType.DOUBLE_CLICK>;
/**
 * Result for right click action.
 */
type RightClickResult = ActionSuccessResult<ActionType.RIGHT_CLICK> | ActionFailureResult<ActionType.RIGHT_CLICK>;
/**
 * Result for drag action.
 */
type DragResult = ActionSuccessResult<ActionType.DRAG> | ActionFailureResult<ActionType.DRAG>;
/**
 * Result for mouse move action.
 */
type MouseMoveResult = ActionSuccessResult<ActionType.MOUSE_MOVE> | ActionFailureResult<ActionType.MOUSE_MOVE>;
/**
 * Result for scroll action.
 */
type ScrollResult = ActionSuccessResult<ActionType.SCROLL> | ActionFailureResult<ActionType.SCROLL>;
/**
 * Result for key action.
 */
type KeyResult = ActionSuccessResult<ActionType.KEY> | ActionFailureResult<ActionType.KEY>;
/**
 * Result for visit URL action.
 */
type VisitUrlResult = ActionSuccessResult<ActionType.VISIT_URL> | ActionFailureResult<ActionType.VISIT_URL>;
/**
 * Result for history back action.
 */
type HistoryBackResult = ActionSuccessResult<ActionType.HISTORY_BACK> | ActionFailureResult<ActionType.HISTORY_BACK>;
/**
 * Result for screenshot action.
 */
type ScreenshotResult = ActionSuccessResult<ActionType.SCREENSHOT> | ActionFailureResult<ActionType.SCREENSHOT>;
/**
 * Result for wait action.
 */
type WaitResult = ActionSuccessResult<ActionType.WAIT> | ActionFailureResult<ActionType.WAIT>;
/**
 * Result for ask user question action.
 */
type AskUserQuestionResult = ActionSuccessResult<ActionType.ASK_USER_QUESTION> | ActionFailureResult<ActionType.ASK_USER_QUESTION>;
/**
 * Result for terminate action.
 */
type TerminateResult = ActionSuccessResult<ActionType.TERMINATE> | ActionFailureResult<ActionType.TERMINATE>;
/**
 * Result for pause and memorize fact action.
 */
type PauseAndMemorizeFactResult = ActionSuccessResult<ActionType.PAUSE_AND_MEMORIZE_FACT> | ActionFailureResult<ActionType.PAUSE_AND_MEMORIZE_FACT>;
/**
 * Creates a success result.
 */
declare function createActionSuccess<T extends ActionType>(actionType: T, data?: ActionSuccessData): ActionSuccessResult<T>;
/**
 * Creates a failure result.
 */
declare function createActionFailure<T extends ActionType>(actionType: T, errorCode: ActionErrorCode, message: string, details?: Record<string, unknown>): ActionFailureResult<T>;

/**
 * MCP tool mapping definitions for Brotto actions.
 * Maps Brotto actions to their corresponding Playwright MCP tools.
 */

/**
 * MCP tool names supported by the browser gateway.
 */
declare enum McpToolName {
    BROWSER_MOUSE_CLICK_XY = "browser_mouse_click_xy",
    BROWSER_MOUSE_DRAG_XY = "browser_mouse_drag_xy",
    BROWSER_MOUSE_MOVE_XY = "browser_mouse_move_xy",
    BROWSER_MOUSE_WHEEL = "browser_mouse_wheel",
    BROWSER_PRESS_KEY = "browser_press_key",
    BROWSER_NAVIGATE = "browser_navigate",
    BROWSER_NAVIGATE_BACK = "browser_navigate_back",
    BROWSER_TAKE_SCREENSHOT = "browser_take_screenshot"
}
/**
 * Parameters for browser_mouse_click_xy tool.
 */
interface MouseClickParams {
    x: number;
    y: number;
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
}
/**
 * Parameters for browser_mouse_drag_xy tool.
 */
interface MouseDragParams {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
}
/**
 * Parameters for browser_mouse_move_xy tool.
 */
interface MouseMoveParams {
    x: number;
    y: number;
}
/**
 * Parameters for browser_mouse_wheel tool.
 */
interface MouseWheelParams {
    x: number;
    y: number;
    deltaX?: number;
    deltaY?: number;
}
/**
 * Parameters for browser_press_key tool.
 */
interface PressKeyParams {
    key: string;
    modifiers?: {
        ctrl?: boolean;
        shift?: boolean;
        alt?: boolean;
        meta?: boolean;
    };
}
/**
 * Parameters for browser_navigate tool.
 */
interface NavigateParams {
    url: string;
    timeout?: number;
}
/**
 * Parameters for browser_navigate_back tool.
 */
interface NavigateBackParams {
    steps?: number;
}
/**
 * Parameters for browser_take_screenshot tool.
 */
interface TakeScreenshotParams {
    fullPage?: boolean;
}
/**
 * Union type of all MCP tool parameters.
 */
type McpToolParams = MouseClickParams | MouseDragParams | MouseMoveParams | MouseWheelParams | PressKeyParams | NavigateParams | NavigateBackParams | TakeScreenshotParams;
/**
 * Mapping from Brotto action type to MCP tool name.
 */
declare const FARA_ACTION_TO_MCP_TOOL: Record<ActionType, McpToolName | null>;
/**
 * Maps a Brotto action to its corresponding MCP tool parameters.
 * Returns null if the action is not executed via MCP tool.
 */
declare function mapActionToMcpParams(action: FaraAction): McpToolParams | null;
/**
 * Checks if an action type is executed via MCP tool.
 */
declare function isMcpAction(actionType: ActionType): boolean;
/**
 * Gets the MCP tool name for an action type.
 */
declare function getMcpToolName(actionType: ActionType): McpToolName | null;
/**
 * Action execution type classification.
 */
declare enum ActionExecutionType {
    /** Action executed via MCP tool call */
    MCP_TOOL = "mcp_tool",
    /** Action handled by bounded orchestrator timer */
    ORCHESTRATOR_TIMER = "orchestrator_timer",
    /** Action requiring control-plane approval */
    CONTROL_PLANE_APPROVAL = "control_plane_approval",
    /** Action marking session completion */
    SESSION_COMPLETION = "session_completion",
    /** Action updating server-side session memory */
    SESSION_MEMORY = "session_memory"
}
/**
 * Maps action type to execution type.
 */
declare function getActionExecutionType(actionType: ActionType): ActionExecutionType;

/**
 * Zod validation schemas for Brotto action arguments.
 */

/**
 * Coordinates schema.
 */
declare const CoordinatesSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    x: number;
    y: number;
}, {
    x: number;
    y: number;
}>;
/**
 * Drag coordinates schema.
 */
declare const DragCoordinatesSchema: z.ZodObject<{
    start: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    end: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
}, "strip", z.ZodTypeAny, {
    start: {
        x: number;
        y: number;
    };
    end: {
        x: number;
        y: number;
    };
}, {
    start: {
        x: number;
        y: number;
    };
    end: {
        x: number;
        y: number;
    };
}>;
/**
 * Scroll delta schema.
 */
declare const ScrollDeltaSchema: z.ZodObject<{
    deltaX: z.ZodNumber;
    deltaY: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    deltaX: number;
    deltaY: number;
}, {
    deltaX: number;
    deltaY: number;
}>;
/**
 * Viewport context schema.
 */
declare const ViewportContextSchema: z.ZodObject<{
    viewportWidth: z.ZodNumber;
    viewportHeight: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    viewportWidth: number;
    viewportHeight: number;
}, {
    viewportWidth: number;
    viewportHeight: number;
}>;
/**
 * Key modifiers schema.
 */
declare const KeyModifiersSchema: z.ZodObject<{
    ctrl: z.ZodOptional<z.ZodBoolean>;
    shift: z.ZodOptional<z.ZodBoolean>;
    alt: z.ZodOptional<z.ZodBoolean>;
    meta: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    shift?: boolean | undefined;
    ctrl?: boolean | undefined;
    alt?: boolean | undefined;
    meta?: boolean | undefined;
}, {
    shift?: boolean | undefined;
    ctrl?: boolean | undefined;
    alt?: boolean | undefined;
    meta?: boolean | undefined;
}>;
/**
 * Left click action arguments schema.
 */
declare const LeftClickArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.LEFT_CLICK>;
    coordinates: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.LEFT_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}, {
    type: ActionType.LEFT_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}>;
/**
 * Double click action arguments schema.
 */
declare const DoubleClickArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.DOUBLE_CLICK>;
    coordinates: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.DOUBLE_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}, {
    type: ActionType.DOUBLE_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}>;
/**
 * Right click action arguments schema.
 */
declare const RightClickArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.RIGHT_CLICK>;
    coordinates: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.RIGHT_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}, {
    type: ActionType.RIGHT_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}>;
/**
 * Drag action arguments schema.
 */
declare const DragArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.DRAG>;
    coordinates: z.ZodObject<{
        start: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>;
        end: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>;
    }, "strip", z.ZodTypeAny, {
        start: {
            x: number;
            y: number;
        };
        end: {
            x: number;
            y: number;
        };
    }, {
        start: {
            x: number;
            y: number;
        };
        end: {
            x: number;
            y: number;
        };
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.DRAG;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        start: {
            x: number;
            y: number;
        };
        end: {
            x: number;
            y: number;
        };
    };
}, {
    type: ActionType.DRAG;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        start: {
            x: number;
            y: number;
        };
        end: {
            x: number;
            y: number;
        };
    };
}>;
/**
 * Mouse move action arguments schema.
 */
declare const MouseMoveArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.MOUSE_MOVE>;
    coordinates: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.MOUSE_MOVE;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}, {
    type: ActionType.MOUSE_MOVE;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}>;
/**
 * Scroll action arguments schema.
 */
declare const ScrollArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.SCROLL>;
    coordinates: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    delta: z.ZodObject<{
        deltaX: z.ZodNumber;
        deltaY: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        deltaX: number;
        deltaY: number;
    }, {
        deltaX: number;
        deltaY: number;
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.SCROLL;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
    delta: {
        deltaX: number;
        deltaY: number;
    };
}, {
    type: ActionType.SCROLL;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
    delta: {
        deltaX: number;
        deltaY: number;
    };
}>;
/**
 * Key action arguments schema.
 */
declare const KeyArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.KEY>;
    key: z.ZodString;
    modifiers: z.ZodOptional<z.ZodObject<{
        ctrl: z.ZodOptional<z.ZodBoolean>;
        shift: z.ZodOptional<z.ZodBoolean>;
        alt: z.ZodOptional<z.ZodBoolean>;
        meta: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
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
}, "strip", z.ZodTypeAny, {
    type: ActionType.KEY;
    observationId: number;
    key: string;
    id: string;
    timestamp: number;
    modifiers?: {
        shift?: boolean | undefined;
        ctrl?: boolean | undefined;
        alt?: boolean | undefined;
        meta?: boolean | undefined;
    } | undefined;
}, {
    type: ActionType.KEY;
    observationId: number;
    key: string;
    id: string;
    timestamp: number;
    modifiers?: {
        shift?: boolean | undefined;
        ctrl?: boolean | undefined;
        alt?: boolean | undefined;
        meta?: boolean | undefined;
    } | undefined;
}>;
/**
 * Visit URL action arguments schema.
 */
declare const VisitUrlArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.VISIT_URL>;
    url: z.ZodString;
    timeout: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.VISIT_URL;
    url: string;
    observationId: number;
    id: string;
    timestamp: number;
    timeout?: number | undefined;
}, {
    type: ActionType.VISIT_URL;
    url: string;
    observationId: number;
    id: string;
    timestamp: number;
    timeout?: number | undefined;
}>;
/**
 * History back action arguments schema.
 */
declare const HistoryBackArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.HISTORY_BACK>;
    steps: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.HISTORY_BACK;
    observationId: number;
    id: string;
    timestamp: number;
    steps?: number | undefined;
}, {
    type: ActionType.HISTORY_BACK;
    observationId: number;
    id: string;
    timestamp: number;
    steps?: number | undefined;
}>;
/**
 * Screenshot action arguments schema.
 */
declare const ScreenshotArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.SCREENSHOT>;
    fullPage: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.SCREENSHOT;
    observationId: number;
    id: string;
    timestamp: number;
    fullPage?: boolean | undefined;
}, {
    type: ActionType.SCREENSHOT;
    observationId: number;
    id: string;
    timestamp: number;
    fullPage?: boolean | undefined;
}>;
/**
 * Wait action arguments schema.
 */
declare const WaitArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.WAIT>;
    durationMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: ActionType.WAIT;
    observationId: number;
    durationMs: number;
    id: string;
    timestamp: number;
}, {
    type: ActionType.WAIT;
    observationId: number;
    durationMs: number;
    id: string;
    timestamp: number;
}>;
/**
 * Ask user question action arguments schema.
 */
declare const AskUserQuestionArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.ASK_USER_QUESTION>;
    question: z.ZodString;
    context: z.ZodOptional<z.ZodString>;
    choices: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.ASK_USER_QUESTION;
    observationId: number;
    question: string;
    id: string;
    timestamp: number;
    choices?: string[] | undefined;
    context?: string | undefined;
}, {
    type: ActionType.ASK_USER_QUESTION;
    observationId: number;
    question: string;
    id: string;
    timestamp: number;
    choices?: string[] | undefined;
    context?: string | undefined;
}>;
/**
 * Terminate action arguments schema.
 */
declare const TerminateArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.TERMINATE>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.TERMINATE;
    observationId: number;
    id: string;
    timestamp: number;
    reason?: string | undefined;
}, {
    type: ActionType.TERMINATE;
    observationId: number;
    id: string;
    timestamp: number;
    reason?: string | undefined;
}>;
/**
 * Pause and memorize fact action arguments schema.
 */
declare const PauseAndMemorizeFactArgsSchema: z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.PAUSE_AND_MEMORIZE_FACT>;
    fact: z.ZodString;
    category: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.PAUSE_AND_MEMORIZE_FACT;
    observationId: number;
    fact: string;
    id: string;
    timestamp: number;
    category?: string | undefined;
}, {
    type: ActionType.PAUSE_AND_MEMORIZE_FACT;
    observationId: number;
    fact: string;
    id: string;
    timestamp: number;
    category?: string | undefined;
}>;
/**
 * Union of all action argument schemas.
 */
declare const FaraActionArgsSchema: z.ZodUnion<[z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.LEFT_CLICK>;
    coordinates: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.LEFT_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}, {
    type: ActionType.LEFT_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.DOUBLE_CLICK>;
    coordinates: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.DOUBLE_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}, {
    type: ActionType.DOUBLE_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.RIGHT_CLICK>;
    coordinates: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.RIGHT_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}, {
    type: ActionType.RIGHT_CLICK;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.DRAG>;
    coordinates: z.ZodObject<{
        start: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>;
        end: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>;
    }, "strip", z.ZodTypeAny, {
        start: {
            x: number;
            y: number;
        };
        end: {
            x: number;
            y: number;
        };
    }, {
        start: {
            x: number;
            y: number;
        };
        end: {
            x: number;
            y: number;
        };
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.DRAG;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        start: {
            x: number;
            y: number;
        };
        end: {
            x: number;
            y: number;
        };
    };
}, {
    type: ActionType.DRAG;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        start: {
            x: number;
            y: number;
        };
        end: {
            x: number;
            y: number;
        };
    };
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.MOUSE_MOVE>;
    coordinates: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.MOUSE_MOVE;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}, {
    type: ActionType.MOUSE_MOVE;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.SCROLL>;
    coordinates: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    delta: z.ZodObject<{
        deltaX: z.ZodNumber;
        deltaY: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        deltaX: number;
        deltaY: number;
    }, {
        deltaX: number;
        deltaY: number;
    }>;
    viewport: z.ZodObject<{
        viewportWidth: z.ZodNumber;
        viewportHeight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        viewportWidth: number;
        viewportHeight: number;
    }, {
        viewportWidth: number;
        viewportHeight: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.SCROLL;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
    delta: {
        deltaX: number;
        deltaY: number;
    };
}, {
    type: ActionType.SCROLL;
    observationId: number;
    viewport: {
        viewportWidth: number;
        viewportHeight: number;
    };
    id: string;
    timestamp: number;
    coordinates: {
        x: number;
        y: number;
    };
    delta: {
        deltaX: number;
        deltaY: number;
    };
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.KEY>;
    key: z.ZodString;
    modifiers: z.ZodOptional<z.ZodObject<{
        ctrl: z.ZodOptional<z.ZodBoolean>;
        shift: z.ZodOptional<z.ZodBoolean>;
        alt: z.ZodOptional<z.ZodBoolean>;
        meta: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
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
}, "strip", z.ZodTypeAny, {
    type: ActionType.KEY;
    observationId: number;
    key: string;
    id: string;
    timestamp: number;
    modifiers?: {
        shift?: boolean | undefined;
        ctrl?: boolean | undefined;
        alt?: boolean | undefined;
        meta?: boolean | undefined;
    } | undefined;
}, {
    type: ActionType.KEY;
    observationId: number;
    key: string;
    id: string;
    timestamp: number;
    modifiers?: {
        shift?: boolean | undefined;
        ctrl?: boolean | undefined;
        alt?: boolean | undefined;
        meta?: boolean | undefined;
    } | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.INSERT_TEXT>;
    text: z.ZodString;
    targetId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.INSERT_TEXT;
    text: string;
    observationId: number;
    id: string;
    timestamp: number;
    targetId?: string | undefined;
}, {
    type: ActionType.INSERT_TEXT;
    text: string;
    observationId: number;
    id: string;
    timestamp: number;
    targetId?: string | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.VISIT_URL>;
    url: z.ZodString;
    timeout: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.VISIT_URL;
    url: string;
    observationId: number;
    id: string;
    timestamp: number;
    timeout?: number | undefined;
}, {
    type: ActionType.VISIT_URL;
    url: string;
    observationId: number;
    id: string;
    timestamp: number;
    timeout?: number | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.HISTORY_BACK>;
    steps: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.HISTORY_BACK;
    observationId: number;
    id: string;
    timestamp: number;
    steps?: number | undefined;
}, {
    type: ActionType.HISTORY_BACK;
    observationId: number;
    id: string;
    timestamp: number;
    steps?: number | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.SCREENSHOT>;
    fullPage: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.SCREENSHOT;
    observationId: number;
    id: string;
    timestamp: number;
    fullPage?: boolean | undefined;
}, {
    type: ActionType.SCREENSHOT;
    observationId: number;
    id: string;
    timestamp: number;
    fullPage?: boolean | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.WAIT>;
    durationMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: ActionType.WAIT;
    observationId: number;
    durationMs: number;
    id: string;
    timestamp: number;
}, {
    type: ActionType.WAIT;
    observationId: number;
    durationMs: number;
    id: string;
    timestamp: number;
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.ASK_USER_QUESTION>;
    question: z.ZodString;
    context: z.ZodOptional<z.ZodString>;
    choices: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.ASK_USER_QUESTION;
    observationId: number;
    question: string;
    id: string;
    timestamp: number;
    choices?: string[] | undefined;
    context?: string | undefined;
}, {
    type: ActionType.ASK_USER_QUESTION;
    observationId: number;
    question: string;
    id: string;
    timestamp: number;
    choices?: string[] | undefined;
    context?: string | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.TERMINATE>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.TERMINATE;
    observationId: number;
    id: string;
    timestamp: number;
    reason?: string | undefined;
}, {
    type: ActionType.TERMINATE;
    observationId: number;
    id: string;
    timestamp: number;
    reason?: string | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.PAUSE_AND_MEMORIZE_FACT>;
    fact: z.ZodString;
    category: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.PAUSE_AND_MEMORIZE_FACT;
    observationId: number;
    fact: string;
    id: string;
    timestamp: number;
    category?: string | undefined;
}, {
    type: ActionType.PAUSE_AND_MEMORIZE_FACT;
    observationId: number;
    fact: string;
    id: string;
    timestamp: number;
    category?: string | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    observationId: z.ZodNumber;
    timestamp: z.ZodNumber;
} & {
    type: z.ZodLiteral<ActionType.MEMORIZE_FACT>;
    fact: z.ZodString;
    category: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: ActionType.MEMORIZE_FACT;
    observationId: number;
    fact: string;
    id: string;
    timestamp: number;
    category?: string | undefined;
}, {
    type: ActionType.MEMORIZE_FACT;
    observationId: number;
    fact: string;
    id: string;
    timestamp: number;
    category?: string | undefined;
}>]>;
/**
 * TypeScript type inferred from the action arguments schema.
 */
type FaraActionArgs = z.infer<typeof FaraActionArgsSchema>;
/**
 * Validates action arguments against the appropriate schema.
 * Returns the validated data or throws a ZodError.
 */
declare function validateActionArgs(args: unknown): FaraActionArgs;
/**
 * Safely validates action arguments.
 * Returns the validated data or null if validation fails.
 */
declare function tryValidateActionArgs(args: unknown): FaraActionArgs | null;
/**
 * Validates coordinates are within viewport bounds.
 */
declare function validateCoordinatesInBounds(x: number, y: number, viewportWidth: number, viewportHeight: number): boolean;
/**
 * Validates that coordinates are within viewport bounds.
 * Throws if validation fails.
 */
declare function assertCoordinatesInBounds(x: number, y: number, viewportWidth: number, viewportHeight: number): void;

export { type AXTuple, AXTupleSchema, type AccessibilityNode, AccessibilityNodeSchema, type ActionCommandV1, ActionCommandV1Schema, type ActionError, ActionErrorCode, type ActionErrorV1, ActionErrorV1Schema, ActionExecutionType, type ActionFailureResult, type ActionId, ActionIdSchema, type ActionProposalV1, ActionProposalV1Schema, type ActionResult, type ActionResultStatusV1, ActionResultStatusV1Schema, type ActionResultV1, ActionResultV1Schema, type ActionSuccessData, type ActionSuccessResult, ActionType, type AgentProposalV1, AgentProposalV1Schema, type ApprovalId, ApprovalIdSchema, type ApprovalResolutionV1, ApprovalResolutionV1Schema, type ArtifactId, ArtifactIdSchema, type AskUserQuestionAction, AskUserQuestionArgsSchema, type AskUserQuestionResult, type BaseAction, type BaseActionResult, type BoundingBox, BoundingBoxSchema, CancelledActionResultV1Schema, type CompletionFindingV1, CompletionFindingV1Schema, type CompletionProposalV1, CompletionProposalV1Schema, type ControlMetadata, ControlMetadataSchema, type Coordinates, CoordinatesSchema, type DialogEffectV1, DialogEffectV1Schema, type DoubleClickAction, DoubleClickArgsSchema, type DoubleClickResult, type DragAction, DragArgsSchema, type DragCoordinates, DragCoordinatesSchema, type DragResult, type EventId, EventIdSchema, type ExecutableActionV1, ExecutableActionV1Schema, FARA_ACTION_TO_MCP_TOOL, FORBIDDEN_BROWSER_DATA_KEYS, FailedActionResultV1Schema, type FaraAction, type FaraActionArgs, FaraActionArgsSchema, ForbiddenBrowserDataError, type FrameId, FrameIdSchema, type FramePathSegmentId, FramePathSegmentIdSchema, type HistoryBackAction, HistoryBackArgsSchema, type HistoryBackResult, IdempotencyKeySchema, type KeyAction, KeyArgsSchema, type KeyModifiers, KeyModifiersSchema, type KeyResult, type LeftClickAction, LeftClickArgsSchema, type LeftClickResult, type LocatorCandidateV1, LocatorCandidateV1Schema, McpToolName, type McpToolParams, type MessageId, MessageIdSchema, type MouseClickParams, type MouseDragParams, type MouseMoveAction, MouseMoveArgsSchema, type MouseMoveParams, type MouseMoveResult, type MouseWheelParams, type NavigateBackParams, type NavigateParams, type NavigationEffectV1, NavigationEffectV1Schema, type NormalizedCoordinates, type ObservationId, ObservationIdCounter, ObservationIdSchema, type ObservationV1, type ObservationId$1 as ObservationV1Id, ObservationV1Schema, type PageState, PageStateSchema, type PauseAndMemorizeFactAction, PauseAndMemorizeFactArgsSchema, type PauseAndMemorizeFactResult, type PolicyContextV1, PolicyContextV1Schema, type PolicyDecisionId, PolicyDecisionIdSchema, type PolicyDecisionV1, PolicyDecisionV1Schema, type PressKeyParams, RejectedActionResultV1Schema, type RightClickAction, RightClickArgsSchema, type RightClickResult, type RunId, RunIdSchema, type SanitizedAccessibleName, SanitizedAccessibleNameSchema, type Screenshot, type ScreenshotAction, ScreenshotArgsSchema, type ScreenshotResult, ScreenshotSchema, type ScrollAction, ScrollArgsSchema, type ScrollDelta, ScrollDeltaSchema, type ScrollResult, type SemanticTarget, type SemanticTargetId, SemanticTargetIdSchema, SemanticTargetSchema, type Sequence, SequenceSchema, type SessionId, SessionIdSchema, type ShadowPathSegmentId, ShadowPathSegmentIdSchema, type StepId, StepIdSchema, SucceededActionResultV1Schema, type TabId, TabIdSchema, type TakeScreenshotParams, type TaskId, TaskIdSchema, type TerminateAction, TerminateArgsSchema, type TerminateResult, type TrajectoryEventKindV1, TrajectoryEventKindV1Schema, type TrajectoryEventV1, TrajectoryEventV1Schema, type TrajectoryLinkageV1, TrajectoryLinkageV1Schema, type Viewport, type ViewportBounds, type ViewportConfig, type ViewportContext, ViewportContextSchema, ViewportSchema, type VisitUrlAction, VisitUrlArgsSchema, type VisitUrlResult, type WaitAction, WaitArgsSchema, type WaitResult, assertCoordinatesInBounds, assertNoForbiddenBrowserData, compareObservationIds, createActionFailure, createActionSuccess, createDefaultViewport, createDefaultViewportConfig, createObservationId, getActionExecutionType, getMcpToolName, getNextObservationId, isHttpUrl, isMcpAction, isNavigationAction, isValidObservationId, isViewportAction, mapActionToMcpParams, tryValidateActionArgs, validateActionArgs, validateCoordinatesInBounds };
