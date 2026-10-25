import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appDir = fileURLToPath(new URL('../../', import.meta.url));
export const require = createRequire(path.join(appDir, 'package.json'));
export const { build } = require('esbuild');
export const bundleDir = mkdtempSync(path.join(tmpdir(), 'second-look-tests-'));

// Tests never call a live service. Fail loudly if a future mock is incomplete.
globalThis.fetch = async () => { throw new Error('Network access is disabled in the test suite.'); };
process.on('exit', () => rmSync(bundleDir, { recursive: true, force: true }));
