#!/usr/bin/env node
/* Wekelijkse promotie: voegt 1 nieuw thema uit themes-bank.json toe aan index.html.
   Idempotent t.o.v. duplicaten: slaat thema's over waarvan de g-naam al bestaat. */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');
const BANK = join(ROOT, 'themes-bank.json');
const POINTER = join(ROOT, '.bank-pointer');
const WEEKBRIEF = join(ROOT, 'weekbrief.md');
const MARKER = "/* flat lijst met stabiele id's */";

function reEsc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function jsStr(s){ return JSON.stringify(s); } // geldige JS-stringliteral

const original = readFileSync(INDEX, 'utf8');
const bank = JSON.parse(readFileSync(BANK, 'utf8'));
let pointer = existsSync(POINTER) ? parseInt(readFileSync(POINTER, 'utf8').trim() || '0', 10) : 0;
if (Number.isNaN(pointer) || pointer < 0) pointer = 0;

function themeExists(html, name){
  const re = new RegExp('g:\\s*"' + reEsc(name) + '"');
  return re.test(html);
}

// Zoek het eerste nog niet ingevoegde thema vanaf pointer.
let theme = null;
while (pointer < bank.length) {
  const cand = bank[pointer];
  if (themeExists(original, cand.g)) { pointer++; continue; }
  theme = cand;
  break;
}

if (!theme) {
  console.log('Bank op of alle resterende thema\'s bestaan al. Geen wijziging.');
  writeFileSync(POINTER, String(pointer));
  process.exit(0);
}

// Bouw het thema-object als geldige JS.
const itemLines = theme.items.map(it => {
  let s = '    {fi:' + jsStr(it.fi) + ', nl:' + jsStr(it.nl);
  if (it.note) s += ', note:' + jsStr(it.note);
  s += '},';
  return s;
}).join('\n');
const block = '  {g:' + jsStr(theme.g) + ', items:[\n' + itemLines + '\n  ]},\n';

// Vind de DATA-array sluiting: het laatste '];' vóór de MARKER-regel.
const markerIdx = original.indexOf(MARKER);
if (markerIdx === -1) { console.error('Marker niet gevonden; stop.'); process.exit(1); }
const closeIdx = original.lastIndexOf('];', markerIdx);
if (closeIdx === -1) { console.error('DATA-sluiting niet gevonden; stop.'); process.exit(1); }

const updated = original.slice(0, closeIdx) + block + original.slice(closeIdx);
writeFileSync(INDEX, updated);

// VALIDATIE: knip scriptinhoud en draai node --check.
function restoreAndFail(msg){
  writeFileSync(INDEX, original);
  console.error('Validatie faalde: ' + msg + ' index.html hersteld, geen wijziging.');
  process.exit(1);
}
const s = updated.indexOf('<script>');
const e = updated.indexOf('</script>', s);
if (s === -1 || e === -1) restoreAndFail('script-tags niet gevonden.');
const scriptBody = updated.slice(s + '<script>'.length, e);
const tmp = join(ROOT, '.promote-check.mjs');
writeFileSync(tmp, scriptBody);
try {
  execSync('node --check ' + JSON.stringify(tmp), { stdio: 'pipe' });
} catch (err) {
  try { unlinkSync(tmp); } catch {}
  restoreAndFail('node --check fout: ' + (err.stderr ? err.stderr.toString() : err.message));
}
try { unlinkSync(tmp); } catch {}

// Weekbrief schrijven: 3 tips passend bij de woorden + spreekopdracht.
const notes = theme.items.filter(it => it.note).map(it => it.fi + ': ' + it.note);
const generic = [
  'Klemtoon ligt altijd op de eerste lettergreep.',
  'Klinkerharmonie: a/o/u en ä/ö/y mengen niet in één woord.',
  'Dubbele letter = langer aanhouden (bijv. tuli vs tulli).',
  'Bij hoeveelheden en na ontkenning gebruik je vaak de partitief.'
];
const tips = [];
for (const n of notes) { if (tips.length < 3) tips.push(n); }
for (const g of generic) { if (tips.length < 3) tips.push(g); }
const sample = theme.items.slice(0, 5).map(it => it.fi).join(', ');
const brief =
`# Weekbrief

## Thema van deze week: ${theme.g}

### 3 grammaticatips
1. ${tips[0]}
2. ${tips[1]}
3. ${tips[2]}

### Spreekopdracht van de week
Neem een spraakmemo op waarin je deze vijf woorden hardop zegt: ${sample}.
Maak met minstens drie ervan een korte Finse zin en stuur de memo naar je Finse familie.
`;
writeFileSync(WEEKBRIEF, brief);

// Pointer opslaan (+1 t.o.v. gebruikt thema).
writeFileSync(POINTER, String(pointer + 1));
console.log('Thema toegevoegd: ' + theme.g + ' (pointer -> ' + (pointer + 1) + ').');
