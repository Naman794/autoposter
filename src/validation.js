export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = message => { throw new HttpError(400, message); };
const subreddit = /^[A-Za-z0-9_]{2,21}$/;
export function validateState(input) {
  if (!input || !Number.isInteger(input.revision) || input.revision < 0) bad('Reload the workspace before saving.');
  if (!Array.isArray(input.posts) || input.posts.length > 500 || !Array.isArray(input.communities) || input.communities.length > 100) bad('Workspace limits: 500 posts and 100 communities.');
  if (input.communities.some(c => typeof c !== 'string' || !subreddit.test(c))) bad('Enter valid subreddit names without r/.');
  const seen = new Set();
  const posts = input.posts.map(p => {
    if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(p.id) || seen.has(p.id)) bad('Invalid or duplicate post ID.');
    seen.add(p.id);
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 300 || typeof p.body !== 'string' || p.body.length > 40000 || !subreddit.test(p.sub)) bad('Check the community, title and body limits.');
    if (!['text', 'link'].includes(p.type) || !['draft', 'planned'].includes(p.status) || typeof p.approved !== 'boolean') bad('Invalid post format or status.');
    if (p.type === 'link') { try { if (!['http:', 'https:'].includes(new URL(p.url).protocol)) bad('Use an HTTP or HTTPS link.'); } catch { bad('Use a valid link URL.'); } }
    if (p.flair && !/^[a-f0-9-]{1,80}$/i.test(p.flair)) bad('Enter a valid flair template ID.');
    const at = p.at ? new Date(p.at) : null;
    if ((p.at && !Number.isFinite(at.getTime())) || (p.status === 'planned' && !at)) bad('Planned posts need a valid date and time.');
    return { id: p.id, sub: p.sub, title: p.title.trim(), body: p.body, type: p.type, url: p.type === 'link' ? p.url : '', status: p.status, approved: p.status === 'planned' && p.approved, flair: p.flair || '', at: at ? at.toISOString() : '' };
  });
  if (Buffer.byteLength(JSON.stringify(posts)) > 1500000) bad('Workspace exceeds the 1.5 MB limit. Export and archive older drafts.');
  return { revision: input.revision, posts, communities: [...new Set(input.communities)], paused: !!input.paused };
}
export function mergeDeliveries(current, incoming) {
  const next = new Map(incoming.posts.map(p => [p.id, p]));
  for (const existing of current.posts) {
    if (!existing.delivery) continue;
    const proposed = next.get(existing.id);
    const { delivery, ...content } = existing;
    if (!proposed || JSON.stringify(content) !== JSON.stringify(proposed)) throw new HttpError(409, 'Attempted posts cannot be edited or deleted. Create a fresh draft for changes.');
    proposed.delivery = delivery;
  }
  return incoming;
}
export function publicState(workspace) {
  const deliveries = {};
  const posts = workspace.posts.map(({ delivery, ...p }) => { if (delivery) deliveries[p.id] = delivery; return p; });
  return { posts, communities: workspace.communities, paused: workspace.paused, revision: workspace.revision, deliveries };
}
