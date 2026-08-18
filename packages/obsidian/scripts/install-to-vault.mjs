import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const vault =
  process.argv[2] ?? path.join(pkgRoot, '..', '..', 'test-vault');

if (!existsSync(path.join(vault, '.obsidian'))) {
  console.error(`not an Obsidian vault (no .obsidian): ${vault}`);
  process.exit(1);
}
const dest = path.join(vault, '.obsidian', 'plugins', 'galley');
mkdirSync(dest, { recursive: true });
for (const f of ['manifest.json', 'styles.css']) {
  cpSync(path.join(pkgRoot, f), path.join(dest, f));
}
cpSync(path.join(pkgRoot, 'dist', 'main.js'), path.join(dest, 'main.js'));
console.log(`installed galley plugin → ${dest}`);
