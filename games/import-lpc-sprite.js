#!/usr/bin/env node
/**
 * Import a Universal LPC Spritesheet Character Generator "individual frames"
 * export (https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/)
 * into a game's CHAR_ASSETS table, in the format used by ruinward.html's
 * buildCharSprite()/drawCharSprite() (a single spritesheet PNG + JSON
 * metadata: one "rotations" row for the idle pose per direction, plus one
 * "animation" row per direction for each named animation).
 *
 * Usage:
 *   node games/import-lpc-sprite.js <frames.zip> <spriteKey> <target.html> [options]
 *
 * Options:
 *   --anim=Running        Animation name written into the JSON (default: Running)
 *   --lpc-anim=walk       LPC animation folder to pull frames from (default: walk)
 *   --idle-anim=idle      LPC animation folder used for the idle/rotations row
 *                         (default: idle; ignored when merging into an existing sprite)
 *   --cell=64             Cell size in px, LPC standard is 64 (default: 64)
 *   --overwrite           Replace the whole existing entry instead of merging
 *                         the new animation into it (default: merge)
 *
 * What it does:
 *   - New spriteKey: builds a fresh sheet — one idle/rotations row plus one
 *     row per direction for --anim — and adds it to CHAR_ASSETS.
 *   - Existing spriteKey (no --overwrite): decodes the current sheet, appends
 *     --anim's 4 direction rows below it, and updates the JSON's `rows` list
 *     in place. This is how a sprite ends up with more than one animation
 *     (e.g. import `walk` as Running once, then `slash` as "Lead Jab" on a
 *     second run against the same spriteKey).
 *   - Existing spriteKey with --overwrite: rebuilds the entry from scratch
 *     with just the one animation being imported now.
 *
 * Requires (installed once, not shipped in the game file): npm install sharp adm-zip
 *
 * After the first import of a spriteKey, set `sprite: '<spriteKey>'` on the
 * relevant ENEMY_DEFS (or player) entry — the rendering pipeline (direction
 * picking, animation playback, idle fallback) picks it up automatically.
 * `en.attackFlash > 0` selects the animation named "Lead Jab" if present
 * (see the enemy draw code) — import an attack animation under that name to
 * make it show up automatically, e.g. --anim="Lead Jab" --lpc-anim=slash.
 */
const fs = require('fs');

