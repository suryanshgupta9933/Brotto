export class InferenceContractError extends Error {
    retryable;
    code = 'INFERENCE_CONTRACT_ERROR';
    constructor(message, retryable) {
        super(message);
        this.retryable = retryable;
        this.name = 'InferenceContractError';
    }
}
export class SessionEngineError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'SessionEngineError';
    }
}
//# sourceMappingURL=types.js.map