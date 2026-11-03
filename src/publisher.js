import { redditConfigured } from './config.js';
import { HttpError } from './validation.js';
export function makePublisher({ store, config, reddit, vault }) {
  async function publish(id, { immediate = false } = {}) {
    if (!config.publishingEnabled) return { status: 'blocked', error: 'Publishing is disabled on the server.' };
    if (!redditConfigured(config)) return { status: 'blocked', error: 'Configure the approved Reddit app first.' };
    const account = await store.account();
    if (!account) return { status: 'blocked', error: 'Connect your Reddit account first.' };
    const post = await store.claim(id, { immediate });
    if (!post) return { status: 'skipped', error: 'Post is paused, not due, not approved, or already attempted.' };
    let submitted = false, result;
    try {
      const token = await reddit.refresh(vault.open(account.encryptedRefreshToken));
      const about = await reddit.read('/r/' + encodeURIComponent(post.sub) + '/about', token.access_token);
      if (!about.data || about.data.user_is_banned) throw new Error('Unable to post in this community. Check membership and posting permissions.');
      if (about.data.is_flair_required && !post.flair) throw new Error('This community requires a flair template ID.');
      if (post.flair) {
        const flair = await reddit.read('/r/' + encodeURIComponent(post.sub) + '/api/link_flair_v2', token.access_token);
        if (!Array.isArray(flair) || !flair.some(f => f.id === post.flair)) throw new Error('The selected flair is not available in this community.');
      }
      submitted = true;
      result = await reddit.submit(post, token.access_token);
    } catch (error) {
      result = submitted ? { status: 'unknown', error: 'Delivery uncertain. Check Reddit manually before creating another post. No automatic retry.' } : { status: 'failed', error: error instanceof HttpError ? error.message : 'Pre-publication check failed. Check account, encryption key and community requirements.' };
    }
    result.at = new Date().toISOString();
    // If receipt persistence fails, the atomic 'sending' claim remains; it must not be automatically re-sent.
    await store.finish(id, result);
    return result;
  }
  async function due({ dryRun = false } = {}) {
    const workspace = await store.getWorkspace(), now = new Date().toISOString();
    const eligible = workspace.paused ? [] : workspace.posts.filter(p => p.status === 'planned' && p.approved && p.at && p.at <= now && !p.delivery);
    if (dryRun) return { dryRun: true, eligible: eligible.length, paused: workspace.paused, publishingEnabled: config.publishingEnabled, redditConfigured: redditConfigured(config), accountConnected: !!await store.account(), results: [] };
    if (!config.publishingEnabled) { await store.heartbeat({ lastRun: now, disabled: true }); return { disabled: true, checked: 0, results: [] }; }
    const results = [];
    for (const p of eligible.slice(0, 20)) {
      const result = await publish(p.id); results.push({ id: p.id, ...result });
      if (result.rateLimited || result.status === 'blocked') break;
    }
    await store.heartbeat({ lastRun: new Date().toISOString(), checked: results.length });
    return { checked: results.length, results };
  }
  return { publish, due };
}
