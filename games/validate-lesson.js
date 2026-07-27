#!/usr/bin/env node
/**
 * Offline validator for LessonCanvas lesson JSON files.
 *
 * Usage:
 *   node validate-lesson.js my-lesson.json
 *
 * lessoncanvas.html itself catches most of what's checked here too, but only ever
 * via console.warn (which a student opening the lesson will never see) or by
 * silently accepting bad data. This is the pre-ship gate: run it before handing a
 * lesson to a student, not after. Exits non-zero and prints a report on any error;
 * warnings are printed but do not fail the run.
 *
 * Plain Node, no dependencies -- this must stay runnable with nothing but `node`.
 */

'use strict';
const fs = require('fs');

// Mirrors BLOCK_REGISTRY in lessoncanvas.html. Keep in sync by hand: grep
// lessoncanvas.html for the pattern `^    (\w+): \{ section:` and update this list
// whenever a block type is added or removed there.
const KNOWN_BLOCK_TYPES = new Set([
  'heading', 'text', 'math', 'image', 'pdf_page', 'video',
  'button', 'slider', 'multiple_choice', 'reveal', 'number_input', 'custom',
  'end_confetti', 'end_plain', 'lesson_overview', 'performance_summary'
]);

// Mirrors THEME_DEFAULTS' color fields in lessoncanvas.html (colors only -- radius/
// fonts aren't relevant to a contrast check). A lesson's theme.colors is merged over
// these before checking, since an author only overrides the colors they care about
// and the rest fall back to these at runtime too.
const THEME_DEFAULT_COLORS = {
  bg:'#f7f8fb', panel:'#ffffff', border:'#e6e8f0', text:'#22252f', textDim:'#767b8c',
  accent:'#5b6cf0', accentDim:'#eef0fe', accentText:'#3542c9',
  good:'#1e9e6b', goodBg:'#e7f8f0', bad:'#d64550', badBg:'#fdeceb', warn:'#b8790a', warnBg:'#fff5e0'
};

// Foreground/background pairs actually used together for text in the shell.
const CONTRAST_PAIRS = [
  ['text', 'bg'], ['text', 'panel'], ['textDim', 'bg'], ['textDim', 'panel'],
  ['accentText', 'accentDim'], ['good', 'goodBg'], ['bad', 'badBg'], ['warn', 'warnBg']
];

function main(){
  const file = process.argv[2];
  if(!file){
    console.error('Usage: node validate-lesson.js <lesson.json>');
    process.exit(1);
  }

  let raw;
  try{
    raw = fs.readFileSync(file, 'utf8');
  }catch(e){
    console.error('Could not read "' + file + '": ' + e.message);
    process.exit(1);
  }

  let lesson;
  try{
    lesson = JSON.parse(raw);
  }catch(e){
    console.error('Invalid JSON in "' + file + '": ' + e.message);
    process.exit(1);
  }

  const errors = [];
  const warnings = [];
  validateLesson(lesson, errors, warnings);

  if(warnings.length){
    console.log('WARNINGS (' + warnings.length + '):');
    warnings.forEach(w => console.log('  - ' + w));
  }
  if(errors.length){
    console.log((warnings.length ? '\n' : '') + 'ERRORS (' + errors.length + '):');
    errors.forEach(e => console.log('  - ' + e));
  }

  const summary = file + ': ' + (errors.length ? 'FAILED' : 'OK') +
    ' (' + errors.length + ' error' + (errors.length === 1 ? '' : 's') +
    ', ' + warnings.length + ' warning' + (warnings.length === 1 ? '' : 's') + ')';
  console.log((warnings.length || errors.length) ? '\n' + summary : summary);
  process.exit(errors.length ? 1 : 0);
}