function fail(msg) {
  console.error('Error: ' + msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const opts = {};
for (const a of args) {
  if (!a.startsWith('--')) continue;
  const [k, v] = a.slice(2).split('=');
  opts[k] = v === undefined ? true : v;
}

const [zipPath, spriteKey, htmlPath] = positional;
if (!zipPath || !spriteKey || !htmlPath) {
  console.log('Usage: node games/import-lpc-sprite.js <frames.zip> <spriteKey> <target.html> [--anim=Running] [--lpc-anim=walk] [--idle-anim=idle] [--cell=64] [--overwrite]');
  process.exit(zipPath || spriteKey || htmlPath ? 1 : 0);
}
if (!fs.existsSync(zipPath)) fail(`zip not found: ${zipPath}`);
if (!fs.existsSync(htmlPath)) fail(`target html not found: ${htmlPath}`);

let sharp, AdmZip;
try {
  sharp = require('sharp');
  AdmZip = require('adm-zip');
} catch (e) {
  fail('missing dependency — run: npm install sharp adm-zip (in the directory you run this script from)');
}

const ANIM_NAME = opts.anim || 'Running';
const LPC_ANIM = opts['lpc-anim'] || 'walk';
const IDLE_ANIM = opts['idle-anim'] || 'idle';
const CELL = parseInt(opts.cell || '64', 10);

// LPC's 4 directions, in the order this project's dirOrder convention uses
// (south = facing the camera, i.e. "down" in LPC terms).
const DIR_MAP = [
  ['south', 'down'],
  ['west', 'left'],
  ['north', 'up'],
  ['east', 'right']
];

// Find the object literal starting at `braceIdx` (which must point at a '{')
// and return the index of its matching closing brace, skipping over quoted
// string contents so braces inside string values don't confuse the count.
function matchBrace(text, braceIdx) {
  let depth = 0, inStr = false;
  for (let i = braceIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

(async () => {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const byName = new Map(entries.map((e) => [e.entryName.replace(/\\/g, '/'), e]));

  function frame(anim, lpcDir, n) {
    const e = byName.get(`standard/${anim}/${lpcDir}/${n}.png`);
    return e ? e.getData() : null;
  }
  function frameCount(anim, lpcDir) {
    let n = 1;
    while (frame(anim, lpcDir, n)) n++;
    return n - 1;
  }

  // The requested animation's frames, one array per direction (always needed).
  const animRows = DIR_MAP.map(([, lpcDir]) => {
    const count = frameCount(LPC_ANIM, lpcDir);
    if (count === 0) fail(`missing standard/${LPC_ANIM}/${lpcDir}/1.png in zip — check --lpc-anim`);
    const frames = [];
    for (let i = 1; i <= count; i++) frames.push(frame(LPC_ANIM, lpcDir, i));
    return frames;
  });
  const newMaxCols = Math.max(...animRows.map((f) => f.length));

  let html = fs.readFileSync(htmlPath, 'utf8');
  const startMarker = 'const CHAR_ASSETS = {';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) fail(`could not find "${startMarker}" in ${htmlPath}`);
  const objStart = startIdx + startMarker.length - 1;
  const objEnd = matchBrace(html, objStart);
  if (objEnd === -1) fail('could not find matching closing brace for CHAR_ASSETS');

  // Tolerant of whitespace drift (indentation, \r\n vs \n) around the key —
  // brittle exact-string matching here previously caused a corrupted-replace
  // to go undetected on the next run and duplicate the entry instead.
  const keyRe = new RegExp('\\n[ \\t]*' + spriteKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*\\{');
  const keySearchArea = html.slice(objStart, objEnd);
  const keyMatch = keyRe.exec(keySearchArea);
  const hasExisting = !!keyMatch;
  const existingKeyStart = hasExisting ? objStart + keyMatch.index : -1;
  const existingBraceIdx = hasExisting ? objStart + keyMatch.index + keyMatch[0].length - 1 : -1;

  let sheetBuffer, jsonRows, columns;

  if (hasExisting && !opts.overwrite) {
    // Merge: decode the current sheet and append this animation's rows below it.
    const entryBraceIdx = existingBraceIdx;
    const entryEnd = matchBrace(html, entryBraceIdx);
    if (entryEnd === -1) fail('could not find matching closing brace for existing entry');
    const entryText = html.slice(entryBraceIdx, entryEnd + 1);

    const b64Match = entryText.match(/b64:\s*"([^"]+)"/);
    const jsonMatch = entryText.match(/json:\s*(\{[\s\S]*\})\s*\}\s*$/);
    if (!b64Match || !jsonMatch) fail(`could not parse existing "${spriteKey}" entry — try --overwrite`);
    const existing = JSON.parse(jsonMatch[1]);
    const ss = existing.spritesheet;
    if (ss.cell_size.width !== CELL || ss.cell_size.height !== CELL) {
      fail(`existing "${spriteKey}" uses ${ss.cell_size.width}x${ss.cell_size.height} cells, but --cell=${CELL} — pass a matching --cell or use --overwrite`);
    }
    const oldBuf = Buffer.from(b64Match[1], 'base64');
    const oldMeta = await sharp(oldBuf).metadata();
    const nextRow = Math.max(...ss.rows.map((r) => r.row)) + 1;

    const newWidth = Math.max(oldMeta.width, newMaxCols * CELL);
    const newHeight = oldMeta.height + DIR_MAP.length * CELL;
    const composites = [{ input: oldBuf, left: 0, top: 0 }];
    animRows.forEach((frames, r) => {
      frames.forEach((buf, f) => composites.push({ input: buf, left: f * CELL, top: oldMeta.height + r * CELL }));
    });
    sheetBuffer = await sharp({
      create: { width: newWidth, height: newHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite(composites).png().toBuffer();

    const addedRows = DIR_MAP.map(([dir], r) => ({ row: nextRow + r, type: 'animation', frame_count: animRows[r].length, animation: ANIM_NAME, direction: dir }));
    jsonRows = ss.rows.concat(addedRows);
    columns = Math.max(ss.columns, newMaxCols);
  } else {
    // Fresh build: idle/rotations row + this one animation's 4 direction rows.
    const idleBuffers = DIR_MAP.map(([, lpcDir]) => {
      const buf = frame(IDLE_ANIM, lpcDir, 1);
      if (!buf) fail(`missing standard/${IDLE_ANIM}/${lpcDir}/1.png in zip — check --idle-anim`);
      return buf;
    });
    const maxCols = Math.max(DIR_MAP.length, newMaxCols);
    const rows = 1 + animRows.length;
    const composites = idleBuffers.map((buf, i) => ({ input: buf, left: i * CELL, top: 0 }));
    animRows.forEach((frames, r) => {
      frames.forEach((buf, f) => composites.push({ input: buf, left: f * CELL, top: (r + 1) * CELL }));
    });
    sheetBuffer = await sharp({
      create: { width: maxCols * CELL, height: rows * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite(composites).png().toBuffer();

    jsonRows = [{ row: 0, type: 'rotations', directions: DIR_MAP.map(([d]) => d) }]
      .concat(DIR_MAP.map(([dir], r) => ({ row: r + 1, type: 'animation', frame_count: animRows[r].length, animation: ANIM_NAME, direction: dir })));
    columns = maxCols;
  }

  const b64 = sheetBuffer.toString('base64');
  const jsonBlock = JSON.stringify({ spritesheet: { cell_size: { width: CELL, height: CELL }, columns, rows: jsonRows } });
  const entryText = `  ${spriteKey}: {\n    b64: "${b64}",\n    json: ${jsonBlock}\n  }`;

  if (hasExisting) {
    const entryEnd = matchBrace(html, existingBraceIdx);
    // Replace the whole "\n  key: { ... }" span (from the newline before the
    // key through its closing brace) with a freshly formatted "\n" + entryText,
    // so indentation can't drift entry-to-entry the way it did before.
    html = html.slice(0, existingKeyStart) + '\n' + entryText + html.slice(entryEnd + 1);
    console.log(opts.overwrite ? `Overwrote "${spriteKey}".` : `Merged "${ANIM_NAME}" into existing "${spriteKey}" (now ${jsonRows.length} rows).`);
  } else {
    const before = html.slice(0, objEnd);
    const needsComma = /\S/.test(html.slice(objStart + 1, objEnd));
    html = before + (needsComma ? ',\n' : '\n') + entryText + '\n' + html.slice(objEnd);
    console.log(`Added new "${spriteKey}" entry to CHAR_ASSETS.`);
  }

  fs.writeFileSync(htmlPath, html);
  const meta = await sharp(sheetBuffer).metadata();
  console.log(`Sheet: ${meta.width}x${meta.height}px, ${jsonRows.length} rows total.`);
  console.log(`Done. Set sprite: '${spriteKey}' on the ENEMY_DEFS (or player) entry that should use it.`);
})().catch((e) => fail(e.stack || String(e)));
