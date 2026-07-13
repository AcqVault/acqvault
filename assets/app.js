
// ── NAV SCROLL + ABOUT BAR HEIGHT ────────────────────────────────────────────
(function() {
  var nav = document.getElementById('main-nav');
  var aboutBar = document.getElementById('about-bar');
  // Persist the greeting-bar dismissal so it doesn't reappear every visit (esp. costly on the mobile fold).
  try { if (aboutBar && localStorage.getItem('acqvault_about_dismissed') === '1') { aboutBar.remove(); aboutBar = null; } } catch (e) {}

  function updateLayout() {
    var barH = aboutBar && !aboutBar.classList.contains('hidden') ? aboutBar.offsetHeight : 0;
    document.documentElement.style.setProperty('--nav-top', barH + 'px');
    nav.style.top = barH + 'px';
  }

  function updateNav() {
    var heroEl = document.querySelector('.hero');
    var overHero = !!heroEl && !document.body.classList.contains('work-mode')
      && window.scrollY < (heroEl.offsetHeight - 72);
    nav.classList.toggle('over-hero', overHero);
    nav.classList.toggle('scrolled', window.scrollY > 30 && !overHero);
  }
  window.acqUpdateNav = updateNav; // let mode changes (work-mode) recolor the nav without a scroll

  window.addEventListener('scroll', function() {
    updateNav();
  }, { passive: true });

  window.addEventListener('resize', updateLayout, { passive: true });
  updateLayout();
  updateNav();
})();

// ── SCROLL REVEAL ─────────────────────────────────────────────────────────────
(function() {
  var els = document.querySelectorAll('.fade-up');
  if (!els.length) return;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var io = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        if (!reduceMotion && e.target.parentElement) {
          // cascade siblings within the same group for a "page assembling" feel
          var sibs = Array.prototype.filter.call(e.target.parentElement.children, function(c){ return c.classList && c.classList.contains('fade-up'); });
          var idx = sibs.indexOf(e.target);
          if (idx > 0 && !e.target.classList.contains('d1') && !e.target.classList.contains('d2')) {
            e.target.style.transitionDelay = (Math.min(idx, 8) * 55) + 'ms';
          }
        }
        e.target.classList.add('in'); io.unobserve(e.target);
      }
    });
  }, { threshold: 0.01, rootMargin: '0px 0px -8% 0px' });
  els.forEach(function(el) { io.observe(el); });
})();

// ── CONFIG ────────────────────────────────────────────────────────────────────
const SEARCH_API = '/api/search';
const FEEDBACK_API = '/api/feedback'; // same-origin relay → Web3Forms server-side (CAC-safe; key never exposed)
// ── CLIENT-SIDE SEARCH (offline-capable) ──────────────────────────────────────
// Mirrors api/search.js scoring EXACTLY so local and server results are identical.
// Once the corpus is cached, search runs on-device — instant, no per-search network,
// and fully usable offline (planes, SCIFs, locked-down .mil networks). It's also the
// access path for the CAC-gated Compass text the official site won't serve.
const CORPUS_URL = '/output/documents.json';
let ACQ_INDEX = null;            // [{ doc, titleLc, contentLc }]
let acqCorpusPromise = null;
function acqQueryTerms(q){ return String(q||'').toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>=2); }
function acqValueFilters(filter, field){ const re=new RegExp(field+'\\s*=\\s*"([^"]+)"','g'); return [...String(filter||'').matchAll(re)].map(m=>m[1]); }
function acqScore(entry, terms, phrase){
  if(!terms.length) return 1;
  let score=0, titleHits=0;
  for(const term of terms){
    const inTitle=entry.titleLc.includes(term), inContent=entry.contentLc.includes(term);
    if(!inTitle && !inContent) return 0;
    if(inTitle){ score+=20; titleHits++; }
    if(inContent) score+=2;
  }
  if(titleHits===terms.length) score+=15;
  if(phrase && terms.length>1){
    if(entry.titleLc.includes(phrase)) score+=100;
    else if(entry.contentLc.includes(phrase)) score+=25;
  }
  return score;
}
function acqPartNum(doc){ const m=String(doc.part||'').match(/\d+/); return m?parseInt(m[0],10):9999; }
function acqCrop(content, query, cropLength){
  const text=String(content||'').replace(/\s+/g,' ').trim();
  const limit=Number(cropLength)||180;
  const q=String(query||'').trim().toLowerCase();
  if(!q) return text.slice(0,limit*2);
  const first=q.split(/\s+/).find(Boolean);
  const idx=first?text.toLowerCase().indexOf(first):-1;
  if(idx===-1) return text.slice(0,limit*2);
  const start=Math.max(0,idx-Math.floor(limit/2));
  const end=Math.min(text.length,start+limit*2);
  return (start>0?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
}
function acqHighlight(text, query){
  let out=String(text||'');
  const terms=[...new Set(String(query||'').toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>2))];
  for(const term of terms){ const esc=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); out=out.replace(new RegExp('('+esc+')','ig'),'<mark>$1</mark>'); }
  return out;
}
function acqLoadCorpus(){
  if(ACQ_INDEX) return Promise.resolve(ACQ_INDEX);
  if(acqCorpusPromise) return acqCorpusPromise;
  // Only reached on the offline/API-down search fallback, and only once (guarded
  // above). Tell AT users the (potentially slow) corpus download is happening so
  // the quiet gap between submitting a search and seeing results isn't a mystery.
  if (typeof srAnnounce === 'function') srAnnounce('Preparing offline search…');
  acqCorpusPromise = fetch(CORPUS_URL)
    .then(r => { if(!r.ok) throw new Error('corpus HTTP '+r.status); return r.json(); })
    // DAF Compass temporarily excluded from search (kept identical to the server
    // filter in api/search.js loadDocs) — docs remain in the corpus, just not indexed.
    .then(docs => { ACQ_INDEX = docs.filter(Boolean).filter(doc => doc.source!=='compass').map(doc => ({ doc, titleLc:String(doc.title||'').toLowerCase(), contentLc:String(doc.content||'').toLowerCase() })); if (typeof srAnnounce === 'function') srAnnounce('Offline search ready.'); return ACQ_INDEX; })
    .catch(e => { acqCorpusPromise = null; throw e; });
  return acqCorpusPromise;
}
function acqLocalSearch(body){
  const filter=body.filter||'';
  const sources=acqValueFilters(filter,'source'), parts=acqValueFilters(filter,'part'), statuses=acqValueFilters(filter,'status');
  const terms=acqQueryTerms(body.q), phrase=terms.join(' ');
  let entries=ACQ_INDEX.filter(({doc})=>{
    if(sources.length && !sources.includes(String(doc.source||''))) return false;
    if(parts.length && !parts.includes(String(doc.part||''))) return false;
    if(statuses.length && !statuses.includes(String(doc.status||''))) return false;
    return true;
  });
  if(terms.length){
    entries=entries.map(e=>({e,s:acqScore(e,terms,phrase)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).map(x=>x.e);
  } else {
    entries=entries.sort((a,b)=>acqPartNum(a.doc)-acqPartNum(b.doc)||String(a.doc.title||'').localeCompare(String(b.doc.title||'')));
  }
  const total=entries.length, offset=Number(body.offset)||0, limit=Math.min(Number(body.limit)||20,100);
  const hits=entries.slice(offset,offset+limit).map(({doc})=>({ ...doc, _formatted:{ title:acqHighlight(doc.title,body.q), content:acqHighlight(acqCrop(doc.content,body.q,body.cropLength),body.q) } }));
  return { hits, estimatedTotalHits:total, offset, limit, processingTimeMs:0, query:body.q||'' };
}

async function meiliSearch(body) {
  // Prefer the on-device corpus once it's loaded: instant, and works with no network.
  if (ACQ_INDEX) return acqLocalSearch(body);
  try {
    const res = await fetch(SEARCH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', body })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || data?.message || `HTTP ${res.status}`;
      throw new Error(`Search service: ${msg}`);
    }
    return data;
  } catch (err) {
    // Offline / API unreachable — fall back to the local corpus.
    try { await acqLoadCorpus(); return acqLocalSearch(body); }
    catch (_) { throw err; }
  }
}
async function meiliDocument(id) {
  if (ACQ_INDEX) { const e = ACQ_INDEX.find(x => String(x.doc.id) === String(id)); return e ? e.doc : null; }
  try {
    const res = await fetch(SEARCH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'document', id })
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    try { await acqLoadCorpus(); const e = ACQ_INDEX.find(x => String(x.doc.id) === String(id)); return e ? e.doc : null; }
    catch (_) { return null; }
  }
}

// ── PWA: register service worker + warm the offline corpus cache ───────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      function maybeToast() { if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg); }
      maybeToast();
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(reg);
        });
      });
    }).catch(function () {});
    // Reload only when the user taps Refresh (not on a first-visit clients.claim).
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!acqUserUpdate || acqSwReloaded) return; acqSwReloaded = true; window.location.reload();
    });
    // Warm the corpus into the SW cache after first paint so search works offline
    // next time — a plain fetch (SW caches it); online search still uses the server.
    setTimeout(function () { fetch(CORPUS_URL).catch(function () {}); }, 1800);
  });
}
var acqUserUpdate = false, acqSwReloaded = false;
function showUpdateToast(reg) {
  if (document.getElementById('update-toast')) return;
  var t = document.createElement('div');
  t.id = 'update-toast'; t.className = 'update-toast'; t.setAttribute('role', 'status');
  t.innerHTML = '<span>A new version of AcqVault is ready.</span><button type="button">Refresh</button>';
  t.querySelector('button').addEventListener('click', function () {
    acqUserUpdate = true;
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  document.body.appendChild(t);
  requestAnimationFrame(function () { t.classList.add('show'); });
}
// Offline indicator — search keeps working from the cached corpus; live data won't.
(function () {
  var bar = document.getElementById('offline-bar');
  if (!bar) return;
  function sync() { bar.hidden = navigator.onLine; }
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
})();

const SOURCE_URLS = {
  'rfo':           'https://www.federalregister.gov/documents/search?conditions%5Bagencies%5D%5B%5D=defense-acquisition-regulations-system',
  'r-dfars':       'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide',
  'far-companion': 'https://www.acquisition.gov/far-companion',
  'category-management': 'https://www.acquisition.gov/far-overhaul',
  'fmr':           'https://comptroller.war.gov/FMR/',
  'afi-63-138':    'https://www.e-publishing.af.mil/',
};
const SOURCE_LABELS = {
  'rfo': 'RFO', 'r-dfars': 'R-DFARS', 'far-companion': 'FAR Companion', 'category-management': 'Category Management Buying Guide',
  'fmr': 'DoD FMR', 'afi-63-138': 'DAFI 63-138',
};

// ── PARTS BY SOURCE ───────────────────────────────────────────────────────────
const PARTS_BY_SOURCE = {
  'rfo': [
    [1,'Federal Acquisition Regulations System'],[2,'Definitions of Words and Terms'],
    [3,'Improper Business Practices and Personal Conflicts of Interest'],
    [4,'Administrative and Information Matters'],[5,'Publicizing Contract Actions'],
    [6,'Competition Requirements'],[7,'Acquisition Planning'],
    [8,'Required Sources of Supplies and Services'],[9,'Contractor Qualifications'],
    [10,'Market Research'],[11,'Describing Agency Needs'],
    [12,'Acquisition of Commercial Products and Services'],
    [13,'Simplified Procedures for Noncommercial Acquisitions'],[14,'Sealed Bidding'],
    [15,'Contracting by Negotiation'],[16,'Types of Contracts'],[17,'Special Contracting Methods'],
    [18,'Emergency Acquisitions'],[19,'Small Business Programs'],[22,'Application of Labor Laws'],
    [23,'Environment, Energy, and Water Efficiency'],[25,'Foreign Acquisition'],
    [26,'Other Socioeconomic Programs'],[27,'Patents, Data, and Copyrights'],
    [28,'Bonds and Insurance'],[29,'Taxes'],[30,'Cost Accounting Standards'],
    [31,'Contract Cost Principles and Procedures'],[32,'Contract Financing'],
    [33,'Protests, Disputes, and Appeals'],[36,'Construction and Architect-Engineer Contracts'],
    [37,'Service Contracting'],[39,'Acquisition of Information Technology'],
    [42,'Contract Administration and Audit Services'],[43,'Contract Modifications'],
    [44,'Subcontracting Policies and Procedures'],[45,'Government Property'],
    [46,'Quality Assurance'],[47,'Transportation'],[49,'Termination of Contracts'],
    [51,'Use of Government Sources by Contractors'],[52,'Solicitation Provisions and Contract Clauses'],
    [53,'Forms']
  ],
  'r-dfars': [
    [201,'Fed A-R Sys'],[202,'Definitions'],[203,'Ethics'],[204,'Admin'],[205,'Publicizing'],
    [206,'Competition'],[207,'Planning'],[208,'Sources'],[209,'Contractor Qual'],
    [210,'Market Res'],[211,'Describing'],[212,'Commercial'],[213,'Simplified'],
    [214,'Sealed Bid'],[215,'Negotiation'],[216,'Types'],[217,'Special'],
    [219,'Small Bus'],[222,'Labor'],[223,'Environment'],[225,'Foreign'],
    [226,'Socioeconomic'],[227,'IP'],[228,'Bonds'],[229,'Taxes'],[231,'Cost Prin'],
    [232,'Financing'],[233,'Disputes'],[236,'Construction'],[237,'Services'],
    [239,'IT'],[242,'Admin'],[243,'Modifications'],[244,'Subcontracting'],
    [245,'GFP'],[246,'Quality'],[247,'Transport'],[249,'Termination'],[252,'Clauses']
  ],
  'far-companion': [
    [1,'General'],[2,'Definitions'],[3,'Ethics'],[4,'Admin'],[5,'Publicizing'],
    [6,'Competition'],[7,'Planning'],[8,'Sources'],[9,'Contractor Qual'],
    [10,'Market Res'],[11,'Describing'],[12,'Commercial'],[13,'Simplified'],
    [14,'Sealed Bid'],[15,'Negotiation'],[16,'Types'],[17,'Special'],
    [19,'Small Bus'],[22,'Labor'],[25,'Foreign'],[27,'IP'],
    [31,'Cost Prin'],[32,'Financing'],[42,'Admin'],[49,'Termination'],[52,'Clauses']
  ],
  'category-management': [
    [1,'Overview'],[2,'Buying Pathway'],[3,'Facilities & Construction'],[4,'Human Capital'],
    [5,'Industrial Products and Services'],[6,'Information Technology'],[7,'Medical'],
    [8,'Office Management'],[9,'Professional Services'],[10,'Security & Protection'],
    [11,'Transportation & Logistics Services'],[12,'Travel']
  ],
  'afi-63-138': [
    [1,'Overview and Applicability'],[2,'Roles and Responsibilities'],
    [3,'Requirements Approval Process'],[4,'Services Acquisition Process'],
    [5,'Governance Assessment'],[6,'Quality Oversight']
  ],
  'fmr': [
    ['1','General Financial Management Information, Systems, and Requirements'],
    ['2A','Budget Formulation and Presentation (2A)'],
    ['2B','Budget Formulation and Presentation (2B)'],
    ['3','Budget Execution — Availability and Use of Budgetary Resources'],
    ['4','Accounting Policy'],['5','Disbursing Policy'],
    ['6A','Reporting Policy'],['6B','Form and Content of the DoD Audited Financial Statements'],
    ['7A','Military Pay Policy — Active Duty and Reserve Pay'],['7B','Military Pay Policy — Retired Pay'],
    ['8','Civilian Pay Policy'],['9','Travel Policy'],['10','Contract Payment Policy'],
    ['11A','Reimbursable Operations Policy — General'],['11B','Reimbursable Operations Policy — Working Capital Funds'],
    ['12','Special Accounts, Funds, and Programs'],['13','Nonappropriated Funds Policy and Procedures'],
    ['14','Administrative Control of Funds and Antideficiency Act Violations'],
    ['15','Security Cooperation Policy'],['16','Department of Defense Debt Management']
  ]
};

// ── STATE ─────────────────────────────────────────────────────────────────────
const activeSources = new Set();
let activeStatuses   = [];
let activeDocId      = null;
let currentHit       = null;
let currentMode      = 'search';
let browseSrc        = 'rfo';
let browseActivePart = null;
let browseLabel = '';
let browseRestoring = false; // suppress the browse auto-scrolls while re-entering a saved view
let debounceTimer    = null;

// We own scroll restoration for the browse reader (the content is rebuilt async on
// reload, so the browser's automatic guess lands at the top). Take it off 'auto' so
// the browser never fights our manual restore.
try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}

// The source menu (z:760) lives inside hero containers stuck at z-index:2, so the
// sticky source bar (z:40) paints OVER it. While the menu is open, body.src-menu-open
// lifts those containers above the bar; closed, they stay low so the hero never
// covers the pinned bars during normal scrolling.
function closeBrowseSourceMenu() {
  const menu = document.getElementById('browse-source-menu');
  const btn = document.getElementById('mode-browse');
  if (menu) menu.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('src-menu-open');
}

function toggleBrowseSourceMenu(event) {
  event?.stopPropagation();
  const menu = document.getElementById('browse-source-menu');
  const btn = document.getElementById('mode-browse');
  if (!menu || !btn) return;
  const open = !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('src-menu-open', open);
}

function chooseBrowseSource(source) {
  closeBrowseSourceMenu();
  setMode('browse');
  setBrowseSource(source);
}

document.addEventListener('click', (event) => {
  if (!event.target.closest?.('.browse-source-picker')) closeBrowseSourceMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeBrowseSourceMenu();
});

// ── DELEGATED ACTIONS ───────────────────────────────────────────────────────
// Every formerly-inline onclick routes through here via data-action so the CSP
// can drop script-src 'unsafe-inline'. Works for dynamically rendered markup too
// (the listener lives on document, so re-renders never need re-binding).
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const arg = el.dataset.arg;
  switch (el.dataset.action) {
    case 'open-feedback': e.preventDefault(); openFeedback(); break;
    case 'close-feedback': closeFeedback(); break;
    case 'dismiss-about': dismissAbout(); break;
    case 'set-mode': setMode(arg); break;
    case 'set-browse-source': setBrowseSource(arg); break;
    case 'choose-browse-source': chooseBrowseSource(arg); break;
    case 'toggle-browse-menu': toggleBrowseSourceMenu(e); break;
    case 'go-browse-source': setMode('browse'); setBrowseSource(arg); break;
    case 'example-query': runExampleQuery(el.dataset.query || ''); break;
    case 'focus-search': {
      e.preventDefault();
      const s = document.getElementById('search-input');
      if (s) s.focus();
      break;
    }
    case 'skip-to-search':
      // href="#search-input" already lands there; re-focus after the jump.
      setTimeout(() => { const s = document.getElementById('search-input'); if (s) s.focus(); }, 0);
      break;
    case 'search-go': {
      setMode('search');
      const i = document.getElementById('search-input');
      if (i) { i.focus(); if (i.value.trim()) runSearch(); }
      break;
    }
    case 'dismiss-newhere': {
      const n = document.getElementById('hero-newhere');
      if (n) n.style.display = 'none';
      try { localStorage.setItem('acqvault_newhere_dismissed', '1'); } catch (x) {}
      break;
    }
    case 'select-part': selectPart(el, el.dataset.part, el.dataset.label || ''); break;
    case 'select-cat-part': selectCategoryGuidePart(el, el.dataset.part, el.dataset.label || ''); break;
    case 'br-copy': brCopy(el.dataset.cite, el); break;
    case 'copy-inline-cite': copyInlineCite(el, el.dataset.cite || ''); break;
    case 'scroll-to': {
      e.preventDefault();
      const t = document.getElementById(el.dataset.anchor);
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
    case 'print': window.print(); break;
  }
});

// Image load failures (formerly inline onerror). error events don't bubble, so
// catch them in the capture phase at the document.
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.hasAttribute('data-fallback-figure')) {
    t.closest('figure')?.classList.add('image-unavailable');
  }
}, true);

// ── NAV OFFSET ────────────────────────────────────────────────────────────────
function adjustNavForAboutBar() {
  const bar = document.getElementById('about-bar');
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  const aboutHeight = bar ? bar.offsetHeight : 0;
  nav.style.top = aboutHeight + 'px';
  document.documentElement.style.setProperty('--top-chrome', `${aboutHeight + nav.offsetHeight}px`);
}
adjustNavForAboutBar();
window.addEventListener('resize', adjustNavForAboutBar);