function validateLesson(lesson, errors, warnings){
  if(!lesson || typeof lesson !== 'object' || Array.isArray(lesson)){
    errors.push('Lesson must be a JSON object.');
    return;
  }
  if(!Array.isArray(lesson.slides)){
    errors.push('Missing top-level "slides" array.');
    return;
  }

  const sourceCount = Array.isArray(lesson.sources) ? lesson.sources.length : 0;
  const allSlideIds = new Set(lesson.slides.map(s => s && s.id).filter(Boolean));
  const idCounts = new Map(); // block id -> count, across the whole lesson

  lesson.slides.forEach((slide, si) => {
    const slideLabel = 'slide[' + si + ']' + (slide && slide.id ? ' (id "' + slide.id + '")' : '');
    if(!slide || typeof slide !== 'object'){
      errors.push(slideLabel + ' is not an object.');
      return;
    }
    if(!Array.isArray(slide.blocks)){
      errors.push(slideLabel + ' is missing a "blocks" array.');
      return;
    }

    // ids visible to reveal_block/reveal_hint/on_threshold targets on this slide --
    // recurses into `reveal` blocks' own nested `content` array, matching the fix to
    // computeTargetedIds() in lessoncanvas.html (a target can live inside a reveal).
    const idsOnThisSlide = new Set();
    walkBlocks(slide.blocks, b => { if(b.id) idsOnThisSlide.add(b.id); });

    walkBlocks(slide.blocks, (block, path) => {
      const label = slideLabel + ' > ' + path;

      if(!block || typeof block !== 'object' || typeof block.type !== 'string'){
        errors.push(label + ' is missing a "type".');
        return;
      }
      if(!KNOWN_BLOCK_TYPES.has(block.type)){
        errors.push(label + ' has unknown block type "' + block.type + '".');
      }

      if(block.id){
        idCounts.set(block.id, (idCounts.get(block.id) || 0) + 1);
      }

      if(block.type === 'multiple_choice' || block.type === 'number_input'){
        validateGradedBlock(block, label, errors);
      }
      if((block.type === 'multiple_choice' || block.type === 'number_input') && !block.id){
        errors.push(label + ' (' + block.type + ') has no "id" -- it would be silently excluded from performance_summary scoring.');
      }
      if(block.verification && block.verification.check_expression){
        checkVerificationAgreement(block, label, errors);
      }

      if(block.type === 'button' && block.action){
        checkAction(block.action, label, idsOnThisSlide, allSlideIds, errors);
      }
      if(block.type === 'slider' && block.on_threshold && block.on_threshold.reveal_block){
        if(!idsOnThisSlide.has(block.on_threshold.reveal_block)){
          errors.push(label + ' slider on_threshold.reveal_block targets id "' + block.on_threshold.reveal_block + '", which does not exist on this slide.');
        }
      }
      if(block.type === 'custom' && (!block.html || !String(block.html).trim())){
        warnings.push(label + ' (custom) has empty "html".');
      }
      if(block.type === 'text' && typeof block.text === 'string'){
        checkCitations(block.text, label, sourceCount, errors);
      }
    });
  });

  idCounts.forEach((count, id) => {
    if(count > 1) errors.push('Block id "' + id + '" is used ' + count + ' times across this lesson (ids must be unique).');
  });

  checkThemeContrast(lesson.theme, warnings);
}

// Visits every block in `blocks`, recursing into a `reveal` block's own nested
// `content` array (when content is a block array rather than a markdown string) --
// the same scope reveal_block/on_threshold targets can reach in lessoncanvas.html.
function walkBlocks(blocks, visit, pathPrefix){
  (blocks || []).forEach((block, i) => {
    const path = (pathPrefix || 'blocks') + '[' + i + ']' + (block && block.type ? ' (' + block.type + ')' : '');
    visit(block, path);
    if(block && block.type === 'reveal' && Array.isArray(block.content)){
      walkBlocks(block.content, visit, path + '.content');
    }
  });
}

