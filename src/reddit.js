import { HttpError } from './validation.js';
export class RedditClient {
  constructor(config, transport = fetch) { this.config = config; this.transport = transport; }
  get basicHeaders() { return { Authorization: 'Basic ' + Buffer.from(this.config.clientId + ':' + this.config.clientSecret).toString('base64'), 'User-Agent': this.config.userAgent }; }
  async token(fields) {
    const response = await this.transport('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: this.basicHeaders, body: new URLSearchParams(fields), signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new HttpError(502, 'Reddit authorization failed. Check API approval and app credentials.');
    return data;
  }
  exchange(code) { return this.token({ grant_type: 'authorization_code', code, redirect_uri: this.config.origin + '/api/reddit/callback' }); }
  refresh(refreshToken) { return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken }); }
  async read(path, accessToken) {
    const response = await this.transport('https://oauth.reddit.com' + path, { headers: { Authorization: 'Bearer ' + accessToken, 'User-Agent': this.config.userAgent }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new HttpError(502, `Reddit access check failed (${response.status}). Check account permissions and API approval.`);
    return response.json();
  }
  async submit(post, accessToken) {
    const body = new URLSearchParams({ api_type: 'json', sr: post.sub, title: post.title, kind: post.type === 'link' ? 'link' : 'self', text: post.body || '', url: post.url || '', resubmit: 'false', sendreplies: 'true' });
    if (post.flair) body.set('flair_id', post.flair);
    const response = await this.transport('https://oauth.reddit.com/api/submit', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'User-Agent': this.config.userAgent }, body, signal: AbortSignal.timeout(20000) });
    // Only a structured rejection confirms failure. Broken responses/5xx may follow an accepted submission.
    const data = await response.json();
    const errors = data.json?.errors || [];
    if (errors.length || (response.status >= 400 && response.status < 500)) {
      return { status: 'failed', error: errors.map(x => x[0] + ': ' + x[1]).join('; ') || `Reddit rejected the post (${response.status}).`, rateLimited: response.status === 429 || errors.some(x => x[0] === 'RATELIMIT') };
    }
    if (!response.ok || !data.json?.data?.url) throw new Error('Unconfirmed Reddit delivery.');
    const result = data.json.data;
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || !(url.hostname === 'reddit.com' || url.hostname.endsWith('.reddit.com'))) throw new Error('Invalid Reddit receipt.');
    return { status: 'published', url: url.href, name: result.name, rateLimited: response.headers.get('x-ratelimit-remaining') === '0' };
  }
  async revoke(refreshToken) {
    const response = await this.transport('https://www.reddit.com/api/v1/revoke_token', { method: 'POST', headers: this.basicHeaders, body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token' }), signal: AbortSignal.timeout(10000) });
    return response.ok;
  }
}
