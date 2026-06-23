#!/usr/bin/env node
/* Wekelijkse promotie voor twee edities (index.html = Merten, jarno.html = Jarno).
   Beide putten uit een gecombineerde playlist: per 2 neutrale thema's 1 persoonlijk/grappig thema.
   Idempotent t.o.v. duplicaten (op g-naam). Valideert het scriptblok met `node --check`;
   bij een fout worden ALLE gewijzigde bestanden hersteld en stopt het script zonder commit. */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = "/* flat lijst met stabiele id's */";
const NEUTRAL = JSON.parse(readFileSync(join(ROOT, 'themes-bank.json'), 'utf8'));
const FUN = JSON.parse(readFileSync(join(ROOT, 'themes-bank-fun.json'), 'utf8'));

// Edities: elk eigen pagina, pointer en weekbrief.
const EDITIONS = [
  { html: 'index.html', pointer: '.bank-pointer',       brief: 'weekbrief.md',       label: 'Suomi-treeni' },
];

// Deterministische playlist: 2 neutraal, dan 1 fun, herhalend. Stabiel bij toevoegen aan het eind.
function buildPlaylist(neutral, fun) {
  const out = []; let ni = 0, fi = 0;
  while (ni < neutral.length || fi < fun.length) {
    for (let k = 0; k < 2 && ni < neutral.length; k++) out.push(neutral[ni++]);
    if (fi < fun.length) out.push(fun[fi++]);
  }
  return out;
}
const PLAYLIST = buildPlaylist(NEUTRAL, FUN);

function reEsc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function jsStr(s){ return JSON.stringify(s); }
function themeExists(html, name){ return new RegExp('g:\\s*"' + reEsc(name) + '"').test(html); }

const GRAMMAR_POOL = [
  'Klemtoon ligt altijd op de eerste lettergreep.',
  'Klinkerharmonie: a/o/u en ä/ö/y mengen niet in één woord.',
  'Dubbele letter = langer aanhouden (tuli vs tulli).',
  'Bij hoeveelheden en na ontkenning gebruik je vaak de partitief.',
  'Richting "naar binnen" = illatief (-an/-en/-in), bijv. saunaan.',
  'Geen lidwoorden in het Fins: "talo" = (het/een) huis.',
  'Bezit: "minulla on..." = ik heb... (letterlijk: bij mij is...).',
];

// Bewaar originelen om bij fout alles te kunnen herstellen.
const originals = new Map();
function snapshot(path){ if(!originals.has(path)) originals.set(path, existsSync(path) ? readFileSync(path,'utf8') : null); }
function restoreAll(){
  for (const [p, c] of originals) {
    if (c === null) { try { unlinkSync(p); } catch {} }
    else writeFileSync(p, c);
  }
}

function validateScript(html, restoreNote){
  const s = html.indexOf('<script>');
  const e = html.indexOf('</script>', s);
  if (s === -1 || e === -1) { restoreAll(); console.error('Script-tags niet gevonden. ' + restoreNote); process.exit(1); }
  const tmp = join(ROOT, '.promote-check.mjs');
  writeFileSync(tmp, html.slice(s + '<script>'.length, e));
  try { execSync('node --check ' + JSON.stringify(tmp), { stdio: 'pipe' }); }
  catch (err) {
    try { unlinkSync(tmp); } catch {}
    restoreAll();
    console.error('node --check fout. ' + restoreNote + ' ' + (err.stderr ? err.stderr.toString() : err.message));
    process.exit(1);
  }
  try { unlinkSync(tmp); } catch {}
}

function writeBrief(ed, theme, idx){
  const tips = [0,1,2].map(k => GRAMMAR_POOL[(idx + k) % GRAMMAR_POOL.length]);
  const words = theme.items.slice(0, 6).map(it => it.fi).join(', ');
  const personal = theme.items.filter(it => it.note).slice(0, 2).map(it => '- ' + it.fi + ' — ' + it.note);
  let md =
`# Weekbrief — ${ed.label}

## Thema van deze week: ${theme.g}

### 3 grammaticatips
1. ${tips[0]}
2. ${tips[1]}
3. ${tips[2]}

### Woorden om te oefenen
${words}

### Spreekopdracht van de week
Neem een spraakmemo op waarin je deze woorden hardop zegt en maak met minstens drie ervan een korte Finse zin. Stuur 'm naar de familie-app.
`;
  if (personal.length) md += `\n### Leuke weetjes\n${personal.join('\n')}\n`;
  writeFileSync(join(ROOT, ed.brief), md);
}

let anyChange = false;

for (const ed of EDITIONS) {
  const htmlPath = join(ROOT, ed.html);
  const pointerPath = join(ROOT, ed.pointer);
  if (!existsSync(htmlPath)) { console.error('Pagina ontbreekt: ' + ed.html); process.exit(1); }
  snapshot(htmlPath); snapshot(pointerPath); snapshot(join(ROOT, ed.brief));

  const original = readFileSync(htmlPath, 'utf8');
  let pointer = existsSync(pointerPath) ? parseInt((readFileSync(pointerPath,'utf8').trim()||'0'),10) : 0;
  if (Number.isNaN(pointer) || pointer < 0) pointer = 0;

  // Zoek eerstvolgend nog niet ingevoegd thema.
  let theme = null;
  while (pointer < PLAYLIST.length) {
    const cand = PLAYLIST[pointer];
    if (themeExists(original, cand.g)) { pointer++; continue; }
    theme = cand; break;
  }
  if (!theme) {
    console.log(ed.label + ': bank op, geen wijziging.');
    writeFileSync(pointerPath, String(pointer));
    continue;
  }

  // Bouw JS-object en voeg in vlak voor de DATA-sluiting (laatste '];' boven MARKER).
  const itemLines = theme.items.map(it => {
    let s = '    {fi:' + jsStr(it.fi) + ', nl:' + jsStr(it.nl);
    if (it.note) s += ', note:' + jsStr(it.note);
    return s + '},';
  }).join('\n');
  const block = '  {g:' + jsStr(theme.g) + ', items:[\n' + itemLines + '\n  ]},\n';

  const markerIdx = original.indexOf(MARKER);
  if (markerIdx === -1) { restoreAll(); console.error(ed.html + ': marker niet gevonden.'); process.exit(1); }
  const closeIdx = original.lastIndexOf('];', markerIdx);
  if (closeIdx === -1) { restoreAll(); console.error(ed.html + ': DATA-sluiting niet gevonden.'); process.exit(1); }

  const updated = original.slice(0, closeIdx) + block + original.slice(closeIdx);
  writeFileSync(htmlPath, updated);
  validateScript(updated, ed.html + ' hersteld; geen commit.');

  writeBrief(ed, theme, pointer);
  writeFileSync(pointerPath, String(pointer + 1));
  anyChange = true;
  console.log(ed.label + ': thema toegevoegd "' + theme.g + '" (pointer -> ' + (pointer + 1) + ').');
}

if (!anyChange) console.log('Niets toe te voegen voor beide edities.');
