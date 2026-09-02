/* ai-crawler.test.js — run: node js/ai-crawler.test.js
 *
 *   "he was asking for ChatGPT something for cabinetry and ChatGPT was
 *    recommended my company, and that's why he contacted me"
 *
 * That is a real job, won from an AI recommendation, so this is worth keeping
 * healthy rather than guessing at.
 *
 * WHAT AN AI CRAWLER ACTUALLY READS. GPTBot, OAI-SearchBot, ClaudeBot,
 * PerplexityBot and Google-Extended fetch raw HTML and mostly do NOT execute
 * JavaScript. On this site the menu and footer are injected by
 * partials/site.js, so every link they carry is invisible to those crawlers.
 * What the crawlers can see is:
 *
 *   robots.txt          whether they are allowed in at all
 *   llms.txt            a plain-text map of the business and its pages
 *   JSON-LD             302 FAQ answers, 33 Service blocks, the Organization
 *   server-rendered <a> the handful of links written into each page's own HTML
 *
 * WHAT WAS WRONG. llms.txt existed and was good, but it listed 20 pages and the
 * site has 41. Twenty-one were missing — including KITCHEN CABINET INSTALLATION,
 * which is the exact service the customer asked ChatGPT about. It also claimed
 * 62 Google reviews while the pages claimed 66 and Google itself showed 67:
 * three different numbers for one fact, on a site whose whole value to an AI is
 * being a reliable source about this business.
 *
 * THE ONE THAT WOULD HURT MOST: silently blocking an AI crawler in robots.txt.
 * It would not break a single page, nothing would look wrong, and the referrals
 * would just stop. Asserted first and hardest.
 */
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const ROBOTS = read('robots.txt');
const LLMS = read('llms.txt');

/* ══ THE ONE THAT WOULD HURT MOST ═════════════════════════════════════════ */
console.log('\nno AI crawler is blocked — this fails silently if it ever breaks\n');
{
  /* Parse robots.txt into user-agent groups so a Disallow under one agent is not
     mistaken for a site-wide rule. */
  const groups = {};
  let current = [];
  ROBOTS.split('\n').forEach(function (line) {
    const l = line.replace(/#.*$/, '').trim();
    if (!l) return;
    const m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) return;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') { current = [val.toLowerCase()]; groups[val.toLowerCase()] = groups[val.toLowerCase()] || []; }
    else if (key === 'disallow' && val) current.forEach(function (a) { (groups[a] = groups[a] || []).push(val); });
  });
  const BOTS = ['gptbot', 'oai-searchbot', 'chatgpt-user', 'claudebot', 'claude-user', 'claude-searchbot',
    'perplexitybot', 'perplexity-user', 'google-extended', 'ccbot', 'applebot-extended', 'bytespider', 'meta-externalagent'];
  const blocked = BOTS.filter(function (b) { return (groups[b] || []).indexOf('/') !== -1; });
  ok('NO AI CRAWLER IS BLOCKED FROM THE WHOLE SITE', blocked.length === 0, blocked.join(', '));

  const star = groups['*'] || [];
  ok('the catch-all group does not disallow the site root', star.indexOf('/') === -1, star.join(', '));
  ok('...and the pages that matter are reachable under it',
    ['/services', '/bathroom-renovation', '/kitchen-cabinet-installation', '/tile-grouting-restoration']
      .every(function (p) { return star.indexOf(p) === -1; }));
  /* The contractor tools SHOULD stay blocked. If that ever inverts, the
     dashboard becomes training data. */
  ok('the contractor-only tools are still disallowed, as they must be',
    ['/dashboard', '/image-studio', '/page-editor'].every(function (p) { return star.indexOf(p) !== -1; }),
    star.join(', '));
}

/* ══ CONTENT SIGNALS ══════════════════════════════════════════════════════
 * A second, quieter way to say no. robots.txt Disallow controls whether a bot
 * may FETCH a page; Content-Signal controls what it may DO with what it fetched.
 * A site can be fully crawlable and still say "do not use this to answer
 * questions", which for this business would be the worst of both worlds — the
 * crawl cost with none of the referrals.
 *
 * Cloudflare's dashboard has a "managed robots.txt" toggle that writes
 *   Content-signal: search=yes, ai-train=no, use=reference
 * over the top of this file. One click, no warning, and the line inverts. That
 * is precisely the kind of silent reversal these assertions exist to catch, so
 * the check below is written to fail on ANY "=no", not only the ones set today.
 */
