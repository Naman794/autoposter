import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const randomToken = () => randomBytes(32).toString('hex');
export const hashToken = value => createHash('sha256').update(value).digest('hex');
export function vault(secret) {
  const key = createHash('sha256').update(secret).digest();
  return {
    seal(value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), bytes].map(x => x.toString('base64url')).join('.');
    },
    open(value) {
      const [iv, tag, bytes] = value.split('.').map(x => Buffer.from(x, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8');
    }
  };
}
export async function passwordVerifier(password) {
  const salt = randomBytes(16), expected = await derive(password, salt, 64);
  return async value => typeof value === 'string' && value.length <= 1024 && timingSafeEqual(expected, await derive(value, salt, 64));
}
export function sessionToken(req) {
  const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('tp_session='));
  const value = cookie?.slice(11); return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
export function cookie(value, secure, expire = false) {
  return `tp_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expire ? 0 : 28800}${secure ? '; Secure' : ''}`;
}
