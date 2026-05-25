import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(packageDir, 'dist');
const tsc = path.join(packageDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

fs.rmSync(outDir, { recursive: true, force: true });
execFileSync(tsc, ['-b', path.join(packageDir, 'tsconfig.json'), '--force'], { stdio: 'inherit' });