// ── MODE SWITCHING ────────────────────────────────────────────────────────────
function setMode(mode) {
  closeBrowseSourceMenu();
  currentMode = mode;
  // Remember which view this tab is showing (per-tab). On a discard-reload the boot
  // restores THIS view — otherwise a stale ?q= left in the URL by an earlier search
  // would hijack the boot back into search-at-top while the user was deep in browse.
  try { sessionStorage.setItem('acq-view-v1', mode); } catch (e) {}
  document.body.classList.toggle('work-mode', mode !== 'search' || Boolean(document.getElementById('search-input')?.value.trim()));
  const hero = document.getElementById('hero');
  ['search','browse','fulltext'].forEach(m => {
    const btn = document.getElementById('mode-' + m);
    btn.classList.toggle('active', m === mode);
    btn.setAttribute('aria-pressed', String(m === mode));
    hero.classList.toggle(m + '-active', m === mode && mode !== 'search');
  });
  const _mt = document.querySelector('.mode-toggle'); if (_mt && _mt._segRest) _mt._segRest();
  if (mode !== 'search') hero.classList.remove('search-active');
  document.getElementById('results-section').classList.toggle('visible', false);
  document.getElementById('browse-section').classList.toggle('visible', mode === 'browse');
  document.getElementById('fulltext-section').classList.toggle('visible', mode === 'fulltext');
  if (mode === 'browse') {
    hero.classList.add('browse-active');
    renderPartsGrid(browseSrc);
    // Move straight to the active browse workspace.
    setTimeout(() => {
      const browseEl = document.getElementById('browse-section');
      if (browseEl && !browseRestoring && !document.hidden) {
        const y = browseEl.getBoundingClientRect().top + window.scrollY - getStickyOffset() - 8;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    }, 60);
  }
  if (mode === 'fulltext') {
    hero.classList.add('fulltext-active');
    setTimeout(() => {
      const ftEl = document.getElementById('fulltext-section');
      if (ftEl && !document.hidden) {
        const y = ftEl.getBoundingClientRect().top + window.scrollY - getStickyOffset() - 8;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    }, 60);
  }
  if (mode === 'search') {
    hero.classList.remove('browse-active','fulltext-active');
    if (document.getElementById('search-input').value.trim()) {
      hero.classList.add('search-active');
      document.getElementById('results-section').classList.add('visible');
    }
  }
}

// ── BROWSE — PART LIST + FULL READER ─────────────────────────────────────────

function getStickyOffset() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--top-chrome');
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function renderPartsGrid(source) {
  const grid  = document.getElementById('parts-grid');
  const parts = PARTS_BY_SOURCE[source] || [];
  if (source === 'category-management') {
    const active = (key) => browseActivePart === key && browseSrc === source;
    const parent = (key, num, label) => `<button type="button" class="part-tile part-tile-parent${active(key) ? ' active' : ''}"
      data-part="${key}" data-label="${esc(label)}" aria-pressed="${active(key)}"
      data-action="select-cat-part">
      <span class="part-tile-num">${num}</span>
      <span class="part-tile-label">${esc(label)}</span>
    </button>`;
    const child = ([num, label]) => `<button type="button" class="part-tile part-tile-child${active(num) ? ' active' : ''}"
      data-part="${num}" data-label="${esc(label)}" aria-pressed="${active(num)}"
      data-action="select-cat-part">
      <span class="part-tile-num">${num}</span>
      <span class="part-tile-label">${esc(label)}</span>
    </button>`;
    grid.innerHTML = [
      parent('1', 'I', 'Overview'),
      child([2, 'Buying Pathway']),
      parent('category-management', 'II', 'Category Management'),
      ...parts.filter(([num]) => Number(num) >= 3).map(child)
    ].join('');
    return;
  }
  grid.innerHTML = parts.map(([num, label]) => {
    const active = String(browseActivePart) === String(num) && browseSrc === source;
    return `<button type="button" class="part-tile${active ? ' active' : ''}"
      data-part="${num}" data-label="${esc(label)}" aria-pressed="${active}"
      data-action="select-part">
      <span class="part-tile-num">${num}</span>
      <span class="part-tile-label">${esc(label)}</span>
    </button>`;
  }).join('');
}

function setBrowseSource(source) {
  browseSrc = source; browseActivePart = null;
  document.querySelectorAll('.browse-src-pill').forEach(p => {
    const active = p.dataset.bsource === source;
    p.classList.toggle('active', active);
    p.setAttribute('aria-pressed', String(active));
  });
  renderPartsGrid(source);
  // Reset reader to empty state
  document.getElementById('browse-reader-inner').innerHTML =
    `<div class="browse-empty" id="browse-empty">
      <div class="browse-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/></svg></div>
      <div class="browse-empty-title">Select a part to read</div>
      <div class="browse-empty-sub">Choose a part from the left panel to load the full text.</div>
    </div>`;
}

// ── RENDER CONTENT LINE ───────────────────────────────────────────────────────
// Converts an L{n}:text line (or plain text) into an HTML element with right indent
function isCategoryGuide(source) {
  return source === 'category-management';
}

function isCategoryGuideHeadingLine(line) {
  const t = (line || '').trim();
  return /^(Pathway Steps|This Guide Promotes|This Guide is Not|The Vision|A Smarter Approach to Federal Acquisition|Navigating the Buying Process|Understanding the Continuum|Simple Procurements|Other-than-Simple Procurements|Navigating the Continuum|Buying Pathway|Decision Tool|Categories of Spend Examples|Category Management|Pathway Primer|Vehicles Table|Resources|Other Guidance|Pathway Pointers|Market Research and Pricing Data|Special Item Numbers \(SINs\)|Trainings|VA-Specific Federal Supply Schedule \(FSS\))$/i.test(t);
}

function isCategoryGuideSubheadingLine(line) {
  return /^(The Vision|Simple Procurements|Other-than-Simple Procurements|Buying Pathway|Decision Tool|Vehicles Table|Resources|Other Guidance|Pathway Pointers|Market Research and Pricing Data|Special Item Numbers \(SINs\)|Trainings|VA-Specific Federal Supply Schedule \(FSS\))$/i.test((line || '').trim());
}

function isBrowseHeadingLine(line, source) {
  const t = (line || '').trim();
  if (isCategoryGuide(source) && isCategoryGuideHeadingLine(t)) return true;
  return /^(Disclaimer|How to Navigate the FAR Companion|Organization Structure|Quick Navigation Tips|Citation System)$/i.test(t);
}

function isDafiSource(source) {
  return source === 'afi-63-138';
}

function dafiParagraphMatch(line) {
  return String(line || '').trim().match(/^(\d+\.\d+(?:\.\d+)*)\.\s+(.+)/);
}

function isBrowseBlockStart(line, source) {
  const t = (line || '').trim();
  if (isDafiSource(source) && dafiParagraphMatch(t)) return true;
  return /^L\d:/.test(t) || /^[●○]\s+/.test(t) || /^(?:o|▪)\s+/.test(t) || /^Step\s+\d+:/i.test(t) || /^\d+\.\s+/.test(t) || /^Part\s+\d+\s*[-–]/i.test(t) || isBrowseHeadingLine(t, source);
}

const CATEGORY_LINKS = [
  ['Market Research as a Service', 'https://www.gsa.gov/about-us/organization/federal-acquisition-service/customer-and-stakeholder-engagement/market-research-as-a-service'],
  ['DLA Fedmall', 'https://www.fedmall.mil/'],
  ['UNICOR.gov', 'https://www.unicor.gov/'],
  ['AbilityOne.gov', 'https://www.abilityone.gov/'],
  ['“Required use”', 'https://acquisitiongateway.gov/category-management/resources/4163?_a%5Eg_nid=376'],
  ['D2D', 'https://d2d.gsa.gov/'],
  ['Procurement Co-Pilot', 'https://acquisitiongateway.gov/procurementcopilot'],
  ['GSA eLibrary', 'https://www.gsaelibrary.gsa.gov/'],
  ['GSA Advantage', 'https://www.gsaadvantage.gov/'],
  ['Acquisition Gateway - Facilities & Construction', 'https://www.acquisitiongateway.gov/category-management/resources/28?_a%5Eg_nid=355'],
  ['Acquisition Gateway - Human Capital', 'https://www.acquisitiongateway.gov/Category-management/resources/579?_a%5Eg_nid=11662'],
  ['Acquisition Gateway - Industrial Products & Services', 'https://www.acquisitiongateway.gov/category-management/resources/30?_a%5Eg_nid=391'],
  ['Acquisition Gateway - Information Technology', 'https://www.acquisitiongateway.gov/category-management/resources/580?_a%5Eg_nid=530'],
  ['Acquisition Gateway - Medical', 'https://www.acquisitiongateway.gov/category-management/resources/31?_a%5Eg_nid=239'],
  ['Acquisition Gateway - Office Management', 'https://www.acquisitiongateway.gov/category-management/resources/32?_a%5Eg_nid=11830'],
  ['Acquisition Gateway - Professional Services', 'https://www.acquisitiongateway.gov/category-management/resources/33?_a%5Eg_nid=398'],
  ['Acquisition Gateway - Security & Protection', 'https://www.acquisitiongateway.gov/Category-management/resources/34?_a%5Eg_nid=11124'],
  ['Acquisition Gateway - Transportation & Logistics Services', 'https://acquisitiongateway.gov/'],
  ['Acquisition Gateway - Travel', 'https://www.acquisitiongateway.gov/category-management/resources/36?_a%5Eg_nid=36325'],
  ['Acquisition Solutions Navigator', 'https://buy.gsa.gov/contracts/home'],
  ['Civilian Services Acquisition Workshops (CSAW)', 'https://buy.gsa.gov/spba'],
  ['Services Scope Review', 'https://www.gsa.gov/buy-through-us/products-services/professional-services/services-scope-review'],
  ['Cloud Information Center', 'https://cic.gsa.gov/'],
  ['GSA Global Supply', 'https://www.gsa.gov/buy-through-us/purchasing-programs/requisition-programs/gsa-global-supply'],
  ['GSA MAS', 'https://www.gsa.gov/buy-through-us/purchasing-programs/multiple-award-schedule'],
  ['OASIS+', 'https://www.gsa.gov/buy-through-us/products-and-services/professional-services/buy-services/oasis-plus'],
  ['8(a) STARS III', 'https://www.gsa.gov/technology/it-contract-vehicles-and-purchasing-programs/gwacs/8a-stars-iii'],
  ['Alliant 2', 'https://www.gsa.gov/technology/it-contract-vehicles-and-purchasing-programs/gwacs/alliant-2'],
  ['SEWP', 'https://www.sewp.nasa.gov/'],
  ['NITAAC CIO-CS', 'https://nitaac.nih.gov/services/cio-cs'],
  ['NITAAC CIO-SP3', 'https://nitaac.nih.gov/services/cio-sp3'],
  ['VETS 2', 'https://www.gsa.gov/technology/it-contract-vehicles-and-purchasing-programs/gwacs/vets-2'],
  ['FedRooms', 'https://www.gsa.gov/travel/plan-book/per-diem-rates/fedrooms'],
  ['City Pair Program', 'https://www.gsa.gov/travel/plan-a-trip/transportation-airfare-rates-pov-rates-etc/airfare-rates-city-pair-program'],
  ['Uber for Government', 'https://redeem.uber.com/public/optin/QJGUT4HH']
].sort((a,b) => b[0].length - a[0].length);

function categoryGuideText(text, source) {
  let out = esc(text);
  if (!isCategoryGuide(source)) return out;
  CATEGORY_LINKS.forEach(([label, url]) => {
    const needle = esc(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(needle, 'g'), `<a class="cm-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`);
  });
  out = out.replace(/\b(\d{3,6}[A-Z0-9]*)\b(?=\s+-)/g, (m) => `<a class="cm-link" href="https://www.gsaelibrary.gsa.gov/ElibMain/sinDetails.do?scheduleNumber=MAS&specialItemNumber=${encodeURIComponent(m)}&executeQuery=YES" target="_blank" rel="noopener">${m}</a>`);
  return out;
}

function categoryGuideContinuumHTML() {
  const rows = [
    ['Requirements', '<strong>Commercial products and commercial services</strong> Includes COTS items and solutions that can be bought largely as-is.', '<strong>Non-commercial or mission-specific needs</strong> Includes products or services that require more tailoring, integration, or specialized delivery.'],
    ['Value / Competition', '<strong>Micro-purchase to simplified procedures</strong> Use micro-purchase, simplified acquisition, and commercial simplified procedures where the requirement fits.', '<strong>Above simplified commercial lanes</strong> Use more formal procedures when value, risk, or complexity exceeds the simplified pathway.'],
    ['Sources', '<strong>Required and priority sources first</strong> Check mandatory sources, existing government-wide contracts, BPAs, shared services, FSS, GWACs, IDIQs, and other pre-competed vehicles.', '<strong>Agency discretion and open market when needed</strong> Move beyond existing vehicles when they cannot meet the requirement.'],
    ['Contracting Method', '<strong>Fast, structured buying lanes</strong> FAR 8.4 orders/BPAs, FAR 12.201-1 and 12.201-2, FAR 13, and other simplified/commercial procedures.', '<strong>Formal market procedures</strong> FAR 14/15 IFB/RFP, broad agency announcements, construction, architect-engineer, and other specialized pathways.'],
    ['Approach', '<strong>Buy commercial capability as-is</strong> Prioritize speed, value, and adoption of existing market solutions.', '<strong>Plan for mission failure risk</strong> Build the capable team, evaluation strategy, and controls needed for complex or custom work.']
  ];
  return `<div class="cm-native-visual cm-continuum" aria-label="Simple to other-than-simple acquisition continuum">
    <div class="cm-continuum-head">
      <div><strong>Simple Pathway</strong><span>Speed, value, and adoption of commercial solutions as-is.</span></div>
      <div><strong>Other-than-Simple Pathway</strong><span>More planning for capable teams, complexity, and mission-risk reduction.</span></div>
    </div>
    <div class="cm-continuum-grid">
      ${rows.map(([label, simple, complex]) => `<div class="cm-cont-row"><div class="cm-cont-label">${label}</div><div class="cm-cont-cell">${simple}</div><div class="cm-cont-cell">${complex}</div></div>`).join('')}
    </div>
    <div class="cm-native-caption"><strong>Continuum summary</strong><span>Adapted from the Category Management Buying Guide, p. 5</span></div>
  </div>`;
}

function categoryGuideSpendTableHTML() {
  const rows = [
    ['Facilities & Construction', 'Office furniture, building materials, commercial real estate leases, and common maintenance services such as janitorial work.', 'Specialized construction services for government facilities, building of military bases, or custom-designed infrastructure.'],
    ['Human Capital', 'Talent acquisition, employer relocation, and professional development training.', 'Specialized government talent development, security clearances, and employee relations services specific to federal regulations.'],
    ['Industrial Products and Services', 'Basic materials, hardware, tools, machinery, and repair or maintenance services for commercial equipment.', 'Specialized test and measurement supplies, equipment, and services for government-specific research and development projects.'],
    ['Information Technology', 'Commercial off-the-shelf software licenses, computer hardware, and general IT consulting.', 'Highly customized software solutions for federal agencies, cybersecurity for classified networks, and specialized telecommunications.'],
    ['Medical', 'Standard pharmaceuticals, healthcare services, and common medical equipment or supplies.', 'Specialized or customized pharmaceuticals, medical equipment, supplies, or services used exclusively by the military or certain federal agencies.'],
    ['Office Management', 'Office supplies, office furniture, and basic office management services.', 'N/A'],
    ['Professional Services', 'Financial services, legal services, management consulting, and marketing services.', 'Research and development projects for government use only, or advisory services for federal policy.'],
    ['Security & Protection', 'Standard security systems, uniforms or protective apparel, and general security guard services.', 'Specialized weapons, integrated physical access control systems, and tactical communication services.'],
    ['Transportation & Logistics Services', 'Package delivery, motor vehicles, and general transportation equipment.', 'Logistics support for military operations, specialized vehicles for federal agencies, or transportation of classified materials.'],
    ['Travel', 'Lodging, passenger travel, and car rental services.', 'N/A']
  ];
  return `<div class="cm-native-visual">
    <div class="cm-spend-wrap">
      <table class="cm-spend-table">
        <thead><tr><th>Category</th><th>Simple Pathway</th><th>Other-than-Simple Pathway</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="cm-native-caption"><strong>Categories of spend examples</strong><span>Adapted from the Category Management Buying Guide, pp. 8-9</span></div>
  </div>`;
}

const CATEGORY_VEHICLE_TABLES = {
  '3': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Facilities Reduction Program (FRP)', 'N/A', 'USACE'],
    ['Tier 3', 'Building Maintenance & Operations (BMO)', 'Building Maintenance and Operations Buyer’s Guide', 'GSA'],
    ['Tier 3', 'OASIS+ Facilities Domain', 'OASIS+ Buyer’s Guide', 'GSA'],
    ['Tier 3', 'Maintenance Repair Facility Supplies Generation 2 (MRFS2)', 'MRFS2 How To', 'GSA'],
    ['Tier 3', 'GSA Global Supply', 'GSA Global Supply FAQs', 'GSA'],
    ['Tier 2', 'GSA MAS - Facilities & Construction', 'Construction-Related Services MAS Ordering Guide (GSA 2024)', 'GSA']
  ],
  '4': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Human Capital and Training Solutions (HCaTS)', 'HCaTS Ordering Guide', 'GSA'],
    ['Tier 3', 'USA Learning', 'N/A', 'OPM'],
    ['Tier 2', 'GSA MAS - Human Capital', 'N/A', 'GSA']
  ],
  '5': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Maintenance Repair Facility Supplies Generation 2 (MRFS2)', 'Maintenance Repair Facility Supplies Generation 2', 'GSA'],
    ['Tier 3', 'GSA Global Supply', 'GSA Global Supply', 'GSA'],
    ['Tier 3', 'DLA eCAT', 'N/A', 'DLA'],
    ['Tier 2', 'GSA MAS - Industrial Products & Services', 'MAS Desk Reference', 'GSA'],
    ['Tier 2', 'VA Federal Supply Schedules', 'N/A', 'VA'],
    ['Tier 2', 'DLA eProcurement', 'N/A', 'DLA'],
    ['Tier 2', 'DLA Special Operational Equipment (SOE)', 'N/A', 'DLA'],
    ['Tier 2', 'DLA Fire and Emergency Services Equipment (FESE)', 'N/A', 'DLA'],
    ['Tier 2', 'DLA Troop Support Tier 2 Contracts', 'N/A', 'DLA'],
    ['Tier 1', 'Treasury Tier 1 Precious Metals', 'N/A', 'Treasury']
  ],
  '6': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', '8(a) STARS III', 'Industry partners, master contract, and pricing', 'GSA'],
    ['Tier 3', 'Alliant 2', 'Ordering guide, industry partners, and pricing list', 'GSA'],
    ['Tier 3', 'Digital Market', 'Ordering guide, vendor list, awarded contracts, and pricing', 'Army'],
    ['Tier 3', 'COMSATCOM', 'Complex Commercial SATCOM Solutions and contractor listing/pricing', 'GSA'],
    ['Tier 3', 'EIS', 'GSA EIS Ordering Guide, Fair Opportunity Ordering Guide, Partner Guide, and Service Guide', 'GSA'],
    ['Tier 3', 'MAS IT', 'MAS Ordering Guide and MAS Buyer Websites and Tools', 'GSA'],
    ['Tier 3', 'SEWP', 'SEWP Tools Guide and vendor contracts/services', 'NASA'],
    ['Tier 3', 'NITAAC CIO-CS', 'CIO-CS Ordering Guide and contract holders', 'NIH'],
    ['Tier 3', 'NITAAC CIO-SP3 / CIO-SP3 SB', 'SP3 and SP3 SB ordering guides and contract holders', 'NIH'],
    ['Tier 3', 'VETS 2', 'N/A', 'GSA'],
    ['Tier 3', 'Wireless', 'Wireless Mobility Solutions website, guide, contractor listing, and pricing', 'GSA']
  ],
  '7': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Medical Surgical Prime Vendor Program (MSPV)', 'Customer Ordering Guide', 'DLA'],
    ['Tier 3', 'VA Hearing Aids (HRA)', 'Registration & Ordering Guidance', 'VA'],
    ['Tier 3', 'DOD/VA High-Tech Medical Equipment / Radiology', 'DMMonline and VA website', 'DLA / VA'],
    ['Tier 3', 'Defense Logistics Agency Medical Electronic Catalog Program (ECAT)', 'Core ECAT User Customer Ordering Guide', 'DLA'],
    ['Tier 3', 'DOD/VA Joint National Contracts for Generic Pharmaceuticals', 'VA Website', 'VA'],
    ['Tier 2', 'GSA MAS - Medical', 'MAS Ordering Guide', 'GSA'],
    ['Tier 2', 'MQS2NG Multiple-Award IDIQ', 'MQS2NG SharePoint Online', 'DHA'],
    ['Tier 2', 'Pharmaceutical Prime Vendor: DoD / VA', 'Customer use guide and VA website', 'DLA / VA'],
    ['Tier 2', 'VA Federal Supply Schedule medical schedules', 'Orders not requiring SOW, orders requiring SOW, and open market paths', 'VA'],
    ['Tier 2', 'AbilityOne / UNICOR / Omnibus IV / Community Care resources', 'How to Buy Products, ordering procedures, and program resources', 'Multiple']
  ],
  '8': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Global Supply Requisition Channel - Furniture', 'Global Supply Furniture Training Video', 'GSA'],
    ['Tier 3', 'Federal Strategic Sourcing Initiative for Office Supplies Fourth Generation (FSSI OS4)', 'FSSI Office Supplies Fourth Generation Buying Guide', 'GSA'],
    ['Tier 2', 'GSA MAS - Office Management', 'MAS Office Administrative Services Ordering Guide (GSA 2024)', 'GSA'],
    ['Tier 2', 'GSA MAS - Furniture and Furnishings', 'N/A', 'GSA']
  ],
  '9': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Identity Protection Services (IPS)', 'Data Breach Response and Identity Protection Services Ordering Procedures', 'GSA'],
    ['Tier 3', 'OASIS+', 'OASIS+ Ordering Guide', 'GSA'],
    ['Tier 2', 'MAS - Professional Services', 'N/A', 'GSA'],
    ['Tier 2', 'MAS - Human Capital', 'N/A', 'GSA']
  ],
  '10': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Reduced Hazard Training Ammunition (RHTA) II', 'RHTA II Ordering Guide', 'DHS'],
    ['Tier 3', 'Body Armor IV', 'Body Armor Ordering Guide', 'DHS'],
    ['Tier 3', 'Tactical Communications Equipment and Services II (TacCom II)', 'N/A', 'DHS'],
    ['Tier 2', 'GSA MAS - Security & Protection', 'N/A', 'GSA']
  ],
  '11': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Next Generation Delivery Service (NGDS)', 'NGDS Contracting Officer’s Ordering Guide', 'DLA'],
    ['Tier 3', 'Direct Delivery Fuels', 'N/A', 'DLA'],
    ['Tier 3', 'GSA Fleet Vehicle Purchasing', 'How to Buy Vehicles', 'GSA'],
    ['Tier 3', 'GSA Fleet Vehicle Leasing', 'N/A', 'GSA']
  ],
  '12': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'City Pair Program (CPP)', 'N/A', 'GSA'],
    ['Tier 3', 'Civilian Employee Relocation Resource Center (ERRC) / Employee Relocation Solutions', 'N/A', 'GSA'],
    ['Tier 3', 'MAS 531110 Long Term Lodging / FedRooms / DoD Preferred', 'N/A', 'GSA'],
    ['Tier 3', 'U.S. Government Rental Car Program', 'N/A', 'DoD'],
    ['Tier 3', 'Emergency Lodging Services (ELS)', 'Guidance for Using ELS', 'GSA'],
    ['Tier 2', 'E-Gov Travel Service (ETS2)', 'N/A', 'GSA'],
    ['Tier 2', 'Travel Agent Services / Travel Consulting / Lodging Negotiation and Management', 'N/A', 'GSA'],
    ['Tier 2', 'GO.gov / CHAMP / Long Term Lodging / Rideshare', 'N/A', 'GSA']
  ]
};

function categoryGuideVehicleTableHTML(partNum) {
  const rows = CATEGORY_VEHICLE_TABLES[String(partNum)] || [];
  if (!rows.length) return '';
  return `<div class="cm-native-visual">
    <div class="cm-spend-wrap">
      <table class="cm-spend-table cm-vehicle-table">
        <thead><tr><th>Tier</th><th>Program</th><th>Ordering Guide</th><th>Agency Owner</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${categoryGuideText(r[1], 'category-management')}</td><td>${categoryGuideText(r[2], 'category-management')}</td><td>${esc(r[3])}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="cm-native-caption"><strong>Vehicles Table</strong><span>Adapted from the Category Management Buying Guide</span></div>
  </div>`;
}

function categoryGuideVisualAfterLine(source, partNum, line, flags) {
  if (!isCategoryGuide(source)) return '';
  const t = (line || '').trim();
  if (String(partNum) === '1' && !flags.continuum && /^The [“"]simple[”"].*continuum is a useful framework/i.test(t)) {
    flags.continuum = true;
    return categoryGuideContinuumHTML();
  }
  if (String(partNum) === '2' && !flags.spend && /^Categories of Spend Examples$/i.test(t)) {
    flags.spend = true;
    return categoryGuideSpendTableHTML();
  }
  if (Number(partNum) >= 3 && !flags.vehicles && /^Vehicles Table$/i.test(t)) {
    flags.vehicles = true;
    return categoryGuideVehicleTableHTML(partNum);
  }
  return '';
}

const DAFI_TABLES = {
  '2.1': {
    title: 'United States Air Force (USAF) SADAs by S-CAT',
    headers: ['S-CAT Level', 'Threshold', 'MAJCOM/FOA/DRU Structure w/ Signed SMA', 'Secretariat & Air Staff Structure w/ Signed SMA', 'Systems PEO/TEO Structure'],
    rows: [
      ['S-CAT I', 'Est. total value:\n> $1B or\n> $300M in any one year', 'AFPEO/CM\nDelegable no lower than GO/SES', 'As designated by USD(A&S), SAF/AQ, or AFPEO/CM\nDelegable no lower than GO/SES', 'S-PEO/TEO\nDelegable no lower than GO/SES'],
      ['S-CAT II', 'Est. total value:\n> $250M but < $1B', 'AFPEO/CM\nDelegable no lower than GO/SES', 'AFPEO/CM\nDelegable no lower than GO/SES', 'S-PEO/TEO\nDelegable no lower than GO/SES'],
      ['S-CAT III', 'Est. total value:\n> $100M but < $250M', 'AFPEO/CM\nDelegable no lower than GO/SES', 'AFPEO/CM\nDelegable no lower than GO/SES', 'S-PEO/TEO\nDelegable no lower than Senior Materiel Leader (SML) or O-6/GS-15 equivalent'],
      ['S-CAT IV', 'Est. total value:\n> $10M but < $100M', 'MAJCOM/FOA/DRU CC/CD/CV/CA\nDelegable to Wing/Directorate CC/CV or O-6/GS-15 equivalent', 'SAF/MG or AFPEO/CM\nDelegable to no lower than the 2-letter principal or deputy', 'S-PEO/TEO or Deputy PEO/TEO\nDelegable to no lower than Materiel Leader (ML) or O-5/GS-14 equivalent'],
      ['S-CAT V', 'Est. total value:\n> SAT but < $10M', 'MAJCOM/FOA/DRU CC/CD/CV/CA\nDelegable to Squadron/Division CC or O-4/GS-13 equivalent. >SAT but < $5M may be delegated to an AWF functional per DoDI 5000.66.', 'SAF/MG or AFPEO/CM\nDelegable to no lower than 3-letter GO/SES', 'S-PEO/TEO or Deputy PEO/TEO\nDelegable no lower than ML or O-5/GS-14 equivalent']
    ],
    notes: 'Special Interest Items are designated by USD(A&S) or designee. Delegations beyond the table require waiver. Delegations must be documented in writing and maintained by the parent organization.'
  },
  '2.2': {
    title: 'United States Space Force (USSF) SADAs by S-CAT',
    headers: ['S-CAT Level', 'Threshold', 'FLDCOM Structure w/ Signed SMA', 'Space Staff Structure w/ Signed SMA', 'Systems PEO/TEO Structure'],
    rows: [
      ['S-CAT I', 'Est. total value:\n> $1B or\n> $300M in any one year', 'AFPEO/CM\nDelegable no lower than GO/SES', 'As designated by USD(A&S), SAF/SQ, or AFPEO/CM\nDelegable no lower than GO/SES', 'S-PEO/TEO\nDelegable no lower than GO/SES'],
      ['S-CAT II', 'Est. total value:\n> $250M but < $1B', 'AFPEO/CM\nDelegable no lower than GO/SES', 'AFPEO/CM\nDelegable no lower than GO/SES', 'S-PEO/TEO\nDelegable no lower than GO/SES'],
      ['S-CAT III', 'Est. total value:\n> $100M but < $250M', 'AFPEO/CM\nDelegable no lower than GO/SES', 'AFPEO/CM\nDelegable no lower than GO/SES', 'S-PEO/TEO\nDelegable no lower than SML or O-6/GS-15 equivalent'],
      ['S-CAT IV', 'Est. total value:\n> $10M but < $100M', 'FLDCOM CC/CD/CV/CA\nDelegable to HQ Director, Delta CC, SBD CC/CV, SML/ML, or O-6/GS-15 equivalent', 'SF/DS or AFPEO/CM\nDelegable to no lower than the 2-letter principal or deputy', 'S-PEO/TEO or Deputy PEO/TEO\nDelegable to no lower than ML or O-5/GS-14 equivalent'],
      ['S-CAT V', 'Est. total value:\n> SAT but < $10M', 'FLDCOM CC/CD/CV/CA\nDelegable to Squadron/Division CC or O-4/GS-13 equivalent. >SAT but < $5M may be delegated to an AWF functional per DoDI 5000.66.', 'SF/DS or AFPEO/CM\nDelegable to no lower than 3-letter principal or deputy', 'S-PEO/TEO or Deputy PEO/TEO\nDelegable no lower than ML or O-5/GS-14 equivalent']
    ],
    notes: 'Special Interest Items are designated by USD(A&S) or designee. For acquisitions supporting multiple FLDCOMs or Space Staff organizations, the executing organization SADA is the decision authority.'
  },
  '2.3': {
    title: 'Certification Levels for PMs/SALs',
    headers: ['S-CAT', 'Role', 'Program Value', 'Certification / Credential'],
    rows: [
      ['S-CAT I*', 'Program Manager', 'Est. > $1B or > $300M in any one year', 'DAWIA PM Advanced Certification'],
      ['S-CAT II', 'Program Manager', 'Est. total value:\n> $250M but < $1B', 'DAWIA PM Practitioner Certification'],
      ['S-CAT III', 'Program Manager', 'Est. total value:\n> $100M but < $250M', 'DAWIA PM Practitioner Certification'],
      ['S-CAT IV', 'Services Acquisition Lead', 'Est. total value:\n> $10M but < $100M', 'DAU Services Acquisition Team Member Credential'],
      ['S-CAT V', 'Services Acquisition Lead', 'Est. total value:\n> SAT but < $10M', 'DAU Services Acquisition Team Member Credential']
    ],
    notes: 'PM billets must be coded as Program Manager acquisition positions. SADAs may appoint DAWIA-certified PMs to S-CAT IV/V based on risk, complexity, and availability. SALs should achieve the credential within six months.'
  },
  '3.1': {
    title: 'USAF Requirements Approval Authority',
    headers: ['Services Category', 'Requirement Value', 'MAJCOM/DRU/FOA Structure', 'Secretariat & Air Staff Structure', 'System PEO/TEO Structure'],
    rows: [
      ['Special Interest', 'All dollar values', 'As designated by USD(A&S), SAF/AQ, or AFPEO/CM', 'As designated by USD(A&S), SAF/AQ, or AFPEO/CM', 'As designated by USD(A&S), SAF/AQ, or AFPEO/CM'],
      ['S-CAT I', 'Est. total value:\n> $1B or\n> $300M in any one year', 'MAJCOM/DRU/FOA CC/CD/CV/CA (delegable)', 'SAF/MG', 'S-PEO/TEO (delegable)'],
      ['S-CAT II', 'Est. total value:\n> $250M but < $1B', 'MAJCOM/DRU/FOA CC/CD/CV/CA (delegable)', 'SAF/MG', 'S-PEO/TEO (delegable)'],
      ['S-CAT III', 'Est. total value:\n> $100M but < $250M', 'MAJCOM/DRU/FOA CC/CD/CV/CA (delegable)', 'SAF/MG', 'S-PEO/TEO (delegable)'],
      ['S-CAT IV', 'Est. total value:\n> $10M but < $100M', 'MAJCOM/DRU/FOA CC/CD/CV/CA (delegable)', 'SAF/MG (delegable)', 'S-PEO/TEO or Deputy (delegable)'],
      ['S-CAT V', 'Est. total value:\n> SAT but < $10M', 'MAJCOM/DRU/FOA CC/CD/CV/CA (delegable)', 'SAF/MG (delegable)', 'S-PEO/TEO or Deputy (delegable)']
    ],
    notes: 'All requirements greater than or equal to the SAT require an approved RAD signed by the RAA indicated by dollar threshold or as delegated.'
  },
  '3.2': {
    title: 'USSF Requirements Approval Authority',
    headers: ['Services Category', 'Requirement Value', 'FLDCOM Structure', 'Space Staff Structure', 'System PEO/TEO Structure'],
    rows: [
      ['Special Interest', 'All dollar values', 'As designated by USD(A&S), SAF/SQ, or AFPEO/CM', 'As designated by USD(A&S), SAF/SQ, or AFPEO/CM', 'As designated by USD(A&S), SAF/SQ, or AFPEO/CM'],
      ['S-CAT I', 'Est. total value:\n> $1B or\n> $300M in any one year', 'FLDCOM CC/CD/CV/CA (delegable)', 'SF/DS', 'S-PEO/TEO (delegable)'],
      ['S-CAT II', 'Est. total value:\n> $250M but < $1B', 'FLDCOM CC/CD/CV/CA (delegable)', 'SF/DS', 'S-PEO/TEO (delegable)'],
      ['S-CAT III', 'Est. total value:\n> $100M but < $250M', 'FLDCOM CC/CD/CV/CA (delegable)', 'SF/DS', 'S-PEO/TEO (delegable)'],
      ['S-CAT IV', 'Est. total value:\n> $10M but < $100M', 'FLDCOM CC/CD/CV/CA (delegable)', 'SF/DS (delegable)', 'S-PEO/TEO or Deputy (delegable)'],
      ['S-CAT V', 'Est. total value:\n> SAT but < $10M', 'FLDCOM CC/CD/CV/CA (delegable)', 'SF/DS (delegable)', 'S-PEO/TEO or Deputy (delegable)']
    ],
    notes: 'IT and Enterprise Data Management requirements must be coordinated with the Chief Technology and Innovation Officer before approval per the CSO delegation memo.'
  }
};

