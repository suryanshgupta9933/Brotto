import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const forwarded = process.argv.slice(2).filter((argument) => argument !== '--' && argument !== '--runInBand');
const result = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand', ...forwarded], {
  cwd: new URL('.', import.meta.url),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
