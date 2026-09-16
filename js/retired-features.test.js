/* retired-features.test.js — run: node js/retired-features.test.js
 *
 *   "I'm not use anymore SEO page writing, this is old, we can delete all
 *    files from GitHub and other. I'm not use any more photo analysis in my
 *    dashboard too ... Room renders / images too, i'm not use that any more"
 *
 * Three features retired in one pass:
 *
 *   SEO page writer   seo-content.html, seo-content-engine, seo-publish
 *   Images            image-studio.html, page-editor.html, generate-image-
 *                     background, get-render-status, image-context,
 *                     publish-image, publish-image-to-page, and in the
 *                     dashboard: the Images and Page Editor tabs, "add render to
 *                     quote", "detect finishes from render"
 *   Photo analysis    the estimate form's Step 6 (which called a function that
 *                     did not exist), the dashboard's "AI Photo Analysis" card
 *                     and its "use for pricing" toggle, and the photoAnalysis
 *                     field the estimator was handed
 *
 * WHAT THE ESTIMATOR LOSES: nothing it was using. It never saw the photographs.
 * It saw the gpt-4o-mini text about them, and only when the toggle was on,
 * which by default it was not. The one thing that changes is that the list of
 * WHICH shots were sent (wide / detail / other) now always reaches it instead
 * of being switched off together with the analysis.
 *
 * A deleted file is easy to check. A reference to a deleted file is the thing
 * that breaks: a tab that opens an iframe onto a 404, a save that reads a
 * checkbox that is not there, a fetch to a function that is gone. This file
 * looks for the references.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* Comments stripped before searching: a comment that explains what was removed
   names the thing it removed, and the first run of this file failed on exactly
   that - its own explanations. Code is what can still reach a deleted thing. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
const RAW_DASH = read('dashboard.html'), RAW_FORM = read('estimate.html');
const DASH = strip(RAW_DASH);
const FORM = strip(RAW_FORM);
/* Stripping is lossy on JavaScript (a '/*' inside a string or a regex eats
   real code), so anything that must still EXIST, and the parse checks, read the
   raw file. Only the "gone" checks read the stripped one. */

/* ══ THE FILES ARE GONE ═══════════════════════════════════════════════════ */
console.log('\nthe retired files are gone\n');
const GONE = [
  'seo-content.html', 'image-studio.html', 'page-editor.html',
  'netlify/functions/seo-content-engine.js', 'netlify/functions/seo-publish.js',
  'netlify/functions/generate-image-background.js', 'netlify/functions/get-render-status.js',
  'netlify/functions/image-context.js', 'netlify/functions/publish-image.js',
  'netlify/functions/publish-image-to-page.js',
  /* Second pass, at his answer: the weekly SEO job, the SEO Brain tab's two
     functions, the Search Console pull that only they used, and the Keyword
     Volumes page. */
  'netlify/functions/seo-weekly-run.js', 'netlify/functions/seo-ai-analyze.js',
  'netlify/functions/seo-dashboard-data.js', 'netlify/functions/fetch-search-console.js',
  'keyword-volumes.html',
];
GONE.forEach(function (f) { ok(f + ' is deleted', !fs.existsSync(path.join(ROOT, f))); });

