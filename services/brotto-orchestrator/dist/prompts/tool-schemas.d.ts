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
export declare function buildToolSchemas(): ToolSchema[];
//# sourceMappingURL=tool-schemas.d.ts.map