import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir  = join(__dirname, 'src');
const distDir = join(__dirname, 'dist');

if (existsSync(distDir)) rmSync(distDir, { recursive: true });
mkdirSync(distDir, { recursive: true });

// Static assets
for (const name of ['sidepanel.html', 'sidepanel.js', 'welcome.html', 'welcome.js', 'panel-tokens.css']) {
  copyFileSync(join(srcDir, name), join(distDir, name));
}
copyFileSync(join(__dirname, 'manifest.json'), join(distDir, 'manifest.json'));

// Brand mark PNGs — single source is src/assets/logo.svg (the same file the
// panel renders inline); rsvg-convert outputs the standard Chrome sizes
// (toolbar, install, store). One geometry, one file, change once, rebuild.
// ponytail: requires `rsvg-convert` (librsvg) on the build host.
const iconSvg = join(srcDir, 'assets', 'logo.svg');
const iconsDir = join(distDir, 'icons');
mkdirSync(iconsDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  // ponytail: execFileSync with an argument array — no shell, so internal
  // values (size, iconSvg) are passed as literal args even if they ever
  // contained shell metacharacters.
  execFileSync('rsvg-convert', [
    '-w', String(size),
    '-h', String(size),
    iconSvg,
    '-o', join(iconsDir, `icon-${size}.png`),
  ]);
}

// ponytail: copy remaining assets verbatim so the side panel can reference
// them as relative paths (assets/logo.svg).
const assetsDir = join(srcDir, 'assets');
if (existsSync(assetsDir)) {
  const destAssetsDir = join(distDir, 'assets');
  mkdirSync(destAssetsDir, { recursive: true });
  for (const file of readdirSync(assetsDir)) {
    const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
    if (['svg', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      copyFileSync(join(assetsDir, file), join(destAssetsDir, file));
    }
  }
}

// Bundle background.ts
console.log('Bundling background.ts...');
await esbuild.build({
  entryPoints: [join(srcDir, 'background.ts')],
  bundle:      true,
  outfile:     join(distDir, 'background.js'),
  platform:    'browser',
  target:      'chrome110',
  format:      'iife',
  minify:      false,
  sourcemap:   false,
});

console.log('Build complete!');
