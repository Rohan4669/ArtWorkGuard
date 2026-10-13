#!/usr/bin/env node
// Creates engine/.venv and installs the pinned Python requirements. Works on macOS, Linux and Windows. No shell is used.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = path.join(root, 'engine');
const venv = path.join(engineDir, '.venv');
const win = process.platform === 'win32';
const venvPy = path.join(venv, win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python');
const dev = process.argv.includes('--dev');

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
function findPython() {
  const candidates = [process.env.PYTHON, ...(win ? ['py -3.12', 'py -3', 'python'] : ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3'])].filter(Boolean);
  for (const c of candidates) {
    const [cmd, ...pre] = c.split(' ');
    const r = run(cmd, [...pre, '-c', 'import sys;print("%d.%d" % sys.version_info[:2])']);
    if (r.status === 0) { const [maj, min] = r.stdout.trim().split('.').map(Number); if (maj === 3 && min >= 10) return { cmd, pre, version: r.stdout.trim() }; }
  }
  return null;
}

const py = findPython();
if (!py) { console.error('Python 3.10+ was not found. Install Python 3.12 (python.org on Windows, "brew install python@3.12" on macOS) or set PYTHON=/path/to/python.'); process.exit(1); }
console.log(`Using Python ${py.version}`);
if (!fs.existsSync(venvPy)) {
  console.log('Creating virtual environment…');
  const r = run(py.cmd, [...py.pre, '-m', 'venv', venv], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('Could not create the virtual environment (on Debian/Ubuntu: sudo apt install python3-venv).'); process.exit(1); }
}
const req = path.join(engineDir, dev ? 'requirements-dev.txt' : 'requirements.txt');
console.log(`Installing ${path.basename(req)}…`);
if (run(venvPy, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', req], { stdio: 'inherit' }).status !== 0) { console.error('pip install failed.'); process.exit(1); }
const check = run(venvPy, ['-c', 'import cv2, numpy, pypdfium2; print("OK opencv", cv2.__version__, "| numpy", numpy.__version__, "| pypdfium2", pypdfium2.version.PYPDFIUM_INFO)']);
if (check.status !== 0) { console.error('Dependency check failed:\n' + check.stderr); process.exit(1); }
console.log(check.stdout.trim());
console.log(`\nEngine ready. Set PYTHON_BIN=${venvPy} (the backend default already points here).`);
