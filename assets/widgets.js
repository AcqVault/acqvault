/* ═══════════════════════════════════════════════════════════════
   ACQVAULT — WIDGETS ADD-ON  (self-contained, no deps)
   1) Threshold quick-reference   2) Acronym decoder
   3) What's new since last visit 4) DAF spending dashboard
   Injects the Toolkit + Spending sections after #quick-links and wires behaviour.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ---------- tiny helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtUSD = (n) => {
    n = Number(n) || 0;
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6)  return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3)  return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n).toLocaleString();
  };
  const fmtExact = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();

  /* ════════════════════════════════════════════════════════════
     DATA
     ════════════════════════════════════════════════════════════ */

  // Thresholds — two scopes. Values reflect FAR 2.101 et al.; verify against current FAR.
  // Values reflect FAR Case 2024-001 / FAC 2025-06 (effective Oct 1, 2025) as carried
  // into the RFO. Citations point to the RFO (the overhauled FAR indexed on this site).
  // Truthful (certified) cost-or-pricing-data threshold rises to $10M for new
  // contracts/orders effective 30 Jun 2026 (NDAA FY2026 sec. 1804(c)); awards
  // made before then — and modifications to them — stay at $2.5M. Date-aware so
  // the headline value is correct as the cutover passes. Source: DAF Compass
  // Part 15 / R-DFARS 215.403-3 (both indexed on this site).
  const _tinaAfterCutover = new Date() >= new Date('2026-06-30T00:00:00');
  const TINA_VALUE = _tinaAfterCutover ? 10000000 : 2500000;
  const TINA_NOTE = _tinaAfterCutover
    ? 'new awards; mods to pre-30 Jun 2026 contracts stay $2.5M'
    : '→ $10M for new awards on/after 30 Jun 2026';
  const THRESHOLDS = [
    { abbr: 'MPT', name: 'Micro-Purchase Threshold', cite: 'RFO 2.101',
      std: 15000, con: 25000, conNote: '$40K outside U.S.' },
    { abbr: 'SAT', name: 'Simplified Acquisition Threshold', cite: 'RFO 2.101',
      std: 350000, con: 1000000, conNote: '$2M outside U.S.' },
    { abbr: 'SAP', name: 'Simplified procedures, commercial', cite: 'RFO 13.500',
      std: 9000000, con: 15000000 },
    { abbr: 'TINA', name: 'Certified cost or pricing data', cite: 'RFO 15.403-4',
      std: TINA_VALUE, con: TINA_VALUE, fixed: true, note: TINA_NOTE },
    { abbr: '', name: 'Subcontracting plan required above', cite: 'RFO 19.702',
      std: 900000, con: 900000, fixed: true },
    { abbr: 'J&A', name: 'Other than full & open — first approval tier', cite: 'RFO 6.304',
      std: 900000, con: 900000, fixed: true }
  ];

  // Acronym glossary: TERM -> [expansion, optional note]
  const ACRONYMS = {
    FAR: ['Legacy Federal Acquisition Regulation', 'Use the RFO for current AcqVault research'],
    DFARS: ['Legacy Defense acquisition supplement', 'Use R-DFARS for current AcqVault research'],
    'R-DFARS': ['R-DFARS', 'DoD deviation set replacing legacy DFARS material'],
    PGI: ['Procedures, Guidance, and Information', 'Legacy companion guidance'],
    DAF: ['Department of the Air Force'],
    DoD: ['Department of Defense'],
    RFO: ['Revolutionary FAR Overhaul', 'The overhauled FAR — EO 14275'],
    SAT: ['Simplified Acquisition Threshold', '$350,000 since Oct 2025 (RFO 2.101)'],
    MPT: ['Micro-Purchase Threshold', '$15,000 since Oct 2025 (RFO 2.101)'],
    SAP: ['Simplified Acquisition Procedures', 'RFO Part 13'],
    TINA: ['Truth in Negotiations Act', 'Certified cost/pricing data; $2.5M, rising to $10M for new awards on/after 30 Jun 2026 (NDAA FY26)'],
    CAS: ['Cost Accounting Standards', '48 CFR 9903 (CAS Board)'],
    IDIQ: ['Indefinite-Delivery, Indefinite-Quantity', 'FAR 16.504'],
    IDV: ['Indefinite-Delivery Vehicle'],
    BPA: ['Blanket Purchase Agreement', 'FAR 13.303 / 8.405-3'],
    GWAC: ['Government-Wide Acquisition Contract'],
    MAC: ['Multiple-Award Contract'],
    FFP: ['Firm-Fixed-Price', 'FAR 16.202'],
    FPIF: ['Fixed-Price Incentive (Firm Target)', 'FAR 16.403'],
    CPFF: ['Cost-Plus-Fixed-Fee', 'FAR 16.306'],
    CPIF: ['Cost-Plus-Incentive-Fee', 'FAR 16.405-1'],
    CPAF: ['Cost-Plus-Award-Fee', 'FAR 16.405-2'],
    'T&M': ['Time-and-Materials', 'FAR 16.601'],
    LPTA: ['Lowest Price Technically Acceptable', 'FAR 15.101-2'],
    LH: ['Labor-Hour contract', 'FAR 16.602'],
    PWS: ['Performance Work Statement'],
    SOW: ['Statement of Work'],
    SOO: ['Statement of Objectives'],
    QASP: ['Quality Assurance Surveillance Plan'],
    QAPC: ['Quality Assurance Program Coordinator', 'DAFI 63-138'],
    COR: ['Contracting Officer\u2019s Representative'],
    'C-COR': ['Chief Contracting Officer\u2019s Representative', 'DAFI 63-138'],
    CO: ['Contracting Officer'],
    CORT: ['Contracting Officer\u2019s Representative Tracking'],
    CPAR: ['Contract Performance Assessment Report'],
    PCO: ['Procuring Contracting Officer'],
    ACO: ['Administrative Contracting Officer'],
    TCO: ['Termination Contracting Officer'],
    PALT: ['Procurement Administrative Lead Time'],
    RFP: ['Request for Proposals', 'FAR 15.203'],
    RFQ: ['Request for Quotations', 'FAR 13.307'],
    RFI: ['Request for Information', 'FAR 15.201'],
    IFB: ['Invitation for Bids', 'Sealed bidding — FAR Part 14'],
    SSEB: ['Source Selection Evaluation Board'],
    SSA: ['Source Selection Authority'],
    SSAC: ['Source Selection Advisory Council'],
    PNM: ['Price Negotiation Memorandum'],
    'J&A': ['Justification and Approval', 'Other than full & open — RFO 6.304'],
    'D&F': ['Determination and Findings', 'FAR 1.7'],
    BAA: ['Broad Agency Announcement', 'FAR 35.016'],
    OTA: ['Other Transaction Authority', '10 U.S.C. 4021/4022'],
    CLIN: ['Contract Line Item Number', 'FAR 4.1003'],
    SLIN: ['Subline Item Number'],
    ACRN: ['Accounting Classification Reference Number'],
    UCA: ['Undefinitized Contract Action', 'R-DFARS / legacy DFARS coverage'],
    ECP: ['Engineering Change Proposal'],
    EVM: ['Earned Value Management', 'FAR 34.2'],
    EVMS: ['Earned Value Management System'],
    WBS: ['Work Breakdown Structure'],
    IMS: ['Integrated Master Schedule'],
    IMP: ['Integrated Master Plan'],
    CDRL: ['Contract Data Requirements List', 'DD Form 1423'],
    DID: ['Data Item Description'],
    GFE: ['Government-Furnished Equipment'],
    GFP: ['Government-Furnished Property', 'FAR 45'],
    GFI: ['Government-Furnished Information'],
    CPARS: ['Contractor Performance Assessment Reporting System'],
    SAM: ['System for Award Management', 'SAM.gov'],
    FPDS: ['Federal Procurement Data System'],
    WAWF: ['Wide Area Workflow', 'Invoicing & receiving in PIEE'],
    PIEE: ['Procurement Integrated Enterprise Environment'],
    EDA: ['Electronic Document Access'],
    OCI: ['Organizational Conflict of Interest', 'FAR 9.5'],
    DCAA: ['Defense Contract Audit Agency'],
    DCMA: ['Defense Contract Management Agency'],
    DAFFARS: ['Department of the Air Force Federal Acquisition Regulation Supplement'],
    DAFI: ['Department of the Air Force Instruction'],
    DAWIA: ['Defense Acquisition Workforce Improvement Act'],
    DLA: ['Defense Logistics Agency'],
    DAU: ['Defense Acquisition University'],
    DoDI: ['Department of Defense Instruction'],
    DRU: ['Direct Reporting Unit'],
    DS: ['Director of Staff'],
    ESIS: ['Early Strategy and Issues Session'],
    FFRDC: ['Federally Funded Research and Development Center'],
    FLDCOM: ['Field Command'],
    FM: ['Financial Management'],
    FOA: ['Field Operating Agency'],
    FS: ['Fiscal Service'],
    FSM: ['Functional Services Manager'],
    'GO/SES': ['General Officer / Senior Executive Service'],
    HAF: ['Headquarters Air Force', 'Secretariat, Air Staff, and Space Staff'],
    GAO: ['Government Accountability Office', 'Bid protest forum'],
    ODC: ['Other Direct Costs'],
    'G&A': ['General and Administrative expense'],
    FMS: ['Foreign Military Sales'],
    FMR: ['Financial Management Regulation', 'DoD 7000.14-R'],
    NDAA: ['National Defense Authorization Act'],
    USC: ['United States Code'],
    CFR: ['Code of Federal Regulations'],
    NAICS: ['North American Industry Classification System'],
    PSC: ['Product or Service Code'],
    UEI: ['Unique Entity Identifier', 'Replaced DUNS in SAM.gov'],
    CAGE: ['Commercial and Government Entity code'],
    DPAS: ['Defense Priorities and Allocations System', 'FAR 11.6'],
    EPA: ['Economic Price Adjustment', 'FAR 16.203 (price clause)'],
    ROM: ['Rough Order of Magnitude'],
    IGCE: ['Independent Government Cost Estimate'],
    BOE: ['Basis of Estimate'],
    SCA: ['Service Contract Act', 'Now SCLS — FAR 22.10'],
    DBA: ['Davis-Bacon Act', 'Construction wage rates — FAR 22.4'],
    CICA: ['Competition in Contracting Act'],
    FASA: ['Federal Acquisition Streamlining Act'],
    COTS: ['Commercial Off-The-Shelf'],
    NDI: ['Non-Developmental Item'],
    'RDT&E': ['Research, Development, Test & Evaluation', 'Appropriation'],
    'O&M': ['Operations and Maintenance', 'Appropriation'],
    MILCON: ['Military Construction'],
    ACAT: ['Acquisition Category'],
    MDAP: ['Major Defense Acquisition Program'],
    KPP: ['Key Performance Parameter'],
    TRL: ['Technology Readiness Level'],
    MRL: ['Manufacturing Readiness Level'],
    EMD: ['Engineering and Manufacturing Development', 'Acquisition phase'],
    LRIP: ['Low-Rate Initial Production'],
    FRP: ['Full-Rate Production'],
    AoA: ['Analysis of Alternatives'],
    AER: ['Annual Execution Review', 'DAFI 63-138'],
    AFI: ['Air Force Instruction'],
    AFIMSC: ['Air Force Installation and Mission Support Center'],
    AFPD: ['Air Force Policy Directive'],
    ANG: ['Air National Guard'],
    AP: ['Acquisition Plan'],
    ASP: ['Acquisition Strategy Panel'],
    PEO: ['Program Executive Officer'],
    MDA: ['Milestone Decision Authority'],
    MFT: ['Multi-Functional Team', 'DAFI 63-138'],
    MIPR: ['Military Interdepartmental Purchase Request'],
    ML: ['Materiel Leader'],
    MOA: ['Memorandum of Agreement'],
    MP: ['Mandatory Procedure'],
    OAC: ['Operating Agency Codes'],
    OCSO: ['Office of the Chief of Space Operations'],
    OSD: ['Office of the Secretary of Defense'],
    RAA: ['Requirements Approval Authority', 'DAFI 63-138'],
    RAD: ['Requirements Approval Document', 'DAFI 63-138'],
    SA: ['Services Advocate', 'DAFI 63-138'],
    SADA: ['Services Acquisition Decision Authority', 'DAFI 63-138'],
    SAE: ['Service Acquisition Executive', 'DAFI 63-138'],
    SAL: ['Services Acquisition Lead', 'DAFI 63-138'],
    SAW: ['Services Acquisition Workshop'],
    SB: ['Small Business'],
    'S-CAT': ['Services Category', 'DAFI 63-138'],
    SDO: ['Services Designated Official', 'Former term for SADA'],
    SMA: ['Services Management Agreement', 'DAFI 63-138'],
    SME: ['Subject Matter Expert'],
    SML: ['Senior Materiel Leader'],
    SMT: ['Strategic Management Tool'],
    'S-PEO': ['Systems Program Executive Officer', 'DAFI 63-138'],
    SPM: ['Surveillance and Performance Monitoring Module', 'PIEE module'],
    SRR: ['Services Requirements Review'],
    SRRB: ['Services Requirements Review Board'],
    SS: ['Services Summary'],
    SSM: ['Senior Services Manager'],
    TEO: ['Technology Executive Officer'],
    USecAF: ['Under Secretary of the Air Force'],
    USSF: ['United States Space Force'],
    VCSAF: ['Vice Chief of Staff of the Air Force'],
    VCSO: ['Vice Chief of Space Operations'],
    'SAF/AQ': ['Asst. Secretary of the AF for Acquisition, Technology & Logistics'],
    'SAF/AA': ['Administrative Assistant to the Secretary of the Air Force'],
    'SAF/MG': ['Deputy Under Secretary of the Air Force (Management)'],
    'SAF/SQ': ['Assistant Secretary of the Air Force (Space Acquisition and Integration)'],
    'SF/DS': ['Space Force Director of Staff'],
    AFMC: ['Air Force Materiel Command'],
    AFLCMC: ['Air Force Life Cycle Management Center'],
    AFICC: ['Air Force Installation Contracting Center'],
    SSC: ['Space Systems Command'],
    'USD(A&S)': ['Under Secretary of Defense for Acquisition & Sustainment']
  };
  // ambiguous / too-short tokens: keep in lookup, skip auto-decoration
  const NO_AUTODECORATE = new Set(['LH', 'EPA', 'USC', 'CFR', 'SOW', 'BOE', 'ROM', 'NDI', 'AoA', 'DBA', 'DID', 'PSC']);

  // Single source of truth for dollar thresholds: derive the MPT/SAT acronym notes
  // from THRESHOLDS so the value can never drift between the two dicts (a prior agent
  // once tried to "correct" MPT to $10k — keep it computed, never hand-typed twice).
  ['MPT', 'SAT'].forEach((ab) => {
    const t = THRESHOLDS.find((x) => x.abbr === ab);
    if (t && ACRONYMS[ab]) ACRONYMS[ab][1] = fmtExact(t.std) + ' since Oct 2025 (' + t.cite + ')';
  });

  /* ════════════════════════════════════════════════════════════
     INJECT MARKUP
     ════════════════════════════════════════════════════════════ */
  function injectSections() {
    // Anchor the injected tool sections on #quick-links (stable). The former #features
    // band was merged into the Coverage band; keep a null-safe ref for the fallback below.
    const features = $('#features');
    const anchor = $('#quick-links') || $('#market-research') || features;
    if (!anchor) return;

    const toolkit = document.createElement('section');
    toolkit.className = 'sec sec-off';
    toolkit.id = 'toolkit';
    toolkit.innerHTML = `
      <div class="sec-inner">
        <p class="eyebrow eyebrow-dark fade-up">Daily toolkit</p>
        <h2 class="sec-head fade-up">The lookups you do<br>a dozen times a day.</h2>
        <p class="sec-sub sec-sub-dark fade-up">Dollar thresholds and the acronym you half-remember \u2014 without leaving the page.</p>
        <div class="tk-grid">
          <div class="tk-col">
            <div class="tk-card fade-up" id="thr-card">
              <div class="tk-card-head">
                <div class="tk-card-icon">\u25B0</div>
                <div class="tk-card-titles">
                  <div class="tk-card-title">Threshold quick-reference</div>
                  <div class="tk-card-sub">RFO &amp; R-DFARS · current thresholds</div>
                </div>
              </div>
              <div class="thr-scope" id="thr-scope" role="tablist">
                <button class="active" data-scope="std" role="tab" aria-selected="true">Standard</button>
                <button data-scope="con" role="tab" aria-selected="false">Contingency / Emergency</button>
              </div>
              <div class="thr-scope-note" id="thr-scope-note"></div>
              <div class="thr-calc">
                <label class="thr-calc-label" for="thr-amount">Check an amount</label>
                <div class="thr-calc-field">
                  <span class="thr-calc-cur">$</span>
                  <input type="text" id="thr-amount" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="e.g. 250,000" aria-label="Acquisition dollar amount" />
                  <button type="button" class="thr-calc-clear" id="thr-amount-clear" aria-label="Clear amount" hidden>✕</button>
                </div>
                <div class="thr-calc-out" id="thr-calc-out" role="status" aria-live="polite"></div>
              </div>
              <div class="thr-list-label">Reference table</div>
              <div class="thr-list" id="thr-list"></div>
              <div class="thr-foot">Per the FY2025 inflation adjustment effective Oct. 1, 2025 and carried into the RFO; DoD deviations live in the R-DFARS. Always verify against the live regulation &amp; any class deviations before acting. The RFO may revise these.</div>
            </div>
          </div>
          <div class="tk-col">
            <div class="tk-card fade-up d1" id="acro-card">
              <div class="tk-card-head">
                <div class="tk-card-icon">A\u02B7</div>
                <div class="tk-card-titles">
                  <div class="tk-card-title">Acronym decoder</div>
                  <div class="tk-card-sub">${Object.keys(ACRONYMS).length}+ terms \u00B7 type to filter</div>
                </div>
              </div>
              <div class="acro-search">
                <span class="acro-search-icon">\u2315</span>
                <input type="text" id="acro-input" placeholder="e.g. IDIQ, J&amp;A, LPTA\u2026" autocomplete="off" spellcheck="false" aria-label="Search acronyms" />
                <span class="acro-count" id="acro-count"></span>
              </div>
              <div class="acro-results" id="acro-results"></div>
              <div class="acro-foot"><b>Tip:</b> acronyms in document text are underlined \u2014 hover any one to see what it means.</div>
            </div>
          </div>
        </div>
      </div>`;

    const dash = document.createElement('section');
    dash.className = 'sec sec-dark';
    dash.id = 'spending-dashboard';
    dash.innerHTML = `
      <div class="sec-inner">
        <div class="dash-head-row">
          <div>
            <p class="eyebrow eyebrow-light fade-up">Live spending</p>
            <h2 class="sec-head fade-up">Where the Air Force<br>is putting its money.</h2>
          </div>
          <div class="dash-window fade-up" id="dash-window" role="group" aria-label="Spending time window">
            <button type="button" data-days="90" aria-pressed="false">90d</button>
            <button type="button" data-days="180" aria-pressed="false">180d</button>
            <button type="button" data-days="365" class="active" aria-pressed="true">1y</button>
            <button type="button" data-days="1095" aria-pressed="false">3y</button>
          </div>
        </div>
        <div class="dash-grid fade-up" id="dash-grid">
          <div class="dash-stat"><div class="dash-stat-label">FY Obligations</div><div class="dash-stat-num accent" id="dash-fy">\u2014</div><div class="dash-stat-foot" id="dash-fy-foot">Fiscal year to date</div></div>
          <div class="dash-stat"><div class="dash-stat-label">Actions</div><div class="dash-stat-num" id="dash-count">\u2014</div><div class="dash-stat-foot" id="dash-count-foot">in window</div></div>
          <div class="dash-stat"><div class="dash-stat-label">Obligated</div><div class="dash-stat-num" id="dash-sum">\u2014</div><div class="dash-stat-foot" id="dash-sum-foot">window total</div></div>
          <div class="dash-stat"><div class="dash-stat-label">Largest action</div><div class="dash-stat-num" id="dash-max">\u2014</div><div class="dash-stat-foot" id="dash-max-foot">single award</div></div>
        </div>
        <div class="dash-cols">
          <div class="dash-panel fade-up">
            <div class="dash-panel-title">Top recipients <span id="dash-recip-window">last 12 months</span></div>
            <div id="dash-recipients" aria-live="polite"><div class="dash-loading dash-skeleton">Loading from USASpending\u2026</div></div>
          </div>
          <div class="dash-panel fade-up d1">
            <div class="dash-panel-title">Largest recent actions <span id="dash-largest-window">last 12 months</span></div>
            <div id="dash-largest" aria-live="polite"><div class="dash-loading dash-skeleton">Loading from USASpending\u2026</div></div>
          </div>
        </div>
        <div class="dash-panel dash-panel-wide fade-up">
          <div class="dash-panel-title">What the Air Force buys <span id="dash-psc-window">last 12 months</span></div>
          <div id="dash-psc" aria-live="polite"><div class="dash-loading dash-skeleton">Loading from USASpending\u2026</div></div>
        </div>
        <div class="dash-foot"><span class="dash-live-dot"></span><span>Source: USASpending.gov \u00B7 Department of the Air Force \u00B7 contract actions (award types A\u2013D)</span></div>
      </div>`;

    // Page flow: Market Research, Quick Links, Toolkit, Spending, Coverage.
    const quicklinks = $('#quick-links');
    const marketResearch = $('#market-research');
    if (marketResearch && quicklinks && (marketResearch.compareDocumentPosition(quicklinks) & Node.DOCUMENT_POSITION_PRECEDING)) {
      quicklinks.insertAdjacentElement('beforebegin', marketResearch);
    }
    (quicklinks || marketResearch || features).insertAdjacentElement('afterend', toolkit);
    toolkit.insertAdjacentElement('afterend', dash);

    // reveal-on-scroll for the freshly injected .fade-up nodes
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.01, rootMargin: '0px 0px 20% 0px' });
    [marketResearch, toolkit, dash].filter(Boolean).forEach((sec) => sec.querySelectorAll('.fade-up').forEach((el) => io.observe(el)));

    // add nav links (Toolkit + Spending) in scroll order, after Quick Links
    const navCenter = $('nav .nav-center');
    if (navCenter) {
      const tk = document.createElement('a');
      tk.href = '#toolkit'; tk.textContent = 'Toolkit';
      const quickLink = navCenter.querySelector('a[href="#quick-links"]');
      if (quickLink) quickLink.insertAdjacentElement('afterend', tk);
      else navCenter.insertBefore(tk, navCenter.firstChild);
      const sp = document.createElement('a');
      sp.href = '#spending-dashboard'; sp.textContent = 'Spending';
      tk.insertAdjacentElement('afterend', sp);
    }
    initHomeNavPolish();
  }

  function initHomeNavPolish() {
    const links = Array.from(document.querySelectorAll('nav .nav-center a[href^="#"]'));
    if (!links.length) return;
    function setActive(id) {
      links.forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#' + id));
    }
    links.forEach(link => {
      link.addEventListener('click', (event) => {
        const id = link.getAttribute('href').slice(1);
        const target = document.getElementById(id);
        if (!target) return;
        event.preventDefault();
        const y = target.getBoundingClientRect().top + window.scrollY - getStickyOffset() - 26;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
        history.replaceState(null, '', '#' + id);
        setActive(id);
      });
    });
    const observed = links.map(link => document.getElementById(link.getAttribute('href').slice(1))).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target?.id) setActive(visible.target.id);
    }, { rootMargin: '-38% 0px -52% 0px', threshold: [0.01, 0.18, 0.35] });
    observed.forEach(section => io.observe(section));
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) setTimeout(() => {
        const y = target.getBoundingClientRect().top + window.scrollY - getStickyOffset() - 26;
        window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
        setActive(target.id);
      }, 80);
    }
  }

  /* ════════════════════════════════════════════════════════════
     1) THRESHOLDS
     ════════════════════════════════════════════════════════════ */
  let thrScope = 'std';
  function renderThresholds(changed) {
    const list = $('#thr-list'); if (!list) return;
    list.innerHTML = THRESHOLDS.map((t) => {
      const val = thrScope === 'con' ? t.con : t.std;
      const uplift = thrScope === 'con' && !t.fixed && t.con !== t.std;
      const note = thrScope === 'con' && t.conNote ? `<span class="thr-up">${esc(t.conNote)}</span>` : '';
      const nm = t.abbr
        ? `<span class="thr-row-abbr">${esc(t.abbr)}</span> \u00B7 ${esc(t.name)}`
        : esc(t.name);
      return `<div class="thr-row${changed && uplift ? ' changed' : ''}" role="button" tabindex="0" aria-haspopup="dialog">
        <div class="thr-row-main">
          <div class="thr-row-name">${nm}</div>
          <div class="thr-row-cite">${esc(t.cite)}</div>
        </div>
        <div class="thr-row-val">${fmtExact(val)}${note}${t.note ? `<span class="thr-up">${esc(t.note)}</span>` : ''}</div>
      </div>`;
    }).join('');
    const noteEl = $('#thr-scope-note');
    if (noteEl) noteEl.textContent = thrScope === 'con'
      ? 'Higher ceilings for contingency, humanitarian, peacekeeping or CBRN operations. Inside-U.S. figures shown; outside-U.S. noted per row.'
      : 'Standard thresholds for routine acquisitions inside the United States.';
  }
  /* ── Threshold Decision Helper (deterministic: pure comparison to the cited THRESHOLDS) ── */
  window.THRESHOLDS = THRESHOLDS; // single source of truth (mirrors window.ACRONYMS pattern)
  let thrLast = null; // last computed {amt, scope, band, triggers} for the "Copy as file note" action
  const thrScopeVal = (t) => (thrScope === 'con' ? t.con : t.std);
  const thrFind = (pred) => THRESHOLDS.find(pred);
  function parseAmount(raw) {
    const digits = String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : null;
  }
  function fmtAmountInput(raw) {
    const digits = String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10).toLocaleString() : '';
  }
  // open the cited clause in the existing reader/drawer, falling back to a search
  function thrJumpToCite(cite) {
    const q = String(cite || '').trim();
    if (!q) return;
    if (typeof window.runExampleQuery === 'function') { window.runExampleQuery(q); return; }
    if (typeof window.runSearch === 'function') {
      const input = $('#search-input'); if (input) input.value = q;
      if (typeof window.setMode === 'function') window.setMode('search');
      window.runSearch(q);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  function renderThrCalc() {
    const out = $('#thr-calc-out'), input = $('#thr-amount'), clr = $('#thr-amount-clear');
    if (!out || !input) return;
    const amt = parseAmount(input.value);
    if (clr) clr.hidden = !input.value;
    if (amt == null) {
      out.classList.remove('on');
      out.innerHTML = `<div class="thr-calc-hint">Type a dollar amount to see which regime applies and which thresholds it crosses — each with its RFO citation.</div>`;
      return;
    }
    const mpt = thrFind((t) => t.abbr === 'MPT'), sat = thrFind((t) => t.abbr === 'SAT'), sapC = thrFind((t) => t.abbr === 'SAP');
    const mptV = thrScopeVal(mpt), satV = thrScopeVal(sat), sapV = thrScopeVal(sapC);
    let band;
    if (amt <= mptV) {
      band = { cls: 'mp', tag: 'Micro-purchase', cite: mpt.cite,
        desc: `At or below the Micro-Purchase Threshold (${fmtExact(mptV)}). Micro-purchase procedures generally apply (RFO 13.2) — competitive quotes are not required and purchases should be distributed equitably among qualified suppliers.` };
    } else if (amt <= satV) {
      band = { cls: 'sap', tag: 'Simplified acquisition', cite: sat.cite,
        desc: `Above the Micro-Purchase Threshold and at or below the Simplified Acquisition Threshold (${fmtExact(satV)}). Simplified Acquisition Procedures are available (RFO Part 13); acquisitions in this range are generally reserved for small business.` };
    } else {
      band = { cls: 'open', tag: 'Above the SAT', cite: sat.cite,
        desc: `Above the Simplified Acquisition Threshold (${fmtExact(satV)}). Full and open competition generally applies (RFO Part 6), using negotiated procedures (RFO Part 15) unless a documented exception applies. Commercial products and services may still use simplified procedures up to ${fmtExact(sapV)} (RFO 13.500).` };
    }
    const triggerDefs = [
      { row: thrFind((t) => t.abbr === 'TINA'), label: 'Certified cost or pricing data (TINA)', cond: 'unless an exception applies — e.g., adequate price competition or commercial products/services' },
      { row: thrFind((t) => /Subcontracting/i.test(t.name)), label: 'Subcontracting plan', cond: 'for other-than-small businesses when subcontracting opportunities exist' },
      { row: thrFind((t) => t.abbr === 'J&A'), label: 'J&A — first approval tier', cond: 'only when awarding other than full and open competition' }
    ];
    const triggers = triggerDefs.filter((d) => d.row).map((d) => {
      const v = thrScopeVal(d.row);
      return { label: d.label, cite: d.row.cite, on: amt > v, value: v, cond: d.cond };
    });
    thrLast = { amt: amt, scope: thrScope, band: band, triggers: triggers };
    const trigRows = triggers.map((t) => `<div class="thr-trig ${t.on ? 'on' : 'off'}">
        <span class="thr-trig-mark" aria-hidden="true">${t.on ? '●' : '○'}</span>
        <span class="thr-trig-body">
          <span class="thr-trig-label">${esc(t.label)} <button type="button" class="thr-trig-cite" data-cite="${esc(t.cite)}">${esc(t.cite)}</button></span>
          <span class="thr-trig-detail">${t.on ? 'Generally required above' : 'Not required at or below'} ${fmtExact(t.value)}${t.on ? ` — ${esc(t.cond)}` : ''}.</span>
        </span>
      </div>`).join('');
    out.classList.add('on');
    out.innerHTML = `
      <div class="thr-band thr-band-${band.cls}">
        <div class="thr-band-top"><span class="thr-band-amt">${fmtExact(amt)}</span><span class="thr-band-tag">${esc(band.tag)}</span></div>
        <div class="thr-band-desc">${band.desc}</div>
        <button type="button" class="thr-band-cite" data-cite="${esc(band.cite)}">Read ${esc(band.cite)} →</button>
      </div>
      <div class="thr-trig-head">At ${fmtExact(amt)}, these thresholds are crossed${thrScope === 'con' ? ' (contingency ceilings)' : ''}:</div>
      <div class="thr-trig-list">${trigRows}</div>
      <div class="thr-calc-foot-row">
        <span class="thr-calc-verify">A mechanical comparison to the cited thresholds below — always verify against the live RFO and any class deviations before acting.</span>
        <button type="button" class="thr-note-btn">⧉ Copy as file note</button>
      </div>`;
  }
  function buildThrNote(t) {
    if (!t) return '';
    const lines = [];
    lines.push(`Threshold check — ${fmtExact(t.amt)}${t.scope === 'con' ? ' (contingency / emergency ceilings)' : ' (standard)'}`);
    lines.push('');
    lines.push(`Regime: ${t.band.tag}. ${t.band.desc}`);
    lines.push('');
    lines.push(`Thresholds at ${fmtExact(t.amt)}:`);
    t.triggers.forEach((tr) => {
      lines.push(`  - ${tr.label} — ${tr.on ? 'generally required above' : 'not required at or below'} ${fmtExact(tr.value)} (${tr.cite})${tr.on ? ` — ${tr.cond}` : ''}.`);
    });
    lines.push('');
    lines.push('Mechanical comparison to current thresholds — verify against the live RFO and any class deviations before acting. (via AcqVault)');
    return lines.join('\n');
  }
  function copyThrNote(btn) {
    const text = buildThrNote(thrLast);
    if (!text) return;
    if (typeof window.copyTextTo === 'function') window.copyTextTo(text, btn, '⧉ Copy as file note');
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
  }
  function initThresholds() {
    const scope = $('#thr-scope'); if (!scope) return;
    scope.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-scope]'); if (!b) return;
      thrScope = b.dataset.scope;
      scope.querySelectorAll('button').forEach((x) => {
        const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on);
      });
      renderThresholds(true);
      renderThrCalc();
    });
    renderThresholds(false);
    const amt = $('#thr-amount'), clr = $('#thr-amount-clear'), out = $('#thr-calc-out');
    if (amt) {
      amt.addEventListener('input', () => { amt.value = fmtAmountInput(amt.value); renderThrCalc(); });
      amt.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    }
    if (clr) clr.addEventListener('click', () => { amt.value = ''; amt.focus(); renderThrCalc(); });
    if (out) out.addEventListener('click', (e) => {
      const note = e.target.closest('.thr-note-btn'); if (note) { copyThrNote(note); return; }
      const b = e.target.closest('[data-cite]'); if (b) thrJumpToCite(b.dataset.cite);
    });
    renderThrCalc();
  }

  /* ════════════════════════════════════════════════════════════
     2) ACRONYM DECODER  (lookup + auto-tooltip)
     ════════════════════════════════════════════════════════════ */
  window.ACRONYMS = ACRONYMS; // expose for the search acronym-assist in app.js (read-only)
  const ACRO_ENTRIES = Object.keys(ACRONYMS).map((k) => ({ term: k, exp: ACRONYMS[k][0], note: ACRONYMS[k][1] || '' }))
    .sort((a, b) => a.term.localeCompare(b.term));

  function renderAcroResults(q) {
    const box = $('#acro-results'); const count = $('#acro-count'); if (!box) return;
    const qq = q.trim().toLowerCase();
    let rows = ACRO_ENTRIES;
    if (qq) {
      rows = ACRO_ENTRIES.filter((e) =>
        e.term.toLowerCase().includes(qq) || e.exp.toLowerCase().includes(qq));
      // term-prefix matches first
      rows.sort((a, b) => {
        const ap = a.term.toLowerCase().startsWith(qq) ? 0 : 1;
        const bp = b.term.toLowerCase().startsWith(qq) ? 0 : 1;
        return ap - bp || a.term.localeCompare(b.term);
      });
    }
    if (count) count.textContent = rows.length ? rows.length + (qq ? ' match' + (rows.length > 1 ? 'es' : '') : ' terms') : '';
    if (!rows.length) { box.innerHTML = `<div class="acro-empty">No acronym matches \u201C${esc(q)}\u201D</div>`; return; }
    const hl = (txt) => {
      if (!qq) return esc(txt);
      const i = txt.toLowerCase().indexOf(qq);
      if (i < 0) return esc(txt);
      return esc(txt.slice(0, i)) + '<mark>' + esc(txt.slice(i, i + qq.length)) + '</mark>' + esc(txt.slice(i + qq.length));
    };
    box.innerHTML = rows.slice(0, 60).map((e) =>
      `<div class="acro-item"><div class="acro-term">${hl(e.term)}</div><div class="acro-exp">${hl(e.exp)}${e.note ? `<small>${esc(e.note)}</small>` : ''}</div></div>`
    ).join('');
  }
  function initAcroLookup() {
    const input = $('#acro-input'); if (!input) return;
    input.addEventListener('input', () => renderAcroResults(input.value));
    renderAcroResults('');
  }

  // ----- auto-decoration in reader/drawer -----
  let acroRegex = null;
  function buildAcroRegex() {
    const terms = Object.keys(ACRONYMS)
      .filter((t) => t.length >= 3 && !NO_AUTODECORATE.has(t))
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&'));
    acroRegex = new RegExp('(?<![A-Za-z0-9/&])(' + terms.join('|') + ')(?![A-Za-z0-9])', 'g');
  }
  function decorate(root) {
    if (!root || !acroRegex) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.length < 3) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === 'ABBR' || tag === 'MARK' || tag === 'A' || tag === 'BUTTON' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        if (p.closest('abbr.acq-acro')) return NodeFilter.FILTER_REJECT;
        acroRegex.lastIndex = 0;
        return acroRegex.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const targets = [];
    let n; while ((n = walker.nextNode())) targets.push(n);
    targets.forEach((node) => {
      acroRegex.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      const text = node.nodeValue;
      while ((m = acroRegex.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const ab = document.createElement('abbr');
        ab.className = 'acq-acro';
        ab.dataset.acro = m[1];
        ab.textContent = m[1];
        frag.appendChild(ab);
        last = m.index + m[1].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }
  function initAcroTooltips() {
    buildAcroRegex();
    let tip = $('#acro-tip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'acro-tip'; document.body.appendChild(tip); }
    const show = (ab) => {
      const key = ab.dataset.acro; const d = ACRONYMS[key]; if (!d) return;
      tip.innerHTML = `<span class="at-term">${esc(key)}</span>${esc(d[0])}${d[1] ? ` \u2014 ${esc(d[1])}` : ''}`;
      const r = ab.getBoundingClientRect();
      tip.style.left = Math.max(10, Math.min(r.left, window.innerWidth - 272)) + 'px';
      tip.style.top = (r.bottom + 8) + 'px';
      tip.classList.add('show');
    };
    const hide = () => tip.classList.remove('show');
    document.addEventListener('mouseover', (e) => { const ab = e.target.closest && e.target.closest('abbr.acq-acro'); if (ab) show(ab); });
    document.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('abbr.acq-acro')) hide(); });
    document.addEventListener('focusin', (e) => { const ab = e.target.closest && e.target.closest('abbr.acq-acro'); if (ab) show(ab); });
    document.addEventListener('scroll', hide, true);

    // watch reader + drawer content for new text, decorate it
    let scheduled = false;
    const queue = new Set();
    const flush = () => { scheduled = false; queue.forEach((el) => decorate(el)); queue.clear(); };
    ['#drawer-content', '#reader-content'].forEach((sel) => {
      const el = $(sel); if (!el) return;
      const mo = new MutationObserver(() => {
        queue.add(el);
        if (!scheduled) { scheduled = true; setTimeout(flush, 120); }
      });
      mo.observe(el, { childList: true, subtree: true });
      if (el.children.length) decorate(el);
    });
  }

  /* ════════════════════════════════════════════════════════════
     3) WHAT'S NEW SINCE LAST VISIT
     ════════════════════════════════════════════════════════════ */
  const LAST_VISIT_KEY = 'acqvault_last_visit';
  function relTime(then) {
    const ms = Date.now() - then; const d = Math.floor(ms / 86400000);
    if (d <= 0) { const h = Math.floor(ms / 3600000); return h <= 1 ? 'earlier today' : h + ' hours ago'; }
    if (d === 1) return 'yesterday'; if (d < 7) return d + ' days ago';
    if (d < 30) return Math.floor(d / 7) + ' week' + (d < 14 ? '' : 's') + ' ago';
    return Math.floor(d / 30) + ' month' + (d < 60 ? '' : 's') + ' ago';
  }
  function typeLabel(t) {
    const tl = (t || '').toLowerCase();
    if (tl.includes('proposed')) return ['Proposed Rule', 'wn-type-proposed'];
    if (tl.includes('interim')) return ['Interim Rule', 'wn-type-interim'];
    if (tl.includes('final') || tl === 'rule') return ['Final Rule', 'wn-type-final'];
    if (tl.includes('notice')) return ['Notice', 'wn-type-other'];
    return [t || 'Notice', 'wn-type-other'];
  }
  async function loadWhatsNew() {
    const list = $('#wn-list'); const metaL = $('#wn-meta-left'); const badge = $('#wn-badge');
    if (!list) return;
    const prevRaw = localStorage.getItem(LAST_VISIT_KEY);
    const prev = prevRaw ? Number(prevRaw) : null;
    const firstVisit = !prev;
    try {
      const url = 'https://www.federalregister.gov/api/v1/documents.json'
        + '?conditions[agencies][]=defense-acquisition-regulations-system'
        + '&conditions[agencies][]=federal-acquisition-regulation'
        + '&conditions[type][]=RULE&conditions[type][]=PRORULE'
        + '&per_page=8&order=newest'
        + '&fields[]=title&fields[]=publication_date&fields[]=type&fields[]=document_number&fields[]=html_url';
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('FR API');
      const data = await res.json();
      const docs = data.results || [];
      if (!docs.length) throw new Error('empty');

      const cutoff = firstVisit ? Date.now() - 14 * 86400000 : prev;
      let newCount = 0;
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      list.innerHTML = docs.map((doc) => {
        const dt = doc.publication_date ? new Date(doc.publication_date + 'T00:00:00') : null;
        const isNew = dt && dt.getTime() >= cutoff;
        if (isNew) newCount++;
        const [tlabel, tcls] = typeLabel(doc.type);
        const dd = dt ? `<b>${dt.getDate()}</b>${months[dt.getMonth()]}` : '\u2014';
        return `<a class="wn-item${isNew ? ' is-new' : ''}" href="${esc(doc.html_url || '#')}" target="_blank" rel="noopener">
          <div class="wn-date">${dd}</div>
          <div class="wn-body">
            <div class="wn-title">${esc(doc.title || 'Untitled')}</div>
            <div class="wn-tags">
              <span class="wn-type ${tcls}">${esc(tlabel)}</span>
              ${isNew ? '<span class="wn-newtag">\u25CF NEW</span>' : ''}
              <span class="wn-docnum">${esc(doc.document_number || '')}</span>
            </div>
          </div>
        </a>`;
      }).join('');

      if (metaL) metaL.innerHTML = firstVisit
        ? 'Welcome \u2014 here\u2019s the <b>latest rulemaking</b>'
        : `You were last here <b>${relTime(prev)}</b>`;
      if (badge) {
        if (newCount > 0) { badge.textContent = newCount + ' new'; badge.classList.remove('zero'); }
        else { badge.textContent = 'Up to date'; badge.classList.add('zero'); }
      }
    } catch (e) {
      if (metaL) metaL.textContent = 'Live feed unavailable right now';
      if (badge) { badge.textContent = '\u2014'; badge.classList.add('zero'); }
      list.innerHTML = `<a class="wn-item" href="https://www.federalregister.gov/agencies/defense-acquisition-regulations-system" target="_blank" rel="noopener">
        <div class="wn-date"><b>\u2192</b>FR</div>
        <div class="wn-body"><div class="wn-title">Open the latest RFO / R-DFARS rules on the Federal Register</div>
        <div class="wn-tags"><span class="wn-type wn-type-other">Federal Register</span></div></div></a>`;
    } finally {
      // stamp this visit AFTER computing "new" against the previous one
      localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    }
  }

  /* ════════════════════════════════════════════════════════════
     4) SPENDING DASHBOARD
     ════════════════════════════════════════════════════════════ */
  let dashDays = 365;
  let dashFYLoaded = false;
  let dashReqToken = 0;
  const winLabel = (d) => d >= 1095 ? 'last 3 years' : d >= 365 ? 'last 12 months' : 'last ' + d + ' days';

  function animateNum(el, target, fmt) {
    if (!el) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(target); return; }
    const start = performance.now(); const dur = 900; const from = 0;
    function step(t) {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (target - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  async function loadDashFY() {
    if (dashFYLoaded) return;
    const el = $('#dash-fy'); if (!el) return;
    const now = new Date();
    const fyStartYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
    const fy = fyStartYear + 1;
    try {
      const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_over_time/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: 'fiscal_year', spending_level: 'transactions',
          filters: {
            agencies: [{ type: 'awarding', tier: 'subtier', name: 'Department of the Air Force' }],
            award_type_codes: ['A', 'B', 'C', 'D'],
            time_period: [{ start_date: fyStartYear + '-10-01', end_date: now.toISOString().slice(0, 10) }]
          }
        })
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      const row = (d.results || []).find((r) => r.time_period && Number(r.time_period.fiscal_year) === fy) || (d.results || [])[0];
      const val = row && (row.Contract_Obligations || row.aggregated_amount);
      if (!Number.isFinite(Number(val))) throw new Error();
      animateNum(el, Number(val), fmtUSD);
      const foot = $('#dash-fy-foot'); if (foot) foot.textContent = 'FY' + fy + ' to date';
      dashFYLoaded = true;
    } catch (e) { el.textContent = 'Delayed'; el.style.fontSize = '20px'; }
  }

  async function fetchTx(days) {
    const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - days);
    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_transaction/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          agencies: [{ type: 'awarding', tier: 'subtier', name: 'Department of the Air Force' }],
          award_type_codes: ['A', 'B', 'C', 'D'],
          time_period: [{ start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) }]
        },
        fields: ['Action Date', 'Award ID', 'Recipient Name', 'Transaction Amount', 'Awarding Sub Agency', 'Transaction Description', 'Mod'],
        sort: 'Transaction Amount', order: 'desc', limit: 100, page: 1
      })
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const d = await res.json();
    return (d.results || []).filter((r) => r['Recipient Name'] && Number(r['Transaction Amount']) > 0);
  }
  // "What the Air Force buys" — top product/service categories (PSC) for the window.
  async function fetchPsc(days) {
    const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - days);
    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category/psc/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          agencies: [{ type: 'awarding', tier: 'subtier', name: 'Department of the Air Force' }],
          award_type_codes: ['A', 'B', 'C', 'D'],
          time_period: [{ start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) }]
        },
        limit: 6, page: 1
      })
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const d = await res.json();
    return (d.results || []).filter((r) => Number(r.amount) > 0);
  }
  function titleCasePsc(s) {
    return String(s || '').toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
  }

  // FLIP: swap a ranked-bar panel's HTML and animate rows that moved/appeared.
  function flipUpdate(container, newHTML) {
    if (!container) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const olds = {};
    container.querySelectorAll('.dash-bar-row[data-key]').forEach((r) => { olds[r.dataset.key] = r.getBoundingClientRect().top; });
    container.innerHTML = newHTML;
    if (reduce) return;
    container.querySelectorAll('.dash-bar-row[data-key]').forEach((r) => {
      const old = olds[r.dataset.key];
      if (old !== undefined) {                       // persisted — slide from old rank to new
        const dy = old - r.getBoundingClientRect().top;
        if (dy) {
          r.style.transition = 'none'; r.style.transform = 'translateY(' + dy + 'px)';
          requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transition = 'transform .5s var(--ease-out)'; r.style.transform = ''; }));
        }
      } else {                                        // new entrant — fade/slide in
        r.style.transition = 'none'; r.style.opacity = '0'; r.style.transform = 'translateY(7px)';
        requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transition = 'opacity .4s ease, transform .4s var(--ease-out)'; r.style.opacity = ''; r.style.transform = ''; }));
      }
    });
  }

  async function loadDashWindow(days) {
    const token = ++dashReqToken;            // race guard for rapid clicks
    const recipBox = $('#dash-recipients'); const largeBox = $('#dash-largest');
    // Only skeleton on first load \u2014 on window switches keep the old bars visible so
    // the update FLIP-animates instead of flashing a reload.
    const skel = '<div class="dash-loading dash-skeleton">Loading\u2026</div>';
    if (recipBox && !recipBox.querySelector('.dash-bar-row')) recipBox.innerHTML = skel;
    if (largeBox && !largeBox.querySelector('.dash-bar-row')) largeBox.innerHTML = skel;
    try {
      // USASpending transaction data lags ~2\u20133 months; expand window until we have data.
      const ladder = [90, 180, 365, 1095].filter((d) => d >= days);
      if (!ladder.length) ladder.push(days);
      let rows = [], usedDays = days, expanded = false;
      for (let i = 0; i < ladder.length; i++) {
        usedDays = ladder[i];
        rows = await fetchTx(usedDays);
        if (token !== dashReqToken) return;  // a newer request superseded this one
        if (rows.length >= 3 || i === ladder.length - 1) { expanded = usedDays !== days; break; }
        await new Promise((r) => setTimeout(r, 250));
      }
      const lbl = winLabel(usedDays) + (expanded ? ' \u00B7 latest available' : '');
      ['#dash-recip-window', '#dash-largest-window', '#dash-psc-window', '#dash-count-foot', '#dash-sum-foot'].forEach((s) => { const el = $(s); if (el) el.textContent = lbl; });
      if (!rows.length) throw new Error('empty');

      const total = rows.reduce((s, r) => s + Number(r['Transaction Amount'] || 0), 0);
      const max = rows.reduce((m, r) => Math.max(m, Number(r['Transaction Amount'] || 0)), 0);
      animateNum($('#dash-count'), rows.length, (v) => String(Math.round(v)) + (rows.length >= 100 ? '+' : ''));
      animateNum($('#dash-sum'), total, fmtUSD);
      animateNum($('#dash-max'), max, fmtUSD);

      // top recipients
      const byRecip = {};
      rows.forEach((r) => {
        const k = cleanName(r['Recipient Name']);
        byRecip[k] = (byRecip[k] || 0) + Number(r['Transaction Amount'] || 0);
      });
      const top = Object.entries(byRecip).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const topMax = top.length ? top[0][1] : 1;
      flipUpdate(recipBox, top.map(([name, amt]) =>
        `<div class="dash-bar-row" data-key="r:${esc(name)}">
          <div class="dash-bar-top"><div class="dash-bar-name">${esc(name)}</div><div class="dash-bar-val">${fmtUSD(amt)}</div></div>
          <div class="dash-bar-track" aria-hidden="true"><div class="dash-bar-fill" style="width:0"></div></div>
        </div>`).join(''));
      requestAnimationFrame(() => {
        recipBox.querySelectorAll('.dash-bar-fill').forEach((f, i) => { f.style.width = Math.max(4, (top[i][1] / topMax) * 100) + '%'; });
      });

      // largest actions
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const largest = rows.slice(0, 6);
      const actMax = largest.length ? (Math.max(...largest.map((r) => Number(r['Transaction Amount'] || 0))) || 1) : 1;
      flipUpdate(largeBox, largest.map((r) => {
        const dt = (r['Action Date'] || '').slice(0, 10);
        const dd = dt ? months[Number(dt.slice(5, 7)) - 1] + ' ' + Number(dt.slice(8, 10)) : '';
        const key = (r['Award ID'] || cleanName(r['Recipient Name'])) + ':' + (r['Transaction Amount'] || '');
        return `<div class="dash-bar-row" data-key="l:${esc(key)}" style="margin-bottom:11px">
          <div class="dash-bar-top"><div class="dash-bar-name">${esc(cleanName(r['Recipient Name']))}</div><div class="dash-bar-val">${fmtUSD(r['Transaction Amount'])}</div></div>
          <div class="dash-bar-track" aria-hidden="true"><div class="dash-bar-fill" style="width:0"></div></div>
          <div class="dash-bar-sub">${esc(r['Award ID'] || '')}${dd ? ' \u00B7 ' + dd : ''}</div>
        </div>`;
      }).join(''));
      requestAnimationFrame(() => {
        largeBox.querySelectorAll('.dash-bar-fill').forEach((f, i) => { f.style.width = Math.max(4, (Number(largest[i]['Transaction Amount'] || 0) / actMax) * 100) + '%'; });
      });

      // "What the Air Force buys" — top PSC categories (separate call; don't block the bars above).
      const pscBox = $('#dash-psc');
      if (pscBox) {
        fetchPsc(usedDays).then((psc) => {
          if (token !== dashReqToken || !psc.length) { if (!psc || !psc.length) pscBox.innerHTML = '<div class="dash-loading dash-skeleton">No category data for this window.</div>'; return; }
          const pscMax = psc[0].amount || 1;
          flipUpdate(pscBox, psc.map((r) =>
            `<div class="dash-bar-row" data-key="p:${esc(r.code || r.name)}">
              <div class="dash-bar-top"><div class="dash-bar-name">${esc(titleCasePsc(r.name))}</div><div class="dash-bar-val">${fmtUSD(r.amount)}</div></div>
              <div class="dash-bar-track" aria-hidden="true"><div class="dash-bar-fill" style="width:0"></div></div>
            </div>`).join(''));
          requestAnimationFrame(() => {
            pscBox.querySelectorAll('.dash-bar-fill').forEach((f, i) => { f.style.width = Math.max(4, (psc[i].amount / pscMax) * 100) + '%'; });
          });
        }).catch(() => { if (pscBox.querySelector('.dash-loading')) pscBox.innerHTML = '<div class="dash-loading dash-skeleton">Category data briefly unavailable.</div>'; });
      }
    } catch (e) {
      if (token !== dashReqToken) return;
      const msg = '<div class="dash-loading dash-skeleton">Live spending data is briefly unavailable \u2014 USASpending may be rate-limiting. It\u2019ll refresh shortly.</div>';
      if (recipBox) recipBox.innerHTML = msg; if (largeBox) largeBox.innerHTML = '';
    }
  }
  function cleanName(t) {
    let s = String(t || '')
      .replace(/,?\s*(L\.?L\.?C\.?|INC\.?|INCORPORATED|CORP\.?|CORPORATION|LTD\.?|L\.?P\.?|CO\.?|COMPANY|TECHNOLOGIES|SYSTEMS|HOLDINGS)\b/gi, '')
      .replace(/^THE\s+/i, '')
      .replace(/[.,\s]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return 'Unnamed recipient';
    // Title-case ALL-CAPS names for readability
    if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
    return s;
  }
  function initDashboard() {
    const win = $('#dash-window'); if (!win) return;
    if (window.initSegGlider) window.initSegGlider(win, 'button', (b) => b.classList.contains('active'));
    win.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-days]'); if (!b) return;
      win.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      if (win._segRest) win._segRest();
      dashDays = Number(b.dataset.days);
      loadDashWindow(dashDays);
    });
    // lazy-load on first scroll into view
    const sec = $('#spending-dashboard');
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) { loadDashFY(); loadDashWindow(dashDays); io.disconnect(); } });
    }, { rootMargin: '200px' });
    io.observe(sec);
  }

  function initMarketResearch() {
    const section = $('#market-research'); if (!section) return;
    const query = $('#market-query-input');
    const btn = $('#market-snapshot-btn');
    const list = $('#market-results-list');
    const count = $('#market-results-count');
    const sub = $('#market-results-sub');
    const noticeWrap = $('#market-notice-types');
    const escAttr = (s) => esc(s).replace(/'/g, '&#39;');
    const filtersEl = $('#market-active-filters');
    const SETASIDE_LABELS = { SBA: 'Small business', '8A': '8(a)', HZC: 'HUBZone', SDVOSBC: 'SDVOSB', WOSB: 'WOSB', EDWOSB: 'EDWOSB' };
    const WINDOW_LABELS = { '90': 'Last 90 days', '365': 'Last 12 months', '1095': 'Last 3 years' };
    const EXAMPLES = [
      { label: 'Base operations support', query: 'base operations support' },
      { label: 'Aircraft parts · PSC 1560', query: '', psc: '1560' },
      { label: 'IT services · NAICS 541512', query: '', naics: '541512' },
      { label: 'Janitorial · NAICS 561720', query: '', naics: '561720' }
    ];

    /* ── PIN-TO-BOARD ──────────────────────────────────────────────
       A persistent working set of opportunities in localStorage (no
       account, nothing leaves the browser — same model as saved.js).
       This is the spine: pattern summary + FAR Part 10 MR note hang
       off the pinned set in later phases. ───────────────────────── */
    const PIN_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M6.5 3.25h11a1 1 0 0 1 1 1V21l-6.5-3.9L5.5 21V4.25a1 1 0 0 1 1-1Z"/></svg>';
    const BOARD_KEY = 'acqvault_market_board_v1';
    const PIN_FIELDS = ['id', 'title', 'type', 'organization', 'postedDate', 'naicsCode', 'classificationCode', 'setAside', 'awardAmount', 'awardee', 'responseDeadline', 'uiLink', 'solicitationNumber', 'attachments'];
    const boardLoad = () => { try { const a = JSON.parse(localStorage.getItem(BOARD_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
    const boardSave = () => { try { localStorage.setItem(BOARD_KEY, JSON.stringify(board)); } catch (e) { /* private mode / quota: degrade */ } };
    const oppKey = (o) => String((o && (o.id || o.uiLink || o.solicitationNumber || o.title)) || '');
    const isPinned = (k) => board.some(o => oppKey(o) === k);
    const compactForBoard = (o) => { const c = {}; PIN_FIELDS.forEach(f => { if (o[f] != null) c[f] = o[f]; }); return c; };
    let board = boardLoad();
    let lastOppByKey = {};
    let boardBtn = null;
    let trayOpen = false;

    // board tray (slide-in) + backdrop — created once, appended to body
    const boardTray = document.createElement('div');
    boardTray.className = 'market-board-tray';
    boardTray.id = 'market-board-tray';
    boardTray.setAttribute('role', 'dialog');
    boardTray.setAttribute('aria-label', 'Pinned opportunities board');
    boardTray.hidden = true;
    const boardBackdrop = document.createElement('div');
    boardBackdrop.className = 'market-board-backdrop';
    boardBackdrop.hidden = true;
    document.body.appendChild(boardBackdrop);
    document.body.appendChild(boardTray);

    function updateBoardBtn() {
      if (!boardBtn) return;
      const n = board.length;
      boardBtn.innerHTML = `${PIN_SVG}<span>Board</span><span class="market-board-badge">${n}</span>`;
      boardBtn.classList.toggle('has-items', n > 0);
      boardBtn.setAttribute('aria-label', `Open board — ${n} pinned opportunit${n === 1 ? 'y' : 'ies'}`);
    }
    // reflect pinned state on any currently-rendered result cards
    function syncPinUI() {
      list?.querySelectorAll('.market-opp-pin').forEach(b => {
        const on = isPinned(b.dataset.pin);
        b.classList.toggle('pinned', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.setAttribute('aria-label', on ? 'Remove from board' : 'Pin to board');
        b.setAttribute('title', on ? 'Pinned to your board' : 'Pin to your board');
      });
    }
    function togglePin(key) {
      const i = board.findIndex(o => oppKey(o) === key);
      if (i >= 0) board.splice(i, 1);
      else { const item = lastOppByKey[key]; if (!item) return; board.push(compactForBoard(item)); }
      boardSave(); syncPinUI(); updateBoardBtn();
      if (trayOpen) renderBoardTray();
    }
    function removeFromBoard(key) {
      const i = board.findIndex(o => oppKey(o) === key);
      if (i >= 0) { board.splice(i, 1); boardSave(); syncPinUI(); updateBoardBtn(); renderBoardTray(); }
    }
    function clearBoard() { board = []; boardSave(); syncPinUI(); updateBoardBtn(); renderBoardTray(); }
    // Pattern summary over the pinned set — pure client-side counting, no charts.
    // NAICS/PSC chips refine the live search; the rest is read-only.
    function tally(getter) {
      const m = new Map();
      board.forEach(o => { const v = getter(o); if (v) m.set(v, (m.get(v) || 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }
    function patternRow(label, entries, refineKey) {
      if (!entries.length) return '';
      const chips = entries.slice(0, 4).map(([val, ct]) => {
        if (refineKey) return `<button type="button" class="market-pat-chip refine" data-refine="${refineKey}" data-val="${escAttr(val)}" title="Refine search to ${escAttr(val)}">${esc(val)}<span class="market-pat-ct">${ct}</span></button>`;
        return `<span class="market-pat-chip">${esc(val)}<span class="market-pat-ct">${ct}</span></span>`;
      }).join('');
      return `<div class="market-pat-row"><span class="market-pat-label">${esc(label)}</span><span class="market-pat-vals">${chips}</span></div>`;
    }
    function patternsHTML() {
      if (board.length < 2) return '';
      const dates = board.map(o => o.postedDate).filter(Boolean).sort();
      const rows = [
        patternRow('Notice type', tally(o => o.type)),
        patternRow('Top offices', tally(o => o.organization)),
        patternRow('NAICS', tally(o => o.naicsCode), 'naics'),
        patternRow('PSC', tally(o => o.classificationCode), 'psc'),
        patternRow('Set-aside', tally(o => o.setAside))
      ].filter(Boolean);
      if (dates.length) {
        const span = dates.length > 1 ? `${dates[0]} → ${dates[dates.length - 1]}` : dates[0];
        rows.push(`<div class="market-pat-row"><span class="market-pat-label">Posted</span><span class="market-pat-span">${esc(span)}</span></div>`);
      }
      if (!rows.length) return '';
      return `<div class="market-patterns"><div class="market-pat-head">Patterns across ${board.length} pinned</div>${rows.join('')}</div>`;
    }
    // ── USASpending.gov: comparable awards + incumbents for the pinned market ──
    // (authoritative award $ + incumbent — SAM notices are a weaker signal). Fetched
    // via our server-side /api/usaspending proxy (CORS + CAC block direct calls).
    let usaData = null;
    let usaState = 'idle'; // idle | loading | ready | empty | error
    let usaSig = '';
    const usaCodes = () => ({ naics: mrDistinct(o => o.naicsCode), psc: mrDistinct(o => o.classificationCode) });
    const usaFmt = (v) => { const n = Number(v); return isFinite(n) ? '$' + Math.round(n).toLocaleString() : '—'; };
    const boardSig = () => { const c = usaCodes(); return c.naics.slice().sort().join(',') + '|' + c.psc.slice().sort().join(','); };
    function paintUsa() { const el = document.getElementById('market-usa'); if (el) el.innerHTML = usaInnerHTML(); }
    async function loadUsa() {
      const c = usaCodes();
      if (!c.naics.length && !c.psc.length) { usaState = 'idle'; paintUsa(); return; }
      const sig = boardSig();
      if (sig === usaSig && (usaState === 'ready' || usaState === 'empty')) { paintUsa(); return; }
      usaSig = sig; usaState = 'loading'; paintUsa();
      try {
        const r = await fetch('/api/usaspending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naics: c.naics, psc: c.psc, years: 3 }) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'USASpending request failed');
        usaData = data;
        usaState = (data.awards && data.awards.length) ? 'ready' : 'empty';
      } catch (e) { usaState = 'error'; }
      paintUsa();
    }
    function usaInnerHTML() {
      const head = `<div class="market-usa-head">Incumbents &amp; recent awards <span class="market-usa-src">USASpending.gov</span></div>`;
      if (usaState === 'loading') return head + '<div class="market-usa-msg">Loading award history…</div>';
      if (usaState === 'error') return head + '<div class="market-usa-msg">Award history unavailable right now.</div>';
      if (usaState === 'empty') return head + '<div class="market-usa-msg">No contract awards found for these NAICS/PSC in the last 3 FY.</div>';
      if (usaState !== 'ready' || !usaData) return '';
      const recips = (usaData.recipients || []).map(r => `<div class="market-usa-recip"><span class="market-usa-name">${esc(r.name)}</span><span class="market-usa-amt">${usaFmt(r.total)}${r.count ? ` <span class="market-usa-ct">${r.count} award${r.count === 1 ? '' : 's'}</span>` : ''}</span></div>`).join('');
      const awards = (usaData.awards || []).slice(0, 5).map(a => `<a class="market-usa-award" href="${escAttr(a.link)}" target="_blank" rel="noopener"><span class="market-usa-aw-top"><span class="market-usa-name">${esc(a.recipient || '—')}</span><span class="market-usa-amt">${usaFmt(a.amount)}</span></span><span class="market-usa-aw-sub">${esc(a.agency || '')}${a.start ? ' · ' + esc(a.start) : ''}</span></a>`).join('');
      const recLbl = usaData.recipientsScope === 'market' ? 'Top recipients in this market (by total obligated $)' : 'Top recipients by obligated $';
      return `<div class="market-usa-head">Incumbents &amp; recent awards <span class="market-usa-src">USASpending · last ${usaData.years} FY</span></div>`
        + `<div class="market-usa-lbl">${recLbl}</div>${recips}`
        + `<div class="market-usa-lbl">Largest recent awards</div>${awards}`;
    }
    // MR note section — historical awards + incumbents (only when data loaded)
    function usaNoteHTML() {
      if (usaState !== 'ready' || !usaData || !(usaData.awards || []).length) return '';
      const recips = (usaData.recipients || []).map(r => `<span class="chip">${esc(r.name)} <b>${esc(usaFmt(r.total))}</b></span>`).join('');
      const rows = (usaData.awards || []).slice(0, 8).map(a => `<tr><td><div class="t-title">${esc(a.recipient || '—')}</div><div class="t-org">${esc(a.agency || '')}${a.subAgency ? ' · ' + esc(a.subAgency) : ''}</div></td><td class="t-mono">${esc(a.start || '')}</td><td class="t-award">${esc(usaFmt(a.amount))}</td><td class="t-mono">${esc(a.type || '')}</td></tr>`).join('');
      return `<div class="sec"><div class="sec-eyebrow"><span class="sec-title">Incumbents &amp; historical awards</span></div>
        <div class="pat"><div class="pat-row"><div class="pat-k">Top recipients</div><div class="pat-v">${recips}</div></div></div>
        <table style="margin-top:10px"><thead><tr><th style="width:44%">Recipient / awarding agency</th><th style="width:16%">Start</th><th style="width:20%">Obligated</th><th style="width:20%">Type</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="foot" style="margin-top:8px;border:none;padding:0;">Source: USASpending.gov (FPDS) — top contract awards by obligated amount, last ${usaData.years} FY. Authoritative for award $ and incumbent; SAM notices above are a weaker signal for award value.</div></div>`;
    }
    // ── FAR/RFO Part 10 market research note (client-side print-to-PDF, CAC-safe) ──
    const mrDistinct = (getter) => [...new Set(board.map(getter).filter(Boolean))];
    const mrSpan = () => { const d = board.map(o => o.postedDate).filter(Boolean).sort(); return d.length ? (d.length > 1 ? `${d[0]} → ${d[d.length - 1]}` : d[0]) : '—'; };
    const mrAwardText = (o) => { const amt = fmtAmount(o.awardAmount); const head = amt || (o.awardAmount ? 'Awarded' : ''); return [head, o.awardee || ''].filter(Boolean).join(' · '); };
    const MRCSS = `
      @font-face{font-family:'Source Serif 4';src:url('/assets/fonts/source-serif4-latin.woff2') format('woff2');font-weight:400 900;font-display:swap;}
      @font-face{font-family:'Inter';src:url('/assets/fonts/inter-latin.woff2') format('woff2');font-weight:400 800;font-display:swap;}
      @font-face{font-family:'IBM Plex Mono';src:url('/assets/fonts/ibm-plex-mono-latin.woff2') format('woff2');font-weight:400;font-display:swap;}
      @font-face{font-family:'IBM Plex Mono';src:url('/assets/fonts/ibm-plex-mono-sb-latin.woff2') format('woff2');font-weight:600;font-display:swap;}
      :root{--brass:#87651c;--brass-ink:#5e4715;--brass-bg:#fbf6e8;--brass-line:rgba(154,115,32,.40);--navy:#0f2540;--ink:#13151b;--ink2:#262a31;--muted:#5e5d66;--muted2:#6f6c74;--off:#f7f6f2;--line:#d9d4c7;--line2:#e8e5de;--ink3:#474c55;}
      @page{size:Letter;margin:0.7in 0.72in;}
      *{box-sizing:border-box;} html,body{margin:0;padding:0;}
      body{font-family:'Inter',system-ui,sans-serif;color:var(--ink2);font-size:10.5px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff;}
      .toolbar{position:sticky;top:0;display:flex;align-items:center;gap:12px;background:var(--navy);color:#fff;padding:10px 16px;font-size:12px;}
      .toolbar button{background:var(--brass);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;font-size:12px;cursor:pointer;}
      .toolbar span{color:rgba(255,255,255,.75);}
      .wrap{max-width:7.2in;margin:0 auto;padding:26px 6px;}
      .mast{display:flex;align-items:center;justify-content:space-between;padding-bottom:11px;border-bottom:2px solid var(--brass);}
      .mast-left{display:flex;align-items:center;gap:9px;} .mast-mark{width:30px;height:30px;display:block;flex-shrink:0;}
      .mast-name{font-weight:800;font-size:15px;letter-spacing:-0.03em;color:var(--ink);} .mast-name span{color:var(--brass-ink);}
      .mast-right{text-align:right;font-size:8px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:var(--muted2);line-height:1.5;}
      .doc-title{font-family:'Source Serif 4',serif;font-weight:800;font-size:27px;line-height:1.08;letter-spacing:-0.015em;color:var(--ink);margin:18px 0 3px;}
      .doc-sub{font-size:11px;color:var(--muted);font-weight:600;} .doc-sub b{color:var(--brass-ink);font-weight:700;}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:0 26px;margin:16px 0 4px;border:1px solid var(--line2);border-radius:9px;overflow:hidden;}
      .meta-cell{padding:8px 13px;border-top:1px solid var(--line2);} .meta-cell:nth-child(1),.meta-cell:nth-child(2){border-top:none;}
      .meta-k{font-size:7.5px;font-weight:800;letter-spacing:0.13em;text-transform:uppercase;color:var(--muted2);margin-bottom:2px;}
      .meta-v{font-size:11px;color:var(--ink);font-weight:600;} .meta-v.mono{font-family:'IBM Plex Mono',monospace;font-weight:400;font-size:10px;letter-spacing:-0.01em;}
      .sec{margin-top:20px;break-inside:avoid;}
      .sec-eyebrow{display:flex;align-items:center;gap:8px;margin-bottom:9px;}
      .sec-num{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:9px;color:#fff;background:var(--navy);border-radius:5px;padding:2px 6px;}
      .sec-title{font-family:'Source Serif 4',serif;font-weight:700;font-size:15px;color:var(--ink);letter-spacing:-0.01em;}
      .pat{border:1px solid var(--brass-line);border-radius:9px;overflow:hidden;}
      .pat-row{display:flex;gap:12px;align-items:baseline;padding:8px 14px;border-top:1px solid rgba(135,101,28,.14);} .pat-row:first-child{border-top:none;}
      .pat-k{flex:0 0 118px;font-size:8px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);}
      .pat-v{flex:1;display:flex;flex-wrap:wrap;gap:6px;}
      .chip{display:inline-flex;align-items:baseline;gap:5px;font-size:9.5px;font-weight:600;color:var(--ink2);background:#fff;border:1px solid var(--line);border-radius:20px;padding:2px 9px;}
      .chip b{font-family:'IBM Plex Mono',monospace;font-weight:600;color:var(--brass-ink);font-size:8.5px;}
      .pat-span{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--ink2);}
      table{width:100%;border-collapse:collapse;margin-top:2px;font-size:9.5px;}
      thead th{text-align:left;font-size:7.5px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted2);padding:0 8px 6px;border-bottom:1.5px solid var(--brass-line);}
      tbody td{padding:8px;border-bottom:1px solid var(--line2);vertical-align:top;} tbody tr{break-inside:avoid;}
      .t-type{font-size:7.5px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:var(--brass-ink);white-space:nowrap;}
      .t-title{font-weight:700;color:var(--ink);line-height:1.3;} .t-org{color:var(--muted);font-size:9px;margin-top:1px;}
      .t-mono{font-family:'IBM Plex Mono',monospace;font-size:8.5px;color:var(--ink2);white-space:nowrap;}
      .t-award{font-family:'IBM Plex Mono',monospace;font-weight:600;color:var(--brass-ink);font-size:9px;margin-top:2px;} .t-muted{color:var(--muted2);}
      .prompt{font-size:9.5px;color:var(--muted);font-style:italic;margin-bottom:9px;}
      .rl{border-bottom:1px solid var(--line);height:22px;}
      .signoff{display:flex;gap:34px;margin-top:16px;break-inside:avoid;}
      .so-cell{flex:1;} .so-k{font-size:7.5px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted2);margin-bottom:16px;} .so-line{border-bottom:1px solid var(--ink3);}
      .guide{margin-top:20px;background:var(--brass-bg);border:1px solid var(--brass-line);border-radius:9px;padding:11px 14px;break-inside:avoid;}
      .guide-k{font-size:8px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--brass-ink);margin-bottom:4px;}
      .guide-t{font-size:10px;color:var(--ink2);line-height:1.55;} .guide-t a{color:var(--brass-ink);text-decoration:none;font-weight:700;font-family:'IBM Plex Mono',monospace;font-size:9px;}
      .foot{margin-top:22px;padding-top:10px;border-top:1px solid var(--line2);font-size:8px;color:var(--muted2);line-height:1.55;} .foot b{color:var(--muted);}
      @media print{.no-print{display:none!important;} .wrap{padding:0;max-width:none;}}
    `;
    const MRMARK = '<svg class="mast-mark" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="94" height="94" rx="20" fill="#0f2540"/><rect x="11" y="11" width="78" height="78" rx="14" fill="none" stroke="#87651c" stroke-width="2"/><circle cx="50" cy="50" r="24" fill="none" stroke="#e4c477" stroke-width="3.5"/><g stroke="#e4c477" stroke-width="4" stroke-linecap="round"><line x1="50" y1="29" x2="50" y2="39"/><line x1="50" y1="71" x2="50" y2="61"/><line x1="29" y1="50" x2="39" y2="50"/><line x1="71" y1="50" x2="61" y2="50"/></g><circle cx="50" cy="50" r="6" fill="#e4c477"/></svg>';
    function mrHTML() {
      const base = location.origin;
      const q = (query?.value || '').trim();
      const today = new Date().toISOString().slice(0, 10);
      const chipRow = (label, entries) => entries.length ? `<div class="pat-row"><div class="pat-k">${esc(label)}</div><div class="pat-v">${entries.slice(0, 6).map(([v, c]) => `<span class="chip">${esc(v)} <b>${c}</b></span>`).join('')}</div></div>` : '';
      const pats = [chipRow('Notice types', tally(o => o.type)), chipRow('Buying offices', tally(o => o.organization)), chipRow('NAICS observed', tally(o => o.naicsCode)), chipRow('PSC observed', tally(o => o.classificationCode)), chipRow('Set-aside signals', tally(o => o.setAside))].filter(Boolean).join('') + `<div class="pat-row"><div class="pat-k">Posting window</div><div class="pat-v"><span class="pat-span">${esc(mrSpan())}</span></div></div>`;
      const rows = board.map(o => {
        const np = [o.naicsCode || '', o.classificationCode || ''].filter(Boolean).join(' · ') || '—';
        const award = o.awardAmount ? `<div class="t-award">${esc(mrAwardText(o))}</div>` : '';
        return `<tr><td><div class="t-type">${esc(o.type || 'Opportunity')}</div><div class="t-mono t-muted">${esc(o.postedDate || '')}</div></td><td><div class="t-title">${esc(o.title || 'Untitled')}</div><div class="t-org">${esc(o.organization || '')}</div>${award}</td><td class="t-mono">${esc(np)}</td><td>${esc(o.setAside || '—')}</td><td class="t-mono">${esc(o.solicitationNumber || '—')}</td></tr>`;
      }).join('');
      const usaSec = usaNoteHTML();  // present only when award data loaded
      return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><base href="${base}/"><title>AcqVault — Market Research Summary</title><style>${MRCSS}</style></head><body>
        <div class="toolbar no-print"><button onclick="window.print()">⤓ Save as PDF</button><span>Opens your browser's print dialog — choose “Save as PDF.”</span></div>
        <div class="wrap">
          <div class="mast"><div class="mast-left">${MRMARK}<div class="mast-name">Acq<span>Vault</span></div></div><div class="mast-right">Market Research Summary<br>Working file · not an official record</div></div>
          <h1 class="doc-title">Market Research Summary</h1>
          <div class="doc-sub">Prepared in support of <b>RFO Part 10</b> (Market Research) · legacy FAR Part 10</div>
          <div class="meta">
            <div class="meta-cell"><div class="meta-k">Market / requirement</div><div class="meta-v">${esc(q || '—')}</div></div>
            <div class="meta-cell"><div class="meta-k">Prepared</div><div class="meta-v mono">${esc(today)}</div></div>
            <div class="meta-cell"><div class="meta-k">NAICS in scope</div><div class="meta-v mono">${esc(mrDistinct(o => o.naicsCode).join(' · ') || '—')}</div></div>
            <div class="meta-cell"><div class="meta-k">PSC in scope</div><div class="meta-v mono">${esc(mrDistinct(o => o.classificationCode).join(' · ') || '—')}</div></div>
            <div class="meta-cell"><div class="meta-k">Posting window reviewed</div><div class="meta-v mono">${esc(mrSpan())}</div></div>
            <div class="meta-cell"><div class="meta-k">Notices reviewed</div><div class="meta-v">${board.length} pinned</div></div>
          </div>
          <div class="sec"><div class="sec-eyebrow"><span class="sec-title">Market landscape</span></div><div class="pat">${pats}</div></div>
          <div class="sec"><div class="sec-eyebrow"><span class="sec-title">Comparable notices reviewed</span></div>
            <table><thead><tr><th style="width:15%">Type / posted</th><th style="width:34%">Notice</th><th style="width:16%">NAICS · PSC</th><th style="width:20%">Set-aside</th><th style="width:15%">Notice #</th></tr></thead><tbody>${rows}</tbody></table>
            <div class="foot" style="margin-top:8px;border:none;padding:0;">Source records retrieved from SAM.gov via AcqVault. Open each notice at <b>sam.gov</b> using its notice number for the authoritative file, attachments, and full description.</div>
          </div>
          ${usaSec}
          <div class="guide"><div class="guide-k">Governing guidance</div><div class="guide-t">This market research supports <a href="/rfo/part-10">RFO Part 10</a> (Market Research). Small-business set-asides recur in this market — see <a href="/rfo/part-19">RFO Part 19</a> for the set-aside determination. For commercial-item treatment by PSC, see <a href="/rfo/part-12">RFO Part 12</a>.</div></div>
          <div class="foot"><b>Generated by AcqVault</b> (acqvault.com) on ${esc(today)} from SAM.gov opportunity data. AcqVault is an <b>unofficial research aid</b> — not legal advice and not an official source. Verify every notice and citation against the official record at sam.gov and the Revolutionary FAR Overhaul before relying on this summary in a contract file.</div>
        </div>
      </body></html>`;
    }
    function mrText() {
      const q = (query?.value || '').trim();
      const patLine = (label, entries) => entries.length ? `  ${label}: ${entries.slice(0, 6).map(([v, c]) => `${v} (${c})`).join(', ')}` : '';
      const L = ['MARKET RESEARCH SUMMARY', 'Prepared in support of RFO Part 10 (Market Research) — working file, not an official record', ''];
      L.push(`Market / requirement: ${q || '—'}`);
      L.push(`NAICS in scope: ${mrDistinct(o => o.naicsCode).join(' · ') || '—'}`);
      L.push(`PSC in scope: ${mrDistinct(o => o.classificationCode).join(' · ') || '—'}`);
      L.push(`Posting window reviewed: ${mrSpan()}`);
      L.push(`Notices reviewed: ${board.length} pinned`);
      L.push(`Prepared: ${new Date().toISOString().slice(0, 10)}`, '', 'MARKET LANDSCAPE');
      [['Notice types', tally(o => o.type)], ['Buying offices', tally(o => o.organization)], ['NAICS observed', tally(o => o.naicsCode)], ['PSC observed', tally(o => o.classificationCode)], ['Set-aside signals', tally(o => o.setAside)]].forEach(([l, e]) => { const s = patLine(l, e); if (s) L.push(s); });
      L.push(`  Posting window: ${mrSpan()}`, '', 'COMPARABLE NOTICES REVIEWED');
      board.forEach(o => {
        L.push(`- [${o.type || 'Opportunity'} · ${o.postedDate || ''}] ${o.title || 'Untitled'} — ${o.organization || ''}`);
        const bits = [o.naicsCode && `NAICS ${o.naicsCode}`, o.classificationCode && `PSC ${o.classificationCode}`, o.setAside, o.solicitationNumber && `Notice ${o.solicitationNumber}`].filter(Boolean);
        if (bits.length) L.push('    ' + bits.join(' · '));
        if (o.awardAmount) L.push('    ' + mrAwardText(o));
        if (o.uiLink) L.push('    ' + o.uiLink);
      });
      if (usaState === 'ready' && usaData && (usaData.awards || []).length) {
        L.push('', `INCUMBENTS & HISTORICAL AWARDS (USASpending.gov, last ${usaData.years} FY)`, '  Top recipients by obligated $:');
        (usaData.recipients || []).forEach(r => L.push(`    ${r.name} — ${usaFmt(r.total)}${r.count ? ` (${r.count} award${r.count === 1 ? '' : 's'})` : ''}`));
        L.push('  Largest recent awards:');
        (usaData.awards || []).slice(0, 8).forEach(a => { L.push(`    ${a.recipient || '—'} — ${usaFmt(a.amount)} · ${a.agency || ''} · ${a.start || ''} · ${a.type || ''}`); if (a.link) L.push(`      ${a.link}`); });
        L.push('  Source: USASpending.gov (FPDS) — authoritative for award $ and incumbent; SAM notices are a weaker signal.');
      }
      L.push('', 'GOVERNING GUIDANCE: RFO Part 10 (Market Research); RFO Part 19 (set-asides); RFO Part 12 (commercial by PSC).', '', `Generated by AcqVault (acqvault.com) on ${new Date().toISOString().slice(0, 10)} from SAM.gov data. Unofficial research aid — verify against the official record before filing.`);
      return L.join('\n');
    }
    function generateMrNote() {
      if (!board.length) return;
      const w = window.open('', '_blank');
      if (!w) { srAnnounceMR('Allow pop-ups to open the report, or use Copy snapshot.'); return; }
      w.document.open(); w.document.write(mrHTML()); w.document.close();
    }
    function copyMrNote(btn) {
      const text = mrText();
      const done = () => { if (btn) { const o = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = o; }, 1600); } };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
      else { try { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (e) {} }
    }
    const srAnnounceMR = (msg) => { if (typeof window.srAnnounce === 'function') window.srAnnounce(msg); };
    function boardItemHTML(o) {
      const key = oppKey(o);
      const meta = [o.solicitationNumber, o.naicsCode ? `NAICS ${o.naicsCode}` : '', o.classificationCode ? `PSC ${o.classificationCode}` : '', o.setAside].filter(Boolean);
      return `<div class="market-board-item">
        <button type="button" class="market-board-remove" data-unpin="${escAttr(key)}" aria-label="Remove from board" title="Remove">×</button>
        <div class="market-board-item-type">${esc(o.type || 'Opportunity')}${o.postedDate ? ` · ${esc(o.postedDate)}` : ''}</div>
        <a class="market-board-item-title" href="${escAttr(o.uiLink || 'https://sam.gov/search/?index=opp')}" target="_blank" rel="noopener">${esc(o.title || 'Untitled opportunity')}</a>
        <div class="market-board-item-org">${esc(o.organization || '')}</div>
        ${meta.length ? `<div class="market-opp-meta">${meta.map(v => `<span>${esc(v)}</span>`).join('')}</div>` : ''}
        ${awardLine(o)}
      </div>`;
    }
    function renderBoardTray() {
      const n = board.length;
      boardTray.innerHTML = `
        <div class="market-board-head">
          <div class="market-board-title">Your board <span class="market-board-count">${n}</span></div>
          <button type="button" class="market-board-close" aria-label="Close board" title="Close">×</button>
        </div>
        <div class="market-board-intro">Your working set for a market research note. Pinned opportunities stay on this device.</div>
        <div class="market-board-body">${n ? patternsHTML() + ((usaCodes().naics.length || usaCodes().psc.length) ? '<div class="market-usa" id="market-usa"></div>' : '') + board.map(boardItemHTML).join('') : '<div class="market-board-empty"><strong>No pinned opportunities yet.</strong>Use the pin on any result card to start building your working set.</div>'}</div>
        ${n ? '<div class="market-board-foot"><div class="market-board-foot-actions"><button type="button" class="market-board-gen" data-mr-note="1">Generate report</button><button type="button" class="market-board-copy" data-mr-copy="1">Copy snapshot</button></div><button type="button" class="market-board-clear" data-board-clear="1">Clear board</button></div>' : ''}`;
      if (n) loadUsa();
    }
    function openTray() {
      renderBoardTray();
      boardBackdrop.hidden = false; boardTray.hidden = false;
      // force a reflow so the slide-in transition plays, then add the open
      // classes synchronously (rAF can be throttled in some render contexts)
      void boardTray.offsetWidth;
      boardBackdrop.classList.add('show'); boardTray.classList.add('open');
      trayOpen = true;
      boardTray.querySelector('.market-board-close')?.focus();
    }
    function closeTray() {
      boardTray.classList.remove('open'); boardBackdrop.classList.remove('show');
      trayOpen = false;
      setTimeout(() => { if (!trayOpen) { boardTray.hidden = true; boardBackdrop.hidden = true; } }, 300);
      boardBtn?.focus();
    }
    boardTray.addEventListener('click', (e) => {
      if (e.target.closest('.market-board-close')) { closeTray(); return; }
      const refine = e.target.closest('[data-refine]');
      if (refine) {
        const k = refine.dataset.refine, v = refine.dataset.val;
        if (k === 'naics') { const el = $('#market-naics-input'); if (el) el.value = v; }
        else if (k === 'psc') { const el = $('#market-psc-input'); if (el) el.value = v; }
        closeTray(); runMarketSearch(); return;
      }
      const unpin = e.target.closest('[data-unpin]'); if (unpin) { removeFromBoard(unpin.dataset.unpin); return; }
      if (e.target.closest('[data-mr-note]')) { generateMrNote(); return; }
      const cp = e.target.closest('[data-mr-copy]'); if (cp) { copyMrNote(cp); return; }
      if (e.target.closest('[data-board-clear]')) { clearBoard(); }
    });
    boardBackdrop.addEventListener('click', closeTray);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && trayOpen) closeTray(); });
    function selectedTypes() {
      const active = Array.from(noticeWrap?.querySelectorAll('.market-pill.active') || []).map(btn => btn.dataset.type);
      return active.length ? active : ['all'];
    }
    function resetNoticeTypes() {
      noticeWrap?.querySelectorAll('.market-pill').forEach(item => {
        const isAll = item.dataset.type === 'all';
        item.classList.toggle('active', isAll);
        item.setAttribute('aria-pressed', isAll ? 'true' : 'false');
      });
    }
    function currentFilters() {
      return {
        query: (query?.value || '').trim(),
        naics: ($('#market-naics-input')?.value || '').trim(),
        psc: ($('#market-psc-input')?.value || '').trim().toUpperCase(),
        agency: $('#market-agency-input')?.value || '',
        windowDays: $('#market-window-select')?.value || '365',
        setAside: $('#market-setaside-select')?.value || '',
        limit: $('#market-limit-select')?.value || '12'
      };
    }
    // Chips reflect the filters of the LAST RUN search (applied state), not
    // in-progress edits — rendered on search, cleared filters re-run the search.
    function renderActiveFilters() {
      if (!filtersEl) return;
      const f = currentFilters();
      const types = selectedTypes();
      const chips = [];
      if (f.query) chips.push(['query', `“${f.query}”`]);
      if (f.naics) chips.push(['naics', `NAICS ${f.naics}`]);
      if (f.psc) chips.push(['psc', `PSC ${f.psc}`]);
      if (f.agency) chips.push(['agency', f.agency]);
      if (f.setAside) chips.push(['setAside', SETASIDE_LABELS[f.setAside] || f.setAside]);
      if (f.windowDays && f.windowDays !== '365') chips.push(['windowDays', WINDOW_LABELS[f.windowDays] || `${f.windowDays} days`]);
      if (types.length && !types.includes('all')) chips.push(['types', `${types.length} notice type${types.length === 1 ? '' : 's'}`]);
      if (!chips.length) { filtersEl.innerHTML = ''; filtersEl.hidden = true; return; }
      filtersEl.hidden = false;
      filtersEl.innerHTML = '<span class="market-af-label">Filters</span>' +
        chips.map(([key, text]) => `<button type="button" class="market-af-chip" data-clear="${escAttr(key)}">${esc(text)}<span aria-hidden="true">×</span></button>`).join('') +
        '<button type="button" class="market-af-clear" data-clear="__all">Clear all</button>';
    }
    function clearFilter(key) {
      const set = (sel, val) => { const el = $(sel); if (el) el.value = val; };
      if (key === '__all') {
        set('#market-query-input', ''); set('#market-naics-input', ''); set('#market-psc-input', '');
        set('#market-agency-input', ''); set('#market-window-select', '365'); set('#market-setaside-select', '');
        resetNoticeTypes();
      } else if (key === 'query') set('#market-query-input', '');
      else if (key === 'naics') set('#market-naics-input', '');
      else if (key === 'psc') set('#market-psc-input', '');
      else if (key === 'agency') set('#market-agency-input', '');
      else if (key === 'setAside') set('#market-setaside-select', '');
      else if (key === 'windowDays') set('#market-window-select', '365');
      else if (key === 'types') resetNoticeTypes();
      runMarketSearch();
    }
    function fmtAmount(v) {
      if (!v && v !== 0) return '';
      const n = Number(String(v).replace(/[^0-9.]/g, ''));
      if (isFinite(n) && n > 0) return '$' + Math.round(n).toLocaleString();
      return esc(String(v));
    }
    function awardLine(item) {
      const amt = fmtAmount(item.awardAmount);
      const head = amt ? `Award ${amt}` : (item.awardAmount ? 'Awarded' : '');
      const parts = [head, item.awardee ? esc(String(item.awardee)) : ''].filter(Boolean).join(' · ');
      return parts ? `<div class="market-opp-award">${parts}</div>` : '';
    }
    function deadlineFlag(item) {
      const raw = item.responseDeadline;
      if (!raw) return '';
      const d = new Date(raw);
      if (isNaN(d.getTime())) return '';
      const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
      if (days < 0) return '<span class="market-opp-flag closed">Response closed</span>';
      if (days === 0) return '<span class="market-opp-flag soon">Closes today</span>';
      const cls = days <= 7 ? 'soon' : 'open';
      return `<span class="market-opp-flag ${cls}">Closes in ${days} day${days === 1 ? '' : 's'}</span>`;
    }
    function examplesHTML() {
      return `<div class="market-examples">${EXAMPLES.map((ex, i) => `<button type="button" class="market-example" data-ex="${i}">${esc(ex.label)}</button>`).join('')}</div>`;
    }
    function renderEmptyState(label, message, opts) {
      opts = opts || {};
      if (count) count.textContent = opts.count || label;
      if (list) list.innerHTML = `<div class="market-empty"><strong>${esc(label)}</strong>${esc(message)}${opts.examples ? examplesHTML() : ''}</div>`;
    }
    function renderLoading() {
      if (count) count.textContent = 'Searching';
      if (sub) sub.textContent = 'Searching SAM.gov through AcqVault…';
      if (list) list.innerHTML = Array.from({ length: 4 }).map(() =>
        '<div class="market-skel"><div class="market-skel-line w40"></div><div class="market-skel-line w90"></div><div class="market-skel-line w70"></div><div class="market-skel-chips"><span></span><span></span></div></div>'
      ).join('');
    }
    function renderError(message) {
      if (count) count.textContent = 'Try again';
      if (sub) sub.textContent = 'The in-site market research service did not respond cleanly.';
      if (list) list.innerHTML = `<div class="market-empty market-error"><strong>Search paused.</strong>${esc(message)}<div class="market-examples"><button type="button" class="market-retry" data-retry="1">Retry search</button><a class="market-example" href="https://sam.gov/search/" target="_blank" rel="noopener">Open in SAM.gov</a></div></div>`;
    }
    function renderOpportunities(data) {
      renderActiveFilters();
      if (data && data.configured === false) {
        if (count) count.textContent = 'Setup needed';
        if (sub) sub.textContent = 'In-site SAM.gov results are ready once the server-side SAM_API_KEY is configured.';
        if (list) list.innerHTML = `<div class="market-empty"><strong>SAM.gov connection pending.</strong>${esc(data.message || 'Set SAM_API_KEY in Vercel to enable official opportunity results inside AcqVault. The external source links remain available above.')}</div>`;
        return;
      }
      const opps = data.opportunities || [];
      const matched = Number(data.totalRecords) || 0;
      if (count) count.textContent = opps.length ? `${opps.length} shown` : 'No matches';
      if (sub) {
        if (!matched) sub.textContent = 'No SAM.gov opportunities matched the current filters.';
        else sub.textContent = `${matched.toLocaleString()}${data.capped ? '+' : ''} matching ${matched === 1 ? 'opportunity' : 'opportunities'} in the selected window${opps.length < matched ? ` · showing the top ${opps.length}` : ''}.`;
      }
      if (!opps.length) {
        renderEmptyState('No matches', 'Nothing came back for these filters. Try removing NAICS/PSC, widening the window, or keeping Notice type on All — or start from a common market:', { examples: true, count: 'No matches' });
        return;
      }
      lastOppByKey = {};
      list.innerHTML = opps.map(item => {
        const key = oppKey(item); lastOppByKey[key] = item;
        const pinned = isPinned(key);
        const meta = [item.solicitationNumber, item.naicsCode ? `NAICS ${item.naicsCode}` : '', item.classificationCode ? `PSC ${item.classificationCode}` : '', item.setAside].filter(Boolean);
        const foot = [deadlineFlag(item), item.attachments ? `<span class="market-opp-attach">${item.attachments} attachment${item.attachments === 1 ? '' : 's'}</span>` : ''].filter(Boolean).join('');
        return `<a class="market-opp-card" href="${escAttr(item.uiLink || 'https://sam.gov/search/?index=opp')}" target="_blank" rel="noopener">
          <div class="market-opp-top"><span class="market-opp-type">${esc(item.type || 'Opportunity')}</span><span class="market-opp-top-right"><span class="market-opp-date">${esc(item.postedDate || '')}</span><button type="button" class="market-opp-pin${pinned ? ' pinned' : ''}" data-pin="${escAttr(key)}" aria-pressed="${pinned}" aria-label="${pinned ? 'Remove from board' : 'Pin to board'}" title="${pinned ? 'Pinned to your board' : 'Pin to your board'}">${PIN_SVG}</button></span></div>
          <div class="market-opp-title">${esc(item.title)}</div>
          <div class="market-opp-org">${esc(item.organization || 'SAM.gov opportunity')}</div>
          <div class="market-opp-meta">${meta.map(value => `<span>${esc(value)}</span>`).join('')}</div>
          ${awardLine(item)}
          ${foot ? `<div class="market-opp-foot">${foot}</div>` : ''}
        </a>`;
      }).join('');
      updateBoardBtn();
    }
    async function runMarketSearch() {
      if (!list) return;
      renderActiveFilters();
      renderLoading();
      btn?.setAttribute('disabled', 'disabled');
      try {
        const response = await fetch('/api/market-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...currentFilters(), noticeTypes: selectedTypes() })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || data.error || 'Market research search failed.');
        renderOpportunities(data);
      } catch (error) {
        renderError(error.message || 'The market research service could not be reached.');
      } finally {
        btn?.removeAttribute('disabled');
      }
    }
    // Delegated: example chips (empty state) prefill + run; retry re-runs; filter chips clear.
    list?.addEventListener('click', (event) => {
      const pin = event.target.closest('[data-pin]');
      if (pin) { event.preventDefault(); event.stopPropagation(); togglePin(pin.dataset.pin); return; }
      const ex = event.target.closest('[data-ex]');
      if (ex) {
        event.preventDefault();
        const spec = EXAMPLES[Number(ex.dataset.ex)] || {};
        if (query) query.value = spec.query || '';
        const n = $('#market-naics-input'); if (n) n.value = spec.naics || '';
        const p = $('#market-psc-input'); if (p) p.value = spec.psc || '';
        runMarketSearch();
        return;
      }
      const retry = event.target.closest('[data-retry]');
      if (retry) { event.preventDefault(); runMarketSearch(); }
    });
    filtersEl?.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-clear]');
      if (chip) clearFilter(chip.dataset.clear);
    });
    noticeWrap?.addEventListener('click', (event) => {
      const pill = event.target.closest('.market-pill');
      if (!pill) return;
      const all = noticeWrap.querySelector('[data-type="all"]');
      if (pill.dataset.type === 'all') {
        noticeWrap.querySelectorAll('.market-pill').forEach(item => {
          const active = item === pill;
          item.classList.toggle('active', active);
          item.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        return;
      }
      pill.classList.toggle('active');
      pill.setAttribute('aria-pressed', pill.classList.contains('active') ? 'true' : 'false');
      all?.classList.remove('active');
      all?.setAttribute('aria-pressed', 'false');
      if (!noticeWrap.querySelector('.market-pill.active')) {
        all?.classList.add('active');
        all?.setAttribute('aria-pressed', 'true');
      }
    });
    btn?.addEventListener('click', runMarketSearch);
    query?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') runMarketSearch();
    });
    // Board button in the results head — grouped with the count on the right.
    const resultsHead = section.querySelector('.market-results-head');
    if (resultsHead && count) {
      const right = document.createElement('div');
      right.className = 'market-head-right';
      boardBtn = document.createElement('button');
      boardBtn.type = 'button';
      boardBtn.className = 'market-board-btn';
      boardBtn.setAttribute('aria-haspopup', 'dialog');
      resultsHead.appendChild(right);
      right.appendChild(count);
      right.appendChild(boardBtn);
      boardBtn.addEventListener('click', () => { trayOpen ? closeTray() : openTray(); });
    }
    updateBoardBtn();
    // First-run state: no default query — invite a search or a common market.
    renderEmptyState('Ready for market research', 'Search a requirement above, or start from a common market:', { examples: true, count: 'Ready' });
  }

  /* ════════════════════════════════════════════════════════════
     BOOT
     ════════════════════════════════════════════════════════════ */
  function boot() {
    injectSections();
    initThresholds();
    initAcroLookup();
    initAcroTooltips();
    initMarketResearch();
    initDashboard();
    initMobileNav();
    // Deep-link restore (?q=, ?src=, ?doc=) is owned by app.js restoreFromUrl().
  }

  /* ════════════════════════════════════════════════════════════
     MOBILE NAV — hamburger + slide-down sheet (≤768px)
     ════════════════════════════════════════════════════════════ */
  function initMobileNav() {
    const btn = $('#nav-hamburger'), menu = $('#mobile-menu'),
          backdrop = $('#mobile-menu-backdrop'), list = $('#mobile-menu-list');
    if (!btn || !menu || !backdrop || !list) return;
    let isOpen = false;
    function buildList() {
      let html = '';
      document.querySelectorAll('nav .nav-center a').forEach((a) => {
        html += `<a class="mm-link" href="${esc(a.getAttribute('href') || '#')}">${esc(a.textContent.trim())}<span class="mm-arrow" aria-hidden="true">→</span></a>`;
      });
      html += `<button type="button" class="mm-link mm-action" data-mm="saved">★ Saved<span class="mm-arrow" aria-hidden="true">→</span></button>`;
      html += `<button type="button" class="mm-link mm-action" data-mm="feedback">Feedback<span class="mm-arrow" aria-hidden="true">→</span></button>`;
      list.innerHTML = html;
    }
    function open() {
      buildList();
      const nav = document.getElementById('main-nav');
      const bottom = nav ? nav.getBoundingClientRect().bottom : 90;
      menu.style.top = Math.max(56, Math.round(bottom + 6)) + 'px';
      menu.hidden = false; backdrop.hidden = false;
      void menu.offsetHeight; // force reflow so the open transition runs reliably
      menu.classList.add('open'); backdrop.classList.add('open');
      btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open');
      document.body.style.overflow = 'hidden';
      isOpen = true;
      if (typeof window.trapFocus === 'function') { try { window.trapFocus(menu); } catch (e) {} }
      const first = list.querySelector('.mm-link'); if (first) first.focus();
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      menu.classList.remove('open'); backdrop.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('open');
      document.body.style.overflow = '';
      if (typeof window.releaseFocus === 'function') { try { window.releaseFocus(); } catch (e) {} }
      btn.focus();
      setTimeout(() => { if (!isOpen) { menu.hidden = true; backdrop.hidden = true; } }, 280);
    }
    btn.addEventListener('click', () => isOpen ? close() : open());
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });
    list.addEventListener('click', (e) => {
      const el = e.target.closest('.mm-link'); if (!el) return;
      const action = el.dataset.mm;
      if (action === 'saved') { close(); const sv = $('#nav-saved'); if (sv) setTimeout(() => sv.click(), 60); return; }
      if (action === 'feedback') { close(); if (typeof openFeedback === 'function') setTimeout(openFeedback, 60); return; }
      const href = el.getAttribute('href');
      if (href && href.charAt(0) === '#') {
        e.preventDefault();
        // In work-mode the landing sections are hidden — restore them before scrolling
        if (document.body.classList.contains('work-mode') && typeof window.acqExitToLanding === 'function') window.acqExitToLanding();
        const target = document.getElementById(href.slice(1));
        close();
        if (target) setTimeout(() => {
          const off = (typeof getStickyOffset === 'function' ? getStickyOffset() : 70) + 26;
          window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - off), behavior: 'smooth' });
        }, 80);
      } else { close(); /* route link (e.g. /deviations) navigates normally */ }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