function validateGradedBlock(block, label, errors){
  if(block.type === 'multiple_choice'){
    if(!Array.isArray(block.options) || block.options.length < 2){
      errors.push(label + ' multiple_choice needs "options" as an array of at least 2 entries.');
      return;
    }
    if(typeof block.correct_answer !== 'number'){
      errors.push(label + ' multiple_choice "correct_answer" must be a number (an option index), got ' + JSON.stringify(block.correct_answer) + '.');
      return;
    }
    if(!Number.isInteger(block.correct_answer) || block.correct_answer < 0 || block.correct_answer > block.options.length - 1){
      errors.push(label + ' multiple_choice "correct_answer" (' + block.correct_answer + ') is not a valid index into options (0..' + (block.options.length - 1) + ').');
    }
  } else if(block.type === 'number_input'){
    if(typeof block.correct_answer !== 'number' || !isFinite(block.correct_answer)){
      errors.push(label + ' number_input "correct_answer" must be a finite number, got ' + JSON.stringify(block.correct_answer) + '.');
    }
    if(block.tolerance !== undefined && (typeof block.tolerance !== 'number' || !isFinite(block.tolerance) || block.tolerance < 0)){
      errors.push(label + ' number_input "tolerance" must be a non-negative finite number when present, got ' + JSON.stringify(block.tolerance) + '.');
    }
  }
}

// Cross-checks verification.expected_result against correct_answer only -- it does
// not re-evaluate check_expression (that would mean shipping an expression
// evaluator here, and this file is meant to stay dependency-free). A self-consistent
// check_expression/expected_result pair is worthless if expected_result has simply
// drifted from the actual answer key, so this is the check that actually matters.
function checkVerificationAgreement(block, label, errors){
  const expected = block.verification.expected_result;
  if(block.type === 'number_input' && typeof expected === 'number' && typeof block.correct_answer === 'number'){
    if(Math.abs(expected - block.correct_answer) >= 1e-6){
      errors.push(label + ' verification.expected_result (' + expected + ') disagrees with correct_answer (' + block.correct_answer + ') -- these describe the same value and must match.');
    }
  }
}

function checkAction(action, label, idsOnThisSlide, allSlideIds, errors){
  if(action.type === 'reveal_block' || action.type === 'reveal_hint'){
    if(!action.target || !idsOnThisSlide.has(action.target)){
      errors.push(label + ' button action "' + action.type + '" targets id "' + action.target + '", which does not exist on this slide.');
    }
  } else if(action.type === 'go_to_slide'){
    if(!action.target || !allSlideIds.has(action.target)){
      errors.push(label + ' button action "go_to_slide" targets slide id "' + action.target + '", which does not exist in this lesson.');
    }
  }
}

function checkCitations(text, label, sourceCount, errors){
  const re = /\[(.+?)\]\(cite:(\d+)\)/g;
  let m;
  while((m = re.exec(text))){
    const n = parseInt(m[2], 10);
    if(n < 1 || n > sourceCount){
      errors.push(label + ' cites source ' + n + ' via "' + m[0] + '", but lesson.sources has ' + sourceCount + ' entr' + (sourceCount === 1 ? 'y' : 'ies') + ' (valid range 1..' + sourceCount + ').');
    }
  }
}

function checkThemeContrast(theme, warnings){
  if(!theme || !theme.colors) return;
  const colors = Object.assign({}, THEME_DEFAULT_COLORS, theme.colors);
  CONTRAST_PAIRS.forEach(([fg, bg]) => {
    const ratio = contrastRatio(colors[fg], colors[bg]);
    if(ratio !== null && ratio < 4.5){
      warnings.push('theme.colors.' + fg + ' (' + colors[fg] + ') on theme.colors.' + bg + ' (' + colors[bg] + ') ' +
        'has a contrast ratio of ' + ratio.toFixed(2) + ':1 -- WCAG AA for normal text wants at least 4.5:1; this may be hard to read.');
    }
  });
}

function hexToRgb(hex){
  if(typeof hex !== 'string') return null;
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  if(!m) return null; // not a plain hex color (CSS var, named color, gradient, ...) -- can't check, skip silently
  let h = m[1];
  if(h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function relLuminance({ r, g, b }){
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hex1, hex2){
  const c1 = hexToRgb(hex1), c2 = hexToRgb(hex2);
  if(!c1 || !c2) return null;
  const l1 = relLuminance(c1), l2 = relLuminance(c2);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

module.exports = { validateLesson, KNOWN_BLOCK_TYPES };

if(require.main === module) main();