function dafiTableKey(line) {
  const t = String(line || '').trim();
  if (/^Table\s+2\.1\.\s+United States Air Force/i.test(t)) return '2.1';
  if (/^Table\s+2\.2\.\s+United States Space Force/i.test(t)) return '2.2';
  if (/^Table\s+2\.3\.\s+Certification Levels/i.test(t)) return '2.3';
  if (/^Table\s+3\.1\.\s+USAF Requirements/i.test(t)) return '3.1';
  if (/^Table\s+3\.2\.\s+USSF Requirements/i.test(t)) return '3.2';
  return '';
}

function dafiNativeTableHTML(key) {
  const t = DAFI_TABLES[key];
  if (!t) return '';
  return `<div class="dafi-native-table">
    <div class="dafi-native-title"><span>Table ${esc(key)}</span>${esc(t.title)}</div>
    <div class="dafi-table-wrap"><table class="dafi-table">
      <thead><tr>${t.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    ${t.notes ? `<div class="dafi-table-notes"><strong>Notes</strong>${esc(t.notes)}</div>` : ''}
  </div>`;
}

// Track the paragraph-token path within one section so nested paragraphs cite
// their FULL path — a "(1)" under "(a)" is 15.404-1(a)(1), not 15.404-1(1). The
// L{n} ingest levels are authoritative: a token at level n replaces everything
// at n and deeper; a continuation line (no leading token) keeps the current path.
function makeParaPath() {
  let nodes = []; // [{level, token}] shallow→deep
  return {
    set(level, token) { nodes = nodes.filter(n => n.level < level); nodes.push({ level, token }); },
    compose(level) { return nodes.filter(n => n.level <= level).map(n => `(${n.token})`).join(''); }
  };
}

function renderContentLine(line, baseCitation, source, paraPath) {
  const lm = line.match(/^L(\d):(.*)/);
  if (lm) {
    const level   = parseInt(lm[1]);
    const content = lm[2].trim();
    if (!content || isBrowsePageNumberLine(content)) return '';
    const text    = categoryGuideText(content, source);
    if (level === 0) return `<p class="br-p">${text}</p>`;
    let cite = baseCitation || '';
    if (cite) {
      // Only real enumeration tokens — (a) (1) (i) (A) (S-90) — never a leading
      // cross-reference like "(See 19.301-1(b))". A line may open with SEVERAL
      // tokens at once ("(b)(1)(A) Every multiyear contract…"): they span the
      // levels ENDING at this line's level, shallowest first.
      const toksM = content.match(/^((?:\([A-Za-z0-9]{1,4}(?:-\d{1,3})?\))+)/);
      const toks = toksM ? Array.from(toksM[1].matchAll(/\(([A-Za-z0-9]{1,4}(?:-\d{1,3})?)\)/g), m => m[1]) : [];
      let path = '';
      if (paraPath) {
        const startLvl = Math.max(1, level - toks.length + 1);
        toks.forEach((t, i) => paraPath.set(startLvl + i, t));
        path = paraPath.compose(Math.max(level, startLvl + toks.length - 1));
      } else if (toks.length) {
        path = toks.map(t => `(${t})`).join('');
      }
      if (path) {
        const dashIdx = cite.indexOf(' — ');
        if (dashIdx !== -1) {
          cite = cite.slice(0, dashIdx) + path + cite.slice(dashIdx);
        } else {
          cite = cite + path;
        }
      }
    }
    const citeBtn = cite
      ? `<button class="br-para-cite" data-cite="${esc(cite)}" data-action="br-copy" title="Copy citation">CITE</button>`
      : '';
    return `<div class="br-para-row br-l${Math.min(level,4)}">${citeBtn}<p class="br-para-text">${text}</p></div>`;
  }

  const t = line.trim();
  if (!t || isBrowsePageNumberLine(t)) return '';

  const dafiM = isDafiSource(source) ? dafiParagraphMatch(t) : null;
  const tableKey = isDafiSource(source) ? dafiTableKey(t) : '';
  if (tableKey) return dafiNativeTableHTML(tableKey);
  if (dafiM) {
    const num = dafiM[1];
    const text = dafiM[2];
    const level = Math.max(0, Math.min(4, num.split('.').length - 2));
    return `<div class="br-dafi-row br-dafi-l${level}"><span class="br-dafi-num">${esc(num)}</span><p class="br-dafi-text">${esc(text)}</p></div>`;
  }

  if (isCategoryGuide(source)) {
    const stepM = t.match(/^Step\s+(\d+):\s*(.*)/i);
    if (stepM) {
      return `<div class="cm-step"><span class="cm-step-num">Step ${esc(stepM[1])}</span><span class="cm-step-text">${categoryGuideText(stepM[2], source)}</span></div>`;
    }

    const subBulletM = t.match(/^(?:o|▪)\s+(.*)/);
    if (subBulletM) {
      return `<div class="br-bullet sub"><span class="br-bullet-marker">○</span><span class="br-bullet-text">${categoryGuideText(subBulletM[1], source)}</span></div>`;
    }

    if (isCategoryGuideHeadingLine(t)) {
      const cls = isCategoryGuideSubheadingLine(t) ? 'cm-subheading' : 'cm-heading';
      return `<div class="${cls}">${esc(t)}</div>`;
    }

    if (/^(Types of Vehicles|Tier\s+[234]|N\/A\s+|MAS\s+|STARS\s+|Alliant\s+|BIC MAC\s+|Digital Market|Best-in-Class\s+)/i.test(t)) {
      return `<div class="cm-table-line">${categoryGuideText(t, source)}</div>`;
    }
  }

  const bulletM = t.match(/^([●○])\s+(.*)/);
  if (bulletM) {
    return `<div class="br-bullet"><span class="br-bullet-marker">${esc(bulletM[1])}</span><span class="br-bullet-text">${categoryGuideText(bulletM[2], source)}</span></div>`;
  }

  const numM = t.match(/^(\d+)\.\s+(.*)/);
  if (numM) {
    return `<div class="br-numbered"><span class="br-num-marker">${esc(numM[1])}.</span><span class="br-num-text">${categoryGuideText(numM[2], source)}</span></div>`;
  }

  if (/^Part\s+\d+\s*[-–]/i.test(t)) {
    return `<div class="br-part-break">${esc(t)}</div>`;
  }

  if (isBrowseHeadingLine(t, source)) {
    return `<div class="br-note-heading">${esc(t)}</div>`;
  }

  return `<p class="br-p">${categoryGuideText(t, source)}</p>`;
}
// ── CITE A SECTION ────────────────────────────────────────────────────────────
function brCopy(citation, btn) {
  // Flash "Copied!" only after the text actually lands on the clipboard — a silent
  // writeText failure used to show success while the clipboard kept the PREVIOUS
  // citation (pasting then produced the wrong section).
  const orig = btn.textContent;
  const flash = () => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(citation).then(flash).catch(() => fallbackCopy(citation, flash));
  } else {
    fallbackCopy(citation, flash);
  }
}

function scrollBrowseReaderToTop() {
  if (browseRestoring || document.hidden) return; // don't scroll during a restore, or in a backgrounded tab (a smooth scroll issued while hidden is deferred by the browser and fires — jumping the user — when they return)
  const reader = document.getElementById('browse-reader');
  if (!reader) return;
  const y = reader.getBoundingClientRect().top + window.scrollY - getStickyOffset() - 8;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

// ── Reading wayfinding: floating back-to-top + current-section crumb ──────────
// Long parts run 90+ sections; the Contents card scrolls away and the inline
// "Back to top" only exists at the part's very end. After ~2 screens of reading
// (browse or the full-page reader) a floating ↑ appears, and on desktop the
// sticky source bar shows which section you're in.
(function initReadingWayfinding() {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'float-top'; btn.textContent = '↑';
  btn.setAttribute('aria-label', 'Back to the top of this document');
  document.body.appendChild(btn);
  btn.addEventListener('click', () => {
    const anchorEl = document.body.classList.contains('reader-mode')
      ? document.getElementById('reader-content')
      : document.getElementById('browse-reader');
    const y = anchorEl ? Math.max(0, anchorEl.getBoundingClientRect().top + window.scrollY - getStickyOffset() - 8) : 0;
    window.scrollTo({ top: y, behavior: 'smooth' });
  });

  const barInner = document.querySelector('.browse-source-bar-inner');
  let crumb = null;
  if (barInner) {
    crumb = document.createElement('span');
    crumb.className = 'browse-crumb';
    crumb.setAttribute('aria-live', 'off');
    barInner.appendChild(crumb);
  }

  let wayfindTimer = 0;
  function update() {
    const readerMode = document.body.classList.contains('reader-mode');
    const inBrowse = currentMode === 'browse' && browseActivePart != null;
    btn.classList.toggle('show', (readerMode || inBrowse) && window.scrollY > 1400);
    if (!crumb) return;
    if (!inBrowse || readerMode) { crumb.textContent = ''; return; }
    // Current section = the last one whose top has crossed under the sticky chrome.
    const secs = document.querySelectorAll('#browse-reader-inner .br-section');
    const fold = getStickyOffset() + 120;
    let cur = null;
    for (const s of secs) {
      if (s.getBoundingClientRect().top <= fold) cur = s; else break;
    }
    if (!cur) { crumb.textContent = ''; return; }
    const num = cur.querySelector('.br-section-num')?.textContent.trim() || '';
    const head = cur.querySelector('.br-section-heading')?.textContent.trim()
      || cur.querySelector('.br-subpart-heading')?.textContent.trim() || '';
    crumb.textContent = num && head ? `${num} — ${head}` : (num || head);
  }
  // Timer throttle, NOT requestAnimationFrame — rAF is paused in backgrounded
  // tabs (this repo's recurring lesson), and a timer keeps state honest there.
  window.addEventListener('scroll', () => {
    if (wayfindTimer) return;
    wayfindTimer = setTimeout(() => { wayfindTimer = 0; update(); }, 120);
  }, { passive: true });
})();

// ── Browse view persistence — survive a tab discard/reload (Chrome Memory Saver
// drops background tabs when many are open; the browse view is DOM-only, so a
// reload would otherwise dump you back at the hero). Per-tab via sessionStorage,
// so two tabs on different parts don't clobber each other. ──────────────────────
function saveBrowseState() {
  if (browseRestoring || currentMode !== 'browse' || browseActivePart == null) return; // don't let a restore's own re-render overwrite the saved position with 0
  try {
    sessionStorage.setItem('acq-browse-v1', JSON.stringify({
      source: browseSrc, part: browseActivePart, label: browseLabel, y: Math.round(window.scrollY)
    }));
  } catch (e) {}
}
// Cache the fully-rendered part HTML per-tab so a discard/reload can REPAINT it
// synchronously — no network round-trip, so the reader never flashes to the top
// before the fetch resolves. Rendered HTML == what selectPart produces (only inline
// handlers, no post-render wiring), so re-injecting it is a faithful restore.
function cacheBrowseHTML(source, part, label, html) {
  try {
    if (!html || html.length > 3000000) return; // skip pathological sizes; sessionStorage quota safety
    sessionStorage.setItem('acq-browse-html-v1', JSON.stringify({ source, part, label, html }));
  } catch (e) {}
}
let _browseSaveTimer = 0;
window.addEventListener('scroll', () => {
  if (browseRestoring || currentMode !== 'browse' || browseActivePart == null) return;
  clearTimeout(_browseSaveTimer);
  _browseSaveTimer = setTimeout(saveBrowseState, 250);
}, { passive: true });
async function restoreBrowseState() {
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem('acq-browse-v1') || 'null'); } catch (e) { return false; }
  if (!saved || !saved.source || saved.part == null) return false;
  browseRestoring = true;
  const targetY = Math.max(0, saved.y || 0);
  try {
    chooseBrowseSource(saved.source);         // enter browse + render the parts grid
    browseLabel = saved.label || '';
    // Fast path: repaint the cached render synchronously (no fetch → no top-flash).
    let cached = null;
    try { cached = JSON.parse(sessionStorage.getItem('acq-browse-html-v1') || 'null'); } catch (e) {}
    if (cached && cached.source === saved.source && String(cached.part) === String(saved.part) && cached.html) {
      browseActivePart = saved.part;
      const reader = document.getElementById('browse-reader-inner');
      if (reader) reader.innerHTML = cached.html;
      document.querySelectorAll('.part-tile').forEach(t => {
        const active = String(t.dataset.part) === String(saved.part);
        t.classList.toggle('active', active);
        t.setAttribute('aria-pressed', String(active));
      });
    } else {
      await selectPart(null, saved.part, saved.label || '');  // no cache (e.g. FMR / other tab) → fetch + render
    }
  } catch (e) { browseRestoring = false; return false; }
  // Land on the saved position. The reader reflows async, and — crucially — this
  // often runs in a BACKGROUNDED tab (Chrome discarded it; the user is flipping
  // back). requestAnimationFrame is PAUSED while hidden, so we drive the landing
  // with timers (which still run, throttled) — instant scrollTo works while hidden
  // too. Re-assert until we reach the saved spot, and again on becoming visible.
  const land = () => {
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: Math.min(targetY, maxY), behavior: 'instant' });
  };
  const onVis = () => { if (!document.hidden) land(); };
  document.addEventListener('visibilitychange', onVis);
  let tries = 0;
  const iv = setInterval(() => {
    land(); tries++;
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const reached = Math.abs(window.scrollY - Math.min(targetY, maxY)) < 4 && maxY >= targetY - 4;
    if (tries >= 25 || (!document.hidden && reached)) {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      browseRestoring = false;
    }
  }, 100);
  land();
  return true;
}

function isBrowsePageNumberLine(line) {
  return /^\d{1,3}$/.test((line || '').trim());
}

function normalizeBrowseLines(rawLines, source, parsed, partNum) {
  const blocks = [];
  let current = null;
  let skippingGuideGraphicText = false;
  let skippingGuideVehicleText = false;
  let skippingDafiTableText = false;

  function flush() {
    if (current && current.text.trim()) blocks.push(current.text.trim());
    current = null;
  }

  rawLines.forEach((raw, idx) => {
    const line = (raw || '').trim();
    if (!line) { flush(); return; }
    if (isBrowsePageNumberLine(line)) return;

    if (isDafiSource(source)) {
      const tableKey = dafiTableKey(line);
      if (tableKey) {
        flush();
        blocks.push(line);
        skippingDafiTableText = true;
        return;
      }
      if (skippingDafiTableText) {
        if (dafiParagraphMatch(line)) {
          skippingDafiTableText = false;
        } else {
          return;
        }
      }
    }

    if (source === 'category-management') {
      if (Number(partNum) >= 3 && /^Types of Vehicles\b/i.test(line)) {
        flush();
        skippingGuideVehicleText = true;
        return;
      }
      if (skippingGuideVehicleText) {
        if (/^Resources$/i.test(line)) {
          skippingGuideVehicleText = false;
        } else {
          return;
        }
      }
      if (String(partNum) === '1' && /^Simple\s+Other than Simple$/i.test(line)) {
        skippingGuideGraphicText = true;
        return;
      }
      if (String(partNum) === '2' && /^Category\s+Simple Pathway\s+Other-than-Simple Pathway$/i.test(line)) {
        skippingGuideGraphicText = true;
        return;
      }
      if (skippingGuideGraphicText) {
        if ((String(partNum) === '1' && /^Simple Procurements$/i.test(line)) ||
            (String(partNum) === '2' && /^Category Management$/i.test(line))) {
          skippingGuideGraphicText = false;
          if (String(partNum) === '2') return;
        } else {
          return;
        }
      }
    }

    if (source === 'far-companion' && parsed?.num) {
      const escapedNum = parsed.num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fcHead = new RegExp('^FC\\s+' + escapedNum + '(?:\\s|$)', 'i');
      if (idx === 0 && fcHead.test(line)) return;
    }

    const partM = line.match(/^Part\s+(\d+)\s*[-–]/i);
    if (source === 'far-companion' && partM && String(partM[1]) !== String(partNum)) {
      flush();
      return;
    }

    if (source === 'category-management' && parsed?.label && !current && !blocks.length) {
      const duplicateLabel = parsed.label.replace(/^Part\s+\d+\s*[-–]\s*/i, '').trim();
      if (duplicateLabel && line.toLowerCase() === duplicateLabel.toLowerCase()) return;
    }

    if (isBrowseBlockStart(line, source)) {
      flush();
      current = { text: line };
      return;
    }

    if (!current) {
      current = { text: line };
      return;
    }

    const prior = current.text;
    if (isBrowseHeadingLine(prior, source) || /^Step\s+\d+:/i.test(prior)) {
      flush();
      current = { text: line };
      return;
    }
    const isListBlock = /^[●○]\s+/.test(prior) || /^(?:o|▪)\s+/.test(prior) || /^\d+\.\s+/.test(prior);
    if (isListBlock && /[.;:]$/.test(prior) && /^[A-Z]/.test(line)) {
      flush();
      current = { text: line };
      return;
    }
    const joiner = /[-–]$/.test(prior) ? '' : ' ';
    current.text = prior.replace(/[-–]$/, '') + joiner + line;
  });
  flush();
  return blocks;
}

// ── BUILD FULL READER HTML FROM HITS ─────────────────────────────────────────
function parseBrowseTitle(hit, source) {
  const title = hit.title || '';
  const anchor = `sec-${hit.id}`;
  const subM = title.match(/^(Subpart\s+[\d.]+)\s*[-–]?\s*(.*)/i);
  if (subM) return { type: 'subpart', num: subM[1], label: subM[2] || '', anchor };

  if (source === 'far-companion' || hit.source === 'far-companion') {
    const fcM = title.match(/^FC\s+(\d{1,3}\.\d{1,6}(?:-\d+)?(?:\([^)]+\))*)\s+(.+)/i);
    if (fcM) return { type: 'section', num: fcM[1], label: fcM[2], anchor };
  }

  const secM = title.match(/^(\d{1,3}\.\d{1,6}(?:-\d+)?(?:\([^)]+\))*)\s+(.+)/);
  if (secM) return { type: 'section', num: secM[1], label: secM[2], anchor };

  const looseM = title.match(/^(\d{1,3}[\d.]*(?:-\d+)*)\s+(.+)/);
  if (looseM) return { type: 'section', num: looseM[1], label: looseM[2], anchor };

  return { type: 'other', num: '', label: title, anchor };
}

// ── FMR browse: chapter index + single-chapter view ───────────────────────────
let fmrBrowseState = null; // { partNum, partLabel, hits } for the active FMR volume
function fmrChapterNum(hit) { const m = String(hit && hit.title || '').match(/Chapter\s+([\w-]+)/i); return m ? m[1] : ''; }
function fmrChapterLabel(hit) {
  const t = String(hit && hit.title || '');
  return t.replace(/^Chapter\s+[\w-]+\s*[:.\-]?\s*/i, '').trim() || t || 'Chapter';
}
function renderFmrVolumeIndex(scroll) {
  const st = fmrBrowseState; if (!st) return;
  const reader = document.getElementById('browse-reader-inner');
  const srcLabel = SOURCE_LABELS['fmr'] || 'DoD FMR';
  const items = st.hits.map((hit, i) =>
    `<li><a class="br-toc-link" href="#" data-fmr-ch="${i}">
      <span class="br-toc-link-num">Ch ${esc(fmrChapterNum(hit) || String(i + 1))}</span>
      <span class="br-toc-link-title">${esc(fmrChapterLabel(hit))}</span>
    </a></li>`).join('');
  reader.innerHTML = `
    <div class="br-header">
      <span class="br-source-badge" style="background:#fef3c7;color:#92400e">${esc(String(srcLabel))}</span>
      <div class="br-part-num">Volume ${esc(String(st.partNum))}</div>
      <div class="br-part-title">${esc(String(st.partLabel))}</div>
      <div class="br-meta"><span>${st.hits.length} chapter${st.hits.length !== 1 ? 's' : ''}</span><span class="br-meta-dot"></span><span>Select a chapter to read</span></div>
    </div>
    <div class="br-toc"><div class="br-toc-title">Chapters</div><ul class="br-toc-list">${items}</ul></div>`;
  reader.querySelectorAll('.br-toc-link[data-fmr-ch]').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); openFmrChapter(Number(a.dataset.fmrCh)); }));
  if (scroll !== false) requestAnimationFrame(scrollBrowseReaderToTop);
}
function openFmrChapter(idx) {
  const st = fmrBrowseState; if (!st) return;
  const hit = st.hits[idx]; if (!hit) return;
  const reader = document.getElementById('browse-reader-inner');
  reader.innerHTML =
    `<button type="button" class="br-fmr-back" id="br-fmr-back">← All chapters in Volume ${esc(String(st.partNum))}</button>` +
    buildReaderHTML([hit], 'fmr', st.partNum, fmrChapterLabel(hit), 1);
  const back = document.getElementById('br-fmr-back');
  if (back) back.addEventListener('click', () => renderFmrVolumeIndex(true));
  requestAnimationFrame(scrollBrowseReaderToTop);
}

