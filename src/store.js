import { MongoClient } from 'mongodb';
import { HttpError, mergeDeliveries } from './validation.js';
export class MongoStore {
  constructor(db) { this.db = db; this.workspaces = db.collection('workspaces'); }
  async init() {
    await Promise.all(['sessions', 'oauth_states', 'login_attempts'].map(name => this.db.collection(name).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })));
    await this.workspaces.updateOne({ _id: 'owner' }, { $setOnInsert: { posts: [], communities: [], paused: false, revision: 0 } }, { upsert: true });
  }
  async ping() { await this.db.command({ ping: 1 }); }
  async getWorkspace() { return this.workspaces.findOne({ _id: 'owner' }); }
  async saveWorkspace(input) {
    const current = await this.getWorkspace();
    if (current.revision !== input.revision) throw new HttpError(409, 'Your workspace changed in another tab or during publishing. Reload before saving.');
    const next = mergeDeliveries(current, input);
    const r = await this.workspaces.updateOne({ _id: 'owner', revision: input.revision }, { $set: { posts: next.posts, communities: next.communities, paused: next.paused }, $inc: { revision: 1 } });
    if (!r.matchedCount) throw new HttpError(409, 'Your workspace changed. Reload before saving.');
    return input.revision + 1;
  }
  async claim(id, { immediate = false, now = new Date() } = {}) {
    const criteria = { id, delivery: { $exists: false }, ...(immediate ? {} : { status: 'planned', approved: true, at: { $lte: now.toISOString(), $gt: '' } }) };
    const doc = await this.workspaces.findOneAndUpdate({ _id: 'owner', paused: false, posts: { $elemMatch: criteria } }, { $set: { 'posts.$.delivery': { status: 'sending', at: now.toISOString() } }, $inc: { revision: 1 } }, { returnDocument: 'after' });
    return doc?.posts.find(p => p.id === id) || null;
  }
  async finish(id, delivery) { await this.workspaces.updateOne({ _id: 'owner', posts: { $elemMatch: { id, 'delivery.status': 'sending' } } }, { $set: { 'posts.$.delivery': delivery }, $inc: { revision: 1 } }); }
  async account() { return this.db.collection('accounts').findOne({ _id: 'owner' }); }
  async setAccount(account) { await this.db.collection('accounts').replaceOne({ _id: 'owner' }, { _id: 'owner', ...account }, { upsert: true }); }
  async deleteAccount() { await this.db.collection('accounts').deleteOne({ _id: 'owner' }); }
  async addSession(id, expiresAt) { await this.db.collection('sessions').insertOne({ _id: id, expiresAt }); }
  async hasSession(id) { return !!await this.db.collection('sessions').findOne({ _id: id, expiresAt: { $gt: new Date() } }); }
  async deleteSession(id) { await this.db.collection('sessions').deleteOne({ _id: id }); }
  async loginAllowed(now = Date.now()) {
    // Single-owner panel: ten attempts per ten-minute window across all web instances.
    const id = String(Math.floor(now / 600000));
    const row = await this.db.collection('login_attempts').findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now + 1200000) } }, { upsert: true, returnDocument: 'after' });
    return row.count <= 10;
  }
  async saveOAuth(id, sessionId, expiresAt) { await this.db.collection('oauth_states').insertOne({ _id: id, sessionId, expiresAt }); }
  async consumeOAuth(id, sessionId) { return !!await this.db.collection('oauth_states').findOneAndDelete({ _id: id, sessionId, expiresAt: { $gt: new Date() } }); }
  async heartbeat(value) { await this.db.collection('system').replaceOne({ _id: 'scheduler' }, { _id: 'scheduler', ...value }, { upsert: true }); }
  async lastRun() { return this.db.collection('system').findOne({ _id: 'scheduler' }); }
}
export async function connectStore(config) {
  // Reuse one MongoClient per process. Retain pool defaults: this small long-running app has no measured need for custom sizing.
  const client = new MongoClient(config.mongoUri);
  try { await client.connect(); const store = new MongoStore(client.db(config.mongoDb)); await store.init(); return { store, close: () => client.close() }; }
  catch (error) { await client.close(); throw error; }
}
