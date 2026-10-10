// credential.js — which server a credential in `settings.agentSecret` may be
// sent to.
//
// One slot holds two things: a self-hoster's `AGENT_SECRET` and, on the cloud
// path, a Supabase access token that is a real account identity. It used to
// ride to whatever address the settings field held, so a mistyped host, an
// imported settings blob or a colleague's self-host received the user's cloud
// token and the relay honoured it as that account. `agentSecretOrigin`,
// recorded beside it by whoever wrote it, is the bind: a credential reaches
// the origin that issued it and nowhere else.
//
// This is the panel-side copy of background.ts's `credentialFor`. The worker
// is a TS bundle and the panel is a plain script, so the two cannot share one
// function — but they must not drift either, and
// scripts/test-panel-credential.test.js runs both against one table and fails
// on the first answer that differs.

/** The origin `url` names, or null when it is not a usable absolute address.
 *
 * Origin rather than the whole string: the same server is written at least
 * three ways here — the wizard's default, the panel's stripped trailing slash,
 * whatever the user typed — and a string comparison reads each as a different
 * server, which is the mistake that removed `HOSTED_SERVER_URL` once already.
 */
function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

/** Is this address on this machine?
 *
 * The one place a credential with no recorded issuer is still presented,
 * because nothing it touches crosses the network. A self-hoster on
 * http://192.168.x.x is a supported deployment, so a recorded origin is what
 * authorises cleartext — never the address alone.
 */
function isLoopback(url) {
  const origin = originOf(url);
  if (!origin) return false;
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * The credential in `settings` that may be presented to `url`, or why not.
 *
 * `typed` is for a value the user just entered on the screen that is asking:
 * it was written for this server by hand, so there is nothing to bind it to.
 * Without it the wizard would refuse the ordinary self-host case, because the
 * key in the field has never been saved anywhere.
 */
function forUrl(settings, url, typed = false) {
  const s = settings || {};
  const secret = typeof s.agentSecret === 'string' ? s.agentSecret.trim() : '';
  // No credential is not a refusal: "no secret means open" is deliberate, and
  // every open self-hosted install arrives here.
  if (secret === '') return { secret: '', refusal: '' };
  const target = originOf(url);
  if (!target) {
    return {
      secret: '',
      refusal: `Brotto can't tell which server ${url} is, so it will not send your sign-in there. Set the server address in Settings.`,
    };
  }
  if (typed) return { secret, refusal: '' };
  const raw = s.agentSecretOrigin;
  const issued = typeof raw === 'string' && raw.trim() ? originOf(raw.trim()) : null;
  if (issued === target) return { secret, refusal: '' };
  if (issued === null && isLoopback(target)) return { secret, refusal: '' };
  return {
    secret: '',
    refusal: `Brotto is holding a sign-in from ${issued || 'an earlier server address'} and will not send it to ${target}.`
      + ' Sign in again for that server — re-enter the server key in Settings if you run your own.',
  };
}

globalThis.brottoCredential = { originOf, isLoopback, forUrl };