# Brotto Evaluation Suite

Comprehensive test suite for the Brotto Browser Automation Platform.

## Directory Structure

```
evals/
├── unit/           # Unit tests for core packages
├── contract/       # Contract tests for protocol compatibility
├── integration/    # Browser integration matrix tests
├── security/       # Security tests
├── agent/          # Agent evaluation suite
├── scripts/        # Test runner scripts
└── README.md
```

## Test Suites

### Unit Tests (`unit/`)

Unit tests for core packages:
- `coordinate-transform` - Coordinate transformation and validation
- `brotto-action-schema` - Action parsing and validation
- `policy-engine` - Policy evaluation and approval
- `relay-protocol` - Protocol serialization and session management

Run unit tests:
```bash
cd evals/unit
npm test
```

### Contract Tests (`contract/`)

Contract tests ensuring protocol compatibility:
- `relay-protocol.test.ts` - Connector-to-relay and extension-to-relay protocols
- `mcp-mapping.test.ts` - Brotto action to MCP tool mapping
- `model-prompt.test.ts` - Model prompt version compatibility

Run contract tests:
```bash
cd evals/contract
npm test
```

### Integration Tests (`integration/`)

Browser integration matrix tests:
- Chrome stable and beta, Edge stable
- Windows x64, macOS Intel and Apple Silicon, Linux x64
- Different display scale factors (1x, 1.25x, 1.5x, 2x, 2.5x, 3x)
- Multiple tabs and windows
- SSO and two-factor authentication flows
- Downloads and uploads

Run integration tests:
```bash
cd evals/integration
npm install
npx playwright install
npm test
```

### Security Tests (`security/`)

Security tests for platform hardening:
- `prompt-injection.test.ts` - Prompt injection attack resistance
- `ssrf.test.ts` - SSRF and DNS rebinding protection
- `token.test.ts` - Token entropy, replay protection, session security

Run security tests:
```bash
cd evals/security
npm test
```

### Agent Evaluation (`agent/`)

Agent performance evaluation:
- Task success rate
- Action accuracy
- Average steps to completion
- Repeated-action rate
- Human-intervention rate
- Screenshot-to-action latency
- End-to-end latency
- Model cost tracking

Run agent evaluation:
```bash
cd evals/agent
npm install
npx playwright install
npm test
```

## Test Runners

### Run All Tests

```bash
./scripts/run-all.sh
```

### Individual Test Suites

```bash
./scripts/run-unit.sh      # Unit tests
./scripts/run-contract.sh  # Contract tests
./scripts/run-security.sh  # Security tests
./scripts/run-integration.sh # Integration tests
./scripts/run-agent.sh     # Agent evaluation
```

### CI Mode

```bash
./scripts/ci.sh
```

## Browser Support

| Browser | Platform | Architecture |
|---------|----------|--------------|
| Chromium | Linux | x64 |
| Chromium | macOS | arm64, x64 |
| Chromium | Windows | x64 |
| Chrome Stable | macOS | arm64 |
| Chrome Beta | macOS | arm64 |
| Edge Stable | Windows | x64 |

## Metrics

The agent evaluation suite tracks:

- **Task Success Rate** - Percentage of tasks completed successfully
- **Action Accuracy** - Accuracy of coordinate-based actions
- **Average Steps** - Mean number of actions per task
- **Repeated Action Rate** - Frequency of repeated actions
- **Human Intervention Rate** - How often human approval is needed
- **Screenshot-to-Action Latency** - Time from screenshot to action execution
- **End-to-End Latency** - Total task completion time
- **Model Cost** - Estimated cost per task based on token usage

## Architecture

Tests follow the architecture defined in `ARCHITECTURE.md` section 13:

- Unit tests cover individual package functionality
- Contract tests verify protocol compatibility between components
- Integration tests verify end-to-end browser automation
- Security tests validate hardening against attacks
- Agent evaluation measures real-world task performance

## Related Documentation

- [Architecture](../../ARCHITECTURE.md)
- [Threat Model](../../THREAT_MODEL.md)
- [Security Documentation](../../docs/security/README.md)
