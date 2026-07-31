# Support

## Getting Help

If you need help with the Fara1.5 Browser Automation Platform, here are the available resources:

### Documentation

- [Architecture Documentation](docs/architecture/README.md)
- [Deployment Guide](docs/deployment/README.md)
- [Protocol Reference](docs/protocol/README.md)
- [SDK Documentation](docs/)

### Community Support

- **GitHub Discussions**: For questions about usage, configuration, and design
- **GitHub Issues**: For bug reports and feature requests

### Commercial Support

For enterprise support, training, and custom development, contact Inventic at:
- Email: support@inventic.io
- Website: https://inventic.io

## Issue Guidelines

When reporting issues, please include:

- Platform version (`npm list fara15-platform` or equivalent)
- Client type (desktop-connector, browser-extension, or SDK)
- Server version and deployment type
- Steps to reproduce
- Expected vs actual behavior
- Error logs (remove any sensitive information)

## Response Times

- **Community Q&A**: Best effort (typically 3-5 business days)
- **Bug reports**: Within 7 days (critical issues within 48 hours)
- **Security issues**: See [SECURITY.md](SECURITY.md)

## Known Limitations

- Chrome remote debugging behavior changed starting with Chrome 136 (requires separate `--user-data-dir`)
- Browser extension requires `chrome.debugger` API (Chrome and Edge only)
- macOS notarization required for distribution on macOS

## Contributing

If you'd like to contribute fixes or documentation improvements, see [CONTRIBUTING.md](CONTRIBUTING.md).