function buildReaderHTML(hits, source, partNum, partLabel, docCount) {
  const srcLabel  = SOURCE_LABELS[source] || source.toUpperCase();
  const tagBg  = {'rfo':'#e8f0fe','r-dfars':'#e6f4ea','far-companion':'#f0eeff','category-management':'#e0f2fe','afi-63-138':'#fff1f2','compass':'#f0f9ff','fmr':'#fef3c7'}[source] || '#f0f0f0';
  const tagClr = {'rfo':'#1a4aa8','r-dfars':'#1a6634','far-companion':'#3d2799','category-management':'#075985','afi-63-138':'#9f1239','compass':'#075985','fmr':'#92400e'}[source] || '#666';
  const readerHits = source === 'far-companion'
    ? hits.filter(hit => parseBrowseTitle(hit, source).num)
    : hits;
  const displayCount = readerHits.length || docCount;
  if (!readerHits.length) {
    return `<div class="browse-empty"><div class="browse-empty-icon">⊘</div><div class="browse-empty-title">No indexed sections found</div><div class="browse-empty-sub">${esc(String(srcLabel))} Part ${esc(String(partNum))} is listed, but no section-level content is indexed yet.</div></div>`;
  }

  // Build TOC from hits
  const tocItems = readerHits.map(hit => parseBrowseTitle(hit, source));

  const tocHTML = `<div class="br-toc">
    <div class="br-toc-title">Contents</div>
    <ul class="br-toc-list">
      ${tocItems.map(item => {
        if (item.type === 'subpart') {
          return `<li class="br-toc-subpart"><span class="br-toc-subpart-label">${esc(item.num)} — ${esc(item.label)}</span></li>`;
        }
        return `<li><a class="br-toc-link" data-action="scroll-to" data-anchor="${esc(item.anchor)}" href="#">
          <span class="br-toc-link-num">${esc(item.num || '—')}</span>
          <span class="br-toc-link-title">${esc(item.label)}</span>
        </a></li>`;
      }).join('')}
    </ul>
  </div>`;
  // Build sections
  const sectionsHTML = readerHits.map((hit, i) => {
    const parsed = parseBrowseTitle(hit, source);
    const title   = hit.title || 'Untitled';
    const anchor  = parsed.anchor;
    const citation = generateCitation(hit);
    const content  = (hit.content || '').replace(/^[^\n]+\n\n/, ''); // strip heading line
    const lines = normalizeBrowseLines(content.split('\n'), source, parsed, partNum);
    const visualFlags = {};
    const paraPath = makeParaPath(); // fresh token path per section
    const bodyHTML = source === 'compass'
      ? formatCompassContent(content, hit, citation)
      : lines.map(l => renderContentLine(l, citation, source, paraPath) + categoryGuideVisualAfterLine(source, partNum, l, visualFlags)).join('');

    if (parsed.type === 'subpart') {
      return `<div id="${anchor}" class="br-section">
        <div class="br-subpart-heading">${esc(parsed.num)}${parsed.label ? ` — ${esc(parsed.label)}` : ''}</div>
        <div class="br-body">${bodyHTML}</div>
      </div>`;
    }

    return `<div id="${anchor}" class="br-section">
      ${i > 0 ? '<div class="br-divider"></div>' : ''}
      <div class="br-section-header">
        <div class="br-section-title-block">
          ${parsed.num ? `<div class="br-section-num">${esc(parsed.num)}</div>` : ''}
          <div class="br-section-heading">${esc(parsed.label || title)}</div>
        </div>
        <button class="br-cite-btn" data-cite="${esc(citation)}" data-action="br-copy">Cite</button>
      </div>
      <div class="br-body">${bodyHTML}</div>
    </div>`;
  }).join('');

  const date = readerHits[0]?.date || hits[0]?.date || '';

  return `
    <div class="br-header">
      <span class="br-source-badge" style="background:${tagBg};color:${tagClr}">${srcLabel}</span>
      <div class="br-part-num">${partWord(source)} ${partNum}</div>
      <div class="br-part-title">${esc(partLabel)}</div>
      <div class="br-meta">
        <span>${displayCount} section${displayCount !== 1 ? 's' : ''}</span>
        ${date ? `<span class="br-meta-dot"></span><span>Issued ${esc(date)}</span>` : ''}
        <span class="br-meta-dot"></span>
        <span>${srcLabel}</span>
      </div>
    </div>
    <div class="br-part-search" id="br-part-search" role="search" aria-label="Search within this part">
      <span class="br-part-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg></span>
      <input class="br-part-search-input" id="br-part-search-input" type="text" placeholder="Search within ${partWord(source)} ${partNum}…" autocomplete="off" spellcheck="false" aria-label="Search within this part">
      <span class="br-part-search-count" id="br-part-search-count"></span>
      <span class="br-part-search-nav" id="br-part-search-nav" aria-label="Part search matches">
        <button type="button" class="br-part-search-step" id="br-part-search-prev" aria-label="Previous match">↑</button>
        <button type="button" class="br-part-search-step" id="br-part-search-next" aria-label="Next match">↓</button>
      </span>
      <button type="button" class="br-part-search-clear" id="br-part-search-clear" aria-label="Clear part search">✕</button>
    </div>
    ${tocHTML}
    ${sectionsHTML}
    <button class="br-back-top" data-action="scroll-to" data-anchor="browse-reader">↑ Back to top</button>
  `;
}

function indexPartForSource(source, part) {
  const n = Number(part);
  if (source === 'r-dfars' && Number.isFinite(n) && n >= 200) return String(n - 200);
  return String(part);
}

function displayPartForSource(source, part) {
  const n = Number(part);
  if (source === 'r-dfars' && Number.isFinite(n) && n > 0 && n < 200) return String(n + 200);
  return String(part);
}

// FMR is organized into Volumes (not Parts); everything else uses "Part".
function partWord(source) { return source === 'fmr' ? 'Volume' : 'Part'; }

function buildCategoryManagementLanding() {
  const categories = (PARTS_BY_SOURCE['category-management'] || []).filter(([num]) => Number(num) >= 3);
  return `
    <div class="br-header">
      <span class="br-source-badge" style="background:#e0f2fe;color:#075985">Category Management Buying Guide</span>
      <div class="br-part-num">Parent Section</div>
      <div class="br-part-title">Category Management</div>
      <div class="br-meta"><span>${categories.length} category pathways</span><span class="br-meta-dot"></span><span>Browse a category from the left panel</span></div>
    </div>
    <div class="br-section">
      <div class="br-body">
        <p class="br-p">The guide groups the category-specific pathway primers under this parent section. Choose a category in the left panel to review its vehicles table, resources, pathway pointers, market research notes, and SIN references.</p>
        <div class="cm-category-index" aria-label="Category Management pathways">
          ${categories.map(([num, label]) => `<button type="button" data-action="select-cat-part" data-part="${esc(String(num))}" data-label="${esc(label)}">${esc(label)}<span>Part ${num}</span></button>`).join('')}
        </div>
      </div>
    </div>`;
}

function selectCategoryGuidePart(tile, partKey, partLabel) {
  if (/^\d+$/.test(String(partKey))) {
    return selectPart(tile, Number(partKey), partLabel);
  }
  browseActivePart = partKey;
  document.querySelectorAll('.part-tile').forEach(t => {
    const active = t.dataset.part === partKey;
    t.classList.toggle('active', active);
    t.setAttribute('aria-pressed', String(active));
  });
  const reader = document.getElementById('browse-reader-inner');
  if (partKey === 'category-management') {
    reader.innerHTML = buildCategoryManagementLanding();
    requestAnimationFrame(scrollBrowseReaderToTop);
  }
}

async function selectPart(tile, partNum, partLabel) {
  browseActivePart = partNum;
  browseLabel = partLabel || '';
  // Update active tile (part ids can be strings like FMR's "7A", so compare as strings)
  document.querySelectorAll('.part-tile').forEach(t => {
    const active = String(t.dataset.part) === String(partNum);
    t.classList.toggle('active', active);
    t.setAttribute('aria-pressed', String(active));
  });

  // Show loading state in reader
  const reader = document.getElementById('browse-reader-inner');
  reader.innerHTML = '<div class="browse-empty"><div class="spinner" style="margin:0 auto 16px;"></div><div class="browse-empty-sub">Loading Part ' + partNum + '…</div></div>';
  if (window.matchMedia('(max-width: 768px)').matches) {
    const readerTop = document.getElementById('browse-reader').getBoundingClientRect().top + window.scrollY - getStickyOffset() - 8;
    window.scrollTo({ top: Math.max(0, readerTop), behavior: 'smooth' });
  }

  try {
    const indexPart = indexPartForSource(browseSrc, partNum);
    // Paginate to get ALL sections — some parts have 100+ sections
    const allHits = [];
    const pageSize = 200;
    let offset = 0;
    while (true) {
      const data = await meiliSearch({
        q: '', limit: pageSize, offset,
        filter: `source = "${browseSrc}" AND part = "${indexPart}"`,
        attributesToRetrieve: ['id','title','content','source','part','status','date','filename','url'],
      });
      const page = data.hits || [];
      allHits.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    const hits = allHits;
    if (!hits.length) {
      reader.innerHTML = '<div class="browse-empty"><div class="browse-empty-icon">⊘</div><div class="browse-empty-title">No content found</div><div class="browse-empty-sub">This part may not be indexed yet for this source.</div></div>';
      requestAnimationFrame(scrollBrowseReaderToTop);
      return;
    }
    // FMR volumes hold one doc per CHAPTER (Vol 7A = 59) — rendering them all at once is heavy.
    // Show a chapter index and load a single chapter on demand (mirrors the drawer/reader path).
    if (browseSrc === 'fmr') {
      fmrBrowseState = { partNum, partLabel, hits };
      renderFmrVolumeIndex();
      return;
    }
    try {
      reader.innerHTML = buildReaderHTML(hits, browseSrc, partNum, partLabel, hits.length);
      requestAnimationFrame(scrollBrowseReaderToTop);
      saveBrowseState(); // remember this part so a tab discard/reload can restore it
      cacheBrowseHTML(browseSrc, partNum, browseLabel, reader.innerHTML); // repaint instantly on reload (no top-flash)
    } catch(buildErr) {
      console.error('buildReaderHTML error:', buildErr);
      reader.innerHTML = `<div class="browse-empty"><div class="browse-empty-icon">⚠</div><div class="browse-empty-title">Render error</div><div class="browse-empty-sub">${buildErr.message} — check console for details</div></div>`;
      requestAnimationFrame(scrollBrowseReaderToTop);
    }
  } catch(e) {
    console.error('Browse error:', e); reader.innerHTML = `<div class="browse-empty"><div class="browse-empty-icon">⚠</div><div class="browse-empty-title">Unable to load</div><div class="browse-empty-sub">${e.message || e}</div></div>`;
    requestAnimationFrame(scrollBrowseReaderToTop);
  }
}

// ── CITATION ──────────────────────────────────────────────────────────────────
function generateCitation(hit) {
  const label = SOURCE_LABELS[hit.source] || (hit.source || 'Document').toUpperCase();
  const title  = hit.title || '';

  // Extract the section title (text after the section number)
  // e.g. "3.101-2 Solicitation and acceptance of gratuities" → "Solicitation and acceptance of gratuities"
  function sectionTitle(t) {
    // Strip leading section number to get just the title text
    const m = t.match(/^[\d.]+(?:-\d+)?(?:\([^)]+\))*\s+(.*)/);
    return m ? m[1].replace(/\.$/, '').trim() : '';
  }

  // Subpart: "Subpart X.X - Title"
  const subM = title.match(/^Subpart\s+([\d.]+)\s*[-–]?\s*(.*)/i);
  if (subM) {
    const subTitle = subM[2].replace(/\.$/, '').trim();
    return subTitle
      ? `${label} Subpart ${subM[1]} — ${subTitle}`
      : `${label} Subpart ${subM[1]}`;
  }

  // FAR Companion: "FC X.XXX Title" — section numbers may carry paragraph tokens,
  // e.g. "FC 6.103(b)(1) Use planning…" (79 titles); without the paren group the
  // match fails and the cite degrades to the bare part ("FAR Companion Part 6").
  const fcM = title.match(/^FC\s+([\d.]+(?:-\d+)?(?:\([^)]+\))*)\s+(.*)/);
  if (fcM && hit.source === 'far-companion') {
    const fcTitle = fcM[2].replace(/\.$/, '').trim();
    return fcTitle
      ? `${label} ${fcM[1]} — ${fcTitle}`
      : `${label} ${fcM[1]}`;
  }

  // Section/subsection: "X.XXX Title" or "X.XXX-X Title"
  const secM = title.match(/^(\d{1,3}\.\d{1,6}(?:-\d+)?)\s+(.*)/);
  if (secM) {
    const secNum   = secM[1];
    const secTitle = secM[2].replace(/\.$/, '').trim();

    // Determine level label per FAR 1.105-2
    // Part = digits left of decimal only (rarely stored this way)
    // Subpart = X.X or X.XX (no section digits)
    // Section = X.XXX (3+ digits right of decimal, no dash)
    // Subsection = X.XXX-X (has dash)
    const parts = secNum.split('.');
    const rightOfDecimal = parts[1] || '';
    const hasDash = secNum.includes('-');

    let levelLabel = '';
    if (!hasDash && rightOfDecimal.length <= 2) {
      levelLabel = 'Subpart ';
    }
    // Sections and subsections: no prefix per FAR convention

    return secTitle
      ? `${label} ${levelLabel}${secNum} — ${secTitle}`
      : `${label} ${levelLabel}${secNum}`;
  }

  // FMR chapters: "Chapter N: Title" — cite volume + chapter, not just the volume
  const chM = title.match(/^Chapter\s+([\w-]+)\s*[:.\-]?\s*(.*)/i);
  if (chM && hit.source === 'fmr') {
    const vol = hit.part ? `${partWord(hit.source)} ${displayPartForSource(hit.source, hit.part)}, ` : '';
    const chTitle = chM[2].replace(/\.$/, '').trim();
    return chTitle
      ? `${label} ${vol}Chapter ${chM[1]} — ${chTitle}`
      : `${label} ${vol}Chapter ${chM[1]}`;
  }

  // Part-level: "Part X — Title" stored as title
  const partM = title.match(/^Part\s+(\d+)\s*[-–]?\s*(.*)/i);
  if (partM) {
    const partTitle = partM[2].replace(/\.$/, '').trim();
    return partTitle
      ? `${label} Part ${partM[1]} — ${partTitle}`
      : `${label} Part ${partM[1]}`;
  }

  // Filename fallback
  const fileMatch = (hit.filename || '').match(/\b(\d{1,3}\.\d{3,6}(?:-\d+)?)\b/);
  if (fileMatch) return `${label} ${fileMatch[1]}`;
  if (hit.part) return `${label} ${partWord(hit.source)} ${displayPartForSource(hit.source, hit.part)}`;
  return label;
}

function citeBtnHTML(cite) {
  return `<button class="dc-cite-btn" data-action="copy-inline-cite" data-cite="${esc(cite)}" aria-label="Copy citation">cite</button>`;
}

function copyInlineCite(btn, citation) {
  navigator.clipboard.writeText(citation).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = citation; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  });
  const orig = btn.textContent;
  btn.textContent = '✓'; btn.classList.add('copied');
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
}
window.copyInlineCite = copyInlineCite;

// ── CROSS-REFERENCE PREVIEW ────────────────────────────────────────────────────
// Turn in-text FAR/RFO section references (e.g. "3.104-4", "52.225-1(a)") into
// hover/focus-previewable links — but ONLY when the reference resolves EXACTLY to a
// section AcqVault has indexed. Unresolved tokens (dollar amounts, dates, sections we
// don't hold) stay plain text, so we never invent or mis-point a citation.
let XREF_MAP = null; // { rfo: Map(token->id), 'r-dfars': Map(token->id) }
const XREF_SOURCES = { rfo: 1, 'r-dfars': 1 };
const XREF_LEAD = /^(\d{1,3}\.\d{1,6}(?:-\d+)?)\b/;
function buildXrefMap() {
  if (XREF_MAP || !ACQ_INDEX) return XREF_MAP;
  const map = { rfo: new Map(), 'r-dfars': new Map() };
  for (const { doc } of ACQ_INDEX) {
    const table = map[doc.source];
    if (!table) continue;
    const m = String(doc.title || '').trim().match(XREF_LEAD);
    if (m && !table.has(m[1])) table.set(m[1], doc.id);
  }
  XREF_MAP = map;
  return XREF_MAP;
}
// Operates on ALREADY-ESCAPED text. esc() leaves ()/digits/dots intact, so the token
// regex is safe here and we never introduce unescaped user content.
function linkifyXrefs(escaped, hit) {
  if (!hit || !XREF_SOURCES[hit.source]) return escaped;
  const map = XREF_MAP || buildXrefMap();
  const table = map && map[hit.source];
  if (!table || !table.size) return escaped;
  const selfM = String(hit.title || '').trim().match(XREF_LEAD);
  const self = selfM ? selfM[1] : null;
  return escaped.replace(/\b(\d{1,3}\.\d{1,6}(?:-\d+)?)\b/g, (full, num) => {
    if (num === self) return full;          // don't self-link the section's own number
    const id = table.get(num);
    if (!id) return full;                    // unresolved -> leave as plain text
    return `<a class="dc-xref" href="?view=reader&amp;doc=${encodeURIComponent(id)}" data-xref="${esc(id)}" tabindex="0">${full}</a>`;
  });
}

let _xrefPop = null, _xrefHideTimer = null, _xrefShowTimer = null;
function xrefSnippet(content) {
  let t = String(content || '').split('\n').map(s => s.replace(/^L\d+:\s*/, '').trim()).filter(Boolean).join(' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > 240 ? t.slice(0, 240).replace(/\s+\S*$/, '') + '…' : t;
}
function xrefPopEl() {
  if (_xrefPop) return _xrefPop;
  const d = document.createElement('div');
  d.id = 'xref-pop';
  d.setAttribute('role', 'tooltip');
  d.addEventListener('mouseenter', () => clearTimeout(_xrefHideTimer));
  d.addEventListener('mouseleave', scheduleHideXrefPop);
  document.body.appendChild(d);
  _xrefPop = d;
  return d;
}
function positionXrefPop(pop, a) {
  const r = a.getBoundingClientRect();
  pop.style.maxWidth = Math.min(360, window.innerWidth - 24) + 'px';
  pop.style.visibility = 'hidden';
  pop.classList.add('show');
  const pr = pop.getBoundingClientRect();
  let top = r.bottom + 8;
  if (top + pr.height > window.innerHeight - 8 && r.top - 8 - pr.height > 8) top = r.top - 8 - pr.height;
  let left = r.left;
  if (left + pr.width > window.innerWidth - 12) left = window.innerWidth - 12 - pr.width;
  if (left < 12) left = 12;
  pop.style.top = Math.max(8, top) + 'px';
  pop.style.left = left + 'px';
  pop.style.visibility = '';
}
function showXrefPop(a) {
  const id = a.dataset.xref;
  const entry = ACQ_INDEX && ACQ_INDEX.find(x => String(x.doc.id) === String(id));
  if (!entry) return;
  const doc = entry.doc;
  const pop = xrefPopEl();
  pop.innerHTML =
    `<div class="xp-head">${sourceTag(doc.source)}<span class="xp-title">${esc(doc.title || '')}</span></div>` +
    `<div class="xp-body">${esc(xrefSnippet(doc.content))}</div>` +
    `<div class="xp-foot"><span class="xp-open">Open clause →</span>` +
    `<span class="xp-verify">AcqVault copy — verify at source</span></div>`;
  positionXrefPop(pop, a);
}
function scheduleHideXrefPop() {
  clearTimeout(_xrefHideTimer);
  _xrefHideTimer = setTimeout(hideXrefPop, 180);
}
function hideXrefPop() {
  clearTimeout(_xrefShowTimer);
  if (_xrefPop) _xrefPop.classList.remove('show');
}
function openXref(a) {
  const id = a.dataset.xref;
  const entry = ACQ_INDEX && ACQ_INDEX.find(x => String(x.doc.id) === String(id));
  if (!entry) return false;
  hideXrefPop();
  openDrawer(entry.doc);
  return true;
}
// Delegated handlers — one set, covers drawer + reader, survives innerHTML swaps.
document.addEventListener('mouseover', (e) => {
  const a = e.target.closest && e.target.closest('.dc-xref');
  if (!a) return;
  clearTimeout(_xrefHideTimer);
  clearTimeout(_xrefShowTimer);
  _xrefShowTimer = setTimeout(() => showXrefPop(a), 120);
});
document.addEventListener('mouseout', (e) => {
  const a = e.target.closest && e.target.closest('.dc-xref');
  if (!a) return;
  clearTimeout(_xrefShowTimer);
  scheduleHideXrefPop();
});
document.addEventListener('focusin', (e) => {
  const a = e.target.closest && e.target.closest('.dc-xref');
  if (a) showXrefPop(a);
});
document.addEventListener('focusout', (e) => {
  const a = e.target.closest && e.target.closest('.dc-xref');
  if (a) scheduleHideXrefPop();
});
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('.dc-xref');
  if (!a) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // allow open-in-new-tab
  if (openXref(a)) e.preventDefault();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideXrefPop(); });
window.addEventListener('scroll', hideXrefPop, true);
window.addEventListener('resize', hideXrefPop);

// ── TOOLKIT INFO POPOVER — click a threshold row / acronym for the RFO reference ─
let _tkPop = null;
function tkPopEl() {
  if (_tkPop) return _tkPop;
  const d = document.createElement('div');
  d.id = 'tk-pop'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Reference detail');
  document.body.appendChild(d); _tkPop = d; return d;
}
function hideTkPop() { if (_tkPop) _tkPop.classList.remove('show'); }
function tkPartFromCite(cite) { const m = String(cite || '').match(/(\d+)\./); return m ? m[1] : null; }
function showThrPop(row) {
  const q = (s) => ((row.querySelector(s) || {}).textContent || '').trim();
  const name = q('.thr-row-name'), cite = q('.thr-row-cite'), val = q('.thr-row-val');
  const part = tkPartFromCite(cite);
  const pop = tkPopEl();
  pop.innerHTML =
    `<div class="tkp-term">${esc(name)}</div>` +
    (val ? `<div class="tkp-val">${esc(val)}</div>` : '') +
    (cite ? `<div class="tkp-sub">Reference · ${esc(cite)}</div>` : '') +
    (part ? `<a class="tkp-open" href="/rfo/part-${esc(part)}">Read ${esc(cite)} in the RFO →</a>` : '') +
    `<div class="tkp-verify">AcqVault copy — verify the current text at the official source.</div>`;
  positionXrefPop(pop, row);
}
document.addEventListener('click', (e) => {
  const thr = e.target.closest && e.target.closest('.thr-row');
  if (thr) { e.stopPropagation(); showThrPop(thr); return; }
  // Stays open until the user clicks away (or Esc) — no scroll/hover auto-dismiss.
  if (_tkPop && _tkPop.classList.contains('show') && !_tkPop.contains(e.target)) hideTkPop();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideTkPop(); return; }
  if (e.key === 'Enter' || e.key === ' ') {
    const el = e.target.closest && e.target.closest('.thr-row');
    if (el) { e.preventDefault(); showThrPop(el); }
  }
});

