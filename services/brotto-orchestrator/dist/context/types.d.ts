export interface ElementState {
    id: string;
    tag: string;
    role: string;
    name: string;
    value: string;
    type?: string;
    placeholder?: string;
    focused: boolean;
    disabled: boolean;
    visible: boolean;
    cx: number;
    cy: number;
    href?: string;
    checked?: boolean;
}
export interface ElementState {
    id: string;
    tag: string;
    role: string;
    name: string;
    value: string;
    type?: string;
    placeholder?: string;
    focused: boolean;
    disabled: boolean;
    visible: boolean;
    cx: number;
    cy: number;
    href?: string;
    checked?: boolean;
}
export interface PageLinkState {
    text: string;
    href: string;
    axPath: Array<{
        role: string;
        index: number;
        name?: string;
    }>;
    attributeHash: string;
    bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
export interface PageButtonState {
    text: string;
    axPath: Array<{
        role: string;
        index: number;
        name?: string;
    }>;
    attributeHash: string;
    bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
export interface PageSnapshot {
    url: string;
    title: string;
    elements: ElementState[];
    focusedId: string | null;
    bodyTextSnippet: string;
    screenshot?: string;
    pageIdentity?: string;
    pagePurpose?: string;
    links?: PageLinkState[];
    buttons?: PageButtonState[];
    axRows?: import("./render.js").AxRowGroup[];
}
export interface HistoryEntry {
    action: string;
    result: string;
}
export interface HistoryEntryV1 extends HistoryEntry {
    reasoning: string;
    observation: string;
    verdict: string;
    nextActionPrediction: string;
}
export interface MemoryFact {
    key: string;
    value: string;
    evidence: string;
}
export interface WorkingMemoryView {
    facts: MemoryFact[];
}
//# sourceMappingURL=types.d.ts.map