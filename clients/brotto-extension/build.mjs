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

// ponytail: rebuild workspace dependencies FIRST so esbuild bundles the
// current schema source, not the stale dist/. Without this, a schema
// source edit silently ships an extension that fails strict-mode
// validation with "Unrecognized key(s)" on the new fields. The previous
// failure: pageIdentity / pagePurpose / links / buttons added to
// ObservationV1Schema but the schema package's dist/ was stale, so the
// extension bundled the old schema and crashed on every capture.
const repoRoot = join(__dirname, '..', '..');
const schemaDir = join(repoRoot, 'packages', 'brotto-action-schema');
if (existsSync(schemaDir)) {
  console.log('Building @brotto/brotto-action-schema (workspace dep)...');
  const schemaBuild = spawnSync('pnpm', ['--dir', schemaDir, 'run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, npm_config_yes: 'true' },
  });
  if (schemaBuild.error) throw schemaBuild.error;
  if (schemaBuild.status !== 0) {
    console.error(`Schema package build failed (status=${schemaBuild.status}); aborting extension build.`);
    process.exit(schemaBuild.status ?? 1);
  }
}

// Clean dist
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}
mkdirSync(distDir, { recursive: true });

// Every declared static runtime asset is required. A missing file aborts the build.
const requiredRuntimeFiles = [
  [join(srcDir, 'sidepanel.html'), join(distDir, 'sidepanel.html')],
  [join(srcDir, 'sidepanel.js'), join(distDir, 'sidepanel.js')],
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