// ── CONTENT FORMATTER ─────────────────────────────────────────────────────────
function formatContent(text, hit) {
  if (!text) return '<div class="dc-text" style="color:#bbb;font-style:italic;">No content available.</div>';
  const srcLabel = SOURCE_LABELS[hit.source] || (hit.source || 'Document').toUpperCase();
  const baseCite = generateCitation(hit);
  const lines    = text.split('\n');
  let html = '', curSection = null, paragraphNodes = [];

  if (hit?.source === 'compass') return formatCompassContent(text, hit, baseCite);

  function buildCite() {
    if (!curSection) return baseCite;
    // Build section number with paragraph tokens appended: 3.103(a)(1)
    let num = curSection;
    paragraphNodes.forEach(node => { num += `(${node.token})`; });
    // Extract the section title from baseCite if it contains " — Title"
    const dashIdx = baseCite.indexOf(' — ');
    const sectionTitle = dashIdx !== -1 ? baseCite.slice(dashIdx) : '';
    return `${srcLabel} ${num}${sectionTitle}`;
  }

  function resetParagraphPath() { paragraphNodes = []; }

  function tokenKind(token) {
    if (/^S-\d+$/i.test(token)) return 'number';
    if (/^\d+$/.test(token)) return 'number';
    if (/^[A-Z]$/.test(token)) return 'upper';
    if (/^[a-z]$/.test(token)) return 'lower';
    if (/^[ivxlcdm]+$/i.test(token)) return 'roman';
    return 'other';
  }

  function isRomanToken(token) { return /^[ivxlcdm]+$/i.test(token); }
  function isLowerAlpha(token) { return /^[a-z]$/.test(token); }

  function nextLowerAlpha(token) {
    return /^[a-y]$/.test(token) ? String.fromCharCode(token.charCodeAt(0) + 1) : '';
  }

  function romanToInt(value) {
    const map = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
    let total = 0, prev = 0;
    [...value.toLowerCase()].reverse().forEach(ch => {
      const n = map[ch] || 0;
      if (n < prev) total -= n;
      else { total += n; prev = n; }
    });
    return total;
  }

  function intToRoman(num) {
    const pairs = [['m',1000],['cm',900],['d',500],['cd',400],['c',100],['xc',90],['l',50],['xl',40],['x',10],['ix',9],['v',5],['iv',4],['i',1]];
    let out = '';
    pairs.forEach(([sym, val]) => { while (num >= val) { out += sym; num -= val; } });
    return out;
  }

  function nextRoman(token) {
    const n = romanToInt(token);
    return n ? intToRoman(n + 1) : '';
  }

  function setParagraphNodes(tokens, kinds) {
    paragraphNodes = tokens.map((token, i) => ({
      token: kinds[i] === 'roman' ? token.toLowerCase() : token,
      kind: kinds[i],
      level: i + 1
    }));
  }

  function replaceAtLevel(token, kind, level) {
    const cleanToken = kind === 'roman' ? token.toLowerCase() : token;
    paragraphNodes = paragraphNodes.filter(node => node.level < level);
    paragraphNodes.push({ token: cleanToken, kind, level });
  }

  function lastNodeOfKind(kind) {
    for (let i = paragraphNodes.length - 1; i >= 0; i--) {
      if (paragraphNodes[i].kind === kind) return paragraphNodes[i];
    }
    return null;
  }

  function inferMultiTokenKind(token, index) {
    if (index === 0 && isLowerAlpha(token)) return 'lower';
    if (/^S-\d+$/i.test(token) || /^\d+$/.test(token)) return 'number';
    if (/^[A-Z]$/.test(token)) return 'upper';
    if (isRomanToken(token)) return 'roman';
    return tokenKind(token);
  }

  function shouldTreatSingleAsRoman(token) {
    if (!isRomanToken(token) || !paragraphNodes.length) return false;
    const value = token.toLowerCase();
    const last = paragraphNodes[paragraphNodes.length - 1];
    if (last.kind === 'roman') return nextRoman(last.token) === value;
    if (last.kind === 'number') return true;
    if (paragraphNodes.length === 1 && last.kind === 'lower') return nextLowerAlpha(last.token) !== value;
    return false;
  }

  function updateParagraphPath(tokens) {
    if (tokens.length > 1) {
      setParagraphNodes(tokens, tokens.map(inferMultiTokenKind));
      return;
    }
    const token = tokens[0];
    if (isLowerAlpha(token) && !shouldTreatSingleAsRoman(token)) {
      setParagraphNodes([token], ['lower']);
      return;
    }
    const kind = /^[A-Z]$/.test(token) ? 'upper' : isRomanToken(token) ? 'roman' : tokenKind(token);
    const last = paragraphNodes[paragraphNodes.length - 1];
    if (kind === 'number') {
      let level = 1;
      if (last) {
        if (last.kind === 'number') level = last.level;
        else if (last.kind === 'lower' || last.kind === 'upper') level = last.level + 1;
        else {
          const numberNode = lastNodeOfKind('number');
          level = numberNode ? numberNode.level : last.level + 1;
        }
      }
      replaceAtLevel(token, 'number', level);
      return;
    }
    if (kind === 'roman') {
      const value = token.toLowerCase();
      let level = 1;
      if (last) {
        if (last.kind === 'roman') level = last.level;
        else if (last.kind === 'number' || last.kind === 'lower') level = last.level + 1;
        else {
          const romanNode = lastNodeOfKind('roman');
          level = romanNode && last.level > romanNode.level ? romanNode.level : last.level + 1;
        }
      }
      replaceAtLevel(value, 'roman', level);
      return;
    }
    if (kind === 'upper') {
      const upperNode = lastNodeOfKind('upper');
      let level = last ? last.level + 1 : 1;
      if (last && last.kind === 'upper') level = last.level;
      else if (upperNode && last && last.level > upperNode.level) level = upperNode.level;
      replaceAtLevel(token, 'upper', level);
      return;
    }
    setParagraphNodes(tokens, tokens.map(tokenKind));
  }

  function leadingParagraphTokens(line) {
    const m = line.match(/^((?:\([A-Za-z0-9-]+\)\s*)+)/);
    if (!m) return null;
    const tokens = [...m[1].matchAll(/\(([^)]+)\)/g)].map(match => match[1]);
    const valid = tokens.every(token => /^S-\d+$/i.test(token) || /^\d+$/.test(token) || /^[a-z]$/.test(token) || /^[A-Z]$/.test(token) || /^[ivxlcdm]+$/i.test(token));
    return valid ? tokens : null;
  }

  // ── TWO-COLUMN MERGE SPLITTER ─────────────────────────────────────────────
  // Detects lines like "1.102 Title. 1.402-1 Other title." and splits them.
  const splitMergedLine = (line) => {
    const sp = /^(\d{1,3}\.\d{1,6}(?:-\d+)?\s+[^.]+?\.\s*)(\d{1,3}\.\d{1,6}(?:-\d+)?\s+[A-Z].*)$/;
    const m = line.match(sp);
    return m ? [m[1].trim(), m[2].trim()] : null;
  };
  const processedLines = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (l && /\d{1,3}\.\d{3,6}(?:-\d+)?/.test(l)) {
      const split = splitMergedLine(l);
      if (split) { processedLines.push(split[0], split[1]); continue; }
    }
    processedLines.push(l);
  }

  // ── TOC ZONE DETECTION ────────────────────────────────────────────────────
  const looksLikeTocLine = (l) => /^\d{1,3}\.\d{1,6}(?:-\d+)?\s+[A-Z]/.test(l) && l.length < 120;
  const firstNonEmpty = processedLines.filter(l => l.trim()).slice(0, 30);
  const tocCount = firstNonEmpty.filter(looksLikeTocLine).length;
  const inTocZone = tocCount >= firstNonEmpty.length * 0.5;
  let pastToc = false;

  for (const raw of processedLines) {
    const line = raw.trim();
    if (!line) { html += '<div class="dc-gap"></div>'; continue; }

    // ── STRUCTURED RFO LINES (L0:/L1:/L2: prefix from ingest_rfo.py) ────────
    const lMatch = line.match(/^L(\d):(.*)/);
    if (lMatch) {
      const level   = parseInt(lMatch[1], 10);
      const content = lMatch[2].trim();
      if (!content) { html += '<div class="dc-gap"></div>'; continue; }
      if (level === 0) {
        html += `<div class="dc-text">${linkifyXrefs(esc(content), hit)}</div>`;
      } else {
        const tokM = content.match(/^\(([^)]+)\)/);
        if (tokM) updateParagraphPath([tokM[1]]);
        const cl = Math.min(level, 4);
        html += `<div class="dc-para dc-l${cl}"><span class="dc-para-text">${linkifyXrefs(esc(content), hit)}</span>${citeBtnHTML(buildCite())}</div>`;
      }
      continue;
    }

    // Mark when we exit TOC zone
    if (inTocZone && !pastToc && (leadingParagraphTokens(line) || line.length > 120)) pastToc = true;
    const isToc = inTocZone && !pastToc;

    if (/^PART\s+\d+/i.test(line) && line.length < 140) {
      curSection = null; resetParagraphPath();
      html += `<div class="dc-part">${esc(line)} ${citeBtnHTML(baseCite)}</div>`;
    } else if (/^FC\s+/i.test(line) && line.length < 240) {
      const m = line.match(/^FC\s+(.+?)(?:\s+[A-Z][^.]*\.|$)/);
      if (m) { curSection = m[1].trim(); resetParagraphPath(); }
      if (isToc) { html += `<div class="dc-section dc-toc-entry">${esc(line)}</div>`; } else { html += `<div class="dc-section">${esc(line)} ${citeBtnHTML(buildCite())}</div>`; }
    } else if (/^Subpart\s+[\d.]+/i.test(line) && line.length < 140) {
      resetParagraphPath();
      const m = line.match(/Subpart\s+([\d.]+)/i); if (m) curSection = m[1];
      if (isToc) { html += `<div class="dc-subpart dc-toc-entry">${esc(line)}</div>`; } else { html += `<div class="dc-subpart">${esc(line)} ${citeBtnHTML(buildCite())}</div>`; }
    } else if (/^\d{1,3}\.\d{1,6}(?:-\d+)?(?:\([^)]+\))*[\s,.-]+/.test(line) && line.length < 240) {
      const m = line.match(/^(\d{1,3}\.\d{1,6}(?:-\d+)?(?:\([^)]+\))*)/);
      if (m) { curSection = m[1]; resetParagraphPath(); }
      html += `<div class="dc-section">${esc(line)} ${citeBtnHTML(buildCite())}</div>`;
    } else if (leadingParagraphTokens(line)) {
      const tokens = leadingParagraphTokens(line);
      updateParagraphPath(tokens);
      const level = Math.min(paragraphNodes.length || 1, 4);
      html += `<div class="dc-para dc-l${level}"><span class="dc-para-text">${linkifyXrefs(esc(line), hit)}</span>${citeBtnHTML(buildCite())}</div>`;
    } else if (/^●\s+/.test(line)) {
      html += `<div class="dc-para dc-l1"><span class="dc-para-text">${esc(line)}</span></div>`;
    } else if (line === line.toUpperCase() && line.length > 3 && line.length < 80 && /[A-Z]{3}/.test(line)) {
      html += `<div class="dc-section">${esc(line)}</div>`;
    } else {
      html += `<div class="dc-text">${linkifyXrefs(esc(line), hit)}</div>`;
    }
  }
  return html;
}

function formatInlineLinks(text) {
  const raw = String(text || '');
  let out = '', last = 0;
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+(?:\)[^\s)]*)?|mailto:[^\s)]+)\)/g;
  let m;
  while ((m = re.exec(raw))) {
    out += esc(raw.slice(last, m.index));
    const label = esc(m[1]);
    const url = esc(m[2]);
    if (/dps\.mil/i.test(m[2])) {
      // CAC-gated DAF SharePoint — never reachable for public/offline users; render as
      // marked text instead of a dead outbound link.
      out += `<span class="dc-cac" title="On the CAC-gated DAF Contracting Compass (gov network + CAC required)">${label}<span class="dc-cac-tag">CAC</span></span>`;
    } else {
      out += `<a class="dc-link" href="${url}" target="_blank" rel="noopener">${label}</a>`;
    }
    last = m.index + m[0].length;
  }
  out += esc(raw.slice(last));
  return out;
}

function compassLinkParts(text) {
  const m = String(text || '').match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+(?:\)[^\s)]*)?|mailto:[^\s)]+)\)(?:\s+—\s+([\s\S]+))?/);
  return m ? { label: m[1], url: m[2], note: m[3] || '' } : null;
}

function compassResourceHTML(line, isImage = false) {
  const body = String(line || '').replace(/^-\s+/, '');
  const link = compassLinkParts(body);
  if (isImage && link?.url) {
    if (/dps\.mil/i.test(link.url)) {
      // CAC-gated SharePoint image — embedding it shows a broken image to public/offline
      // users. Render a labeled placeholder instead.
      return `<figure class="dc-compass-visual image-cac"><figcaption><span>${esc(link.label)}</span><span class="dc-cac-note">Visual on the CAC-gated DAF site</span></figcaption></figure>`;
    }
    return `<figure class="dc-compass-visual"><img src="${esc(link.url)}" alt="${esc(link.label)}" loading="lazy" data-fallback-figure><figcaption><span>${esc(link.label)}</span><a href="${esc(link.url)}" target="_blank" rel="noopener">Open image</a></figcaption></figure>`;
  }
  const note = link?.note ? ` <span class="dc-resource-note">— ${formatInlineLinks(link.note)}</span>` : '';
  const content = link ? `${formatInlineLinks(`[${link.label}](${link.url})`)}${note}` : formatInlineLinks(body);
  return `<div class="dc-resource"><div class="dc-resource-text">${content}</div></div>`;
}

function formatCompassContent(text, hit, baseCite) {
  const lines = String(text || '').split('\n');
  let html = '';
  let supportOpen = false;
  let inVisuals = false;
  const closeSupport = () => {
    if (!supportOpen) return '';
    supportOpen = false;
    return '</div></details>';
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { html += '<div class="dc-gap"></div>'; continue; }
    if (/^##\s+/.test(line)) {
      const heading = line.replace(/^##\s+/, '').trim();
      inVisuals = /Images and visual references/i.test(heading);
      const isSupport = /Supporting resources|Templates and document libraries|Points of contact|Images and visual references/i.test(heading);
      if (isSupport) {
        if (!supportOpen) {
          html += closeSupport();
          html += `<details class="dc-compass-support"><summary>Supporting resources</summary><div class="dc-compass-support-body">`;
          supportOpen = true;
        }
        html += `<div class="dc-compass-kicker">${formatInlineLinks(heading)}</div>`;
      } else {
        html += closeSupport();
        html += `<div class="dc-section">${formatInlineLinks(heading)} ${citeBtnHTML(baseCite)}</div>`;
      }
    } else if (/^###\s+/.test(line)) {
      html += `<div class="dc-subpart">${formatInlineLinks(line.replace(/^###\s+/, ''))}</div>`;
    } else if (/^-\s+/.test(line)) {
      if (!supportOpen && !inVisuals && !compassLinkParts(line)) {
        html += `<div class="br-bullet"><span class="br-bullet-marker">•</span><span class="br-bullet-text">${formatInlineLinks(line.replace(/^-\s+/, ''))}</span></div>`;
      } else {
        html += compassResourceHTML(line, inVisuals);
      }
    } else if (/^•\s*/.test(line)) {
      html += closeSupport();
      html += `<div class="dc-compass-callout">${formatInlineLinks(line.replace(/^•\s*/, ''))}</div>`;
    } else {
      if (!supportOpen && line.length > 80 && !/^Source page:/i.test(line)) {
        html += `<div class="dc-text">${formatInlineLinks(line)}</div>`;
        continue;
      }
      html += `<div class="dc-text">${formatInlineLinks(line)}</div>`;
    }
  }
  html += closeSupport();
  return html;
}

function cleanSnippet(t){return t?t.replace(/L\d:/g,"").replace(/\s+/g," ").trim():"";}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Safely render search highlights: escape ALL html, then restore only <mark> tags.
// Neutralizes any html in indexed content (stored XSS) while preserving highlighting.
function markOnly(s) {
  // Strip internal list-level ingest markers (L0:/L1:…) so they never leak into
  // rendered titles/snippets — the SEO/reader paths already strip these.
  return esc(s).replace(/L\d+:\s*/g, '').replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>');
}

// ── DRAWER FILTER ─────────────────────────────────────────────────────────────
document.getElementById('drawer-filter-input').addEventListener('input', function() { filterDrawerContent(this.value); });

function contentFilterRows(rootSelector) {
  // dc-* rows = drawer-style content; br-section blocks = browse-style content
  // (the full-page reader now renders through buildReaderHTML).
  return document.querySelectorAll(`${rootSelector} .dc-section, ${rootSelector} .dc-subpart, ${rootSelector} .dc-para, ${rootSelector} .dc-text, ${rootSelector} .dc-part, ${rootSelector} .br-section`);
}

function filterContentRows(rootSelector, q, countEl) {
  const query  = q.trim().toLowerCase();
  const rows   = contentFilterRows(rootSelector);
  const root   = document.querySelector(rootSelector);
  if (!query) {
    rows.forEach(el => el.style.display = '');
    if (root) root.classList.remove('is-filtered');
    if (countEl) countEl.classList.remove('visible');
    return 0;
  }
  let matches = 0;
  let firstMatch = null;
  rows.forEach(el => {
    const vis = el.textContent.toLowerCase().includes(query);
    el.style.display = vis ? '' : 'none';
    if (vis) { matches++; if (!firstMatch) firstMatch = el; }
  });
  if (root) root.classList.add('is-filtered');
  if (countEl) {
    countEl.textContent = `${matches} match${matches !== 1 ? 'es' : ''}`;
    countEl.classList.add('visible');
  }
  return { matches, firstMatch };
}

function filterDrawerContent(q) {
  filterContentRows('#drawer-content', q, document.getElementById('drawer-filter-count'));
}

function resetDrawerFilter() {
  document.getElementById('drawer-filter-input').value = '';
  document.getElementById('drawer-filter-count').classList.remove('visible');
  document.getElementById('drawer-content').classList.remove('is-filtered');
  contentFilterRows('#drawer-content').forEach(el => el.style.display = '');
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
const RESULTS_PAGE_SIZE = 40;
// Accumulator for the current result set so "Show more" can append further pages.
let lastSearchQuery = '';
let lastSearchHits = [];
let lastSearchTotal = 0;
async function search(query, offset = 0) {
  const filter = buildFilter(activeSources, activeStatuses);
  const body   = { q: query, offset, limit: RESULTS_PAGE_SIZE, attributesToHighlight: ['title','content'],
    highlightPreTag: '<mark>', highlightPostTag: '</mark>', attributesToCrop: ['content'], cropLength: 180 };
  if (filter) body.filter = filter;
  return meiliSearch(body);
}

function buildFilter(sources, statuses) {
  const parts = [];
  const liveSources = ['rfo', 'r-dfars', 'far-companion', 'category-management', 'afi-63-138', 'fmr'];
  const selectedSources = sources.size > 0 ? [...sources].filter(s => liveSources.includes(s)) : liveSources;
  if (selectedSources.length) parts.push('(' + selectedSources.map(s => `source = "${s}"`).join(' OR ') + ')');
  if (statuses.length)  parts.push('(' + statuses.map(s => `status = "${s}"`).join(' OR ') + ')');
  return parts.join(' AND ') || null;
}

function meiliFilterValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function docCacheKey(docId) {
  return `acqvault:doc:${docId}`;
}

function cacheDocumentForNewTab(hit) {
  if (!hit || !hit.id) return;
  try {
    localStorage.setItem(docCacheKey(hit.id), JSON.stringify(hit));
  } catch (e) {}
}

function readCachedDocument(docId) {
  try {
    const raw = localStorage.getItem(docCacheKey(docId));
    if (!raw) return null;
    const hit = JSON.parse(raw);
    return hit && String(hit.id) === String(docId) ? hit : null;
  } catch (e) {
    return null;
  }
}

function buildLookupFilter(lookup) {
  const parts = [];
  if (lookup.source) parts.push(`source = "${meiliFilterValue(lookup.source)}"`);
  if (lookup.part) parts.push(`part = "${meiliFilterValue(indexPartForSource(lookup.source, lookup.part))}"`);
  return parts.join(' AND ') || null;
}

async function searchDocumentLookup(docId, lookup) {
  const body = { q: lookup.title || '', limit: 10 };
  const filter = buildLookupFilter(lookup);
  if (filter) body.filter = filter;
  let data;
  try { data = await meiliSearch(body); }
  catch (e) { return null; }
  return (data.hits || []).find(hit => String(hit.id) === String(docId)) || null;
}

async function fetchDocumentById(docId, lookup = {}) {
  const cached = readCachedDocument(docId);
  if (cached) return cached;

  const metadataHit = await searchDocumentLookup(docId, lookup);
  if (metadataHit) return metadataHit;

  try {
    const data = await meiliSearch({ q: '', filter: `id = "${meiliFilterValue(docId)}"`, limit: 1 });
    const hit = (data.hits || []).find(item => String(item.id) === String(docId));
    if (hit) return hit;
  } catch (e) {}

  try {
    return await meiliDocument(docId);
  } catch (e) {
    return null;
  }
}

// ── RENDER HELPERS ────────────────────────────────────────────────────────────
function statusClass(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('open'))     return 'rc-badge-open';
  if (s.includes('interim'))  return 'rc-badge-interim';
  if (s.includes('class'))    return 'rc-badge-class';
  if (s.includes('proposed')) return 'rc-badge-proposed';
  if (s.includes('final'))    return 'rc-badge-final';
  return 'rc-badge-unknown';
}
function badgeTag(status) {
  if (!status || String(status).trim().toLowerCase() === 'unknown') return '';
  // Display-normalize the corpus's mixed casings ("active" vs "Active deviation"
  // vs "Current") without touching the data.
  const s = String(status).trim();
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return `<span class="rc-badge ${statusClass(status)}">${esc(label)}</span>`;
}
function sourceTag(source) {
  const safeSource = source || 'unknown';
  const label = SOURCE_LABELS[safeSource] || safeSource;
  const cls   = safeSource.replace(/[^a-z0-9]/gi,'-').toLowerCase();
  return `<span class="rc-tag rc-tag-${cls}">${esc(label)}</span>`;
}

// ── Freshness / provenance: as-of stamps, file-ready citations, staleness banner ──
function fmtAsOf(iso) {
  try { const d = new Date(iso); if (isNaN(d)) return ''; return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch (e) { return ''; }
}
function cleanClauseText(s) {
  return (s || '')
    .replace(/L\d+:/g, '')   // strip internal list-level markers (L1:/L2:…)
    .replace(/\s+/g, ' ')
    .trim();
}
function buildCiteBlock(hit) {
  // generateCitation already returns "<REF> — <Title>", so use it verbatim as the reference line.
  const ref = (typeof generateCitation === 'function' ? generateCitation(hit) : '') || hit.filename || hit.title || 'Citation';
  const text = cleanClauseText(hit.content);
  const label = SOURCE_LABELS[hit.source] || hit.source || '';
  const asof = hit.indexed_at ? `copy retrieved ${fmtAsOf(hit.indexed_at)}` : '';
  let out = ref;
  if (text) out += `\n\n"${text}"`;
  out += `\n\nSource: AcqVault · ${label}${asof ? ' · ' + asof : ''}`;
  out += `\nUnofficial copy — confirm the current/effective text at the official source before relying on it.`;
  return out;
}
function fallbackCopy(text, cb) {
  const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); if (cb) cb();
}
// Visually-hidden polite live region so copy/cite success is announced to screen readers
// (the button's label swap alone isn't reliably announced).
function srAnnounce(msg) {
  let el = document.getElementById('sr-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sr-status'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true');
    el.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
    document.body.appendChild(el);
  }
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 40); // clear→set so repeats re-announce
}

