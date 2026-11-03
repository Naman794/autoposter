import { readFile } from 'node:fs/promises';
import { HttpError, validateState, publicState } from './validation.js';
import { cookie, sessionToken, randomToken, hashToken } from './security.js';
import { redditConfigured } from './config.js';
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
const json = (value, status = 200) => Response.json(value, { status, headers });
const redirect = (path, extra = {}) => new Response(null, { status: 303, headers: { ...headers, Location: path, ...extra } });
async function payload(req) {
  const text = await req.text();
  if (Buffer.byteLength(text) > 1700000) throw new HttpError(413, 'Request is too large.');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON request.'); }
}
const loginPage = invalid => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owner sign-in · Threadpilot</title><link rel="stylesheet" href="/styles.css"><link rel="icon" href="/favicon.svg"></head><body style="min-height:100vh;display:grid;place-items:center;padding:24px"><section class="formbox" style="width:410px;max-width:100%"><div class="eyebrow">THREADPILOT · YOUR WORKSPACE</div><h1>Welcome back.</h1><p class="subtitle" style="line-height:1.8">Sign in with the owner password configured on your server.</p><form method="post" action="/api/login"><label for="password" style="margin-top:25px">Workspace password</label><input class="field" id="password" type="password" name="password" required maxlength="1024" autocomplete="current-password">${invalid ? '<p class="save-error" role="alert">Sign-in failed. Check your password or try again later.</p>' : ''}<button class="btn primary" style="width:100%;margin:20px 0" type="submit">Sign in</button></form><a href="/" class="small">← Explore the public preview</a></section></body></html>`;
export async function createApp({ config, store, reddit, publisher, vault, verifyPassword }) {
  const assets = new Map(await Promise.all(Object.entries(files).map(async ([path, [file, type]]) => [path, { body: await readFile(new URL('../public/' + file, import.meta.url)), type: type + '; charset=utf-8' }])));
  return async function app(req) {
    try {
      const url = new URL(req.url), path = url.pathname;
      if (req.method === 'GET' && assets.has(path)) { const asset = assets.get(path); return new Response(asset.body, { headers: { ...headers, 'Content-Type': asset.type } }); }
      if (req.method === 'GET' && path === '/login') return new Response(loginPage(url.searchParams.has('error')), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
      if (req.method === 'GET' && path === '/healthz') { await store.ping(); return json({ status: 'ok' }); }
      // Every browser mutation is same-origin. No wildcard CORS or trusted external identity headers.
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.get('Origin') !== config.origin) throw new HttpError(403, 'Invalid request origin.');
      if (path === '/api/login' && req.method === 'POST') {
        if (!await store.loginAllowed()) return redirect('/login?error=1');
        const raw = await req.text();
        if (Buffer.byteLength(raw) > 4096) throw new HttpError(413, 'Request is too large.');
        const password = new URLSearchParams(raw).get('password');
        if (!await verifyPassword(password)) return redirect('/login?error=1');
        const token = randomToken(); await store.addSession(hashToken(token), new Date(Date.now() + 28800000));
        return redirect('/', { 'Set-Cookie': cookie(token, config.origin.startsWith('https:')) });
      }
      const token = sessionToken({ headers: { cookie: req.headers.get('Cookie') || '' } });
      const sessionId = token ? hashToken(token) : null;
      const authenticated = !!sessionId && await store.hasSession(sessionId);
      if (!authenticated) {
        if (path === '/api/reddit/connect' || path === '/api/reddit/callback') return redirect('/login');
        if (path.startsWith('/api/')) return json({ error: 'Sign in to save drafts and connect your Reddit account.' }, 401);
        return json({ error: 'Not found' }, 404);
      }
      if (path === '/api/logout' && req.method === 'POST') { await store.deleteSession(sessionId); return jsonWithCookie({ ok: true }, cookie('', config.origin.startsWith('https:'), true)); }
      if (path === '/api/state' && req.method === 'GET') {
        const [workspace, account, beat] = await Promise.all([store.getWorkspace(), store.account(), store.lastRun()]);
        return json({ ...publicState(workspace), configured: redditConfigured(config), account: account ? { name: account.name } : null, publishingEnabled: config.publishingEnabled, scheduler: config.publishingEnabled && !!beat && !beat.disabled && Date.now() - Date.parse(beat.lastRun) < 1800000, lastRun: beat?.lastRun || null, callback: config.origin + '/api/reddit/callback' });
      }
      if (path === '/api/state' && req.method === 'PUT') { const next = validateState(await payload(req)); return json({ ok: true, revision: await store.saveWorkspace(next) }); }
      if (path === '/api/reddit/connect' && req.method === 'GET') {
        if (!redditConfigured(config)) return redirect('/?connection=not-configured');
        const nonce = randomToken(); await store.saveOAuth(hashToken(nonce), sessionId, new Date(Date.now() + 600000));
        const q = new URLSearchParams({ client_id: config.clientId, response_type: 'code', state: nonce, redirect_uri: config.origin + '/api/reddit/callback', duration: 'permanent', scope: 'identity submit read' });
        return redirect('https://www.reddit.com/api/v1/authorize?' + q);
      }
      if (path === '/api/reddit/callback' && req.method === 'GET') {
        const nonce = url.searchParams.get('state');
        if (!nonce || !await store.consumeOAuth(hashToken(nonce), sessionId)) throw new HttpError(400, 'Reddit authorization expired or invalid. Start again from the panel.');
        if (url.searchParams.has('error')) return redirect('/?connection=cancelled');
        const code = url.searchParams.get('code'); if (!code) throw new HttpError(400, 'Reddit did not provide an authorization code.');
        const tokens = await reddit.exchange(code);
        if (!tokens.refresh_token) throw new HttpError(502, 'Reddit did not issue permanent authorization. Connect again.');
        const me = await reddit.read('/api/v1/me', tokens.access_token);
        if (!me.name) throw new HttpError(502, 'Unable to verify the Reddit account.');
        await store.setAccount({ name: me.name, encryptedRefreshToken: vault.seal(tokens.refresh_token), connectedAt: new Date().toISOString() });
        return redirect('/?connection=success');
      }
      if (path === '/api/reddit/disconnect' && req.method === 'POST') {
        const account = await store.account(); let revoked = false;
        if (account) { try { revoked = await reddit.revoke(vault.open(account.encryptedRefreshToken)); } catch { /* Remove local authorization even when Reddit cannot be reached. */ } }
        await store.deleteAccount(); return json({ ok: true, revoked });
      }
      if (path === '/api/reddit/flairs' && req.method === 'GET') {
        const sub = url.searchParams.get('sub'); if (!/^[A-Za-z0-9_]{2,21}$/.test(sub || '')) throw new HttpError(400, 'Enter a valid subreddit.');
        const account = await store.account(); if (!account || !redditConfigured(config)) throw new HttpError(409, 'Connect your approved Reddit app first.');
        const t = await reddit.refresh(vault.open(account.encryptedRefreshToken));
        const flairs = await reddit.read('/r/' + encodeURIComponent(sub) + '/api/link_flair_v2', t.access_token);
        return json({ flairs: Array.isArray(flairs) ? flairs.filter(f => f.id).map(f => ({ id: f.id, text: f.text || 'Untitled flair' })) : [] });
      }
      if (path === '/api/posts/publish' && req.method === 'POST') {
        const body = await payload(req);
        if (typeof body.id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(body.id) || body.confirm !== true) throw new HttpError(400, 'Explicit publication confirmation is required.');
        const result = await publisher.publish(body.id, { immediate: true });
        return json(result, result.status === 'blocked' || result.status === 'skipped' ? 409 : 200);
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Never echo driver messages, connection strings, request bodies or OAuth tokens into HTTP responses/logs.
      console.error('Request failed:', error.constructor?.name || 'Error');
      return json({ error: 'The request could not be completed. Check the server configuration and try again.' }, 500);
    }
  };
}
function jsonWithCookie(value, valueCookie) { const response = json(value); response.headers.set('Set-Cookie', valueCookie); return response; }
