# Client Packaging Documentation

Documentation for packaging and distributing desktop connectors and browser extensions.

## Contents

- [Desktop Connector](./desktop-connector.md) - Native connector packaging
- [Browser Extension](....md) - Extension packaging
- [Signing](./signing.md) - Code signing procedures
- [SBOM](./sbom.md) - Software Bill of Materials generation
- [Release Process](./release.md) - Release workflow

## Desktop Connector

### Distribution Formats

| Platform | Architecture | Filename |
|----------|-------------|----------|
| Windows | x64 | connector-windows-x64.zip |
| Windows | ARM64 | connector-windows-arm64.zip |
| macOS | x64 | connector-macos-x64.zip |
| macOS | ARM64 | connector-macos-arm64.zip |
| Linux | x64 | connector-linux-x64.zip |
| Linux | ARM64 | connector-linux-arm64.zip |

### Variants

- **Lightweight**: Uses system Chrome/Edge, smaller download
- **Deterministic**: Bundles Chrome for Testing, larger but reproducible

### Signing

- **Windows**: Authenticode signature required
- **macOS**: Developer ID + notarization required
- **Linux**: GPG signature recommended

## Browser Extension

### Distribution Channels

1. Chrome Web Store
2. Edge Add-ons
3. Unpacked (developer/enterprise)

### Review Considerations

Chrome Web Store review may scrutinize `<all_urls>` and debugger permissions. Provide clear justification documentation during submission.

## Related

- [Desktop Connector Client](../../...- [Browser Extension Client](../../clients/brotto-extension/README.md)
