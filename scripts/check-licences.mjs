#!/usr/bin/env node
// Lists licences of every production dependency (npm tree + Python engine venv) and flags anything not on the permissive allow-list.
// This is an engineering aid, NOT legal clearance.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PERMISSIVE = /^(MIT|ISC|BSD-[23]-Clause|Apache-2\.0|0BSD|CC0-1\.0|Zlib|MIT-CMU|HPND|BlueOak-1\.0\.0|Python-2\.0|Unlicense|CC-BY-4\.0|OFL-1\.1)$/i;
const COPYLEFT = /(A?GPL|LGPL|SSPL|EUPL|MPL|CC-BY-SA|CC-BY-NC)/i;
const REVIEW_NOTES = { 'opencv-python-headless': 'Wheel bundles FFmpeg (LGPL), libvpx, OpenSSL 1.1.1 - legal + security review', pypdfium2: 'Bundles PDFium and third-party notices - reproduce notices when distributing' };

const norm = (l) => (typeof l === 'string' ? l : l?.type || (Array.isArray(l) ? l.map(norm).join(' OR ') : 'UNKNOWN'));
const expressionOk = (expr) => expr.replace(/[()]/g, ' ').split(/\s+(?:AND|OR)\s+/i).every((t) => PERMISSIVE.test(t.trim()));
const rows = [];

// npm production tree
const ls = spawnSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
for (const p of new Set(ls.stdout.split('\n').filter((x) => x.includes('node_modules')))) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8'));
    if (j.private && j.name?.startsWith('@artworkguard/')) continue; // this project's own workspaces
    let lic = norm(j.license ?? j.licenses);
    if (lic === 'UNKNOWN') { // fall back to sniffing the shipped LICENSE file
      const f = fs.readdirSync(p).find((n) => /^licen[cs]e/i.test(n));
      const t = f ? fs.readFileSync(path.join(p, f), 'utf8').slice(0, 600) : '';
      if (/Permission is hereby granted, free of charge/i.test(t)) lic = 'MIT (LICENSE file; metadata missing)';
    }
    rows.push({ eco: 'npm', name: j.name, version: j.version, license: lic });
  } catch { /* workspace link or missing */ }
}
// Python venv
const win = process.platform === 'win32';
const venvPy = path.join(root, 'engine', '.venv', win ? 'Scripts/python.exe' : 'bin/python');
if (fs.existsSync(venvPy)) {
  const code = 'import importlib.metadata as m,json;print(json.dumps([{"name":d.metadata["Name"],"version":d.version,"license":(d.metadata.get("License-Expression") or d.metadata.get("License") or "UNKNOWN").split("\\n")[0][:80],"classifiers":[c for c in (d.metadata.get_all("Classifier") or []) if c.startswith("License")]} for d in m.distributions() if d.metadata["Name"].lower() not in ("pip","setuptools","wheel")]))';
  const r = spawnSync(venvPy, ['-c', code], { encoding: 'utf8' });
  if (r.status === 0) for (const d of JSON.parse(r.stdout)) {
    const cls = d.classifiers.map((c) => c.split('::').pop().trim()).join('; ');
    const lic = /^(UNKNOWN|Files:|Copyright)/i.test(d.license) || d.license.length > 40 ? cls || d.license : d.license;
    rows.push({ eco: 'python', name: d.name, version: d.version, license: lic });
  }
} else console.warn('! engine/.venv not found: Python licences were NOT checked (run "npm run setup:engine").');

const norm2 = (l) => l.replace(/\s*\(LICENSE file; metadata missing\)/, '').replace(/, dependency licenses/i, '').replace(/,\s*/g, ' AND ').replace(/Apache Software License/i, 'Apache-2.0').replace(/Apache 2\.0/i, 'Apache-2.0').replace(/^BSD License$/i, 'BSD-3-Clause').replace(/^MIT License$/i, 'MIT');
let bad = 0, review = 0; const byLic = {};
for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  const lic = norm2(r.license); byLic[lic] = (byLic[lic] || 0) + 1;
  const note = REVIEW_NOTES[r.name?.toLowerCase()];
  const status = COPYLEFT.test(lic) ? 'COPYLEFT' : expressionOk(lic) ? (note ? 'REVIEW' : 'ok') : 'UNRECOGNISED';
  if (status === 'COPYLEFT' || status === 'UNRECOGNISED') bad++; if (status === 'REVIEW') review++;
  if (status !== 'ok') console.log(`${status.padEnd(12)} ${r.eco.padEnd(6)} ${r.name}@${r.version}  [${lic}]${note ? '  - ' + note : ''}`);
}
console.log(`\n${rows.length} production packages. Licence summary:`);
Object.entries(byLic).sort((a, b) => b[1] - a[1]).forEach(([l, n]) => console.log(`  ${String(n).padStart(4)}  ${l}`));
console.log(`\nflagged for action: ${bad}   flagged for review notes: ${review}`);
console.log('Reminder: this is not legal advice or clearance.');
process.exit(bad ? 1 : 0);