function copyResultCite(hit, btn) {
  const block = buildCiteBlock(hit);
  const flash = () => { const o = btn.dataset.label || btn.textContent; btn.dataset.label = o; btn.textContent = '✓ Copied'; btn.classList.add('copied'); srAnnounce('Citation copied to clipboard'); setTimeout(() => { btn.textContent = btn.dataset.label; btn.classList.remove('copied'); }, 1800); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(block).then(flash).catch(() => fallbackCopy(block, flash));
  else fallbackCopy(block, flash);
}
(function checkCorpusFreshness() {
  fetch('/output/corpus-meta.json').then(r => r.ok ? r.json() : null).then(meta => {
    if (!meta) return;
    window.__corpusMeta = meta;
    // Precision tool → state the exact indexed count from data, not a hand-typed "5,500+"
    if (meta.doc_count) {
      const n = Number(meta.doc_count);
      if (n > 0) {
        const ss = document.querySelector('.hero-statstrip-count strong'); if (ss) ss.textContent = n.toLocaleString();
        const fb = document.querySelector('.fcard-sections .fcard-bignum'); if (fb) fb.textContent = n.toLocaleString();
      }
    }
    const gen = meta.generated_at ? new Date(meta.generated_at) : null;
    if (!gen || isNaN(gen)) return;
    const days = Math.floor((Date.now() - gen.getTime()) / 86400000);
    const bar = document.getElementById('stale-bar');
    if (bar && days > 21) {
      bar.innerHTML = `<b>Heads up —</b> AcqVault last re-indexed its copy ${days} days ago (${fmtAsOf(meta.generated_at)}). The RFO changes often; confirm any citation against the official source before relying on it.`;
      bar.hidden = false;
    }
  }).catch(() => {});
})();

// ── "Updated" badges: sections changed in a recent re-index (ledger: /output/changes-log.json) ──
// Map of doc id → run date for changes within the badge window. Populated async at
// startup; cards rendered before it resolves simply omit the badge (next render has it).
const UPDATED_WINDOW_DAYS = 45;
let updatedDocs = new Map();
(function loadChangeLedger() {
  fetch('/output/changes-log.json').then(r => r.ok ? r.json() : null).then(runs => {
    if (!Array.isArray(runs)) return;
    const cutoff = Date.now() - UPDATED_WINDOW_DAYS * 86400000;
    for (const run of runs) {
      const at = new Date(run.run_at).getTime();
      if (isNaN(at) || at < cutoff) continue;
      const rfo = run.rfo || {};
      for (const s of [].concat(rfo.modified || [], rfo.added || [])) {
        if (s && s.id) updatedDocs.set(s.id, run.run_at);
      }
    }
  }).catch(() => {});
})();
function updatedTag(id) {
  const at = updatedDocs.get(id);
  if (!at) return '';
  return `<span class="rc-badge rc-badge-updated" title="Text changed in AcqVault's ${esc(fmtAsOf(at))} re-index — see /changes">Updated</span>`;
}

// ── Acronym-aware search assist: instant answer + "search the full term" ──
function acronymHit(q) {
  var dict = window.ACRONYMS; if (!dict) return null;
  var key = (q || '').trim();
  if (!key || key.length > 8) return null; // acronyms are short
  var found = dict[key] ? key : null;
  if (!found) { var up = key.toUpperCase(); for (var k in dict) { if (k.toUpperCase() === up) { found = k; break; } } }
  if (!found) return null;
  var v = dict[found] || [];
  return { acr: found, exp: v[0] || '', note: v[1] || '' };
}
function showAcronymAssist(q) {
  var el = document.getElementById('acr-suggest'); if (!el) return;
  var hit = acronymHit(q);
  if (!hit || !hit.exp || hit.exp.toLowerCase() === (q || '').trim().toLowerCase()) { el.hidden = true; el.innerHTML = ''; return; }
  el.innerHTML = '<span class="acr-tag">' + esc(hit.acr) + '</span>' +
    '<span class="acr-exp"><b>' + esc(hit.exp) + '</b>' + (hit.note ? '<span class="acr-note"> · ' + esc(hit.note) + '</span>' : '') + '</span>' +
    '<button type="button" class="acr-go" data-exp="' + esc(hit.exp) + '">Search the full term →</button>';
  el.hidden = false;
}

// Zero-results launchpad — recovery actions for the highest-intent moment.
function buildNoResultsHTML(query) {
  const q = String(query || '').trim();
  const legacyRe = /\b(FAR|DFARS|DFAR|DAFFARS)\b/i;
  const stripped = q.replace(legacyRe, '').replace(/\s{2,}/g, ' ').trim();
  const isLegacy = legacyRe.test(q) && stripped && stripped.toLowerCase() !== q.toLowerCase();
  const filtered = activeSources && activeSources.size > 0;
  const filterNames = filtered ? Array.from(activeSources).map(s => SOURCE_LABELS[s] || s).join(', ') : '';
  // Both rescues can apply at once (e.g. a legacy term WHILE filtered) — stack them, don't pick one.
  let primary = '';
  if (isLegacy) {
    primary += `<div class="nr-note">AcqVault indexes the <strong>RFO / R-DFARS</strong> that replaced the legacy FAR&nbsp;/&nbsp;DFARS.</div>
      <button class="nr-btn nr-btn-primary" data-action="strip-legacy" data-q="${esc(stripped)}">Search the RFO / R-DFARS for “${esc(stripped)}”</button>`;
  }
  if (filtered) {
    primary += `<div class="nr-note">You're searching only <strong>${esc(filterNames)}</strong>.</div>
      <button class="nr-btn nr-btn-primary" data-action="all-sources">Search all sources</button>`;
  }
  return `<div class="no-results nr-launch">
    <div class="nr-title">No matches for “${esc(q)}”</div>
    <div class="nr-sub">Try one of these — or tell us what's missing.</div>
    ${primary}
    <div class="nr-actions">
      <button class="nr-btn" data-action="browse">Browse by Part</button>
      <button class="nr-btn" data-action="fulltext">Full-Text PDFs</button>
      <button class="nr-btn nr-btn-report" data-action="report" data-q="${esc(q)}">Tell Iz this should be here</button>
    </div>
  </div>`;
}
document.getElementById('results-list').addEventListener('click', (e) => {
  const b = e.target.closest('.nr-btn'); if (!b) return;
  const action = b.dataset.action;
  if (action === 'all-sources') { restoreFiltersFromParam(''); if (searchInput.value.trim()) runSearch(); }
  else if (action === 'strip-legacy') { searchInput.value = b.dataset.q || ''; if (searchInput.value.trim()) runSearch(); }
  else if (action === 'browse') { setMode('browse'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (action === 'fulltext') { setMode('fulltext'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (action === 'report') {
    const m = document.getElementById('fb-message');
    if (m) m.value = `Search gap: "${b.dataset.q || ''}" returned no results. Could this be added?`;
    openFeedback();
  }
});
// Keyboard: ↑/↓ move focus through result cards (power-user nav; Enter opens via the link)
document.getElementById('results-list').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const links = Array.from(document.querySelectorAll('#results-list .rc-open'));
  if (!links.length) return;
  e.preventDefault();
  const cur = document.activeElement ? document.activeElement.closest('.rc-open') : null;
  let idx = links.indexOf(cur);
  if (idx === -1) idx = e.key === 'ArrowDown' ? -1 : links.length;
  const next = Math.max(0, Math.min(links.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
  links[next].focus();
});

function renderResults(data, query) {
  const list  = document.getElementById('results-list');
  const label = document.getElementById('result-count-label');
  const hits  = data.hits || [];
  const total = data.estimatedTotalHits || hits.length;
  const fscope = (activeSources && activeSources.size > 0)
    ? ` in ${esc(Array.from(activeSources).map(s => SOURCE_LABELS[s] || s).join(', '))}` : '';
  label.innerHTML = `<strong>${total.toLocaleString()}</strong> result${total !== 1 ? 's' : ''} for "<em>${esc(query)}</em>"${fscope}`;
  if (!hits.length) { list.innerHTML = buildNoResultsHTML(query); return; }
  list.innerHTML = hits.map(resultCardHTML).join('');
  list.querySelectorAll('.result-card').forEach(bindResultCard);
  renderMoreButton(hits.length, total);
}

// One result card's HTML — shared by the initial render and the "Show more" append.
function resultCardHTML(hit) {
  const hl = hit._formatted || hit;
  const pinned = !!(window.AcqSaved && AcqSaved.isPinned(hit.id));
  const params = new URLSearchParams({ view: 'reader', doc: hit.id });
  if (hit.source) params.set('source', hit.source);
  if (hit.part) params.set('part', hit.part);
  if (hit.title) params.set('title', hit.title);
  const href = '?' + params.toString();
  return `<div class="result-card${hit.id === activeDocId ? ' active' : ''}" data-id="${esc(hit.id)}" data-source="${esc(hit.source || '')}">
      <button class="rc-pin${pinned ? ' is-pinned' : ''}" type="button" data-pin-id="${esc(hit.id)}" data-pin-title="${esc(hit.title || '')}" data-pin-source="${esc(hit.source || '')}" data-pin-part="${esc(hit.part || '')}" data-pin-file="${esc(hit.filename || '')}" data-pin-url="${esc(hit.url || '')}" data-pin-anchor="${esc(hit.anchor || '')}" data-pin-indexed="${esc(hit.indexed_at || '')}" data-pin-status="${esc(hit.status || '')}" aria-pressed="${pinned ? 'true' : 'false'}" aria-label="${pinned ? 'Remove saved clause' : 'Save this clause'}" title="${pinned ? 'Saved — click to remove' : 'Save this clause'}">★</button>
      <a class="rc-open" href="${esc(href)}" aria-label="Open: ${esc(hit.title || 'document')}">
        <div class="rc-meta">${sourceTag(hit.source)}${badgeTag(hit.status)}${updatedTag(hit.id)}${hit.part ? `<span class="rc-part">${partWord(hit.source)} ${esc(displayPartForSource(hit.source, hit.part))}</span>` : ''}</div>
        <div class="rc-title">${markOnly(hl.title || hit.title || 'Untitled')}</div>
        <div class="rc-snippet">${markOnly(hl.content || '')}</div>
      </a>
      <div class="rc-foot">
        <span class="rc-asof" title="When AcqVault captured this copy — not the regulation's effective date">${hit.indexed_at ? `AcqVault copy · ${esc(fmtAsOf(hit.indexed_at))}` : ''}</span>
        <button class="rc-cite-btn" type="button" aria-label="Copy a file-ready citation">⧉ Cite</button>
      </div>
    </div>`;
}
// Wire one card's open/cite handlers (hit looked up from the accumulator).
function bindResultCard(card) {
  const hit = lastSearchHits.find(h => h.id === card.dataset.id);
  if (!hit) return;
  const link = card.querySelector('.rc-open');
  if (link) link.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // allow native open-in-new-tab
    e.preventDefault(); openDrawer(hit);
  });
  const citeBtn = card.querySelector('.rc-cite-btn');
  if (citeBtn) citeBtn.addEventListener('click', (e) => { e.stopPropagation(); copyResultCite(hit, citeBtn); });
}
// (Re)draw the "Show more" pager at the end of the list.
function renderMoreButton(shown, total) {
  const old = document.getElementById('rc-more-btn'); if (old) old.remove();
  if (shown >= total) return;
  const remaining = total - shown;
  const list = document.getElementById('results-list');
  list.insertAdjacentHTML('beforeend',
    `<button type="button" class="rc-more" id="rc-more-btn">Show ${Math.min(RESULTS_PAGE_SIZE, remaining).toLocaleString()} more` +
    `<span class="rc-more-count">${shown.toLocaleString()} of ${total.toLocaleString()} shown</span></button>`);
  const moreBtn = document.getElementById('rc-more-btn');
  if (moreBtn) moreBtn.addEventListener('click', () => loadMoreResults(moreBtn));
}

// Fetch + append the next page of results, keeping keyboard focus on the first new card.
async function loadMoreResults(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  const prevCount = lastSearchHits.length;
  try {
    const data = await search(lastSearchQuery, prevCount);
    const newHits = data.hits || [];
    lastSearchHits = lastSearchHits.concat(newHits);
    lastSearchTotal = data.estimatedTotalHits || lastSearchTotal;
    // Append only the new page instead of re-rendering the whole accumulated list
    // (which blanked the list under the user's scroll and rebuilt every card).
    const list = document.getElementById('results-list');
    const oldMore = document.getElementById('rc-more-btn'); if (oldMore) oldMore.remove();
    newHits.forEach(hit => list.insertAdjacentHTML('beforeend', resultCardHTML(hit)));
    const cards = list.querySelectorAll('.result-card');
    for (let i = prevCount; i < cards.length; i++) bindResultCard(cards[i]);
    renderMoreButton(lastSearchHits.length, lastSearchTotal);
    const firstNew = cards[prevCount] && cards[prevCount].querySelector('.rc-open');
    if (firstNew) firstNew.focus();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Show more'; }
  }
}

// ── READER PAGE ───────────────────────────────────────────────────────────────
function renderReaderPage(hit) {
  cacheDocumentForNewTab(hit);
  document.body.classList.add('reader-mode');
  document.body.style.overflow = '';
  document.title = `${hit.title || 'Document'} — AcqVault`;

  const citation = generateCitation(hit);
  const readerTitle = document.getElementById('reader-title');
  readerTitle.textContent = hit.title || 'Document';
  // Move keyboard/SR focus into the reader so users aren't stranded on now-hidden results.
  readerTitle.setAttribute('tabindex', '-1');
  readerTitle.focus({ preventScroll: true });
  document.getElementById('reader-meta').innerHTML = `${sourceTag(hit.source)} ${badgeTag(hit.status)}`;
  document.getElementById('reader-cite').textContent = citation;
  document.getElementById('reader-aside-cite').textContent = citation;
  document.getElementById('reader-file').textContent = hit.filename || '';
  document.getElementById('reader-source').textContent = SOURCE_LABELS[hit.source] || hit.source || '—';
  document.getElementById('reader-part').textContent = hit.part ? `${partWord(hit.source)} ${displayPartForSource(hit.source, hit.part)}` : '—';

  const original = document.getElementById('reader-original');
  // Compass official source is CAC-gated — don't send users to a 403 wall.
  const sourceUrl = hit.source === 'compass' ? '' : (SOURCE_URLS[hit.source] || '');
  original.href = sourceUrl || '#';
  original.style.display = sourceUrl ? '' : 'none';

  // Load full part, then scroll to the specific section
  loadFullPartInReader(hit);
}

// Render hits into the full-page reader through the SAME pipeline as the browse
// pane (buildReaderHTML) so "open in new tab" reads exactly like Browse by
// Regulation — part banner, Contents, serif section headers, nested para cites.
// The reader topbar has its own find-in-document, so drop the injected in-part
// search bar (it would be unwired here — polish.js only watches the browse pane).
function renderReaderAsBrowse(contentEl, hits, source, partNum, partLabel) {
  contentEl.innerHTML = buildReaderHTML(hits, source, partNum, partLabel, hits.length);
  contentEl.querySelector('#br-part-search')?.remove();
}

async function loadFullPartInReader(hit) {
  const contentEl = document.getElementById('reader-content');
  contentEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const dispPart = displayPartForSource(hit.source, hit.part);
  const partLabel = (PARTS_BY_SOURCE[hit.source] || []).find(([n]) => String(n) === String(dispPart))?.[1] || '';
  // FMR: render just the clicked chapter (the readable unit), not the whole large volume.
  if (hit.source === 'fmr') {
    renderReaderAsBrowse(contentEl, [hit], 'fmr', dispPart, fmrChapterLabel(hit));
    return;
  }
  try {
    const indexPart = indexPartForSource(hit.source, hit.part);
    const allHits = [];
    const pageSize = 200;
    let offset = 0;
    while (true) {
      const data = await meiliSearch({
        q: '', limit: pageSize, offset,
        filter: `source = "${hit.source}" AND part = "${indexPart}"`,
        attributesToRetrieve: ['id','title','content','source','part','status','date','filename','url'],
      });
      const page = data.hits || [];
      allHits.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    if (!allHits.length) {
      renderReaderAsBrowse(contentEl, [hit], hit.source, dispPart, partLabel);
      return;
    }
    renderReaderAsBrowse(contentEl, allHits, hit.source, dispPart, partLabel);
    resetReaderSearch();
    // Scroll to the clicked section after render (buildReaderHTML anchors are sec-<id>).
    // "Open in new tab" often opens BACKGROUNDED (middle-click): smooth scrolls are
    // deferred in hidden tabs, so land instantly there — the tab is already positioned
    // on the section when the user switches to it.
    const target = document.getElementById(`sec-${hit.id}`);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: document.hidden ? 'instant' : 'smooth', block: 'start' }), 100);
  } catch(e) {
    renderReaderAsBrowse(contentEl, [hit], hit.source, dispPart, partLabel);
    resetReaderSearch();
  }
}

function filterReaderContent(q) {
  const countEl = document.getElementById('reader-search-count');
  const clearBtn = document.getElementById('reader-search-clear');
  const result = filterContentRows('#reader-content', q, countEl);
  clearBtn.classList.toggle('visible', Boolean(q.trim()));
  if (q.trim() && result.firstMatch) {
    result.firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function resetReaderSearch() {
  const input = document.getElementById('reader-search-input');
  const countEl = document.getElementById('reader-search-count');
  const clearBtn = document.getElementById('reader-search-clear');
  if (input) input.value = '';
  if (countEl) countEl.classList.remove('visible');
  if (clearBtn) clearBtn.classList.remove('visible');
  const content = document.getElementById('reader-content');
  if (content) content.classList.remove('is-filtered');
  contentFilterRows('#reader-content').forEach(el => el.style.display = '');
}

function renderReaderError() {
  document.body.classList.add('reader-mode');
  document.body.style.overflow = '';
  document.getElementById('reader-page').innerHTML = `
    <div class="reader-empty">
      <strong>Document unavailable</strong>
      This reader link could not load the selected source text. Try opening the result from search again.
      <div style="margin-top:24px;"><a class="reader-action" href="/">Return to search</a></div>
    </div>`;
}

document.getElementById('reader-search-input').addEventListener('input', function() { filterReaderContent(this.value); });
document.getElementById('reader-search-clear').addEventListener('click', function() {
  resetReaderSearch();
  document.getElementById('reader-search-input').focus();
});

// ── DRAWER ────────────────────────────────────────────────────────────────────
// Focus management for dialogs (reader drawer, feedback modal): move focus in,
// trap Tab inside, restore focus to the trigger on close (WCAG 2.4.3 / 1.3.2).
let _focusTrapHandler = null, _focusReturnEl = null;
function _focusable(container) {
  return Array.prototype.slice.call(container.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null);
}
// Hide everything behind an open dialog from the AT virtual cursor (aria-modal
// support is inconsistent). Records what we inerted so we restore exactly that.
let _inertedEls = [];
function _setBackgroundInert(container) {
  _inertedEls = [];
  Array.prototype.forEach.call(document.body.children, function (el) {
    if (el === container || el.contains(container)) return;
    if (el.id === 'drawer-backdrop' || el.id === 'mobile-menu-backdrop') return;
    if (el.hasAttribute('inert')) return; // already inert (e.g. a closed dialog) — leave as-is
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
    _inertedEls.push(el);
  });
}
function _clearBackgroundInert() {
  _inertedEls.forEach(function (el) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); });
  _inertedEls = [];
}
function trapFocus(container) {
  releaseFocus();
  _focusReturnEl = document.activeElement;
  _setBackgroundInert(container);
  const items = _focusable(container);
  (items[0] || container).focus();
  _focusTrapHandler = function (e) {
    if (e.key !== 'Tab') return;
    const f = _focusable(container);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', _focusTrapHandler, true);
}
function releaseFocus() {
  if (_focusTrapHandler) { document.removeEventListener('keydown', _focusTrapHandler, true); _focusTrapHandler = null; }
  _clearBackgroundInert(); // restore the background BEFORE returning focus (can't focus an inert el)
  if (_focusReturnEl && typeof _focusReturnEl.focus === 'function') { try { _focusReturnEl.focus(); } catch (_) {} }
  _focusReturnEl = null;
}

function openDrawer(hit) {
  activeDocId = hit.id; currentHit = hit;
  cacheDocumentForNewTab(hit);
  document.getElementById('drawer-title').textContent  = hit.title || 'Document';
  document.getElementById('drawer-source').textContent = SOURCE_LABELS[hit.source] || hit.source;
  document.getElementById('drawer-part').textContent   = hit.part ? `${partWord(hit.source)} ${displayPartForSource(hit.source, hit.part)}` : '—';
  document.getElementById('drawer-file').textContent   = hit.filename || '—';
  const drawerAsof = document.getElementById('drawer-asof');
  if (drawerAsof) drawerAsof.textContent = hit.indexed_at ? fmtAsOf(hit.indexed_at) : '—';
  const citation = generateCitation(hit);
  document.getElementById('cite-text').textContent = citation;
  const copyBtn = document.getElementById('cite-copy-btn');
  copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied');
  copyBtn.onclick = () => copyCitation(citation, copyBtn);
  const linkBtn = document.getElementById('cite-link-btn');
  if (linkBtn) {
    linkBtn.textContent = 'Copy link'; linkBtn.classList.remove('copied');
    linkBtn.onclick = () => copyTextTo(window.location.href, linkBtn, 'Copy link');
  }
  document.getElementById('drawer-meta').innerHTML = `${sourceTag(hit.source)} ${badgeTag(hit.status)}`;
  renderDrawerDeviation(hit);
  loadDeviations().then(() => { if (activeDocId === hit.id) renderDrawerDeviation(hit); });
  const drawerOrig = document.getElementById('drawer-orig');
  if (hit.source === 'compass') { drawerOrig.style.display = 'none'; }
  else { drawerOrig.style.display = ''; drawerOrig.href = hit.url || SOURCE_URLS[hit.source] || '#'; }
  const newTabUrl = new URL(window.location.href);
  newTabUrl.searchParams.set('view', 'reader');
  newTabUrl.searchParams.set('doc', hit.id);
  if (hit.source) newTabUrl.searchParams.set('source', hit.source);
  if (hit.part) newTabUrl.searchParams.set('part', hit.part);
  if (hit.title) newTabUrl.searchParams.set('title', hit.title);
  document.getElementById('drawer-newtab').href = newTabUrl.toString();
  resetDrawerFilter();
  const drawer = document.getElementById('drawer');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  drawer.inert = false;
  document.getElementById('drawer-backdrop').classList.add('visible');
  document.body.style.overflow = 'hidden';
  trapFocus(drawer);
  document.querySelectorAll('.result-card').forEach(c => c.classList.toggle('active', c.dataset.id === hit.id));
  if (!document.body.classList.contains('reader-mode')) setDocParams(hit);
  // Load full part then scroll to this section
  loadFullPartInDrawer(hit);
  document.dispatchEvent(new CustomEvent('acqvault:draweropen', { detail: hit }));
}

async function loadFullPartInDrawer(hit) {
  const contentEl = document.getElementById('drawer-content');
  // Show the clicked section IMMEDIATELY — the words the CO searched for, no blank spinner —
  // then hydrate the rest of the part around it.
  contentEl.innerHTML =
    `<div id="drawer-sec-${hit.id}" class="drawer-full-section drawer-sec-active">${formatContent(hit.content || '', hit)}</div>` +
    `<div class="drawer-rest-loading">Loading the rest of this part…</div>`;
  // FMR is grouped by Volume but a Volume holds many large chapters; the chapter is the
  // readable unit, so show just the clicked chapter rather than hydrating the whole volume.
  if (hit.source === 'fmr') {
    const lr = contentEl.querySelector('.drawer-rest-loading'); if (lr) lr.remove();
    return;
  }
  try {
    const indexPart = indexPartForSource(hit.source, hit.part);
    const allHits = [];
    const pageSize = 200;
    let offset = 0;
    while (true) {
      const data = await meiliSearch({
        q: '', limit: pageSize, offset,
        filter: `source = "${hit.source}" AND part = "${indexPart}"`,
        attributesToRetrieve: ['id','title','content','source','part','status','date','filename','url'],
      });
      const page = data.hits || [];
      allHits.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    if (activeDocId !== hit.id) return;   // user opened another clause while loading — don't clobber
    if (!allHits.length) {                // nothing more to load — keep the section already shown
      const lr = contentEl.querySelector('.drawer-rest-loading'); if (lr) lr.remove();
      return;
    }
    let html = '';
    allHits.forEach(h => {
      html += `<div id="drawer-sec-${h.id}" class="drawer-full-section${h.id === hit.id ? ' drawer-sec-active' : ''}">${formatContent(h.content || '', h)}</div>`;
    });
    contentEl.innerHTML = html;
    // Restore the CO to the section they clicked, instantly (no smooth jump).
    const target = document.getElementById(`drawer-sec-${hit.id}`);
    if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
  } catch(e) {
    const lr = contentEl.querySelector('.drawer-rest-loading'); if (lr) lr.remove();  // keep the instant section
  }
}

function closeDrawer() {
  activeDocId = null; currentHit = null;
  if (!document.body.classList.contains('reader-mode')) setDocParams(null);
  const drawer = document.getElementById('drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.inert = true;
  document.getElementById('drawer-backdrop').classList.remove('visible');
  document.body.style.overflow = '';
  document.querySelectorAll('.result-card').forEach(c => c.classList.remove('active'));
  resetDrawerFilter();
  releaseFocus();
}

function copyTextTo(text, btn, label) {
  const done = () => {
    btn.textContent = 'Copied!'; btn.classList.add('copied');
    srAnnounce('Copied to clipboard');
    setTimeout(() => { btn.textContent = label; btn.classList.remove('copied'); }, 2200);
  };
  navigator.clipboard.writeText(text).then(done).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); done();
  });
}
function copyCitation(citation, btn) { copyTextTo(citation, btn, 'Copy'); }

// ── Deviation crosswalk: mechanical pointer from a clause's part to the DoD class deviation ──
let DEVIATIONS = null, deviationsPromise = null;
function loadDeviations() {
  if (DEVIATIONS) return Promise.resolve(DEVIATIONS);
  if (deviationsPromise) return deviationsPromise;
  deviationsPromise = fetch('/output/deviations.json')
    .then(r => r.ok ? r.json() : [])
    .then(j => { DEVIATIONS = Array.isArray(j) ? j : []; return DEVIATIONS; })
    .catch(() => { DEVIATIONS = []; return DEVIATIONS; });
  return deviationsPromise;
}
function deviationFor(hit) {
  if (!hit || !DEVIATIONS) return null;
  if (hit.source !== 'rfo' && hit.source !== 'r-dfars') return null;
  // Match on the DISPLAYED part: RFO shows e.g. "6", R-DFARS shows the DFARS number e.g. "203".
  const disp = (typeof displayPartForSource === 'function') ? displayPartForSource(hit.source, hit.part) : hit.part;
  const p = String(disp || '').split(/[.\- ]/)[0].trim();
  if (!p) return null;
  return DEVIATIONS.find(d => hit.source === 'rfo' ? String(d.rfo_part) === p : String(d.dfars_part) === p) || null;
}
function renderDrawerDeviation(hit) {
  const el = document.getElementById('drawer-deviation');
  if (!el) return;
  const d = deviationFor(hit);
  if (!d) { el.hidden = true; el.innerHTML = ''; return; }
  const memo = d.pdf_url ? ` · <a href="${esc(d.pdf_url)}" target="_blank" rel="noopener">signed memo ↗</a>` : '';
  el.innerHTML = `<span class="dev-tag">DoD class deviation</span>` +
    `<span class="dev-body">DARS ${esc(d.dars)} · effective ${esc(d.effective)} · RFO Part ${esc(d.rfo_part)} ↔ legacy DFARS Part ${esc(d.dfars_part)}${memo}` +
    `<span class="dev-verify">Mechanical pointer — confirm against the official source.</span></span>`;
  el.hidden = false;
}
loadDeviations(); // warm the small (~14KB) crosswalk on load

document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
// Leave the reader: prefer same-site back, else go home. Wired to the Back control and Esc.
function exitReader() {
  try {
    if (document.referrer && new URL(document.referrer).origin === location.origin && window.history.length > 1) {
      window.history.back();
      return;
    }
  } catch (e) {}
  window.location.href = '/';
}
(function wireReaderBack() {
  const rb = document.getElementById('reader-back');
  if (rb) rb.addEventListener('click', exitReader);
})();
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeDrawer(); closeFeedback();
  if (document.body.classList.contains('reader-mode')) {
    const ri = document.getElementById('reader-search-input');
    if (ri && document.activeElement === ri && ri.value) { ri.value = ''; ri.dispatchEvent(new Event('input')); return; }
    exitReader();
  }
});

// ── Keyboard: "/" or ⌘K / Ctrl-K focuses search from anywhere ─────────────────
document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable);
  const cmdK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
  const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !inField;
  if (!cmdK && !slash) return;
  if (document.body.classList.contains('reader-mode')) return;
  const fb = document.getElementById('feedback-modal');
  if (fb && fb.classList.contains('open')) return;
  e.preventDefault();
  const drawer = document.getElementById('drawer');
  if (drawer && drawer.classList.contains('open')) closeDrawer();
  const si = document.getElementById('search-input');
  if (!si) return;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => { si.focus(); si.select(); }, 160);
});

// ── SEARCH INPUT & LIFECYCLE ──────────────────────────────────────────────────
const hero           = document.getElementById('hero');
const resultsSection = document.getElementById('results-section');
const searchInput    = document.getElementById('search-input');
const searchCount    = document.getElementById('search-count');
const searchClear    = document.getElementById('search-clear');

