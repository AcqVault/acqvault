/* ═══════════════════════════════════════════════════════════════
   ACQVAULT — WIDGETS ADD-ON  (self-contained, no deps)
   1) Threshold quick-reference   2) Acronym decoder
   3) What's new since last visit 4) DAF spending dashboard
   Injects two homepage sections after #features and wires behaviour.
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

  /* ════════════════════════════════════════════════════════════
     INJECT MARKUP
     ════════════════════════════════════════════════════════════ */
  function injectSections() {
    const features = $('#features');
    if (!features) return;

    const toolkit = document.createElement('section');
    toolkit.className = 'sec sec-off';
    toolkit.id = 'toolkit';
    toolkit.innerHTML = `
      <div class="sec-inner">
        <p class="eyebrow eyebrow-dark fade-up">Daily toolkit</p>
        <h2 class="sec-head fade-up">The lookups you do<br>a dozen times a day.</h2>
        <p class="sec-sub sec-sub-dark fade-up">Dollar thresholds, the acronym you half-remember, and what changed since you last logged in \u2014 without leaving the page.</p>
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
            <div class="tk-card wn-card fade-up d2" id="wn-card">
              <div class="tk-card-head">
                <div class="tk-card-icon">\u2726</div>
                <div class="tk-card-titles">
                  <div class="tk-card-title">What\u2019s new</div>
                  <div class="tk-card-sub">Latest RFO / R-DFARS rulemaking</div>
                </div>
              </div>
              <div class="wn-meta" id="wn-meta">
                <span class="wn-meta-left" id="wn-meta-left">Checking the Federal Register\u2026</span>
                <span class="wn-badge zero" id="wn-badge">\u2014</span>
              </div>
              <div class="wn-list" id="wn-list"><div class="wn-loading">Loading latest rules\u2026</div></div>
              <div class="wn-foot"><a href="https://www.federalregister.gov/agencies/defense-acquisition-regulations-system" target="_blank" rel="noopener">View all on Federal Register \u2192</a></div>
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

    // Page flow: Market Research, Quick Links, Toolkit, Spending, Features, Sources.
    const quicklinks = $('#quick-links');
    const marketResearch = $('#market-research');
    if (marketResearch && quicklinks && (marketResearch.compareDocumentPosition(quicklinks) & Node.DOCUMENT_POSITION_PRECEDING)) {
      quicklinks.insertAdjacentElement('beforebegin', marketResearch);
    }
    (quicklinks || marketResearch || features).insertAdjacentElement('afterend', toolkit);
    toolkit.insertAdjacentElement('afterend', dash);
    const sourceTilesTpl = $('#source-tiles-template');
    if (sourceTilesTpl) {
      const sourceTiles = sourceTilesTpl.content.firstElementChild.cloneNode(true);
      dash.insertAdjacentElement('afterend', sourceTiles);
    }

    // reveal-on-scroll for the freshly injected .fade-up nodes
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.01, rootMargin: '0px 0px 20% 0px' });
    [marketResearch, toolkit, dash].filter(Boolean).forEach((sec) => sec.querySelectorAll('.fade-up').forEach((el) => io.observe(el)));

    // add nav link
    const navCenter = $('nav .nav-center');
    if (navCenter) {
      const a = document.createElement('a');
      a.href = '#toolkit'; a.textContent = 'Toolkit';
      const quickLink = navCenter.querySelector('a[href="#quick-links"]');
      if (quickLink) quickLink.insertAdjacentElement('afterend', a);
      else navCenter.insertBefore(a, navCenter.firstChild);
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
      return `<div class="thr-row${changed && uplift ? ' changed' : ''}">
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
    const trigRows = triggerDefs.filter((d) => d.row).map((d) => {
      const v = thrScopeVal(d.row), on = amt > v;
      return `<div class="thr-trig ${on ? 'on' : 'off'}">
        <span class="thr-trig-mark" aria-hidden="true">${on ? '●' : '○'}</span>
        <span class="thr-trig-body">
          <span class="thr-trig-label">${esc(d.label)} <button type="button" class="thr-trig-cite" data-cite="${esc(d.row.cite)}">${esc(d.row.cite)}</button></span>
          <span class="thr-trig-detail">${on ? 'Generally required above' : 'Not required at or below'} ${fmtExact(v)}${on ? ` — ${esc(d.cond)}` : ''}.</span>
        </span>
      </div>`;
    }).join('');
    out.classList.add('on');
    out.innerHTML = `
      <div class="thr-band thr-band-${band.cls}">
        <div class="thr-band-top"><span class="thr-band-amt">${fmtExact(amt)}</span><span class="thr-band-tag">${esc(band.tag)}</span></div>
        <div class="thr-band-desc">${band.desc}</div>
        <button type="button" class="thr-band-cite" data-cite="${esc(band.cite)}">Read ${esc(band.cite)} →</button>
      </div>
      <div class="thr-trig-head">At ${fmtExact(amt)}, these thresholds are crossed${thrScope === 'con' ? ' (contingency ceilings)' : ''}:</div>
      <div class="thr-trig-list">${trigRows}</div>
      <div class="thr-calc-verify">A mechanical comparison to the cited thresholds below — always verify against the live RFO and any class deviations before acting.</div>`;
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
    win.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-days]'); if (!b) return;
      win.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
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
    function selectedTypes() {
      const active = Array.from(noticeWrap?.querySelectorAll('.market-pill.active') || []).map(btn => btn.dataset.type);
      return active.length ? active : ['all'];
    }
    function setResultsState(label, message) {
      if (count) count.textContent = label;
      if (list) list.innerHTML = `<div class="market-empty"><strong>${esc(label)}</strong>${esc(message)}</div>`;
    }
    function renderOpportunities(data) {
      if (data && data.configured === false) {
        if (count) count.textContent = 'Setup needed';
        if (sub) sub.textContent = 'In-site SAM.gov results are ready once the server-side SAM_API_KEY is configured.';
        if (list) list.innerHTML = `<div class="market-empty"><strong>SAM.gov connection pending.</strong>${esc(data.message || 'Set SAM_API_KEY in Vercel to enable official opportunity results inside AcqVault. The external source links remain available above.')}</div>`;
        return;
      }
      const opps = data.opportunities || [];
      if (count) count.textContent = opps.length ? `${opps.length} shown` : 'No matches';
      if (sub) sub.textContent = data.totalRecords ? `${Number(data.totalRecords).toLocaleString()} SAM.gov records matched the current filters.` : 'No SAM.gov records matched the current filters.';
      if (!opps.length) {
        setResultsState('No matches', 'Try fewer filters, leave Notice type on All, or remove NAICS/PSC to broaden the market view.');
        return;
      }
      list.innerHTML = opps.map(item => {
        const meta = [item.solicitationNumber, item.naicsCode ? `NAICS ${item.naicsCode}` : '', item.classificationCode ? `PSC ${item.classificationCode}` : '', item.setAside].filter(Boolean);
        return `<a class="market-opp-card" href="${escAttr(item.uiLink || 'https://sam.gov/search/?index=opp')}" target="_blank" rel="noopener">
          <div class="market-opp-top"><span class="market-opp-type">${esc(item.type || 'Opportunity')}</span><span class="market-opp-date">${esc(item.postedDate || '')}</span></div>
          <div class="market-opp-title">${esc(item.title)}</div>
          <div class="market-opp-org">${esc(item.organization || 'SAM.gov opportunity')}</div>
          <div class="market-opp-meta">${meta.map(value => `<span>${esc(value)}</span>`).join('')}</div>
        </a>`;
      }).join('');
    }
    async function runMarketSearch() {
      if (!list) return;
      if (count) count.textContent = 'Searching';
      if (sub) sub.textContent = 'Searching SAM.gov through AcqVault...';
      list.innerHTML = '<div class="market-loading">Searching official SAM.gov opportunities...</div>';
      btn?.setAttribute('disabled', 'disabled');
      try {
        const response = await fetch('/api/market-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: query?.value || '',
            naics: $('#market-naics-input')?.value || '',
            psc: $('#market-psc-input')?.value || '',
            agency: $('#market-agency-input')?.value || '',
            windowDays: $('#market-window-select')?.value || '365',
            setAside: $('#market-setaside-select')?.value || '',
            limit: $('#market-limit-select')?.value || '12',
            noticeTypes: selectedTypes()
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || data.error || 'Market research search failed.');
        renderOpportunities(data);
      } catch (error) {
        if (count) count.textContent = 'Try again';
        if (sub) sub.textContent = 'The in-site market research service did not respond cleanly.';
        setResultsState('Search paused', error.message || 'The market research service could not be reached.');
      } finally {
        btn?.removeAttribute('disabled');
      }
    }
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
    loadWhatsNew();
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
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      menu.classList.remove('open'); backdrop.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('open');
      document.body.style.overflow = '';
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

