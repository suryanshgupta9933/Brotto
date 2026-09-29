// Dev-only: injects a chrome.* stub into a copy of dist/sidepanel.html so the
// real render/handler paths can be driven from the browser console. Deleted on
// each build; not shipped.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const stub = `<script>
window.__sent = [];
window.__bag = {
  settings: { serverUrl: 'http://brotto.internal:9999' },
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
      if (cb) cb({ success: true });
    },
    connect: () => ({ onMessage: { addListener(){} }, onDisconnect: { addListener(){} }, postMessage(){}, disconnect(){} }),
  },
  storage: { local: area(window.__bag), session: area({}) },
  debugger: { attach(){}, detach(){} },
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