// ── URL state sync — shareable / bookmarkable searches + clause links ─────────
function activeSourceParam() {
  return (activeSources && activeSources.size) ? Array.from(activeSources).sort().join(',') : '';
}
function setSearchParams(q) {
  try {
    const url = new URL(window.location.href);
    if (q) { url.searchParams.set('q', q); const s = activeSourceParam(); s ? url.searchParams.set('src', s) : url.searchParams.delete('src'); }
    else { ['q', 'src'].forEach(k => url.searchParams.delete(k)); }
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch (e) {}
}
function setDocParams(hit) {
  try {
    const url = new URL(window.location.href);
    if (hit) {
      url.searchParams.set('doc', hit.id);
      hit.source ? url.searchParams.set('source', hit.source) : url.searchParams.delete('source');
      hit.part ? url.searchParams.set('part', hit.part) : url.searchParams.delete('part');
      hit.title ? url.searchParams.set('title', hit.title) : url.searchParams.delete('title');
    } else {
      ['doc', 'source', 'part', 'title', 'view'].forEach(k => url.searchParams.delete(k));
    }
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch (e) {}
}
function restoreFiltersFromParam(srcStr) {
  const wanted = String(srcStr || '').split(',').map(s => s.trim()).filter(Boolean);
  const valid = new Set(Array.from(document.querySelectorAll('#source-filters .fpill[data-source]'))
    .map(p => p.dataset.source).filter(s => s && s !== 'all'));
  activeSources.clear();
  wanted.forEach(s => { if (valid.has(s)) activeSources.add(s); });
  document.querySelectorAll('#source-filters .fpill').forEach(p => {
    const s = p.dataset.source;
    const on = s === 'all' ? activeSources.size === 0 : activeSources.has(s);
    p.classList.toggle('active', on); p.setAttribute('aria-pressed', String(on));
  });
}

async function runSearch(options = {}) {
  const preserveScroll = Boolean(options.preserveScroll);
  const q = searchInput.value.trim();
  if (!q) { deactivateSearch(); return; }
  if (currentMode !== 'search') setMode('search');
  activateSearch({ scrollToTop: !preserveScroll });
  const resultsList = document.getElementById('results-list');
  resultsList.setAttribute('aria-busy', 'true'); // tell AT a fetch is in progress
  resultsList.innerHTML = Array.from({ length: 4 }, () => '<div class="skel-card"><div class="skel-line skel-tag"></div><div class="skel-line skel-title"></div><div class="skel-line skel-snippet"></div><div class="skel-line skel-snippet short"></div></div>').join('');
  try {
    const data = await search(q, 0);
    lastSearchQuery = q;
    lastSearchHits = data.hits || [];
    lastSearchTotal = data.estimatedTotalHits || lastSearchHits.length;
    renderResults({ hits: lastSearchHits, estimatedTotalHits: lastSearchTotal }, q);
    setSearchParams(q);
    showAcronymAssist(q);
    document.dispatchEvent(new CustomEvent('acqvault:searched', { detail: { q: q } }));
    const total = data.estimatedTotalHits || (data.hits || []).length;
    searchCount.textContent = total ? `${total} results` : '';
  } catch (e) {
    const msg = e && e.message ? e.message : 'Please try again.';
    resultsList.innerHTML = '<div class="no-results"><strong>Search unavailable</strong>' + esc(msg) + '</div>';
    searchCount.textContent = '';
  } finally {
    resultsList.setAttribute('aria-busy', 'false');
  }
}

function activateSearch({ scrollToTop = false } = {}) {
  document.body.classList.add('work-mode');
  hero.classList.add('search-active'); hero.classList.remove('browse-active','fulltext-active');
  resultsSection.classList.add('visible');
  document.getElementById('browse-section').classList.remove('visible');
  document.getElementById('fulltext-section').classList.remove('visible');
  searchClear.classList.add('visible');
  adjustNavForAboutBar(); // the about-bar is display:none in work-mode → reclaim its height
  if (window.acqUpdateNav) window.acqUpdateNav(); // drop the dark over-hero nav in work-mode
  if (scrollToTop) requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function deactivateSearch() {
  document.body.classList.remove('work-mode');
  adjustNavForAboutBar(); // about-bar returns on the landing → restore its offset
  hero.classList.remove('search-active'); resultsSection.classList.remove('visible');
  searchClear.classList.remove('visible'); searchCount.textContent = ''; closeDrawer();
  var asEl = document.getElementById('acr-suggest'); if (asEl) { asEl.hidden = true; asEl.innerHTML = ''; }
  setSearchParams('');
  if (window.acqUpdateNav) window.acqUpdateNav(); // restore dark over-hero nav on the landing
}

searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  if (!searchInput.value.trim()) { deactivateSearch(); return; }
  debounceTimer = setTimeout(runSearch, 300);
});
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(debounceTimer); if (searchInput.value.trim()) runSearch(); } });
searchClear.addEventListener('click', () => { searchInput.value = ''; deactivateSearch(); searchInput.focus(); });

// ── Work-mode nav guard: home-section links restore the landing before the anchor scroll ──
// (work-mode hides the landing sections, so the target must be revealed first)
function exitToLanding() {
  clearTimeout(debounceTimer);
  if (searchInput.value.trim()) searchInput.value = '';
  deactivateSearch();
  if (currentMode !== 'search') setMode('search');
}
window.acqExitToLanding = exitToLanding;
(function () {
  const nc = document.getElementById('nav-center');
  if (nc) nc.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || !document.body.classList.contains('work-mode')) return;
    exitToLanding(); // sections are visible again before the browser's native anchor scroll runs
  });
})();
// Home, from anywhere in the app: the nav logo and the Home nav link exit the
// active view in place (no reload) and land on the hero. Plain left-clicks are
// handled here; modified clicks / new tabs fall through to the href (/?home=1),
// which the boot code resolves to the hero regardless of this tab's saved view.
(function () {
  function goHome(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    e.preventDefault();
    exitToLanding();
    try { history.replaceState(history.state, '', '/'); } catch (err) {}
    window.scrollTo({ top: 0, behavior: document.hidden ? 'instant' : 'smooth' });
  }
  document.querySelectorAll('.nav-logo, #nav-home').forEach(el => el.addEventListener('click', goHome));
})();
(function () {
  const as = document.getElementById('acr-suggest');
  if (as) as.addEventListener('click', (e) => {
    const b = e.target.closest('.acr-go'); if (!b) return;
    searchInput.value = b.dataset.exp; runSearch(); searchInput.focus();
  });
})();

// ── Restore from URL on load: ?q= (+ ?src=) search, then ?doc= clause/reader ──
(async function restoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  // ?home=1 is the explicit "take me to the hero" signal (nav logo, the Home links
  // on the server-rendered pages). It must beat every restore — a plain "/" boot
  // re-enters whatever view this tab last had open, so without the signal clicking
  // the logo from Browse would land right back in Browse.
  if (params.has('home')) {
    try { sessionStorage.setItem('acq-view-v1', 'search'); } catch (e) {}
    try { history.replaceState(null, '', '/'); } catch (e) {}
    return;
  }
  const q = params.get('q');
  const docId = params.get('doc');
  const readerMode = params.get('view') === 'reader';
  // The view the user LEFT OPEN wins over URL leftovers: an earlier search in the
  // tab's life leaves ?q= behind, and on a discard-reload that stale q used to
  // hijack the boot into search-at-top while the user was deep in the browse reader.
  let savedView = null;
  try { savedView = sessionStorage.getItem('acq-view-v1'); } catch (e) {}
  if (savedView === 'browse' && !readerMode && await restoreBrowseState()) return;
  // No shareable search/reader in the URL → this may be a discarded browse tab
  // Chrome just reloaded. Re-enter the last browse view (source/part/scroll) —
  // unless the tab had explicitly moved on to another view (search/fulltext).
  if (!q && !docId) {
    if (savedView !== 'search' && savedView !== 'fulltext') await restoreBrowseState();
    return;
  }
  if (q && !readerMode) {
    const src = params.get('src');
    if (src) restoreFiltersFromParam(src);
    searchInput.value = q;
    try { await runSearch(); } catch (e) {}
  }
  if (!docId) return;
  if (readerMode) { document.body.classList.add('reader-mode'); document.body.style.overflow = ''; }
  try {
    const hit = await fetchDocumentById(docId, {
      source: params.get('source'), part: params.get('part'), title: params.get('title')
    });
    if (hit) { if (readerMode) renderReaderPage(hit); else openDrawer(hit); }
    else if (readerMode) renderReaderError();
  } catch (e) { if (readerMode) renderReaderError(); }
})();

// ── FILTERS ───────────────────────────────────────────────────────────────────
document.getElementById('source-filters').addEventListener('click', e => {
  const pill    = e.target.closest('.fpill');
  if (!pill || pill.classList.contains('disabled')) return;
  const src     = pill.dataset.source;
  const allPill = document.querySelector('#source-filters .fpill[data-source="all"]');
  if (src === 'all') {
    activeSources.clear();
    document.querySelectorAll('#source-filters .fpill').forEach(p => p.classList.remove('active'));
    allPill.classList.add('active');
  } else {
    if (activeSources.has(src)) { activeSources.delete(src); pill.classList.remove('active'); }
    else { activeSources.add(src); pill.classList.add('active'); }
    allPill.classList.toggle('active', activeSources.size === 0);
  }
  document.querySelectorAll('#source-filters .fpill').forEach(p => p.setAttribute('aria-pressed', String(p.classList.contains('active'))));
  if (searchInput.value.trim()) runSearch({ preserveScroll: true });
});

// Status filters removed

// ── ABOUT BAR ─────────────────────────────────────────────────────────────────
function dismissAbout() {
  try { localStorage.setItem('acqvault_about_dismissed', '1'); } catch (e) {}
  const bar = document.getElementById('about-bar');
  const nav = document.getElementById('main-nav');
  bar.style.transform = 'translateY(-100%)'; bar.style.opacity = '0';
  nav.style.top = '0';
  document.documentElement.style.setProperty('--top-chrome', `${nav.offsetHeight}px`);
  setTimeout(() => bar.remove(), 340);
}

// ── FEEDBACK MODAL ────────────────────────────────────────────────────────────
function openFeedback() {
  document.getElementById('feedback-form').style.display = '';
  document.getElementById('feedback-success').style.display = 'none';
  const btn = document.getElementById('fb-submit');
  btn.textContent = 'Send Feedback'; btn.disabled = false;
  const modal = document.getElementById('feedback-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.inert = false;
  document.body.style.overflow = 'hidden';
  trapFocus(modal);
}
function closeFeedback() {
  const modal = document.getElementById('feedback-modal');
  modal.inert = true;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.getElementById('drawer').classList.contains('open')) document.body.style.overflow = '';
  releaseFocus();
}
document.getElementById('feedback-modal').addEventListener('click', e => { if (e.target === document.getElementById('feedback-modal')) closeFeedback(); });
document.getElementById('feedback-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('fb-submit');
  const errEl = document.getElementById('feedback-error');
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.hidden = false; } };
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  const message = document.getElementById('fb-message').value.trim();
  if (!message) { showErr('Please add a message first.'); return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch(FEEDBACK_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('fb-name').value.trim() || 'Anonymous',
        email: document.getElementById('fb-email').value.trim() || '',
        message
      })
    });
    if (res.ok) {
      document.getElementById('feedback-form').style.display = 'none';
      document.getElementById('feedback-success').style.display = 'block';
      ['fb-name','fb-email','fb-message'].forEach(id => document.getElementById(id).value = '');
      setTimeout(closeFeedback, 3200);
    } else {
      const data = await res.json().catch(() => ({}));
      btn.disabled = false; btn.textContent = 'Send Feedback';
      showErr(data.error || 'Could not send right now — please try again.');
    }
  } catch {
    btn.disabled = false; btn.textContent = 'Send Feedback';
    showErr('Could not send — check your connection and try again.');
  }
});

// ── (particle canvas removed — generic decoration + a continuous O(n²) loop) ───

// ── TYPING ANIMATION ──────────────────────────────────────────────────────────
const QUERIES=[["sole source justification","47"],["RFO 6.302-1 only one source","23"],["simplified acquisition threshold","61"],["R-DFARS class deviation 2025","18"],["DoD FMR volume 3 payments","34"],["DAFI 63-138 services acquisition","12"],["other than full and open competition","34"],["undefinitized contract action","12"]];
let qi=0,ci=0,del=false;
function tick(){const el=document.getElementById('btyping'),rc=document.getElementById('bcount');if(!el)return;const[q,cnt]=QUERIES[qi];if(!del){el.textContent=q.slice(0,ci+1);ci++;if(ci===q.length){del=true;rc.textContent=cnt+' results';setTimeout(tick,2200);return;}setTimeout(tick,52);}else{el.textContent=q.slice(0,ci-1);ci--;if(ci===0){del=false;rc.textContent='— results';qi=(qi+1)%QUERIES.length;setTimeout(tick,380);return;}setTimeout(tick,26);}}
setTimeout(tick,900);

// ── SCROLL FADE-IN ────────────────────────────────────────────────────────────
// (Handled by the staggered reveal observer at the top of this file; this
//  duplicate is intentionally disabled so it doesn't race the cascade delays.)

// ── REGULATION NEWS FEED ──────────────────────────────────────────────────────
async function loadNewsFeed() {
  const el = document.getElementById('news-feed-list');
  if (!el) return;
  try {
    // Fetch latest RFO-related documents from Federal Register API
    const res = await fetch(
      'https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=defense-acquisition-regulations-system&conditions[agencies][]=office-of-the-under-secretary-of-defense-for-acquisition-and-sustainment&per_page=5&order=newest&fields[]=title&fields[]=publication_date&fields[]=type&fields[]=document_number&fields[]=html_url',
      { mode: 'cors' }
    );
    if (!res.ok) throw new Error('FR API unavailable');
    const data = await res.json();
    const docs = data.results || [];
    if (!docs.length) throw new Error('No results');

    const typeLabel = (t) => {
      if (!t) return { label: 'Notice', cls: 'nfi-type-other' };
      const tl = t.toLowerCase();
      if (tl.includes('proposed')) return { label: 'Proposed Rule', cls: 'nfi-type-proposed' };
      if (tl.includes('interim') || tl.includes('rule')) return { label: 'Interim Rule', cls: 'nfi-type-interim' };
      if (tl.includes('final')) return { label: 'Final Rule', cls: 'nfi-type-final' };
      return { label: t, cls: 'nfi-type-other' };
    };

    const fmtDate = (d) => {
      if (!d) return '';
      const dt = new Date(d + 'T00:00:00');
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    el.innerHTML = docs.map(doc => {
      const { label, cls } = typeLabel(doc.type);
      return `<a class="news-feed-item" href="${doc.html_url || '#'}" target="_blank" rel="noopener">
        <div class="nfi-date">${fmtDate(doc.publication_date)}</div>
        <div class="nfi-body">
          <div class="nfi-title">${esc(doc.title || 'Untitled')}</div>
          <div class="nfi-meta">
            <span class="nfi-type ${cls}">${label}</span>
            <span class="nfi-doc">${esc(doc.document_number || '')}</span>
          </div>
        </div>
      </a>`;
    }).join('') + `<div class="news-feed-footer"><a href="https://www.federalregister.gov/agencies/defense-acquisition-regulations-system" target="_blank" rel="noopener">View all on Federal Register →</a></div>`;
  } catch(e) {
    // Fallback: show curated static items
    el.innerHTML = `
      <a class="news-feed-item" href="https://www.federalregister.gov/documents/search?conditions%5Bagencies%5D%5B%5D=defense-acquisition-regulations-system" target="_blank" rel="noopener">
        <div class="nfi-date">Live</div>
        <div class="nfi-body">
          <div class="nfi-title">View latest RFO / R-DFARS updates</div>
          <div class="nfi-meta"><span class="nfi-type nfi-type-other">Federal Register</span></div>
        </div>
      </a>
      <div class="news-feed-footer"><a href="https://www.federalregister.gov/agencies/defense-acquisition-regulations-system" target="_blank" rel="noopener">Open Federal Register →</a></div>
    `;
  }
}









// ── HERO LEADERSHIP QUOTE ────────────────────────────────────────────────────
const HERO_QUOTES = [
  { q: 'Before you achieve, everyone will ask you why you are working so hard. After you achieve, everyone will remind you how lucky you got.', a: 'AcqVault' },
  { q: 'The standard you walk past is the standard you accept.', a: 'David Morrison' },
  { q: 'Great leaders do not create followers. They create more leaders.', a: 'Tom Peters' },
  { q: 'Discipline is choosing what you want most over what you want now.', a: 'Unknown' },
  { q: 'The credit belongs to the one who is actually in the arena.', a: 'Theodore Roosevelt' },
  { q: 'Plans are worthless, but planning is everything.', a: 'Dwight D. Eisenhower' },
  { q: 'What you do has far greater impact than what you say.', a: 'Stephen Covey' },
  { q: 'Management is doing things right; leadership is doing the right things.', a: 'Peter Drucker' },
  { q: 'Well done is better than well said.', a: 'Benjamin Franklin' },
  { q: 'Action expresses priorities.', a: 'Mahatma Gandhi' },
  { q: 'It always seems impossible until it is done.', a: 'Nelson Mandela' },
  { q: 'You do not rise to the level of your goals. You fall to the level of your systems.', a: 'James Clear' },
  { q: 'Never confuse motion with action.', a: 'Benjamin Franklin' },
  { q: 'If everything is a priority, nothing is a priority.', a: 'Unknown' },
  { q: 'Slow is smooth, and smooth is fast.', a: 'Military proverb' },
  { q: 'Trust is built in drops and lost in buckets.', a: 'Kevin Plank' },
  { q: 'The obstacle is the way.', a: 'Marcus Aurelius' },
  { q: 'The main thing is to keep the main thing the main thing.', a: 'Stephen Covey' },
  { q: 'Decisions are easy when values are clear.', a: 'Roy Disney' },
  { q: 'Excellence is not an act, but a habit.', a: 'Will Durant' },
  { q: 'Do what you can, with what you have, where you are.', a: 'Theodore Roosevelt' },
  { q: 'The best way out is always through.', a: 'Robert Frost' },
  { q: 'Luck is what happens when preparation meets opportunity.', a: 'Seneca' },
  { q: 'The price of greatness is responsibility.', a: 'Winston Churchill' },
  { q: 'A goal without a plan is just a wish.', a: 'Antoine de Saint-Exupery' },
  { q: 'Pressure is a privilege.', a: 'Billie Jean King' },
  { q: 'Own the outcome, not just the task.', a: 'Unknown' },
  { q: 'Prepared people make difficult work look simple.', a: 'Unknown' },
  { q: 'The meeting is not the work. The work is the work.', a: 'Unknown' },
  { q: 'A calm mind is a strategic advantage.', a: 'Unknown' },
  { q: 'Speed matters, but direction matters more.', a: 'Unknown' },
  { q: 'Competence is quiet. It does not need a parade.', a: 'Unknown' },
  { q: 'If the mission matters, the details matter.', a: 'Unknown' },
  { q: 'A clear requirement is a gift to everyone downstream.', a: 'Unknown' },
  { q: 'Readiness is built before it is needed.', a: 'Unknown' },
  { q: 'A leader absorbs confusion and returns clarity.', a: 'Unknown' }
];
const AFFIRMATIONS = [
  { q: 'You are doing your best, and the acquisition package has chosen not to notice.', a: 'Affirmation' },
  { q: 'The requirement is clear enough to proceed and vague enough to return later with consequences.', a: 'Affirmation' },
  { q: 'Today, may your suspense be real and your stakeholder be findable.', a: 'Affirmation' },
  { q: 'The contract file is not complete, but it has developed confidence.', a: 'Affirmation' },
  { q: 'You are one attachment away from temporary peace, which is how the system keeps you humble.', a: 'Affirmation' },
  { q: 'The meeting could have been an email, but the email wanted witnesses.', a: 'Affirmation' },
  { q: 'Your market research is defensible, even if it was assembled under emotional procurement conditions.', a: 'Affirmation' },
  { q: 'The acquisition strategy is alive, and it has started requesting snacks.', a: 'Affirmation' },
  { q: 'You can do hard things, including explaining for the third time that urgent is not a funding source.', a: 'Affirmation' },
  { q: 'The procurement package has entered its comments era.', a: 'Affirmation' },
  { q: 'A clean requirement is possible. We honor that possibility from a safe distance.', a: 'Affirmation' },
  { q: 'You are not behind. The baseline simply left without filing a travel voucher.', a: 'Affirmation' },
  { q: 'The clause matrix is not judging you. It is just disappointed in several rows.', a: 'Affirmation' },
  { q: 'Today is full of opportunities to lower acquisition risk and personal expectations.', a: 'Affirmation' },
  { q: 'The plan is defensible, which is sometimes the most romantic thing a plan can be.', a: 'Affirmation' },
  { q: 'Some risks are accepted. Others are pretending to be assumptions.', a: 'Affirmation' },
  { q: 'Your draft has potential, which is what reviewers say before becoming weather.', a: 'Affirmation' },
  { q: 'The source selection plan is calm on paper, where many brave things live.', a: 'Affirmation' },
  { q: 'The requirement owner is aligned, pending whatever they say in the next meeting.', a: 'Affirmation' },
  { q: 'You are not overthinking. You are pre-answering the question Legal will ask at 4:47.', a: 'Affirmation' },
  { q: 'The contract action is moving, although in the way furniture moves during an office reorg.', a: 'Affirmation' },
  { q: 'The spreadsheet has hidden rows because the truth wanted privacy.', a: 'Affirmation' },
  { q: 'You are one clean citation away from sounding like this was always the plan.', a: 'Affirmation' },
  { q: 'The approval chain is long, but your follow-up language remains professionally restrained.', a: 'Affirmation' },
  { q: 'A good note to file is just future-you begging for mercy in complete sentences.', a: 'Affirmation' },
  { q: 'The acquisition timeline is compressed because optimism got access to PowerPoint.', a: 'Affirmation' },
  { q: 'Your independent government estimate is independent in spirit and estimated in self-defense.', a: 'Affirmation' },
  { q: 'The portal timing out is not personal. It treats everyone with the same quiet contempt.', a: 'Affirmation' },
  { q: 'This too shall pass, likely through two more coordination rounds.', a: 'Affirmation' },
  { q: 'The program office has a vision, and today you are converting it into paperwork with margins.', a: 'Affirmation' },
  { q: 'The answer is in the FAR, surrounded by several answers having a jurisdictional disagreement.', a: 'Affirmation' },
  { q: 'Your calm tone is doing important structural work in a room full of dependencies.', a: 'Affirmation' },
  { q: 'A concise email is a public service. A concise acquisition email is nearly mythological.', a: 'Affirmation' },
  { q: 'The budget drill found you because hiding was not included in the acquisition plan.', a: 'Affirmation' },
  { q: 'The milestone is green because the slide needed closure.', a: 'Affirmation' },
  { q: 'You have survived every urgent data call so far, which is technically past performance.', a: 'Affirmation' },
  { q: 'The procurement request is maturing, which means the acronyms have begun reproducing.', a: 'Affirmation' },
  { q: 'You are allowed to celebrate a complete PR, quietly, before finance asks a fair question.', a: 'Affirmation' },
  { q: 'The requirement changed overnight. This is unfortunate, but at least the tracker gets attention.', a: 'Affirmation' },
  { q: 'Your professionalism remains intact despite direct exposure to Reply All.', a: 'Affirmation' },
  { q: 'The final review is rarely final. The optimism is the important part.', a: 'Affirmation' },
  { q: 'The business clearance is close, a word doing significant unpaid labor.', a: 'Affirmation' },
  { q: 'You are not lost. You are conducting market research on possible directions.', a: 'Affirmation' },
  { q: 'A well-placed caveat can hold up a briefing longer than some funding lines.', a: 'Affirmation' },
  { q: 'The evaluation criteria are clear, except to the people evaluating them.', a: 'Affirmation' },
  { q: 'Today, may your assumptions be documented before they become office folklore.', a: 'Affirmation' },
  { q: 'The tracker is not judging you. It is presenting evidence with excellent formatting.', a: 'Affirmation' },
  { q: 'The acquisition team is aligned, apart from the parts involving people.', a: 'Affirmation' },
  { q: 'A complete package is possible. We choose to believe this for morale.', a: 'Affirmation' },
  { q: 'Your file naming convention is aspirational, and so are we.', a: 'Affirmation' },
  { q: 'The contract specialist knows. The contract specialist has always known.', a: 'Affirmation' },
  { q: 'Some comments improve the product. Others confirm the reviewer opened the file.', a: 'Affirmation' },
  { q: 'You did not miss the obvious. The obvious was hiding behind a local supplement.', a: 'Affirmation' },
  { q: 'The source selection note briefly restored order, which made everyone suspicious.', a: 'Affirmation' },
  { q: 'Your scope is stable, except for the parts currently stretching.', a: 'Affirmation' },
  { q: 'Procurement lead time is not a suggestion. It is a lifestyle with forms.', a: 'Affirmation' },
  { q: 'The answer may require a governance body, which is how simple questions build character.', a: 'Affirmation' },
  { q: 'The agenda was ambitious. Reality submitted a nonconcurrence.', a: 'Affirmation' },
  { q: 'The package has been routed. Now begins the ancient art of waiting professionally.', a: 'Affirmation' },
  { q: 'You are building a record, not merely surviving a Tuesday.', a: 'Affirmation' },
  { q: 'The estimate is rough, but it has cells and borders, so people will respect it.', a: 'Affirmation' },
  { q: 'The good idea survived coordination, which means it may be unusually sturdy.', a: 'Affirmation' },
  { q: 'The day has moving parts, and you have located enough of them to be useful.', a: 'Affirmation' },
  { q: 'Your decision memo is becoming clearer, despite the comments trying to unionize.', a: 'Affirmation' },
  { q: 'The approval is pending, which is Latin for check again after lunch.', a: 'Affirmation' },
  { q: 'You can be strategic and still care deeply whether the PDF is searchable.', a: 'Affirmation' },
  { q: 'The contract file believes in you, which is why it keeps requesting proof.', a: 'Affirmation' },
  { q: 'A small win is still a win, especially if nobody schedules a lessons-learned meeting.', a: 'Affirmation' },
  { q: 'You are one clean action item away from temporary alignment.', a: 'Affirmation' },
  { q: 'The briefing is almost final, a phrase best treated like a weather forecast.', a: 'Affirmation' },
  { q: 'The plan has risks, but at least they have names now.', a: 'Affirmation' },
  { q: 'You are not drowning in details. You are participating in immersive compliance.', a: 'Affirmation' },
  { q: 'The requirement is evolving. Please keep assumptions inside the vehicle.', a: 'Affirmation' },
  { q: 'Your notes are clear enough that tomorrow-you may briefly forgive today-you.', a: 'Affirmation' },
  { q: 'The contract is not awarded yet, but the documentation has a rich inner life.', a: 'Affirmation' },
  { q: 'The clause is mandatory. Your emotional response remains optional.', a: 'Affirmation' },
  { q: 'The package is not perfect, but it is no longer actively resisting civilization.', a: 'Affirmation' },
  { q: 'You made the complicated thing slightly less complicated. That counts more than it sounds.', a: 'Affirmation' },
  { q: 'The decision authority has questions, which means the slide deck is breathing.', a: 'Affirmation' },
  { q: 'Your file is organized enough to make an auditor curious.', a: 'Affirmation' },
  { q: 'The work is hard, but at least the acronym list is longer than the problem statement.', a: 'Affirmation' },
  { q: 'You are one meeting away from clarity, or at least a better inventory of confusion.', a: 'Affirmation' },
  { q: 'The program changed priorities, and you changed tabs with dignity.', a: 'Affirmation' },
  { q: 'A good handoff is a quiet act of leadership and a gift to Friday.', a: 'Affirmation' },
  { q: 'Your day has deliverables, dependencies, and the faint glow of possible closure.', a: 'Affirmation' },
  { q: 'The requirement has been clarified, which means a new question has unlocked.', a: 'Affirmation' },
  { q: 'Procurement is a team sport where the scoreboard is mostly signatures.', a: 'Affirmation' },
  { q: "You are not moving paper. You are moving decisions through bureaucracy's natural habitat.", a: 'Affirmation' },
  { q: 'The action officer life is not glamorous, but the version history is impeccable.', a: 'Affirmation' },
  { q: 'Today, may your review comments be actionable and your meeting links functional.', a: 'Affirmation' },
  { q: 'The acquisition community thanks you, mostly by assigning another suspense date.', a: 'Affirmation' },
  { q: 'A clean table of contents will not fix the world, but it can improve the room.', a: 'Affirmation' },
  { q: 'The procurement gods accept your attachment and request one more certification.', a: 'Affirmation' },
  { q: 'Your acquisition package has fewer mysteries than yesterday, which is progress by any fair standard.', a: 'Affirmation' },
  { q: 'The funding line is real, and for one beautiful second, so is hope.', a: 'Affirmation' },
  { q: 'You have done harder things, though few required this many signatures.', a: 'Affirmation' },
  { q: 'The final file name says final because language is sometimes aspirational.', a: 'Affirmation' },
  { q: 'Your requirements crosswalk is doing the work of a small diplomatic mission.', a: 'Affirmation' },
  { q: 'The contract action is urgent, which is unfortunate given how calendars work.', a: 'Affirmation' },
  { q: 'The amendment is simple, except for the part where it amends everything emotionally.', a: 'Affirmation' },
  { q: 'Your market research found options. The options found questions.', a: 'Affirmation' },
  { q: 'The acquisition plan is not judging the team. It is merely keeping receipts.', a: 'Affirmation' },
  { q: 'Today, may your stakeholders be decisive and your PDFs less decorative.', a: 'Affirmation' },
  { q: 'The record will show you tried, and in contracting, the record is basically a character witness.', a: 'Affirmation' },
  { q: 'You are close to done, which is when the package traditionally reveals a side quest.', a: 'Affirmation' },
  { q: 'The office printer is not part of the acquisition strategy, but it has opinions.', a: 'Affirmation' },
  { q: 'Your response to comments was measured, professional, and only internally theatrical.', a: 'Affirmation' },
  { q: 'The clause lookup took time, but so does archaeology.', a: 'Affirmation' },
  { q: 'The business decision is sound. The route to approval remains scenic.', a: 'Affirmation' },
  { q: 'A good acquisition professional knows when to escalate and when to rename the file more clearly.', a: 'Affirmation' },
  { q: 'Your patience is a renewable resource, but the procurement lead time is not.', a: 'Affirmation' },
  { q: 'The suspense is due at close of business, a phrase doing a heroic amount of emotional work.', a: 'Affirmation' },
  { q: 'The package has a few loose ends, which is acquisition-speak for tomorrow having plans.', a: 'Affirmation' },
  { q: 'You are closer than you were, unless the baseline moved. It probably moved.', a: 'Affirmation' },
  { q: 'Some days the win is a clean citation. Today may be one of those elite days.', a: 'Affirmation' },
  { q: 'The requirement is measurable, assuming morale can be measured in tracked changes.', a: 'Affirmation' },
  { q: 'Your acquisition strategy has entered the phase where everyone remembers one more thing.', a: 'Affirmation' },
  { q: 'The meeting had outcomes, which puts it ahead of several government traditions.', a: 'Affirmation' },
  { q: 'You did the hard part. Now the easy part will become weird for administrative reasons.', a: 'Affirmation' },
  { q: 'The package is in review, which means it is both alive and unavailable.', a: 'Affirmation' },
  { q: 'Today, may your email find the one person who can actually answer it.', a: 'Affirmation' },
  { q: 'The file is complete enough to move forward and incomplete enough to remain realistic.', a: 'Affirmation' },
  { q: 'Your calm is suspiciously effective. Continue using it sparingly.', a: 'Affirmation' },
  { q: 'The acquisition machine runs on documentation, patience, and snacks nobody admits are lunch.', a: 'Affirmation' },
  { q: 'You are enough. The missing attachment is not.', a: 'Affirmation' },
  { q: 'You lost? Do you need help? You should probably call the policy guy named Dave.', a: 'Affirmation' }
];
let lastHeroQuoteKey = '';
let lastAffirmationKey = '';
let heroQuoteMode = 'quote';
let affirmationQueue = [];
let fallbackQuoteQueue = [];

function quoteKey(item) {
  return String((item && (item.q || item.content)) || '');
}

function shuffledItems(items, lastKey) {
  const pool = (items || []).slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (pool.length > 1 && quoteKey(pool[0]) === lastKey) {
    const swapIndex = pool.findIndex(item => quoteKey(item) !== lastKey);
    if (swapIndex > 0) [pool[0], pool[swapIndex]] = [pool[swapIndex], pool[0]];
  }
  return pool;
}

function nextQueuedItem(items, queue, lastKey) {
  if (!queue.length) queue.push(...shuffledItems(items, lastKey));
  return queue.shift() || null;
}

function preserveHeroScroll(fn) {
  const x = window.scrollX;
  const y = window.scrollY;
  const result = fn();
  requestAnimationFrame(() => {
    window.scrollTo(x, y);
  });
  return result;
}

function setHeroQuote(quote, source) {
  const textEl = document.getElementById('hero-quote-text');
  const authorEl = document.getElementById('hero-quote-author');
  const sourceEl = document.getElementById('hero-quote-source');
  const refreshBtn = document.getElementById('hero-quote-refresh');
  if (!textEl || !authorEl || !sourceEl || !quote) return;
  textEl.textContent = quote.q || quote.content || '';
  const showAuthor = heroQuoteMode !== 'affirmation';
  authorEl.textContent = showAuthor ? (quote.a || quote.author || 'Unknown') : '';
  authorEl.style.display = showAuthor ? '' : 'none';
  sourceEl.textContent = source || 'curated';
  if (refreshBtn) refreshBtn.textContent = heroQuoteMode === 'affirmation' ? 'New affirmation' : 'New quote';
}

function nextFallbackQuote() {
  const quote = nextQueuedItem(HERO_QUOTES, fallbackQuoteQueue, lastHeroQuoteKey);
  lastHeroQuoteKey = quoteKey(quote);
  setHeroQuote(quote, 'curated');
}

function nextAffirmation() {
  const affirmation = nextQueuedItem(AFFIRMATIONS, affirmationQueue, lastAffirmationKey);
  lastAffirmationKey = quoteKey(affirmation);
  setHeroQuote(affirmation, 'original');
}

async function loadHeroQuote({ preserveScroll = false } = {}) {
  // Curated, on-device only — no third-party fetch (CAC networks block it; also a privacy/self-host win).
  const run = () => {
    if (heroQuoteMode === 'affirmation') nextAffirmation();
    else nextFallbackQuote();
  };
  if (!preserveScroll) return run();
  const x = window.scrollX;
  const y = window.scrollY;
  run();
  requestAnimationFrame(() => {
    window.scrollTo(x, y);
  });
}

function setHeroQuoteMode(mode, options = {}) {
  heroQuoteMode = mode === 'affirmation' ? 'affirmation' : 'quote';
  document.querySelectorAll('.hero-quote-mode').forEach(btn => {
    const active = btn.dataset.quoteMode === heroQuoteMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  loadHeroQuote(options);
}

(function initHeroQuote() {
  if (!document.getElementById('hero-quote-text')) return; // quote block removed — skip (also avoids a blocked third-party fetch)
  document.querySelectorAll('.hero-quote-mode').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      preserveHeroScroll(() => setHeroQuoteMode(btn.dataset.quoteMode, { preserveScroll: true }));
    });
  });
  const btn = document.getElementById('hero-quote-refresh');
  if (btn) {
    btn.addEventListener('click', e => {
      e.preventDefault();
      preserveHeroScroll(() => loadHeroQuote({ preserveScroll: true }));
    });
  }
  loadHeroQuote();
})();

