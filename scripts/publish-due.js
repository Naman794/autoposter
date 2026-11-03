import { readConfig } from '../src/config.js';
import { connectStore } from '../src/store.js';
import { vault } from '../src/security.js';
import { RedditClient } from '../src/reddit.js';
import { makePublisher } from '../src/publisher.js';
const dryRun = process.argv.includes('--dry-run');
let connection;
try {
  const config = readConfig(process.env, { worker: true }); connection = await connectStore(config);
  const publisher = makePublisher({ config, store: connection.store, vault: vault(config.encryptionKey), reddit: new RedditClient(config) });
  const result = await publisher.due({ dryRun });
  // Log counts and statuses only, never post contents, tokens or database credentials.
  console.log(JSON.stringify({ ...result, results: result.results.map(r => ({ id: r.id, status: r.status })) }));
} catch (error) { console.error('Publisher failed. Check environment variables and MongoDB access. Error type:', error.constructor?.name); process.exitCode = 1; }
finally { await connection?.close(); }