/* ══ AND NOTHING STILL POINTS AT THEM ═════════════════════════════════════ */
console.log('\nno page, script or function still reaches for one of them\n');
{
  const walk = (dir, out) => {
    fs.readdirSync(dir).forEach(function (f) {
      const p = path.join(dir, f);
      if (f === 'node_modules' || f === '.git') return;
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (/\.(html|js|toml|json|txt)$/.test(f) && !/\.test\.js$/.test(f) && f !== 'retired-features.test.js') out.push(p);
    });
    return out;
  };
  const files = walk(ROOT, []);
  const NAMES = ['seo-content', 'image-studio', 'page-editor', 'seo-content-engine', 'seo-publish',
    'generate-image-background', 'get-render-status', 'image-context', 'publish-image', 'find-finishes',
    'estimate-analyze-photo', 'seo-weekly-run', 'seo-ai-analyze', 'seo-dashboard-data', 'fetch-search-console',
    'keyword-volumes'];
  const hits = [];
  files.forEach(function (p) {
    const src = fs.readFileSync(p, 'utf8');
    /* Strip comments: a comment that explains what was removed is not a reference. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*#.*$/gm, '');
    NAMES.forEach(function (n) {
      const re = new RegExp('[\\/"\'`]' + n.replace(/-/g, '\\-') + '(?:\\.html|\\.js|["\'`\\s?)])', 'g');
      const m = code.match(re);
      if (m) hits.push(path.relative(ROOT, p) + ': ' + n + ' ×' + m.length);
    });
  });
  ok('NO LIVE REFERENCE TO A DELETED PAGE OR FUNCTION ANYWHERE', hits.length === 0, hits.join('\n        '));
}

/* ══ THE DASHBOARD ════════════════════════════════════════════════════════ */
console.log('\nthe dashboard no longer offers what is gone\n');
ok('no Images tab', DASH.indexOf('"images"') === -1 && DASH.indexOf("'images'") === -1);
ok('no Page Editor tab', DASH.indexOf('pageeditor') === -1);
ok('no Content Studio dispatch', DASH.indexOf('renderContentStudio') === -1);
ok('no SEO Brain or Keyword Volumes tab code either',
  DASH.indexOf('renderSeoTab') === -1 && DASH.indexOf('renderKeywordVolumes') === -1 && DASH.indexOf('runSeoNow') === -1);
ok('no iframe onto a deleted page', !/<iframe src="\/(seo-content|image-studio|page-editor)/.test(DASH));
ok('the "add render to quote" path is gone', DASH.indexOf('addRenderToQuote') === -1 && DASH.indexOf('currentRenderBase64') === -1);
ok('the "detect finishes from render" path is gone', DASH.indexOf('sbcfDetectFromRender') === -1 && DASH.indexOf('sbcfUseInRender') === -1);
ok('the "AI Photo Analysis" card is gone', DASH.indexOf('AI Photo Analysis') === -1 && DASH.indexOf('paList') === -1);
ok('...and its "use for pricing" checkbox with it', DASH.indexOf('use-photo-analysis') === -1);
ok('THE SAVE PATH DOES NOT READ THE MISSING CHECKBOX — that would throw on every Generate',
  DASH.indexOf('usePhotoAnalysis') === -1);
ok('the finish builder that hosted the detect button is still there',
  /window\.sbcfAddGroup=/.test(RAW_DASH) && /est\.finishGroups=/.test(RAW_DASH));
ok('the readiness box still renders on its own',
  /\(readinessHtml \?\s*'<div class="form-section" id="readiness-section">' \+ readinessHtml \+ '<\/div>'/.test(RAW_DASH));
ok('the visitors tab still has the table styles it borrowed from the SEO tab',
  /^\.seo-table \{/m.test(RAW_DASH) && /class="seo-table"/.test(RAW_DASH));

/* ══ THE ESTIMATE FORM ════════════════════════════════════════════════════ */
console.log('\nthe customer form no longer carries the dead analysis step\n');
ok('Step 6 markup is gone', FORM.indexOf('data-step="6"') === -1 && FORM.indexOf('analysis-cards') === -1);
ok('nothing tries to reach it', FORM.indexOf('goToStep(6)') === -1);
ok('the fetch to the function that never existed is gone', FORM.indexOf('estimate-analyze-photo') === -1);
ok('formData has no photoAnalysis', !/photoAnalysis/.test(FORM));
ok('the submitted payload does not carry it either', FORM.indexOf('analysisLite') === -1);
ok('the question planner is no longer sent photoNotes', FORM.indexOf('photoNotes') === -1);
ok('photos are still uploaded and still counted',
  /upload-photo/.test(RAW_FORM) && /photoCount:photos\.length/.test(RAW_FORM));
ok('the planner still gets the photos themselves',
  /photos:\(formData\.photos\|\|\[\]\)\.filter/.test(RAW_FORM));
{
  /* The planner call is an object literal; removing its last property must
     have left it syntactically whole. Parse every script block. */
  const blocks = RAW_FORM.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  let broken = null;
  blocks.forEach(function (b, i) {
    try { new vm.Script(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); }
    catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; }
  });
  ok('every script block in estimate.html parses', broken === null, broken || '');
}

/* ══ THE ESTIMATOR ════════════════════════════════════════════════════════ */
console.log('\nthe estimator is handed the same thing it always used - minus a field that was off\n');
{
  const BG = read('netlify/functions/generate-estimate-background.js');
  ok('the estimator no longer takes photoAnalysis', !/photoAnalysis:/.test(BG.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('WHICH SHOTS WERE SENT now always reaches it, no longer switched off with the analysis',
    /photoShots: photoShots\(request\),/.test(BG) && !/usePhotoAnalysis/.test(BG));
  ok('the request intake no longer stores the field', !/photoAnalysis/.test(read('netlify/functions/estimate-request.js')));
  ok('the scope pin still fingerprints old records the same way, so no stored pin goes stale',
    /photoAnalysis: req\.photoAnalysis/.test(read('netlify/functions/lib/scope-pin.js')));
}

/* ══ SECRETS THAT NO LONGER NEED TO EXIST ═════════════════════════════════ */
console.log('\ntwo environment variables have no user left\n');
{
  const fns = fs.readdirSync(path.join(ROOT, 'netlify/functions')).filter(f => f.endsWith('.js'));
  const users = (name) => fns.filter(f => read('netlify/functions/' + f).indexOf(name) !== -1);
  ok('GITHUB_TOKEN is read by no function — it can be removed from Netlify', users('GITHUB_TOKEN').length === 0, users('GITHUB_TOKEN').join(', '));
  ok('GEMINI_API_KEY is read by no function — it can be removed from Netlify', users('GEMINI').length === 0, users('GEMINI').join(', '));
}

/* ══ ROBOTS ═══════════════════════════════════════════════════════════════ */
console.log('\nrobots.txt no longer names pages that do not exist\n');
{
  const R = read('robots.txt');
  ok('the deleted tools are no longer listed', !/image-studio|seo-content|page-editor|keyword-volumes/.test(R));
  ok('the dashboard and the remaining tool still are', /Disallow: \/dashboard/.test(R) && /Disallow: \/bid-analyzer/.test(R));
}

console.log('\nevery script block in dashboard.html still parses\n');
{
  const blocks = RAW_DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  let broken = null;
  blocks.forEach(function (b, i) {
    try { new vm.Script(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); }
    catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; }
  });
  ok('all ' + blocks.length + ' blocks parse', broken === null, broken || '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
