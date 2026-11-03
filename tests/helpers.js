import { HttpError, mergeDeliveries } from '../src/validation.js';
export const post = (id = 'post-1', changes = {}) => ({ id, sub: 'SideProject', title: 'A useful question', body: 'Helpful context', type: 'text', url: '', status: 'planned', approved: true, flair: '', at: new Date(Date.now() - 60000).toISOString(), ...changes });
export function memoryStore(posts = []) {
  let workspace = { _id: 'owner', posts: structuredClone(posts), communities: [], paused: false, revision: 0 }, account = null, beat = null;
  const sessions = new Set(), states = new Map(); let attempts = 0;
  return {
    getWorkspace: async () => structuredClone(workspace),
    saveWorkspace: async next => { if (next.revision !== workspace.revision) throw new HttpError(409, 'Workspace changed.'); mergeDeliveries(workspace, next); workspace = { ...structuredClone(next), _id: 'owner', revision: next.revision + 1 }; return workspace.revision; },
    claim: async (id, { immediate = false, now = new Date() } = {}) => {
      const p = workspace.posts.find(p => p.id === id);
      if (workspace.paused || !p || p.delivery || (!immediate && (p.status !== 'planned' || !p.approved || !p.at || p.at > now.toISOString()))) return null;
      p.delivery = { status: 'sending', at: now.toISOString() }; workspace.revision++; return structuredClone(p);
    },
    finish: async (id, delivery) => { workspace.posts.find(p => p.id === id).delivery = structuredClone(delivery); workspace.revision++; },
    account: async () => account && structuredClone(account), setAccount: async value => { account = structuredClone(value); }, deleteAccount: async () => { account = null; },
    heartbeat: async value => { beat = structuredClone(value); }, lastRun: async () => beat,
    addSession: async id => { sessions.add(id); }, hasSession: async id => sessions.has(id), deleteSession: async id => { sessions.delete(id); },
    saveOAuth: async (id, sessionId, expiresAt) => { states.set(id, { sessionId, expiresAt }); },
    consumeOAuth: async (id, sessionId) => { const s = states.get(id); if (!s || s.sessionId !== sessionId || s.expiresAt <= new Date()) return false; states.delete(id); return true; },
    loginAllowed: async () => ++attempts <= 10, ping: async () => {},
  };
}
export const config = { origin: 'https://panel.example', production: true, publishingEnabled: true, clientId: 'test-id', clientSecret: 'test-secret', userAgent: 'web:test:v1.0 (by /u/test)', encryptionKey: 'a'.repeat(32) };
