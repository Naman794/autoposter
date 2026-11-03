import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'scripts', 'tests', 'public']) {
  for (const file of await readdir(new URL('../' + dir, import.meta.url))) {
    if (!file.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', dir + '/' + file], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
if (html.includes('signin-with-chatgpt') || html.includes('chatgpt.site')) throw new Error('Hosted identity or Site references remain in the frontend.');
console.log('Syntax and standalone frontend checks passed.');
