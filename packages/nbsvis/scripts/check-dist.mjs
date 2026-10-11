// Verifies the package's install story:
//   - the core entry (`.`) never reaches pixi.js (or any viewer package), directly or via
//     shared chunks, so core works on its own
//   - the optional `./pixi` entry keeps pixi.js external (provided by the app)
//   - pixi.js is declared as an optional peer dependency, not a regular dependency
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const FORBIDDEN_FROM_CORE = [/^@opennbs\//, /^pixi\.js($|\/)/, /^three($|\/)/];

const errors = [];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (pkg.dependencies?.['pixi.js']) {
  errors.push('pixi.js must not be a regular dependency; declare it as an optional peer');
}
if (!pkg.peerDependencies?.['pixi.js'] || !pkg.peerDependenciesMeta?.['pixi.js']?.optional) {
  errors.push('pixi.js must be a peerDependency marked optional in peerDependenciesMeta');
}
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const name of Object.keys(pkg[field] ?? {})) {
    if (/^@opennbs\//.test(name) || /^three($|\/)/.test(name)) {
      errors.push(`${field} must not include "${name}"`);
    }
  }
}

const staticImport = /(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g;

/** Walks the static import graph from an entry file; returns visited files and bare specifiers. */
function walk(entry) {
  const files = new Set();
  const bare = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (files.has(file)) continue;
    if (!existsSync(file)) {
      errors.push(`missing built file ${file.replace(root + '/', '')}`);
      continue;
    }
    files.add(file);
    const code = readFileSync(file, 'utf8');
    for (const [, spec] of code.matchAll(staticImport)) {
      if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec));
      else if (!spec.startsWith('data:') && !spec.startsWith('/')) {
        bare.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
      }
    }
  }
  return { files, bare };
}

const core = walk(join(dist, 'index.js'));
for (const spec of core.bare) {
  if (FORBIDDEN_FROM_CORE.some((re) => re.test(spec))) {
    errors.push(`core entry (dist/index.js) imports "${spec}"`);
  }
}

const pixi = walk(join(dist, 'pixi.js'));
if (!pixi.bare.has('pixi.js')) {
  errors.push('dist/pixi.js never imports "pixi.js"; expected it as an external import');
}
for (const spec of pixi.bare) {
  if (spec !== 'pixi.js') errors.push(`dist/pixi.js imports unexpected package "${spec}"`);
}

if (errors.length) {
  console.error('package install-story check failed:\n - ' + [...new Set(errors)].join('\n - '));
  process.exit(1);
}
console.log(
  `install-story check passed (core: ${core.files.size} files, pixi: ${pixi.files.size} files).`,
);
