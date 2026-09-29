// Dev-only: injects a chrome.* stub into a copy of dist/sidepanel.html so the
// real render/handler paths can be driven from the browser console. Deleted on
// each build; not shipped.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const stub = `<script>
window.__sent = [];
window.__bag = {
  settings: { serverUrl: 'http://127.0.0.1:9911' },
  sessions: window.__seed || [],
  modelConfig: { provider: 'anthropic', model: 'MiniMax-M3.1-Flash-Preview', context_window: 1000000 },
};
window.__forceFail = null;
const area = (bag) => ({
  get: (k) => Promise.resolve(typeof k === 'string' ? (k in bag ? { [k]: bag[k] } : {}) : { ...bag }),
  set: (o) => { Object.assign(bag, o); return Promise.resolve(); },
  remove: (k) => { delete bag[k]; return Promise.resolve(); },
});
window.chrome = {
  runtime: {
    lastError: null,
    onMessage: { addListener: (fn) => { window.__onMessage = fn; } },
    sendMessage: (msg, cb) => {
      window.__sent.push(JSON.parse(JSON.stringify(msg)));
      const f = window.__forceFail;
      if (f && f.type === msg.type) { if (cb) cb({ success: false, error: f.error }); return; }
      if (msg.type === 'get_panel_log') { if (cb) cb({ success: true, events: window.__log || [] }); return; }
      if (cb) cb({ success: true });
    },
    connect: () => ({ onMessage: { addListener(){} }, onDisconnect: { addListener(){} }, postMessage(){}, disconnect(){} }),
  },
  storage: { local: area(window.__bag), session: area(window.__session = window.__session || {}) },
  debugger: { attach(){}, detach(){} },
  sidePanel: { setOptions: (o) => { window.__path = o.path; return Promise.resolve(); } },
};
window.__deliver = (m) => window.__onMessage(m, { id: 'test' });
</script>
`;

const html = readFileSync('dist/sidepanel.html', 'utf8');
const marker = '<script src="sidepanel.js"></script>';
if (!html.includes(marker)) throw new Error('sidepanel.js script tag not found');
mkdirSync('.preview', { recursive: true });
writeFileSync('dist/__test.html', html.replace(marker, stub + marker));
console.log('wrote dist/__test.html');

// The wizard needs a different stub: no messaging, but a sidePanel that
// records the path it was pointed at so the hand-off can be asserted.
const welcomeStub = `<script>
window.__path = null;
window.__bag = window.__bag || {};
window.__session = window.__session || {};
const area = (bag) => ({
  get: (k) => Promise.resolve(typeof k === 'string' ? (k in bag ? { [k]: bag[k] } : {}) : { ...bag }),
  set: (o) => { Object.assign(bag, o); return Promise.resolve(); },
  remove: (k) => { delete bag[k]; return Promise.resolve(); },
});
window.chrome = {
  storage: { local: area(window.__bag), session: area(window.__session) },
  sidePanel: { setOptions: (o) => { window.__path = o.path; return Promise.resolve(); } },
};
</script>
`;
const wHtml = readFileSync('dist/welcome.html', 'utf8');
const wMarker = '<script src="welcome.js"></script>';
if (!wHtml.includes(wMarker)) throw new Error('welcome.js script tag not found');
writeFileSync('dist/__test-welcome.html', wHtml.replace(wMarker, welcomeStub + wMarker));
console.log('wrote dist/__test-welcome.html');
