# Coordinate Transform

Shared library for transforming coordinates between model canvas, viewport, and device pixel spaces. Handles DPI scaling, viewport changes, and coordinate validation.

## Purpose

The coordinate-transform package provides:
- Screenshot normalization to fixed model canvas dimensions
- Viewport-to-canvas and canvas-to-viewport coordinate transformation
- Device pixel ratio (DPR) handling
- Viewport offset detection (toolbar, address bar)
- Coordinate validation (bounds checking, stale screenshot detection)
- Transformation matrix storage per screenshot

## Coordinate System

```
Model canvas: fixed width × height (e.g., 1024 × 768)
Browser viewport: variable width × height
Transform: scale + optional letterbox
```

## Validation Rules

Actions are rejected when:
- Screenshot dimensions do not match the recorded transform
- Device pixel ratio changed
- Browser zoom changed (not 100%)
- The selected tab changed
- The page navigated between observation and action
- The target coordinate lies outside the page viewport

## Technology

- TypeScript
- Zod for transformation schema

## Related

- [Brotto Action Schema](../brotto-action-schema/README.md)
- [Browser MCP Gateway](../../services/browser-mcp-gateway/README.md)
