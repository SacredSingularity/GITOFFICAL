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
 *
 * ---- Out of scope ----
 * check_expression is never evaluated here -- only cross-checked against
 * expected_result/correct_answer where both are declared numbers. Shipping an
 * expression evaluator would break the no-dependencies rule above, so a
 * check_expression that is simply *wrong* (e.g. "4*t" where it should be "4/t")
 * passes this validator cleanly as long as expected_result and correct_answer
 * still agree with each other. That specific case is only ever caught at runtime,
 * in the browser console, by lessoncanvas.html's own verifyBlock(). A lesson
 * passing this validator can still have a wrong answer key if the expression
 * itself -- not just its stated result -- is bad.
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
    // No `errors` passed here -- a malformed entry is reported once, by the main
    // pass below, not twice.
    const idsOnThisSlide = new Set();
    walkBlocks(slide.blocks, b => { if(b.id) idsOnThisSlide.add(b.id); });

    walkBlocks(slide.blocks, (block, path) => {
      const label = slideLabel + ' > ' + path;

      // walkBlocks() already filtered out null/non-object entries (reporting them
      // itself, since `errors` is passed below), so `block` is guaranteed a real
      // object here -- this only needs to check the one field walkBlocks can't know
      // is required.
      if(typeof block.type !== 'string'){
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
      // Every field that lessoncanvas.html actually pipes through renderMiniMarkdown()
      // can contain a live [text](cite:N) link, not just `text` blocks -- the rule is
      // "renders through the markdown path", not a hardcoded pair of cases.
      const markdownField = MARKDOWN_FIELDS_BY_TYPE[block.type];
      if(markdownField && typeof block[markdownField] === 'string'){
        checkCitations(block[markdownField], label, sourceCount, errors);
      }
      // reveal.content is markdown only when it's a string; when it's an array it's
      // a nested block list instead, already covered by walkBlocks()'s own recursion.
      if(block.type === 'reveal' && typeof block.content === 'string'){
        checkCitations(block.content, label, sourceCount, errors);
      }
    }, undefined, errors);
  });

  idCounts.forEach((count, id) => {
    if(count > 1) errors.push('Block id "' + id + '" is used ' + count + ' times across this lesson (ids must be unique).');
  });

  // Slide ids matter just as much as block ids: go_to_slide resolves via
  // lesson.slides.findIndex(s => s.id === target) in lessoncanvas.html, so two
  // slides sharing an id silently collapse -- every go_to_slide aimed at it reaches
  // only whichever slide comes first, and nothing before this said so.
  const slideIdCounts = new Map();
  lesson.slides.forEach((s, i) => {
    if(s && s.id) slideIdCounts.set(s.id, (slideIdCounts.get(s.id) || []).concat(i));
  });
  slideIdCounts.forEach((indices, id) => {
    if(indices.length > 1){
      errors.push('Slide id "' + id + '" is used by slides at index ' + indices.join(', ') +
        ' -- go_to_slide targeting it will only ever reach slide[' + indices[0] + '].');
    }
  });

  checkThemeContrast(lesson.theme, warnings);
}

// Fields that render through lessoncanvas.html's renderMiniMarkdown() and can
// therefore contain a live [text](cite:N) citation link. Keep in sync by hand:
// grep lessoncanvas.html for `renderMiniMarkdown(` and check what each caller passes.
const MARKDOWN_FIELDS_BY_TYPE = {
  text: 'text',
  multiple_choice: 'explanation',
  end_confetti: 'message',
  end_plain: 'message'
};

// Visits every block in `blocks`, recursing into a `reveal` block's own nested
// `content` array (when content is a block array rather than a markdown string) --
// the same scope reveal_block/on_threshold targets can reach in lessoncanvas.html.
// A null/non-object entry is skipped rather than handed to `visit` (which can
// therefore assume a real object) -- reported once, here, if `errors` is given;
// callers that don't need it to be reported (e.g. a preliminary id-collection
// pass) can omit `errors` and get a silent skip instead of a duplicate report.
function walkBlocks(blocks, visit, pathPrefix, errors){
  (blocks || []).forEach((block, i) => {
    const isObj = block && typeof block === 'object';
    const path = (pathPrefix || 'blocks') + '[' + i + ']' + (isObj && block.type ? ' (' + block.type + ')' : '');
    if(!isObj){
      if(errors) errors.push(path + ' is not an object.');
      return;
    }
    visit(block, path);
    if(block.type === 'reveal' && Array.isArray(block.content)){
      walkBlocks(block.content, visit, path + '.content', errors);
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

// Cross-checks verification.expected_result against correct_answer -- it does not
// re-evaluate check_expression (that would mean shipping an expression evaluator
// here, and this file is meant to stay dependency-free). A self-consistent
// check_expression/expected_result pair is worthless if expected_result has simply
// drifted from the actual answer key, so this is the check that actually matters.
//
// expected_result can only be inferred from correct_answer for number_input, where
// both describe the same arithmetic value. For multiple_choice, correct_answer is
// an option INDEX -- a categorically different value -- so a missing expected_result
// there is an authoring error, not something to default (mirrors verifyBlock() in
// lessoncanvas.html).
function checkVerificationAgreement(block, label, errors){
  const expected = block.verification.expected_result;
  if(expected === undefined){
    if(block.type !== 'number_input'){
      errors.push(label + ' verification.check_expression is present but expected_result is missing -- required for ' +
        block.type + ' blocks, since correct_answer here is not the arithmetic result check_expression is supposed to produce.');
    }
    return; // number_input infers it from correct_answer at runtime; nothing to cross-check here
  }
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
