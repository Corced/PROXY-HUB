'use strict';

// PROXYHUB Bridge: browser <-> 9Router (single internal account)
//
// POST /api/bridge/session         verify the internal 9Router session
// POST /api/bridge/oauth/start     { provider }     -> { authUrl, state }
// POST /api/bridge/oauth/finish    { callbackUrl }  -> { ok, provider, detail }
// GET  /api/bridge/oauth/callback  auto-exchange, used only if the provider
//                                  redirect_uri points at the Bridge
//
// The browser never talks to 9Router. ROUTER_PASSWORD stays server-side.

const http = require('http');

const PORT = Number(process.env.PORT || 8090);
const ROUTER = (process.env.ROUTER_URL || 'http://9router:20128').replace(/\/$/, '');
const PASSWORD = process.env.ROUTER_PASSWORD;
const REDIRECT =
  process.env.OAUTH_REDIRECT_URI || 'http://localhost:20128/callback';

// Optional: require a valid New API session on the Bridge endpoints.
// Off by default. See the notes after this code block.
const NEWAPI_URL = (process.env.NEWAPI_URL || '').replace(/\/$/, '');
const REQUIRE_NEWAPI_SESSION = process.env.REQUIRE_NEWAPI_SESSION === 'true';

if (!PASSWORD) {
  console.error('[bridge] ROUTER_PASSWORD is not set');
  process.exit(1);
}

const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

// state -> { provider, codeVerifier, redirectUri, createdAt }
const flows = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [state, flow] of flows) {
    if (now - flow.createdAt > FLOW_TTL_MS) flows.delete(state);
  }
}, 60 * 1000).unref();

// ---------------------------------------------------------
// 9ROUTER SESSION
// ---------------------------------------------------------

let cookie = '';
let loginPromise = null;

async function doLogin() {
  console.log('[bridge] logging into internal 9Router account');

  const r = await fetch(ROUTER + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error('9Router login failed: HTTP ' + r.status + ' ' + detail);
  }

  const cookies = r.headers.getSetCookie?.() || [];
  cookie = cookies.map((c) => c.split(';')[0]).join('; ');

  if (!cookie) {
    throw new Error('9Router login succeeded but no session cookie was returned');
  }

  console.log('[bridge] internal 9Router session created');
}

