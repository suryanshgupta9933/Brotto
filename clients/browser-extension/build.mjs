import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, rmSync } from 'fs';
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

// Every declared static runtime asset is required. A missing file aborts the build.
const requiredRuntimeFiles = [
  [join(srcDir, 'popup.js'), join(distDir, 'popup.js')],
  [join(srcDir, 'popup.html'), join(distDir, 'popup.html')],
];
for (const [source, destination] of requiredRuntimeFiles) copyFileSync(source, destination);

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
