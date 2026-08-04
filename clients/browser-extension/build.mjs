import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, 'src');
const distDir = join(__dirname, 'dist');

// Fail closed before creating or copying any distributable output.
const require = createRequire(import.meta.url);
const typecheck = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit'], {
  cwd: __dirname,
  stdio: 'inherit',
});
if (typecheck.error) throw typecheck.error;
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);

// Clean dist
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}
mkdirSync(distDir, { recursive: true });

// Copy only the runtime assets declared by the extension manifest.
const copyFiles = ['popup.js', 'options.js'];
for (const file of copyFiles) {
  const src = join(srcDir, file);
  if (existsSync(src)) {
    copyFileSync(src, join(distDir, file));
  }
}

// Copy HTML files
for (const file of readdirSync(srcDir)) {
  if (file.endsWith('.html')) {
    copyFileSync(join(srcDir, file), join(distDir, file));
  }
}

// Copy icons
const iconsDir = join(__dirname, 'icons');
if (existsSync(iconsDir)) {
  mkdirSync(join(distDir, 'icons'), { recursive: true });
  for (const icon of readdirSync(iconsDir)) {
    if (icon.endsWith('.png')) {
      copyFileSync(join(iconsDir, icon), join(distDir, 'icons', icon));
    }
  }
}

// Copy manifest.json
copyFileSync(join(__dirname, 'manifest.json'), join(distDir, 'manifest.json'));

// Bundle background.ts with all its dependencies
console.log('Bundling background.ts...');
await esbuild.build({
  entryPoints: [join(srcDir, 'background.ts')],
  bundle: true,
  outfile: join(distDir, 'background.js'),
  platform: 'browser',
  target: 'chrome110',
  format: 'iife',
  minify: false,
  sourcemap: false,
});

console.log('Build complete!');
