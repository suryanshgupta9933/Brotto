# Contributing to Fara1.5 Browser Automation Platform

We welcome contributions from the community. This document outlines the process for contributing to the project.

## Code of Conduct

This project adheres to the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0
- Rust (for desktop-connector)
- Go (optional, for cdp-relay)
- Python 3.11+ (for fara-inference)

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/fara15-platform.git
   cd fara15-platform
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build all packages:
   ```bash
   npm run build
   ```

## Contribution Process

### 1. Branch Naming

Create feature branches from `master`:
- `feature/description` - new features
- `fix/description` - bug fixes
- `docs/description` - documentation
- `refactor/description` - code refactoring

### 2. Making Changes

1. Make your changes in the appropriate directory under `apps/`, `services/`, `clients/`, or `packages/`
2. Follow existing code style and conventions
3. Add tests for new functionality
4. Run the test suite:
   ```bash
   npm test
   ```

### 3. Commit Guidelines

- Use clear, descriptive commit messages
- Reference issues in commits when applicable
- Keep commits focused and atomic

### 4. Pull Request Process

1. Ensure all tests pass and linting is clean
2. Update documentation if your changes affect APIs or architecture
3. Request review from maintainers
4. Address review feedback
5. Once approved, maintainers will merge your PR

## Areas for Contribution

- Desktop connector (Rust/Go)
- Browser extension (TypeScript/Manifest V3)
- Agent orchestrator (TypeScript)
- CDP relay (Go/Rust)
- Policy engine
- SDK libraries
- Documentation

## License

By contributing to the Fara1.5 Browser Automation Platform, you agree that your contributions will be licensed under the Apache License, Version 2.0.
