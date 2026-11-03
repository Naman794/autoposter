import http from 'node:http';
import { readConfig } from './config.js';
import { connectStore } from './store.js';
import { passwordVerifier, vault } from './security.js';
import { RedditClient } from './reddit.js';
import { makePublisher } from './publisher.js';
import { createApp } from './app.js';
async function start() {
  const config = readConfig(), connection = await connectStore(config), cryptoVault = vault(config.encryptionKey);
  const reddit = new RedditClient(config), publisher = makePublisher({ store: connection.store, config, reddit, vault: cryptoVault });
  const app = await createApp({ config, store: connection.store, reddit, publisher, vault: cryptoVault, verifyPassword: await passwordVerifier(config.adminPassword) });
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 1700000) { res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' }); res.end('{"error":"Request too large"}'); return; } chunks.push(chunk); }
      const request = new Request(new URL(req.url, config.origin), { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
      const response = await app(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!res.headersSent) res.writeHead(500); res.end('Request failed'); }
  });
  server.requestTimeout = 30000;
  server.listen(config.port, '0.0.0.0', () => console.log('Threadpilot web service started.'));
  const shutdown = () => { server.close(async () => { await connection.close(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
start().catch(error => { console.error('Startup failed. Check MongoDB access, ADMIN_PASSWORD, TOKEN_ENCRYPTION_KEY and APP_URL. Error type:', error.constructor?.name); process.exitCode = 1; });