console.log('\nautomated systems are told they may USE the content, not just read it\n');
{
  /* Pull the directive out of the catch-all group. */
  let group = null, signal = null;
  ROBOTS.split('\n').forEach(function (line) {
    const l = line.replace(/#.*$/, '').trim();
    if (!l) return;
    const m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) return;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') group = m[2].trim();
    else if (key === 'content-signal' && group === '*') signal = m[2].trim().toLowerCase();
  });

  ok('THE CONTENT-SIGNAL LINE EXISTS, in the catch-all group', signal !== null, signal || 'not found');

  const fields = {};
  (signal || '').split(',').forEach(function (p) {
    const kv = p.trim().split('=');
    if (kv.length === 2) fields[kv[0].trim()] = kv[1].trim();
  });

  ok('search=yes — it may be indexed', fields.search === 'yes', fields.search);
  ok('AI-INPUT=YES — it may be used to answer a live question. This is the one that won the cabinetry job.',
    fields['ai-input'] === 'yes', fields['ai-input']);
  ok('ai-train=yes — it may be trained on', fields['ai-train'] === 'yes', fields['ai-train']);
  ok('use=full — it may be summarized, not merely linked', fields.use === 'full', fields.use);

  /* The catch-all. Any future field set to "no" fails here even though no
     assertion above knows its name. */
  const denied = Object.keys(fields).filter(function (k) { return fields[k] === 'no'; });
  ok('NOTHING IS SET TO "no" — a managed-robots.txt click would show up right here',
    denied.length === 0, denied.join(', '));

  /* The rest of the file has to keep meaning what it says. */
  ok('...and the catch-all group still allows the site root',
    /^\s*Allow:\s*\/\s*$/m.test(ROBOTS));
}

/* ══ llms.txt COVERS THE WHOLE BUSINESS ═══════════════════════════════════ */
console.log('\nllms.txt maps every public page, not a subset\n');
{
  const SKIP = new Set(['dashboard', 'image-studio', 'page-editor', 'dashboard-shell', 'bid-analyzer',
    'seo-content', 'keyword-volumes', 'invoice', 'agreement', 'contract', 'quote', 'estimate',
    'handyman-estimate', 'googlee822c2a7421a7276', '404', 'review', 'index', 'sitemap']);
  const pages = fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html'); })
    .map(function (f) { return f.slice(0, -5); }).filter(function (p) { return !SKIP.has(p); });
  const listed = new Set((LLMS.match(/sanibuildingcorp\.com\/([a-z0-9-]+)/g) || [])
    .map(function (m) { return m.split('/').pop(); }));
  const missing = pages.filter(function (p) { return !listed.has(p); });
  ok('EVERY PUBLIC PAGE IS LISTED', missing.length === 0, missing.join(', '));

  /* The service that actually won a job from ChatGPT. */
  ok('KITCHEN CABINET INSTALLATION IS THERE — the service a customer asked ChatGPT about',
    /kitchen-cabinet-installation\)/.test(LLMS) && /cabinet/i.test(LLMS));
  ok('...and the word "cabinetry" appears, because that is what he typed',
    /cabinetry/i.test(LLMS));

  /* The small, quick work he actually wants to sell. */
  ['regrout', 'tile repair', 'wall panels', 'backsplash', 'waterproofing', 'same-day'].forEach(function (t) {
    ok('llms.txt names "' + t + '" — the small quick work he wants', new RegExp(t, 'i').test(LLMS));
  });

  ok('every link in it points at a page that exists',
    (function () {
      const bad = Array.from(listed).filter(function (s) {
        return !fs.existsSync(path.join(ROOT, s + '.html')) && !fs.existsSync(path.join(ROOT, s));
      });
      return bad.length === 0 ? true : bad.join(', ');
    })() === true);
}

