import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { appDir, bundleDir, build } from './support/paths.mjs';

const unitSuites = ['screening', 'freshness', 'requirements', 'resale', 'location'];
const integrationSuites = [
  'store-lifecycle',
  'scout-throughput',
  'freshness-integration',
  'requirements-integration',
  'resale-integration',
  'city-integration',
];

function run(file) {
  const result = spawnSync(process.execPath, [file], { cwd: appDir, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const suite of unitSuites) {
  console.log(`\nChecking ${suite} rules`);
  const output = path.join(bundleDir, `${suite}.test.${suite === 'location' ? 'mjs' : 'cjs'}`);
  await build({
    entryPoints: [path.join(appDir, 'lib', `${suite}.test.ts`)],
    absWorkingDir: appDir,
    outfile: output,
    bundle: true,
    platform: 'node',
    format: suite === 'location' ? 'esm' : 'cjs',
    logLevel: 'silent',
  });
  run(output);
}

for (const suite of integrationSuites) {
  console.log(`\nChecking ${suite}`);
  run(path.join(appDir, 'tests', `test-${suite}.mjs`));
}

console.log('\nAll eleven test groups passed. No live services or persistent database used.');
