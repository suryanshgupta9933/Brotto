# Extension Review Documentation

Documentation for the browser extension review process, permissions justification, and compatibility information.

## Contents

- [Permissions Justification](./permissions.md) - Explanation of required permissions
- [Chrome Web Store](./chrome-store.md) - Store listing and review guidance
- [Compatibility Matrix](./compatibility.md) - Supported browsers and versions
- [Enterprise Deployment](./enterprise.md) - Enterprise policy installation

## Required Permissions

| Permission | Justification |
|------------|---------------|
| debugger | Required for chrome.debugger API to control browser tabs |
| activeTab | Access the currently active tab when user initiates automation |
| tabs | List tabs for user selection dialog |
| tabGroups | Manage tab groups for session-scoped automation |
| <all_urls> | Attach debugger to any user-selected tab |

## Privacy Disclosure

The extension:
- Does not collect browsing history
- Does not track user activity beyond automation sessions
- Transmits only CDP data for active automation sessions
- Stores only ephemeral session tokens

## Security Considerations

- Extension cannot execute arbitrary code
- All automation requires explicit user action to start
- Debugger detaches immediately when socket closes
- No remote code or eval() usage

## Related

- [Browser Extension Client](../../clients/browser-extension/README.md)