// ── SIDE TICKERS ─────────────────────────────────────────────────────────────

function stAnimateNum(el, target, prefix, suffix, decimals, duration, formatter) {
  var start = performance.now();
  el.classList.add('live');
  function render(val) {
    return formatter ? formatter(val) : prefix + val.toFixed(decimals) + suffix;
  }
  function step(now) {
    var p = Math.min((now - start) / duration, 1);
    var e = 1 - Math.pow(1 - p, 3);
    var val = e * target;
    el.textContent = render(val);
    if (p < 1) requestAnimationFrame(step);
    else { el.textContent = render(target); el.classList.remove('live'); }
  }
  requestAnimationFrame(step);
}

function stFmtAmt(n) {
  if (!n && n !== 0) return '$—';
  if (n >= 1e12) return '$' + (n/1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3)  return '$' + (n/1e3).toFixed(0) + 'K';
  return '$' + n.toFixed(0);
}

// Compact micro-SVG sparkline of cumulative FY obligations (the "it's tracking live" signal)
function stRenderSpark(values) {
  var el = document.getElementById('st-spark');
  if (!el) return;
  if (!values || values.length < 3) { el.style.display = 'none'; return; }
  var w = 132, h = 32, pad = 2.5;
  var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
  var range = (max - min) || 1;
  var xy = values.map(function(v, i) {
    var x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    var y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  var line = xy.join(' ');
  var lastX = (pad + (w - 2 * pad)).toFixed(1);
  var lastY = (h - pad - ((values[values.length - 1] - min) / range) * (h - 2 * pad)).toFixed(1);
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pulse = reduce ? '' : '<animate attributeName="r" values="2.4;3.4;2.4" dur="1.8s" repeatCount="indefinite"/>';
  el.innerHTML =
    '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<defs><linearGradient id="st-spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>' +
    '<polygon fill="url(#st-spark-fill)" points="' + pad + ',' + (h - pad) + ' ' + line + ' ' + (w - pad) + ',' + (h - pad) + '"/>' +
    '<polyline fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" points="' + line + '"/>' +
    '<circle cx="' + lastX + '" cy="' + lastY + '" r="2.6" fill="var(--accent)">' + pulse + '</circle>' +
    '</svg>';
  el.style.display = 'block';
}

function stToday() {
  return new Date().toISOString().slice(0, 10);
}

function stFiscalYearStart() {
  var now = new Date();
  var fyStartYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return fyStartYear + '-10-01';
}

function stFyStats() {
  // FY runs Oct 1 – Sep 30
  var now = new Date();
  var fyStart = new Date(now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1, 9, 1);
  var fyEnd   = new Date(fyStart.getFullYear() + 1, 8, 30);
  var total   = fyEnd - fyStart;
  var elapsed = now - fyStart;
  var daysLeft = Math.ceil((fyEnd - now) / 86400000);
  var pct = Math.min(100, (elapsed / total * 100)).toFixed(1);
  var daysEl = document.getElementById('st-fy-days');
  var pctEl  = document.getElementById('st-fy-pct');
  if (daysEl) daysEl.textContent = daysLeft + ' days left';
  if (pctEl)  pctEl.textContent  = pct + '% complete';
  var fillEl = document.getElementById('st-fy-fill');
  var paceEl = document.getElementById('st-fy-pace-mini');
  if (fillEl) fillEl.style.width = pct + '%';
  if (paceEl) paceEl.textContent = pct + '% elapsed';
}

async function stFetchObligations() {
  var el = document.getElementById('st-obligations-num');
  if (!el) return;
  var now = new Date();
  var fyStartYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  var fy = fyStartYear + 1;
  var startDate = fyStartYear + '-10-01';
  var endDate = now.toISOString().slice(0, 10);
  try {
    var res = await fetch('https://api.usaspending.gov/api/v2/search/spending_over_time/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group: 'month',
        spending_level: 'transactions',
        filters: {
          agencies: [{ type: 'awarding', tier: 'subtier', name: 'Department of the Air Force' }],
          award_type_codes: ['A','B','C','D'],
          time_period: [{ start_date: startDate, end_date: endDate }]
        }
      })
    });
    if (!res.ok) throw new Error('USASpending obligations request failed');
    var d = await res.json();
    // USASpending 'month' is the FISCAL period (1=Oct … 12=Sep), already chronological.
    var rows = (d.results || []).filter(function(r) { return r.time_period && Number(r.time_period.fiscal_year) === fy; });
    rows.forEach(function(r) {
      r._fm = Number(r.time_period.month);
      r._amt = Number(r.Contract_Obligations || r.aggregated_amount) || 0;
    });
    rows.sort(function(a, b) { return a._fm - b._fm; });
    // Drop trailing empty months — USASpending transaction data lags ~2–3 months.
    while (rows.length && rows[rows.length - 1]._amt <= 0) rows.pop();
    if (!rows.length) throw new Error('No obligations returned');
    // Cumulative running total → a clean rising line; last point = FY-to-date total.
    var cumulative = [], running = 0;
    rows.forEach(function(r) { running += r._amt; cumulative.push(running); });
    var val = running;
    if (!Number.isFinite(val) || val <= 0) throw new Error('No obligations returned');
    stAnimateNum(el, val, '$', '', 0, 1600, stFmtAmt);
    var mini = document.getElementById('st-fy-spend-mini');
    if (mini) mini.textContent = stFmtAmt(val);
    stRenderSpark(cumulative);
    // "As of" the latest month with data — the trust signal (fiscal period → calendar month).
    var fm = rows[rows.length - 1]._fm;
    var calMonth = ((fm + 8) % 12) + 1;
    var calYear = (fm <= 3) ? (fy - 1) : fy;
    var asof = new Date(calYear, calMonth - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    var asofEl = document.getElementById('st-asof');
    if (asofEl) asofEl.textContent = ' · as of ' + asof;
    var heroAsof = document.getElementById('hero-asof');
    if (heroAsof) heroAsof.textContent = 'as of ' + asof;
  } catch(e) {
    el.innerHTML = '<span class="st-error-num">Data delayed</span>';
    el.classList.remove('live');
    var card = el.closest('.side-ticker');
    if (card) card.classList.add('st-fallback');
    var mini = document.getElementById('st-fy-spend-mini');
    if (mini) mini.textContent = 'Delayed';
  }
}

async function stFetchDAFAwards() {
  var body = document.getElementById('st-awards-body');
  var footer = document.getElementById('st-awards-footer');
  if (!body) return;
  try {
    var windows = [30, 90, 180, 365];
    var awards = [];
    var usedDays = 30;
    for (var w = 0; w < windows.length; w++) {
      usedDays = windows[w];
      awards = await stFetchDAFTransactionWindow(usedDays);
      if (awards.length >= 6 || w === windows.length - 1) break;
    }
    if (!awards.length) throw new Error();
    var positiveAwards = awards.filter(function(a) { return Number(a['Transaction Amount']) > 0; });
    if (positiveAwards.length >= 6) awards = positiveAwards;
    if (footer) footer.textContent = 'USASpending.gov · ' + (usedDays === 30 ? 'last 30 days' : 'latest ' + usedDays + ' days');
    stRenderAwards(awards.slice(0, 12).map(function(a) {
      var vendor = stCleanAwardText(a['Recipient Name'] || '', 30);
      var org = stAwardOrgFromTransaction(a);
      var date = (a['Action Date'] || '').slice(0,10);
      var id = a['Award ID'] || '';
      var mod = a.Mod && a.Mod !== '0' ? ' · ' + a.Mod : '';
      return { amt: stFmtAmt(a['Transaction Amount'] || 0), vendor: vendor, id: id + mod, date: date, org: org };
    }));
  } catch(e) {
    body.closest('.side-ticker')?.classList.add('st-fallback');
    body.innerHTML = '<div class="st-loading"><strong>Recent awards delayed</strong><br>Retrying from USASpending.</div>';
  }
}

async function stFetchDAFTransactionWindow(days) {
  var end = new Date();
  var start = new Date(end);
  start.setDate(start.getDate() - days);
  var payload = {
    filters: {
      agencies: [{ type: 'awarding', tier: 'subtier', name: 'Department of the Air Force' }],
      award_type_codes: ['A','B','C','D'],
      time_period: [{ start_date: start.toISOString().slice(0,10), end_date: end.toISOString().slice(0,10) }]
    },
    fields: ['Action Date','Award ID','Recipient Name','Transaction Amount','Awarding Agency','Awarding Sub Agency','generated_internal_id','Transaction Description','Mod'],
    sort: 'Action Date', order: 'desc', limit: 30, page: 1
  };
  var res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_transaction/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('USASpending transactions request failed');
  var d = await res.json();
  var seen = new Set();
  return (d.results || []).filter(function(a) {
    var id = [a['Award ID'], a.Mod, a['Action Date'], a['Transaction Amount']].join('|');
    if (!a['Award ID'] || !a['Recipient Name'] || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function stAwardDoDAAC(awardId) {
  var m = String(awardId || '').match(/^([A-Z0-9]{6})/i);
  return m ? m[1].toUpperCase() : '';
}

function stAwardOrgFromTransaction(a) {
  var dodaac = stAwardDoDAAC(a['Award ID']);
  if (dodaac) return 'DoDAAC ' + dodaac;
  return stCleanAwardText(a['Awarding Sub Agency'] || a['Awarding Agency'] || 'Awarding office pending', 36);
}


function stCleanAwardText(text, max) {
  var clean = String(text || '').replace(/,?\s*(LLC|INC\.?|CORP\.?|CORPORATION|LTD|LP|CO\.?|COMPANY)\b/gi,'').replace(/\s+/g,' ').trim();
  if (clean.length > max) clean = clean.slice(0, Math.max(0, max - 1)) + '…';
  return clean;
}

function stRenderAwards(awards) {
  var body = document.getElementById('st-awards-body');
  if (!body) return;
  body.innerHTML = '';
  awards.forEach(function(a, i) {
    var el = document.createElement('div');
    el.className = 'st-award-item';
    el.style.animationDelay = (i * 0.06) + 's';
    el.innerHTML =
      '<div class="st-award-dot"></div>' +
      '<div class="st-award-info">' +
        '<div class="st-award-top"><div class="st-award-amt">' + a.amt + '</div><div class="st-award-date">' + (a.date || '') + '</div></div>' +
        '<div class="st-award-vendor">' + a.vendor + '</div>' +
        '<div class="st-award-contract">' + (a.id || 'Award ID pending') + '</div>' +
        '<div class="st-award-org">' + (a.org || '') + '</div>' +
      '</div>';
    body.appendChild(el);
  });

  // Auto-scroll only inside the awards panel. Never call scrollIntoView here;
  // it can pull the whole page back to the hero while someone is reading below.
  var idx = 0;
  var items = body.querySelectorAll('.st-award-item');
  if (items.length < 2) return;
  setInterval(function() {
    idx = (idx + 1) % items.length;
    var target = items[idx];
    if (target) body.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
  }, 2500);
}

// Init side tickers
(function() {
  stFyStats();
  stFetchObligations();
  stFetchDAFAwards();
})();

// ── SLIDING SELECTION GLIDER — the nav's magic indicator, generalized to any
//    single-select segmented control (hero mode-toggle, spending window toggle).
function initSegGlider(container, buttonSel, isActive) {
  if (!container || container._segRest) return container && container._segRest;
  container.classList.add('seg');
  var glider = document.createElement('span');
  glider.className = 'seg-glider';
  container.insertBefore(glider, container.firstChild);
  function btns() { return Array.prototype.slice.call(container.querySelectorAll(buttonSel)); }
  function moveTo(el, instant) {
    if (!el) return;
    var cr = container.getBoundingClientRect(), br = el.getBoundingClientRect();
    if (!br.width) return;
    if (instant) glider.style.transition = 'none';
    glider.style.width = br.width + 'px';
    glider.style.height = br.height + 'px';
    glider.style.transform = 'translate(' + (br.left - cr.left) + 'px,' + (br.top - cr.top) + 'px)';
    container.classList.add('glider-ready');
    btns().forEach(function (b) { b.classList.toggle('on-glider', b === el); });
    if (instant) { void glider.offsetWidth; glider.style.transition = ''; }
  }
  function rest(instant) {
    var a = btns().filter(isActive)[0];
    if (a) moveTo(a, instant);
    else { container.classList.remove('glider-ready'); btns().forEach(function (b) { b.classList.remove('on-glider'); }); }
  }
  container.addEventListener('mouseover', function (e) {
    var b = e.target.closest(buttonSel); if (b && container.contains(b)) moveTo(b);
  });
  container.addEventListener('mouseleave', function () { rest(); });
  window.addEventListener('resize', function () { rest(true); }, { passive: true });
  container._segRest = rest;
  // Position under the active button once laid out. Retry across paint + the
  // command-dock entrance animation (it has zero width at first frame).
  requestAnimationFrame(function () { rest(true); });
  window.addEventListener('load', function () { rest(true); });
  setTimeout(function () { rest(true); }, 350);
  return rest;
}
window.initSegGlider = initSegGlider;
// Hero command dock (Search / Browse by Source·Regulation / Full Text)
(function () {
  var mt = document.querySelector('.mode-toggle');
  if (mt) initSegGlider(mt, '.mode-btn', function (b) { return b.classList.contains('active'); });
})();

// ── MEANINGFUL MOTION: nav sliding pill + scrollspy, market path, feature stats ─
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1) Nav: a single pill that glides under the hovered / active link (Apple-style).
  var navCenter = document.getElementById('nav-center');
  if (navCenter) {
    var pill = navCenter.querySelector('.nav-pill');
    var activeLink = navCenter.querySelector('a');
    function navLinks() { return Array.prototype.slice.call(navCenter.querySelectorAll('a')); }
    function movePill(el, instant) {
      if (!pill || !el || !el.offsetWidth) return;
      if (instant) pill.style.transition = 'none';
      pill.style.width = el.offsetWidth + 'px';
      pill.style.transform = 'translateX(' + el.offsetLeft + 'px)';
      navCenter.classList.add('pill-ready');
      // Mark exactly the link under the pill so only it inverts to white text.
      navLinks().forEach(function (x) { x.classList.toggle('pilled', x === el); });
      if (instant) { void pill.offsetWidth; pill.style.transition = ''; }
    }
    // Rest the pill under the current-section link; hide it entirely when no
    // section is active (e.g. at the top over the hero) so a navy pill never
    // sits under a dark, unselected link.
    function restPill(instant) {
      var act = navCenter.querySelector('a.active');
      if (act) movePill(act, instant);
      else { navCenter.classList.remove('pill-ready'); navLinks().forEach(function (x) { x.classList.remove('pilled'); }); }
    }
    // Delegated hover so JS-injected links (e.g. Toolkit, added by widgets.js after this runs) glide too.
    navCenter.addEventListener('mouseover', function (e) {
      var a = e.target.closest('a'); if (a && navCenter.contains(a)) movePill(a);
    });
    navCenter.addEventListener('mouseleave', function () { restPill(); });
    window.addEventListener('resize', function () { restPill(true); }, { passive: true });
    // Resolve a nav link to the on-page section it should light up: a #hash link
    // maps to that element; a bare page link like /library or /study lights up an
    // on-page section that shares its slug (so the pill never skips those).
    function spyTarget(l) {
      var href = l.getAttribute('href') || '';
      if (href.charAt(0) === '#') return href.length > 1 ? document.querySelector(href) : null;
      var m = href.match(/^\/([a-z0-9-]+)\/?$/i);
      return m ? document.getElementById(m[1]) : null;
    }
    function initSpy() {
      // Re-query at call time (load+400ms) so late-injected links join the scrollspy.
      var links = navLinks();
      if (!activeLink) activeLink = links[0];
      restPill(true);
      links.forEach(function (l) {
        var sec = spyTarget(l);
        if (!sec) return;
        new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              activeLink = l;
              links.forEach(function (x) { x.classList.toggle('active', x === l); });
              if (!navCenter.matches(':hover')) movePill(l);
            }
          });
        }, { rootMargin: '-45% 0px -50% 0px' }).observe(sec);
      });
    }
    // Sections include JS-injected ones (market-research) — wait for them.
    window.addEventListener('load', function () { setTimeout(initSpy, 400); });
  }

  // 2) Market-research path: steps illuminate 1→2→3→4 as it scrolls in (shows the flow).
  var path = document.querySelector('.market-path');
  if (path) {
    var steps = Array.prototype.slice.call(path.querySelectorAll('.market-step'));
    new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        steps.forEach(function (s, i) { setTimeout(function () { s.classList.add('lit'); }, reduce ? 0 : i * 200); });
        obs.disconnect();
      });
    }, { threshold: 0.4 }).observe(path);
  }

  // 3) Feature stats: bars grow + numbers count up when the section scrolls in.
  function countUp(el) {
    var m = String(el.textContent || '').trim().match(/^(\D*)(\d[\d,]*)(.*)$/);
    if (!m) return;
    var pre = m[1], target = parseInt(m[2].replace(/,/g, ''), 10), suf = m[3];
    if (reduce || !target) { return; }
    var start = performance.now(), dur = 950;
    (function step(t) {
      var p = Math.min(1, (t - start) / dur);
      var v = Math.round((1 - Math.pow(1 - p, 3)) * target);
      el.textContent = pre + v.toLocaleString() + suf;
      if (p < 1) requestAnimationFrame(step);
    })(start);
  }

  // 4) Pointer-following sheen on grid cards (updates --mx/--my on the hovered card).
  if (!reduce) {
    document.addEventListener('pointermove', function (e) {
      var card = e.target.closest && e.target.closest('.ql-card, .src-tile, .feat, .tk-card');
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });
  }

  var featSection = document.getElementById('features');
  if (featSection) {
    var fills = Array.prototype.slice.call(featSection.querySelectorAll('.feat-stat-fill'));
    fills.forEach(function (f) { f.dataset.w = f.style.width || '100%'; if (!reduce) f.style.width = '0'; });
    var nums = Array.prototype.slice.call(featSection.querySelectorAll('.feat-stat-num'));
    new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        fills.forEach(function (f, i) { setTimeout(function () { f.style.width = f.dataset.w; }, reduce ? 0 : 140 + i * 90); });
        nums.forEach(function (n) { countUp(n); });
        obs.disconnect();
      });
    }, { threshold: 0.3 }).observe(featSection);
  }
})();

