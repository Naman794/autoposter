export function readConfig(env = process.env, { worker = false } = {}) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid port number.');
  const appUrl = new URL(env.APP_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`);
  if (production && appUrl.protocol !== 'https:') throw new Error('APP_URL must use HTTPS in production.');
  const config = {
    port, production, origin: appUrl.origin,
    mongoUri: env.MONGODB_URI || '', mongoDb: env.MONGODB_DB || 'threadpilot',
    adminPassword: env.ADMIN_PASSWORD || '', encryptionKey: env.TOKEN_ENCRYPTION_KEY || '',
    clientId: env.REDDIT_CLIENT_ID || '', clientSecret: env.REDDIT_CLIENT_SECRET || '',
    userAgent: env.REDDIT_USER_AGENT || '', publishingEnabled: env.ENABLE_AUTOPUBLISH === 'true',
  };
  // One long-running MongoClient per web/cron process; use driver pool defaults until workload measurements justify tuning.
  if (!config.mongoUri) throw new Error('Set MONGODB_URI to your MongoDB Atlas connection string.');
  if (!worker && config.adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
  if (config.encryptionKey.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY must contain at least 32 random characters.');
  return config;
}
export const redditConfigured = c => !!(c.clientId && c.clientSecret && c.userAgent);
