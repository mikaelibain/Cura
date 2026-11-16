import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const targets = [resolve(root, 'data', 'product-resolution-state.json'), resolve(root, 'data', 'image-cache')];
for (const target of targets) {
  if (!target.startsWith(root + sep)) throw new Error(`Refusing path outside project: ${target}`);
  if (!existsSync(target)) { console.log(`already clear: ${target.slice(root.length + 1)}`); continue; }
  rmSync(target, { recursive: true, force: true });
  console.log(`cleared: ${target.slice(root.length + 1)}`);
}
console.log('Browser board data and user settings were not changed.');
console.log('Persistent Tavily/Firecrawl quota counters were preserved.');
console.log('Restart the API process to clear its in-memory provider and URL caches.');