console.log('\nthe business facts agree with each other everywhere\n');
{
  /* Three different review counts on one site is the kind of contradiction that
     makes an AI trust the source less. */
  const counts = new Set();
  fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html'); }).forEach(function (f) {
    const h = read(f);
    (h.match(/"reviewCount":\s*"(\d+)"/g) || []).forEach(function (m) { counts.add(m.match(/(\d+)/)[1]); });
    (h.match(/(\d+)\s+Google\s+[Rr]eviews/g) || []).forEach(function (m) { counts.add(m.match(/(\d+)/)[1]); });
  });
  (LLMS.match(/(\d+)\s+Google\s+reviews/g) || []).forEach(function (m) { counts.add(m.match(/(\d+)/)[1]); });
  ok('ONE review count across the whole site and llms.txt, not three',
    counts.size === 1, Array.from(counts).sort().join(' / '));

  const PHONE = '(332) 277-0990', ADDR = '2954 Brighton 12th Street';
  ok('llms.txt carries the same phone number as the schema', LLMS.indexOf(PHONE) !== -1);
  ok('...and the same street address', LLMS.indexOf(ADDR) !== -1);
  ok('...and says fully insured, never "licensed"',
    /fully insured/i.test(LLMS) && !/licensed/i.test(LLMS));
  ok('no TV mounting anywhere in it', !/tv mount/i.test(LLMS));
  ok('US spelling, on a New York contractor\'s file',
    !/colour|specialise|organise|centre\b/i.test(LLMS));
}

console.log('\nllms.txt can be found without guessing\n');
ok('robots.txt points at it', /llms\.txt/i.test(ROBOTS));

/* ══ THE STRUCTURED DATA AI ACTUALLY MINES ════════════════════════════════ */
console.log('\nthe structured data an AI reads instead of the JavaScript menu\n');
{
  const SKIPH = new Set(['dashboard.html', 'image-studio.html', 'page-editor.html', 'dashboard-shell.html',
    'bid-analyzer.html', 'seo-content.html', 'keyword-volumes.html', 'invoice.html', 'agreement.html',
    'contract.html', 'quote.html', 'estimate.html', 'handyman-estimate.html',
    'googlee822c2a7421a7276.html', '404.html', 'review.html']);
  const pages = fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html') && !SKIPH.has(f); });
  const without = pages.filter(function (f) { return !/application\/ld\+json/.test(read(f)); });
  ok('EVERY public page carries structured data', without.length === 0, without.join(', '));

  let faqs = 0, broken = [];
  pages.forEach(function (f) {
    (read(f).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []).forEach(function (b) {
      const body = b.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '');
      try {
        const d = JSON.parse(body);
        (Array.isArray(d) ? d : [d]).forEach(function (x) {
          if (x['@type'] === 'FAQPage') faqs += (x.mainEntity || []).length;
        });
      } catch (e) { broken.push(f); }
    });
  });
  ok('every block on every page is valid JSON — an AI silently skips one that is not',
    broken.length === 0, Array.from(new Set(broken)).join(', '));
  ok('the FAQ answer bank is intact (300+ questions)', faqs >= 300, faqs + ' questions');

  /* sameAs is how an AI corroborates that this business is real. */
  const IDX = read('index.html');
  const same = (IDX.match(/"sameAs":\s*\[([^\]]*)\]/) || [])[1] || '';
  const platforms = (same.match(/https?:\/\/[^"]+/g) || []).length;
  ok('the homepage links the business to its listings elsewhere — how an AI checks it is real',
    platforms >= 10, platforms + ' platforms');
  ['yelp.com', 'trustpilot.com', 'houzz.com', 'angi.com', 'mapquest.com'].forEach(function (p) {
    ok('...including ' + p, same.indexOf(p) !== -1);
  });
  ok('the organization has a stable @id the other blocks point at',
    /"@id":\s*"https:\/\/www\.sanibuildingcorp\.com\/#organization"/.test(IDX));
}

console.log('\nwhat a crawler that does not run JavaScript can still reach\n');
{
  /* The menu and footer are injected by partials/site.js. These crawlers do not
     run it, so the homepage's own <a> tags are the entry points to the site. */
  const IDX = read('index.html');
  const links = new Set((IDX.match(/href="(\/[^"#?]*)"/g) || [])
    .map(function (m) { return m.slice(6, -1); })
    .filter(function (h) { return !h.startsWith('/.netlify') && !/\.(png|ico|jpg|webmanifest|json)$/.test(h); }));
  ok('the homepage carries real links in its own HTML, not only in the JS menu',
    links.size >= 10, links.size + ' links');
  ['/services', '/kitchen-cabinet-installation', '/bathroom-renovation', '/commercial-tile-installation', '/contact']
    .forEach(function (p) { ok('...including ' + p, links.has(p)); });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
