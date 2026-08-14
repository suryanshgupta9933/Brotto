/**
 * TypeScript types for the Brotto Platform SDK
 */
// Re-export action types from brotto-action-schema
// These are the canonical action types for browser automation
export var ActionType;
(function (ActionType) {
    ActionType["LEFT_CLICK"] = "left_click";
    ActionType["DOUBLE_CLICK"] = "double_click";
    ActionType["RIGHT_CLICK"] = "right_click";
    ActionType["DRAG"] = "drag";
    ActionType["MOUSE_MOVE"] = "mouse_move";
    ActionType["SCROLL"] = "scroll";
    ActionType["KEY"] = "key";
    ActionType["VISIT_URL"] = "visit_url";
    ActionType["HISTORY_BACK"] = "history_back";
    ActionType["SCREENSHOT"] = "screenshot";
    ActionType["WAIT"] = "wait";
    ActionType["ASK_USER_QUESTION"] = "ask_user_question";
    ActionType["TERMINATE"] = "terminate";
    ActionType["PAUSE_AND_MEMORIZE_FACT"] = "pause_and_memorize_fact";
})(ActionType || (ActionType = {}));
//# sourceMappingURL=types.js.map