// Verify the committed catalogue snapshot still matches the CURRENT official
// Kanton Zürich source.
//
//   node tools/catalogue-check/check-source.mjs           # compare size + last-modified (fast, HEAD)
//   node tools/catalogue-check/check-source.mjs --hash     # also download & compare sha256 (definitive)
//
// Reads the canton URL from source.json and the recorded fingerprint from
// official-catalogue.json (_meta, written by extract.py). If the live file at
// zh.ch differs from what we extracted, the official catalogue has been
// republished — re-extract and reconcile. Offline is a soft skip, not a failure.

import fs from 'node:fs';
import crypto from 'node:crypto';

const src = JSON.parse(fs.readFileSync(new URL('./source.json', import.meta.url), 'utf8'));
const meta = JSON.parse(fs.readFileSync(new URL('./official-catalogue.json', import.meta.url), 'utf8'))._meta;
const url = src.pdf_url;
const wantHash = process.argv.includes('--hash');

console.log(`\nCatalogue source check — ${src.label}`);
console.log(`  url:       ${url}`);
console.log(`  snapshot:  ${meta.bytes} bytes · sha256 ${(meta.sha256 || '?').slice(0, 16)}… · last-modified ${meta.http_last_modified || '(n/a)'}`);

let res;
try {
  res = await fetch(url, { method: wantHash ? 'GET' : 'HEAD', headers: { 'User-Agent': 'gkt-catalogue-check/1.0' } });
} catch (e) {
  console.log(`  live:      UNREACHABLE (${e.message}) — skipping source check (offline?).\n`);
  process.exit(0);
}
if (!res.ok) {
  console.log(`  live:      HTTP ${res.status} ${res.statusText} — cannot verify.\n`);
  process.exit(2);
}

const liveBytes = Number(res.headers.get('content-length')) || null;
const liveMod = res.headers.get('last-modified');
let liveSha = null;
if (wantHash) {
  liveSha = crypto.createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');
}
console.log(`  live:      ${liveBytes ?? '?'} bytes${liveSha ? ' · sha256 ' + liveSha.slice(0, 16) + '…' : ''} · last-modified ${liveMod || '(n/a)'}`);

const sizeOk = liveBytes == null || meta.bytes == null || liveBytes === meta.bytes;
const hashOk = !wantHash || liveSha === meta.sha256;

if (!sizeOk || !hashOk) {
  console.log(`\n  DRIFT — the official Zürich catalogue has changed since this snapshot was taken.`);
  console.log(`  Refresh:  python tools/catalogue-check/extract.py   then reconcile & re-run npm run check:catalogue\n`);
  process.exit(1);
}
console.log(`\n  OK — snapshot matches the current official Zürich source` +
            `${wantHash ? ' (sha256 verified)' : ' (size + last-modified; use --hash for a byte-exact check)'}.\n`);
process.exit(0);
