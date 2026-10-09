// A no-op stand-in for the extension APIs. The real sidepanel.js is loaded
// unedited so the GIFs come from shipping code; only the parts that would open
// a socket or touch extension storage are stood down.
//
// Everything returns another stub, so any path resolves instead of throwing
// at load. Reads return true rather than a falsy stub so the panel does not
// branch down an error path that never happens in Chrome.

const stub = new Proxy(function () {}, {
  get: (target, prop) => (prop === "then" ? undefined : stub),
  apply: () => stub,
});

window.chrome = new Proxy({}, { get: () => stub });

// A fetch that never settles. The panel's startup health probe awaits it, so
// the unreachable-server branch never runs and no toast lands in the frame —
// and, unlike a fake response, nothing downstream can half-render against a
// made-up catalogue.
window.fetch = () => new Promise(() => {});