// Concurrent callers share one login instead of racing.
function login() {
  if (!loginPromise) {
    loginPromise = doLogin().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
}

async function router(path, opts = {}, retry = true) {
  if (!cookie) await login();

  const r = await fetch(ROUTER + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      cookie,
      ...(opts.headers || {}),
    },
  });

  if ((r.status === 401 || r.status === 403) && retry) {
    console.log('[bridge] 9Router session expired, logging in again');
    cookie = '';
    return router(path, opts, false);
  }

  return r;
}

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (d) => {
      size += d.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(d);
    });

    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function send(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function normalizeProvider(provider) {
  if (typeof provider !== 'string' || !provider.trim()) {
    throw new Error('provider is required');
  }
  const value = provider.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid provider');
  }
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Optional gate: caller must hold a valid New API session.
async function isNewApiUser(req) {
  if (!REQUIRE_NEWAPI_SESSION) return true;
  if (!NEWAPI_URL) return false;

  try {
    const r = await fetch(NEWAPI_URL + '/api/user/self', {
      headers: {
        cookie: req.headers.cookie || '',
        'new-api-user': req.headers['new-api-user'] || '',
      },
    });
    if (!r.ok) return false;
    const d = await r.json().catch(() => null);
    return !!d?.success;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------
// OAUTH LOGIC
// ---------------------------------------------------------

async function startOAuth(providerInput, redirectUriInput) {
  const provider = normalizeProvider(providerInput);
  const redirectUri = redirectUriInput || REDIRECT;

  const endpoint =
    `/api/oauth/${encodeURIComponent(provider)}/authorize` +
    `?redirect_uri=${encodeURIComponent(redirectUri)}`;

  console.log(`[bridge] starting OAuth: ${provider}`);

  const r = await router(endpoint);
  const text = await r.text();
  const d = parseJsonSafe(text);

  if (typeof d !== 'object' || d === null) {
    return { code: 502, body: { error: '9Router returned invalid JSON', provider, detail: text } };
  }
  if (!r.ok) {
    return { code: 502, body: { error: '9Router OAuth start failed', provider, status: r.status, detail: d } };
  }
  if (!d.authUrl || !d.state) {
    return { code: 502, body: { error: 'No authUrl/state returned by 9Router', provider, detail: d } };
  }

  flows.set(d.state, {
    provider,
    codeVerifier: d.codeVerifier,
    redirectUri: d.redirectUri || redirectUri,
    createdAt: Date.now(),
  });

  console.log(`[bridge] OAuth started: ${provider}, state=${d.state}`);

  return {
    code: 200,
    body: { provider, authUrl: d.authUrl, state: d.state, flowType: d.flowType },
  };
}

// Shared by POST /oauth/finish and GET /oauth/callback.
async function exchangeOAuth(code, state) {
  const flow = flows.get(state);

  if (!flow) {
    return {
      code: 400,
      body: {
        ok: false,
        error: 'This OAuth session expired or is unknown. Start the connection again.',
      },
    };
  }

  // State is single-use: remove it before the exchange so a replay can't reuse it.
  flows.delete(state);

  const { provider, codeVerifier, redirectUri } = flow;
  console.log(`[bridge] finishing OAuth: ${provider}, state=${state}`);

  const r = await router(`/api/oauth/${encodeURIComponent(provider)}/exchange`, {
    method: 'POST',
    body: JSON.stringify({ code, state, redirectUri, codeVerifier }),
  });

  const detail = parseJsonSafe(await r.text());

  // HTTP 200 with { success: false } or { error } is still a failure.
  const logicalFailure =
    detail && typeof detail === 'object' && (detail.success === false || !!detail.error);
  const ok = r.ok && !logicalFailure;

  console.log(`[bridge] exchange result: ${provider} HTTP ${r.status} ok=${ok}`);

  return { code: ok ? 200 : 502, body: { ok, provider, detail } };
}

// ---------------------------------------------------------
// SERVER
// ---------------------------------------------------------

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const path = url.pathname;

      // Health check (no auth)
      if (req.method === 'GET' && path === '/api/bridge/health') {
        return send(res, 200, { ok: true });
      }

      // Provider redirect lands here. No New API session check:
      // the single-use `state` is the secret.
      if (req.method === 'GET' && path === '/api/bridge/oauth/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const providerError = url.searchParams.get('error');

        let result;
        if (providerError) {
          result = { code: 400, body: { ok: false, error: providerError } };
        } else if (!code || !state) {
          result = { code: 400, body: { ok: false, error: 'Missing code or state' } };
        } else {
          result = await exchangeOAuth(code, state);
        }

        const { ok, provider, error } = result.body;
        const payload = JSON.stringify({
          type: 'proxyhub-provider-result',
          ok: !!ok,
          provider: provider || null,
        }).replaceAll('<', '\\u003c');

        res.writeHead(result.code, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        return res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Provider connection</title></head>
<body style="font-family:system-ui;padding:2rem">
  <h2>${ok ? 'Connected' : 'Connection failed'}</h2>
  <p>${
    ok
      ? escapeHtml(provider) + ' is connected. You can close this tab.'
      : escapeHtml(error || 'Please go back to PROXYHUB and try again.')
  }</p>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage(${payload}, window.location.origin);
        setTimeout(function () { window.close(); }, 1200);
      }
    } catch (e) {}
  </script>
</body>
</html>`);
      }

      // Everything below needs a New API session when enabled.
      if (req.method === 'POST' && path.startsWith('/api/bridge/')) {
        if (!(await isNewApiUser(req))) {
          return send(res, 401, { error: 'Unauthorized' });
        }
      }

      // POST /api/bridge/session
      if (req.method === 'POST' && path === '/api/bridge/session') {
        await login();

        const r = await router('/api/v1/models');
        if (!r.ok) {
          return send(res, 502, {
            ok: false,
            error: '9Router session verification failed',
            status: r.status,
          });
        }

        return send(res, 200, { ok: true, router: 'connected' });
      }

      // POST /api/bridge/oauth/start
      if (req.method === 'POST' && path === '/api/bridge/oauth/start') {
        const input = await readJson(req);
        const result = await startOAuth(input.provider, input.redirectUri);
        return send(res, result.code, result.body);
      }

      // POST /api/bridge/oauth/finish
      if (req.method === 'POST' && path === '/api/bridge/oauth/finish') {
        const input = await readJson(req);
        const text = String(input.callbackUrl || '').trim();

        if (!text) {
          return send(res, 400, { ok: false, error: 'callbackUrl is required' });
        }

        let callback;
        try {
          callback = new URL(text);
        } catch {
          return send(res, 400, { ok: false, error: 'Invalid callback URL' });
        }

        const code = callback.searchParams.get('code');
        const state = callback.searchParams.get('state');

        if (!code || !state) {
          return send(res, 400, {
            ok: false,
            error: 'Callback URL must contain code= and state=.',
          });
        }

        const result = await exchangeOAuth(code, state);
        return send(res, result.code, result.body);
      }

      return send(res, 404, { error: 'not found' });
    } catch (e) {
      console.error('[bridge]', e);
      return send(res, 500, { error: String(e.message || e) });
    }
  })
  .listen(PORT, () => {
    console.log(`PROXYHUB bridge listening on :${PORT}`);
    console.log('9Router:', ROUTER);
    console.log('Default redirect:', REDIRECT);
    console.log('New API session required:', REQUIRE_NEWAPI_SESSION);
  });