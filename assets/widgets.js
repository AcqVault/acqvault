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
  // TINA: $10M since 30 Jun 2026 (NDAA FY2026 sec. 1804(c)). Pre-cutover awards and
  // their mods keep $2.5M — that nuance lives in the acronym glossary, not the row.
  const TINA_VALUE = 10000000;
  // Citations verified against the live corpus 2026-07-02 (post-July RFO refresh);
  // refresh.py cite-watch flags any of these that stop resolving after a corpus update.
  // Three groups in the order a CO thinks: the two anchors first, then the
  // floors that carve them up, then the approval/data tiers — ascending within each.
  const G1 = 'Core thresholds';
  const G2 = 'Labor & construction floors';
  const G3 = 'Approvals, plans & data';
  const THRESHOLDS = [
    { group: G1, abbr: 'MPT', name: 'Micro-Purchase Threshold', cite: 'RFO 2.101',
      std: 15000, con: 25000, conNote: '$40K outside U.S.' },
    { group: G1, abbr: 'SAT', name: 'Simplified Acquisition Threshold', cite: 'RFO 2.101',
      std: 350000, con: 1000000, conNote: '$2M outside U.S.' },
    { group: G2, abbr: 'DBA', name: 'Davis-Bacon wage rules — construction', cite: 'RFO 22.402',
      std: 2000, con: 2000, fixed: true, note: 'Sets the construction micro-purchase ceiling' },
    { group: G2, abbr: 'SCA', name: 'Service Contract Labor Standards', cite: 'RFO 22.1002',
      std: 2500, con: 2500, fixed: true, note: 'Sets the services micro-purchase ceiling' },
    { group: G2, abbr: '', name: 'Walsh-Healey — supply contracts', cite: 'RFO 22.601',
      std: 20000, con: 20000, fixed: true },
    { group: G2, abbr: '', name: 'Performance & payment bonds — construction', cite: 'RFO 28.102',
      std: 150000, con: 150000, fixed: true },
    { group: G3, abbr: '', name: 'Trafficking compliance plan', cite: 'RFO 22.1703',
      std: 700000, con: 700000, fixed: true, note: 'Work performed outside the U.S.' },
    { group: G3, abbr: '', name: 'Subcontracting plan', cite: 'RFO 19.109',
      std: 900000, con: 900000, fixed: true, note: '$2M for construction of a public facility' },
    { group: G3, abbr: 'J&A', name: 'Other than full & open — first tier', cite: 'RFO 6.104-2',
      std: 900000, con: 900000, fixed: true },
    { group: G3, abbr: '', name: 'Construction past-performance eval (CPARS)', cite: 'RFO 42.1102',
      std: 900000, con: 900000, fixed: true, note: 'Above the SAT for most other contracts' },
    { group: G3, abbr: 'SAP', name: 'Commercial simplified procedures', cite: 'RFO 12.201-1',
      std: 9000000, con: 15000000 },
    { group: G3, abbr: 'TINA', name: 'Certified cost or pricing data', cite: 'RFO 15.403-3',
      std: TINA_VALUE, con: TINA_VALUE, fixed: true },
    { group: G3, abbr: '', name: '8(a) sole source — justification', cite: 'RFO 6.103-5',
      std: 30000000, con: 30000000, fixed: true },
    { group: G3, abbr: '', name: 'Non-fixed-price contract justification — DoD', cite: 'RFO 16.104',
      std: 100000000, con: 100000000, fixed: true,
      note: 'E.O. 14402 · other agencies $10M (DHS $25M, NASA $35M)' }
  ];

  // Acronym glossary: TERM -> [expansion, optional note]
  const ACRONYMS = {
    FAR: ['Legacy Federal Acquisition Regulation', 'Use the RFO for current AcqVault research'],
    DFARS: ['Legacy Defense acquisition supplement', 'Use R-DFARS for current AcqVault research'],
    'R-DFARS': ['R-DFARS', 'DoD deviation set replacing legacy DFARS material'],
    PGI: ['Procedures, Guidance, and Information', 'R-DFARS PGI — procedural guidance issued with the DoD class deviations; does not bind'],
    DAF: ['Department of the Air Force'],
    Compass: ['DAF Contracting Compass', 'The DAF contracting knowledge center on SharePoint — CAC required'],
    DoD: ['Department of Defense'],
    RFO: ['Revolutionary FAR Overhaul', 'The overhauled FAR — EO 14275'],
    SAT: ['Simplified Acquisition Threshold', '$350,000 since Oct 2025 (RFO 2.101)'],
    MPT: ['Micro-Purchase Threshold', '$15,000 since Oct 2025 (RFO 2.101)'],
    SAP: ['Simplified Acquisition Procedures', 'RFO Part 13'],
    TINA: ['Truth in Negotiations Act', 'Certified cost/pricing data — $10M since 30 Jun 2026 (NDAA FY26); pre-cutover awards and their mods stay $2.5M'],
    CAS: ['Cost Accounting Standards', '48 CFR 9903 (CAS Board)'],
    IDIQ: ['Indefinite-Delivery, Indefinite-Quantity', 'RFO 16.504'],
    IDV: ['Indefinite-Delivery Vehicle'],
    BPA: ['Blanket Purchase Agreement', 'RFO 13.2 / 8.4'],
    GWAC: ['Government-Wide Acquisition Contract'],
    MAC: ['Multiple-Award Contract'],
    FFP: ['Firm-Fixed-Price', 'RFO 16.202'],
    FPIF: ['Fixed-Price Incentive (Firm Target)', 'RFO 16.404-1'],
    CPFF: ['Cost-Plus-Fixed-Fee', 'RFO 16.304'],
    CPIF: ['Cost-Plus-Incentive-Fee', 'RFO 16.405'],
    CPAF: ['Cost-Plus-Award-Fee', 'RFO 16.402-4'],
    'T&M': ['Time-and-Materials', 'RFO 16.601'],
    LPTA: ['Lowest Price Technically Acceptable', 'RFO 15.103-2'],
    LH: ['Labor-Hour contract', 'RFO 16.602'],
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
    RFP: ['Request for Proposals', 'RFO 15.102'],
    RFQ: ['Request for Quotations', 'RFO 13.201'],
    RFI: ['Request for Information', 'RFO 15.101'],
    IFB: ['Invitation for Bids', 'Sealed bidding — RFO Part 14'],
    SSEB: ['Source Selection Evaluation Board'],
    SSA: ['Source Selection Authority'],
    SSAC: ['Source Selection Advisory Council'],
    PNM: ['Price Negotiation Memorandum'],
    'J&A': ['Justification and Approval', 'Other than full & open — RFO 6.104-2'],
    SCA: ['Service Contract Act', 'Now “Service Contract Labor Standards” — applies above $2,500 (RFO 22.1002-2)'],
    'EO 14402': ['Promoting Efficiency, Accountability, and Performance in Federal Contracting', 'Apr 2026 E.O. — head-of-agency justification to award other than firm-fixed-price: $100M DoD, $35M NASA, $25M DHS, $10M all others (RFO 16.104)'],
    DBA: ['Davis-Bacon Act', 'Construction wage rates — applies above $2,000 (RFO 22.402-3)'],
    'D&F': ['Determination and Findings', 'RFO 1.5'],
    BAA: ['Broad Agency Announcement', 'RFO 35.102'],
    OTA: ['Other Transaction Authority', '10 U.S.C. 4021/4022'],
    CLIN: ['Contract Line Item Number', 'RFO 4.202-2'],
    SLIN: ['Subline Item Number'],
    ACRN: ['Accounting Classification Reference Number'],
    UCA: ['Undefinitized Contract Action', 'R-DFARS / legacy DFARS coverage'],
    ECP: ['Engineering Change Proposal'],
    EVM: ['Earned Value Management', 'RFO 34.2'],
    EVMS: ['Earned Value Management System'],
    WBS: ['Work Breakdown Structure'],
    IMS: ['Integrated Master Schedule'],
    IMP: ['Integrated Master Plan'],
    CDRL: ['Contract Data Requirements List', 'DD Form 1423'],
    DID: ['Data Item Description'],
    GFE: ['Government-Furnished Equipment'],
    GFP: ['Government-Furnished Property', 'RFO Part 45'],
    GFI: ['Government-Furnished Information'],
    CPARS: ['Contractor Performance Assessment Reporting System'],
    SAM: ['System for Award Management', 'SAM.gov'],
    FPDS: ['Federal Procurement Data System'],
    WAWF: ['Wide Area Workflow', 'Invoicing & receiving in PIEE'],
    PIEE: ['Procurement Integrated Enterprise Environment'],
    EDA: ['Electronic Document Access'],
    OCI: ['Organizational Conflict of Interest', 'RFO 9.5'],
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
    DPAS: ['Defense Priorities and Allocations System', 'RFO 11.5'],
    EPA: ['Economic Price Adjustment', 'RFO 16.203 (price clause)'],
    ROM: ['Rough Order of Magnitude'],
    IGCE: ['Independent Government Cost Estimate'],
    BOE: ['Basis of Estimate'],
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
                <label class="thr-calc-label" for="thr-amount">Check an amount — or search by term</label>
                <div class="thr-calc-field">
                  <span class="thr-calc-cur">$</span>
                  <input type="text" id="thr-amount" autocomplete="off" spellcheck="false" placeholder="e.g. 250,000  —  or “commercial”, “bonds”, “TINA”" aria-label="Dollar amount or threshold term" />
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
            <div class="tk-card fade-up d1" id="cra-card">
              <div class="tk-card-head">
                <div class="tk-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z"/><path d="M14 3v4h4"/><path d="m9 14.5 2 2 4-4.5"/></svg></div>
                <div class="tk-card-titles">
                  <div class="tk-card-title">CASPER review tiers</div>
                  <div class="tk-card-sub">Contract Acquisition Strategy, Pricing &amp; Execution Review</div>
                </div>
              </div>
              <div class="cra-intro">Every CASPER gets an independent review. Find your portfolio column — the row your dollar value lands in is your Contract Review Authority (CRA).</div>
              <div class="cra-wrap">
                <table class="cra-table">
                  <thead><tr><th scope="col">CRA</th><th scope="col">Operational</th><th scope="col">Enterprise</th><th scope="col">PEO</th><th scope="col">PAE</th></tr></thead>
                  <tbody>
                    <tr><td>COCO / designee</td><td>≥$5M – ≤$10M</td><td>≥$10M – ≤$50M</td><td>≥$10M – ≤$100M</td><td>≥$10M</td></tr>
                    <tr><td>SCO / designee¹</td><td>&gt;$10M – &lt;$1B</td><td>&gt;$50M – &lt;$1B</td><td>&gt;$100M – &lt;$1B</td><td>Special interest²</td></tr>
                    <tr><td>HCA / designee</td><td colspan="4">Special interest² or ≥$1B — all portfolio types</td></tr>
                  </tbody>
                </table>
              </div>
              <div class="thr-foot">¹ The SCO also serves as CRA for IDIQs ≥$1B that don't establish pricing in the basic contract. ² Special interest may be designated by the SAE for any action regardless of value; designees must be at least one level above the CO. From the AcqVault <a class="cra-dl" href="/pdfs/casper-mfr-template.pdf" download="AcqVault-CASPER-MFR-Template.pdf">CASPER MFR template ↓</a></div>
            </div>
            <div class="tk-card fade-up d1" id="acro-card">
              <div class="tk-card-head">
                <div class="tk-card-icon">A\u02B7</div>
                <div class="tk-card-titles">
                  <div class="tk-card-title">Acronym decoder</div>
                  <div class="tk-card-sub">${Object.keys(ACRONYMS).length}+ terms \u00B7 type to filter</div>
                </div>
              </div>
              <div class="acro-search">
                <span class="acro-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="13" height="13" style="display:block;"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg></span>
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

  // Resolve a nav link to the on-page section it should track: a #hash link maps to
  // that element; a bare page link (/library, /study) maps to an on-page section that
  // shares its slug, so those links join the scrollspy instead of being skipped.
  function navSectionId(a) {
    const href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#') { const el = href.length > 1 ? document.querySelector(href) : null; return el ? el.id : null; }
    const m = href.match(/^\/([a-z0-9-]+)\/?$/i);
    const el = m ? document.getElementById(m[1]) : null;
    return el ? el.id : null;
  }
  function initHomeNavPolish() {
    const pairs = Array.from(document.querySelectorAll('nav .nav-center a'))
      .map(a => ({ a, id: navSectionId(a) })).filter(p => p.id);
    if (!pairs.length) return;
    function setActive(id) {
      pairs.forEach(p => p.a.classList.toggle('active', p.id === id));
    }
    pairs.forEach(({ a, id }) => {
      a.addEventListener('click', (event) => {
        // Page links (e.g. /library, /study) navigate normally; only in-page hashes smooth-scroll.
        if ((a.getAttribute('href') || '').charAt(0) !== '#') return;
        const target = document.getElementById(id);
        if (!target) return;
        event.preventDefault();
        const y = target.getBoundingClientRect().top + window.scrollY - getStickyOffset() - 26;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
        history.replaceState(null, '', '#' + id);
        setActive(id);
      });
    });
    const observed = pairs.map(p => document.getElementById(p.id)).filter(Boolean);
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
    list.innerHTML = THRESHOLDS.map((t, i) => {
      const val = thrScope === 'con' ? t.con : t.std;
      const uplift = thrScope === 'con' && !t.fixed && t.con !== t.std;
      const note = thrScope === 'con' && t.conNote ? `<span class="thr-up">${esc(t.conNote)}</span>` : '';
      const nm = t.abbr
        ? `<span class="thr-row-abbr">${esc(t.abbr)}</span> \u00B7 ${esc(t.name)}`
        : esc(t.name);
      const head = t.group && (i === 0 || THRESHOLDS[i - 1].group !== t.group)
        ? `<div class="thr-group">${esc(t.group)}</div>` : '';
      return `${head}<div class="thr-row${changed && uplift ? ' changed' : ''}">
        <div class="thr-row-main">
          <div class="thr-row-name">${nm}</div>
          <div class="thr-row-cite">${esc(t.cite)}</div>${t.note ? `<div class="thr-row-note">${esc(t.note)}</div>` : ''}
        </div>
        <div class="thr-row-val">${fmtExact(val)}${note}</div>
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
  // Extra search terms so a plain-language word finds the right row even when it
  // isn't in the name (keyed by abbr, or by name for the abbr-less rows).
  const THR_KW = {
    'MPT': 'micropurchase micro purchase small buy convenience check card',
    'SAT': 'simplified acquisition small business set aside reserve',
    'SAP': 'commercial simplified acquisition procedures products services',
    'TINA': 'truth in negotiations certified cost or pricing data truthful sweep',
    'DBA': 'construction prevailing wage davis bacon labor site',
    'SCA': 'service contract labor standards scls services wage employees',
    'J&A': 'justification and approval sole source other than full open competition',
    'Performance & payment bonds — construction': 'surety miller act payment performance guarantee',
    'Walsh-Healey — supply contracts': 'supplies manufacturer dealer wages',
    'Trafficking compliance plan': 'human trafficking persons compliance overseas',
    'Subcontracting plan': 'small business subcontracting goals plan',
  };
  const thrSearchStr = (t) =>
    `${t.abbr} ${t.name} ${t.note || ''} ${t.cite} ${THR_KW[t.abbr] || ''} ${THR_KW[t.name] || ''}`.toLowerCase();

  function renderThrSearch(raw) {
    const out = $('#thr-calc-out'), clr = $('#thr-amount-clear'), field = $('.thr-calc-field');
    if (!out) return;
    if (clr) clr.hidden = !raw;
    if (field) field.classList.add('thr-searching');   // hide the $ affordance
    const q = raw.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const matches = q ? THRESHOLDS.filter((t) => { const s = thrSearchStr(t); return words.every((w) => s.includes(w)); }) : [];
    out.classList.add('on');
    if (!matches.length) {
      out.innerHTML = `<div class="thr-calc-hint">No threshold matches &ldquo;${esc(raw.trim())}&rdquo;. Try a dollar amount, or a term like <b>commercial</b>, <b>bonds</b>, <b>micro-purchase</b>, or <b>TINA</b>.</div>`;
      return;
    }
    const rows = matches.map((t) => {
      const val = thrScope === 'con' ? t.con : t.std;
      const up = thrScope === 'con' && t.conNote ? `<span class="thr-up">${esc(t.conNote)}</span>` : '';
      const nm = t.abbr ? `<span class="thr-row-abbr">${esc(t.abbr)}</span> · ${esc(t.name)}` : esc(t.name);
      return `<div class="thr-sr">
          <div class="thr-sr-main">
            <div class="thr-sr-name">${nm}</div>
            ${t.note ? `<div class="thr-sr-note">${esc(t.note)}</div>` : ''}
            <button type="button" class="thr-trig-cite" data-cite="${esc(t.cite)}">${esc(t.cite)}</button>
          </div>
          <div class="thr-sr-val">${fmtExact(val)}${up}</div>
        </div>`;
    }).join('');
    out.innerHTML = `<div class="thr-trig-head">${matches.length} threshold${matches.length !== 1 ? 's' : ''} matching &ldquo;${esc(raw.trim())}&rdquo;${thrScope === 'con' ? ' (contingency ceilings)' : ''}:</div>
      <div class="thr-sr-list">${rows}</div>
      <div class="thr-calc-foot-row"><span class="thr-calc-verify">Values are the current thresholds below — always verify against the live RFO and any class deviations before acting.</span></div>`;
  }

  function renderThrCalc() {
    const out = $('#thr-calc-out'), input = $('#thr-amount'), clr = $('#thr-amount-clear'), field = $('.thr-calc-field');
    if (!out || !input) return;
    if (field) field.classList.remove('thr-searching');
    const amt = parseAmount(input.value);
    if (clr) clr.hidden = !input.value;
    if (amt == null) {
      out.classList.remove('on');
      out.innerHTML = `<div class="thr-calc-hint">Type a <b>dollar amount</b> to see which regime applies and which thresholds it crosses — or a <b>term</b> like &ldquo;commercial&rdquo; or &ldquo;bonds&rdquo; to look one up. Each links to its RFO citation.</div>`;
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
        desc: `Above the Simplified Acquisition Threshold (${fmtExact(satV)}). Full and open competition generally applies (RFO Part 6), using negotiated procedures (RFO Part 15) unless a documented exception applies. Commercial products and services may still use simplified procedures up to ${fmtExact(sapV)} (RFO 12.201-1).` };
    }
    const triggerDefs = [
      { row: thrFind((t) => t.abbr === 'DBA'), label: 'Construction wage rates (Davis-Bacon)', cond: 'for construction at a specific site — also caps the construction micro-purchase threshold' },
      { row: thrFind((t) => t.abbr === 'SCA'), label: 'Service Contract Labor Standards (SCA)', cond: 'for service contracts principally using service employees — also caps the services micro-purchase threshold' },
      { row: thrFind((t) => /payment bonds/i.test(t.name)), label: 'Performance & payment bonds', cond: 'for construction contracts (Bonds statute)' },
      { row: thrFind((t) => /Subcontracting/i.test(t.name)), label: 'Subcontracting plan', cond: 'for other-than-small businesses when subcontracting opportunities exist' },
      { row: thrFind((t) => t.abbr === 'J&A'), label: 'J&A — first approval tier', cond: 'only when awarding other than full and open competition' },
      { row: thrFind((t) => t.abbr === 'TINA'), label: 'Certified cost or pricing data (TINA)', cond: 'unless an exception applies — e.g., adequate price competition or commercial products/services' }
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
      const cur = $('#thr-amount');
      if (cur && /[a-z]/i.test(cur.value)) renderThrSearch(cur.value); else renderThrCalc();
    });
    renderThresholds(false);
    const amt = $('#thr-amount'), clr = $('#thr-amount-clear'), out = $('#thr-calc-out');
    if (amt) {
      amt.addEventListener('input', () => {
        if (/[a-z]/i.test(amt.value)) {           // any letter → look up by term
          renderThrSearch(amt.value);
        } else {                                   // digits only → check an amount
          amt.value = fmtAmountInput(amt.value);
          renderThrCalc();
        }
      });
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
    const observers = new Map();
    // decorate() wraps matches in <abbr>, i.e. it mutates the very subtree we're observing,
    // which re-armed the observer and made it walk the whole reader a SECOND time for every
    // render. Detach around our own mutations and drain any records they queued.
    const flush = () => {
      scheduled = false;
      queue.forEach((el) => {
        const mo = observers.get(el);
        if (mo) mo.disconnect();
        decorate(el);
        if (mo) { mo.takeRecords(); mo.observe(el, { childList: true, subtree: true }); }
      });
      queue.clear();
    };
    ['#drawer-content', '#reader-content'].forEach((sel) => {
      const el = $(sel); if (!el) return;
      const mo = new MutationObserver(() => {
        queue.add(el);
        if (!scheduled) { scheduled = true; setTimeout(flush, 120); }
      });
      observers.set(el, mo);
      mo.observe(el, { childList: true, subtree: true });
      if (el.children.length) decorate(el);
    });
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
    const WINDOW_LABELS = { '90': 'Last 90 days', '365': 'Last 12 months', '730': 'Last 2 years', '1095': 'Last 3 years' };
    const EXAMPLES = [
      { label: 'Base operations support', query: 'base operations support' },
      { label: 'Aircraft parts · PSC 1560', query: '', psc: '1560' },
      { label: 'IT services · NAICS 541512', query: '', naics: '541512' },
      { label: 'Janitorial · NAICS 561720', query: '', naics: '561720' }
    ];
    // High-confidence keyword → code nudges. SAM's keyword only matches notice TITLES,
    // so a bare "iPad" misses most of the market. When a typed term maps to a code we're
    // sure of, we offer a one-click scan by that code (adding it KEEPS the keyword, which
    // then only ranks the pool — see the server's broaden mode). Only rock-solid codes
    // live here; anything unmatched falls back to generic "add a NAICS/PSC" guidance.
    const CODE_HINTS = [
      { re: /\b(ipad|ipads|tablet|tablets|laptop|laptops|desktop|desktops|computer|computers|workstation|workstations|notebook)\b/i, naics: '334111', psc: '7021', label: 'Computers & tablets' },
      { re: /\b(monitor|monitors|printer|printers|scanner|scanners|peripheral|peripherals)\b/i, naics: '334118', psc: '7025', label: 'Computer peripherals' },
      { re: /\b(software|saas|licen[sc]e|licen[sc]es|licen[sc]ing)\b/i, naics: '513210', label: 'Software' },
      { re: /\b(it services|help ?desk|network|networking|cyber|cybersecurity|information technology)\b/i, naics: '541512', label: 'IT services' },
      { re: /\b(janitorial|custodial|cleaning)\b/i, naics: '561720', label: 'Janitorial' },
      { re: /\b(guard|guards|security services)\b/i, naics: '561612', label: 'Security guards' },
      { re: /\b(base operations|base operating|\bbos\b|facilities support)\b/i, naics: '561210', label: 'Base operations support' },
      { re: /\b(grounds|landscaping|mowing|lawn)\b/i, naics: '561730', label: 'Grounds maintenance' },
      { re: /\b(aircraft parts?|aircraft components?)\b/i, psc: '1560', label: 'Aircraft parts' },
      { re: /\b(construction|renovation)\b/i, naics: '236220', label: 'Commercial construction' },
      { re: /\b(motor vehicles?|trucks?|automobiles?|passenger vehicles?)\b/i, naics: '336110', label: 'Motor vehicles' }
    ];
    function codeHintFor(q) { const s = String(q || ''); return CODE_HINTS.find(h => h.re.test(s)) || null; }
    // Chip buttons that add the code and re-run (data-suggest-* is wired in the list handler).
    function suggestionChips(h) {
      if (!h) return '';
      const chips = [];
      if (h.naics) chips.push(`<button type="button" class="market-example" data-suggest-naics="${escAttr(h.naics)}">NAICS ${esc(h.naics)} · ${esc(h.label)}</button>`);
      if (h.psc) chips.push(`<button type="button" class="market-example" data-suggest-psc="${escAttr(h.psc)}">PSC ${esc(h.psc)} · ${esc(h.label)}</button>`);
      return `<div class="market-examples">${chips.join('')}</div>`;
    }
    // The in-results note shown after a title-scoped (keyword, no code) search.
    function titleNoteHTML(q) {
      const h = codeHintFor(q);
      const tail = h
        ? ' Most awards and closed notices are titled differently. Scan the full market by code:'
        : ' Add a NAICS or PSC code for a full scan across awards and closed notices.';
      return `<div class="market-note"><span>Keyword matched notice <strong>titles</strong> only.${tail}</span>${suggestionChips(h)}</div>`;
    }

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
    // ── CONTRACT VEHICLES — "what can I already order against?" ─────────────
    // Two lanes: (1) live IDV discovery via /api/vehicles (USASpending child-order
    // grouping — ranks vehicles by actual recent ordering; agency count shows
    // multi-agency use in practice), and (2) the curated named-vehicle directory
    // (assets/vehicles.json — ordering model, DPA, access fee, sunset dates, all
    // from official sponsor pages; facts we could not verify are omitted).
    let vehData = null, vehState = 'idle', vehSig = '';
    let vehDir = null, vehDirPromise = null;
    let vehShowAll = false, vehFilter = ''; // "Browse all vehicles" mode inside the tray
    // Codes: what the user SEARCHED wins; fall back to the pinned board's codes.
    function vehCodes() {
      const f = currentFilters();
      const naics = f.naics ? [f.naics] : mrDistinct(o => o.naicsCode);
      const psc = f.psc ? [f.psc] : mrDistinct(o => o.classificationCode);
      return { naics, psc };
    }
    function loadVehDir() {
      if (vehDir) return Promise.resolve(vehDir);
      if (!vehDirPromise) {
        vehDirPromise = fetch('/assets/vehicles.json?v=5').then(r => r.ok ? r.json() : null)
          .then(d => { vehDir = d; return d; }).catch(() => null);
      }
      return vehDirPromise;
    }
    // Match directory entries to the market: NAICS/PSC prefix tags + query keywords.
    function vehDirMatches(codes) {
      if (!vehDir || !Array.isArray(vehDir.vehicles)) return { matched: [], always: [] };
      const q = ((query?.value || '') + '').toLowerCase();
      const score = (v) => {
        const t = v.tags || {};
        let s = 0;
        (t.naics || []).forEach(p => codes.naics.forEach(c => { if (c.startsWith(p) || p.startsWith(c)) s += Math.min(p.length, c.length); }));
        (t.psc || []).forEach(p => codes.psc.forEach(c => { if (c.startsWith(p) || p.startsWith(c)) s += Math.min(p.length, c.length) * 2; }));
        (t.kw || []).forEach(k => { if (q && q.includes(k)) s += 3; });
        return s;
      };
      const scored = vehDir.vehicles.filter(v => !(v.tags && v.tags.always))
        .map(v => ({ v, s: score(v) })).filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s).slice(0, 6).map(x => x.v);
      const always = vehDir.vehicles.filter(v => v.tags && v.tags.always);
      return { matched: scored, always };
    }
    const VEH_MODEL = {
      'direct': ['Direct ordering', 'veh-direct'],
      'direct-dpa': ['Direct · DPA required', 'veh-dpa'],
      'assisted': ['Assisted — sponsor places the order', 'veh-assisted'],
      'restricted': ['Restricted community', 'veh-restricted'],
      'pending': ['Not yet open', 'veh-pending'],
      'closed': ['Ordering closed', 'veh-closed']
    };
    function vehSunset(iso) {
      if (!iso) return null;
      const days = Math.floor((new Date(iso) - Date.now()) / 86400000);
      if (days < 0) return { cls: 'veh-closed', txt: 'ordering closed ' + iso };
      if (days <= 180) return { cls: 'veh-sunsetting', txt: 'ordering ends ' + iso };
      return { cls: '', txt: 'ordering to ' + iso };
    }
    function paintVeh() { const el = document.getElementById('market-veh'); if (el) el.innerHTML = vehInnerHTML(); }
    async function loadVeh() {
      const c = vehCodes();
      loadVehDir().then(paintVeh); // directory renders as soon as it arrives (browse-all needs it even with no codes)
      if (!c.naics.length && !c.psc.length) { vehState = 'idle'; paintVeh(); return; }
      const sig = c.naics.slice().sort().join(',') + '|' + c.psc.slice().sort().join(',');
      if (sig === vehSig && (vehState === 'ready' || vehState === 'empty')) { paintVeh(); return; }
      vehSig = sig; vehState = 'loading'; paintVeh();
      try {
        const r = await fetch('/api/usaspending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'vehicles', naics: c.naics, psc: c.psc }) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Vehicle discovery failed');
        vehData = data;
        vehState = (data.vehicles && data.vehicles.length) ? 'ready' : 'empty';
      } catch (e) { vehState = 'error'; }
      paintVeh();
    }
    function vehLiveRow(v) {
      const name = (v.desc || '').replace(/^IGF::[A-Z]+::IGF\s*/i, '').trim() || v.piid || 'Vehicle';
      const sun = vehSunset(v.lastOrder);
      const badges = [
        v.typeLabel ? `<span class="veh-badge">${esc(v.typeLabel)}</span>` : '',
        v.orderingAgencies > 1 ? `<span class="veh-badge veh-multi">${v.orderingAgencies} agencies ordering</span>` : '',
        sun ? `<span class="veh-badge ${sun.cls}">${esc(sun.txt)}</span>` : ''
      ].filter(Boolean).join('');
      const sub = [v.piid, v.agency, v.recipient].filter(Boolean).join(' · ');
      const act = v.recentOrders ? `${v.recentOrders} order${v.recentOrders === 1 ? '' : 's'} · ${usaFmt(v.recentObligated)} (2 yrs)` : 'No recent orders sampled';
      return `<a class="veh-row" href="${escAttr(v.link)}" target="_blank" rel="noopener">
        <span class="veh-row-top"><span class="veh-name">${esc(name.length > 90 ? name.slice(0, 88) + '…' : name)}</span></span>
        <span class="veh-row-sub">${esc(sub)}</span>
        <span class="veh-row-foot">${badges}<span class="veh-act">${esc(act)}</span></span></a>`;
    }
    function vehDirRow(v) {
      const model = VEH_MODEL[v.ordering] || ['', ''];
      const sun = vehSunset(v.ordering_end);
      return `<a class="veh-row veh-dirrow" href="${escAttr(v.url)}" target="_blank" rel="noopener">
        <span class="veh-row-top"><span class="veh-name">${esc(v.name)}</span>${v.bic === true ? '<span class="veh-badge veh-bic">BIC</span>' : ''}</span>
        <span class="veh-row-sub">${esc(v.sponsor)} · ${esc(v.type)}${v.fee ? ' · ' + esc(v.fee) : ''}</span>
        <span class="veh-row-foot"><span class="veh-badge ${model[1]}">${esc(model[0])}</span>${sun && sun.cls ? `<span class="veh-badge ${sun.cls}">${esc(sun.txt)}</span>` : ''}</span></a>`;
    }
    // Full-detail row for the browse-all view: adds the scope + status lines.
    function vehDirRowFull(v) {
      const model = VEH_MODEL[v.ordering] || ['', ''];
      const sun = vehSunset(v.ordering_end);
      return `<a class="veh-row veh-dirrow" href="${escAttr(v.url)}" target="_blank" rel="noopener">
        <span class="veh-row-top"><span class="veh-name">${esc(v.name)}</span>${v.bic === true ? '<span class="veh-badge veh-bic">BIC</span>' : ''}</span>
        <span class="veh-row-sub">${esc(v.sponsor)} · ${esc(v.type)}${v.fee ? ' · ' + esc(v.fee) : ''}</span>
        <span class="veh-row-scope">${esc(v.scope || '')}</span>
        ${v.status ? `<span class="veh-row-scope veh-row-status">${esc(v.status)}</span>` : ''}
        <span class="veh-row-foot"><span class="veh-badge ${model[1]}">${esc(model[0])}</span>${sun && sun.cls ? `<span class="veh-badge ${sun.cls}">${esc(sun.txt)}</span>` : ''}</span></a>`;
    }
    // "Browse all vehicles" — the whole directory, in the tray, grouped and filterable.
    function vehAllListHTML() {
      const all = (vehDir && vehDir.vehicles) || [];
      const q = vehFilter.trim().toLowerCase();
      const hit = (v) => !q || [v.name, v.sponsor, v.type, v.scope, v.status, (v.tags && (v.tags.kw || []).join(' '))].join(' ').toLowerCase().includes(q);
      // Closed vehicles are never listed (owner rule) — the directory carries only
      // orderable vehicles plus pre-award successors a CO should plan around.
      const open = (v) => v.ordering !== 'closed' && v.ordering !== 'pending';
      const groups = [
        ['Government-wide', all.filter(v => v.audience === 'gov-wide' && open(v) && hit(v))],
        ['DoD & service-specific', all.filter(v => v.audience !== 'gov-wide' && open(v) && hit(v))],
        ['On the horizon (pre-award)', all.filter(v => v.ordering === 'pending' && hit(v))]
      ];
      const blocks = groups.filter(([, list]) => list.length).map(([label, list]) =>
        `<div class="market-usa-lbl">${esc(label)} (${list.length})</div>` +
        list.slice().sort((a, b) => a.name.localeCompare(b.name)).map(vehDirRowFull).join('')
      ).join('');
      return blocks || '<div class="market-usa-msg">No vehicles match that filter.</div>';
    }
    function vehAllHTML() {
      const n = (vehDir && vehDir.vehicles || []).length;
      return `<div class="market-usa-head">All contract vehicles <span class="market-usa-src">${n} tracked · verified ${esc((vehDir && vehDir.verified_as_of) || '')}</span></div>
        <button type="button" class="veh-all-back" data-veh-back>← Back to this market</button>
        <input type="text" class="veh-all-filter" id="veh-all-filter" placeholder="Filter — name, sponsor, scope (e.g. cloud, 8(a), medical)…" value="${escAttr(vehFilter)}" aria-label="Filter vehicles">
        <div id="veh-all-list">${vehAllListHTML()}</div>
        <div class="veh-note">Ordering rules and fees from official sponsor pages — confirm against the linked ordering guide before relying on them. See RFO Part 8 for required sources and RFO 16.505 for fair opportunity on orders.</div>`;
    }
    function vehInnerHTML() {
      if (vehShowAll && vehDir) return vehAllHTML();
      const c = vehCodes();
      const head = `<div class="market-usa-head">Existing contract vehicles <span class="market-usa-src">USASpending · sponsor pages</span></div>`;
      const allLink = vehDir ? `<button type="button" class="veh-all-link" data-veh-all>Browse all ${(vehDir.vehicles || []).length} contract vehicles →</button>` : '';
      if (!c.naics.length && !c.psc.length) {
        return head + '<div class="market-usa-msg">Search with a NAICS or PSC — or pin notices that carry them — and this panel shows the GWACs, IDIQs, BPAs, and schedules already covering that market: who sponsors them, the access fee, and whether your office can order directly.</div>' + allLink;
      }
      let live = '';
      if (vehState === 'loading') live = '<div class="market-usa-msg">Scanning recent ordering activity…</div>';
      else if (vehState === 'error') live = '<div class="market-usa-msg">Vehicle discovery unavailable right now.</div>';
      else if (vehState === 'empty') live = '<div class="market-usa-msg">No vehicles with recent ordering found for these codes.</div>';
      else if (vehState === 'ready' && vehData) {
        live = `<div class="market-usa-lbl">Where orders are flowing (last 2 yrs)</div>` + (vehData.vehicles || []).slice(0, 6).map(vehLiveRow).join('');
      }
      let dir = '';
      if (vehDir) {
        const m = vehDirMatches(c);
        const rows = m.matched.map(vehDirRow).join('');
        const always = m.always.map(vehDirRow).join('');
        if (rows || always) {
          dir = `<div class="market-usa-lbl">Named vehicles that may fit</div>${rows}${always ? `<div class="market-usa-lbl">Always available</div>${always}` : ''}${allLink}
            <div class="veh-note">Ordering rules and fees from official sponsor pages, verified ${esc(vehDir.verified_as_of || '')} — confirm against the linked ordering guide before relying on them. See RFO Part 8 for required sources and RFO 16.505 for fair opportunity on orders.</div>`;
        } else {
          dir = allLink;
        }
      }
      return head + live + dir;
    }

    // ── COMPETITION PROFILE — "how this market buys" (extent competed + set-asides) ──
    let compData = null, compState = 'idle', compSig = '';
    function paintComp() { const el = document.getElementById('market-comp'); if (el) el.innerHTML = compInnerHTML(); }
    async function loadComp() {
      const c = vehCodes();
      if (!c.naics.length && !c.psc.length) { compState = 'idle'; paintComp(); return; }
      const sig = c.naics.slice().sort().join(',') + '|' + c.psc.slice().sort().join(',');
      if (sig === compSig && (compState === 'ready' || compState === 'empty')) { paintComp(); return; }
      compSig = sig; compState = 'loading'; paintComp();
      try {
        const r = await fetch('/api/usaspending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'competition', naics: c.naics, psc: c.psc }) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Competition profile failed');
        compData = data;
        compState = (data.totalDollars > 0) ? 'ready' : 'empty';
      } catch (e) { compState = 'error'; }
      paintComp();
    }
    const compFmtB = (v) => {
      const n = Number(v) || 0;
      if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
      return '$' + Math.round(n).toLocaleString();
    };
    function compInnerHTML() {
      const head = `<div class="market-usa-head">How this market buys <span class="market-usa-src">USASpending · last 3 FY</span></div>`;
      if (compState === 'idle') return '';
      if (compState === 'loading') return head + '<div class="market-usa-msg">Profiling competition in this market…</div>';
      if (compState === 'error') return head + '<div class="market-usa-msg">Competition profile unavailable right now.</div>';
      if (compState === 'empty' || !compData) return head + '<div class="market-usa-msg">No obligations found for these codes in the last 3 FY.</div>';
      const d = compData;
      const cPct = d.competed.sharePct, ncPct = d.notCompeted.sharePct;
      const bar = (cPct != null) ? `
        <div class="comp-bar" role="img" aria-label="${cPct}% of labeled dollars competed, ${ncPct}% not competed">
          <span class="comp-bar-c" style="width:${Math.max(2, Math.min(98, cPct))}%"></span>
        </div>
        <div class="comp-bar-legend"><span><i class="comp-dot comp-dot-c"></i>Competed ${cPct}% of $</span><span><i class="comp-dot comp-dot-nc"></i>Not competed ${ncPct}%</span></div>` : '';
      const stats = `<div class="comp-stats">
        <span class="comp-stat"><b>${compFmtB(d.totalDollars)}</b> obligated</span>
        <span class="comp-stat"><b>${(d.totalActions || 0).toLocaleString()}</b> contract actions</span>
        ${d.competed.actionSharePct != null ? `<span class="comp-stat"><b>${d.competed.actionSharePct}%</b> of actions competed</span>` : ''}
      </div>`;
      const sa = (d.setAsides || []).length
        ? `<div class="market-usa-lbl">Set-aside share of dollars</div><div class="comp-sa">${d.setAsides.map(s => `<span class="comp-sa-chip">${esc(s.label)} <b>${s.sharePct}%</b></span>`).join('')}</div>`
        : '';
      return head + stats + bar + sa + `<div class="veh-note">Shares of obligated dollars over the last 3 fiscal years (competed shares are of extent-labeled dollars). Feeds the competition and set-aside picture for RFO Part 10 research and the Part 19 determination.</div>`;
    }

    // ── RULE-OF-TWO SIGNAL — capable-sources counts from SAM entity registrations ──
    let r2Data = null, r2State = 'idle', r2Sig = '';
    const r2Naics = () => (vehCodes().naics.find(n => String(n).replace(/[^0-9]/g, '').length === 6) || '');
    function paintR2() { const el = document.getElementById('market-r2'); if (el) el.innerHTML = r2InnerHTML(); }
    async function loadR2() {
      const naics = r2Naics();
      if (!naics) { r2State = 'idle'; paintR2(); return; }
      if (naics === r2Sig && (r2State === 'ready' || r2State === 'limited')) { paintR2(); return; }
      r2Sig = naics; r2State = 'loading'; paintR2();
      try {
        // GET so the edge cache holds the result (POST is never edge-cached)
        const r = await fetch('/api/market-research?mode=sources&naics=' + encodeURIComponent(naics));
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'lookup failed');
        r2Data = data;
        r2State = data.limited || data.configured === false ? 'limited' : (data.smallUnderNaics != null ? 'ready' : 'limited');
      } catch (e) { r2State = 'error'; }
      paintR2();
    }
    function r2InnerHTML() {
      const naics = r2Naics();
      const head = `<div class="market-usa-head">Capable sources — Rule of Two signal <span class="market-usa-src">SAM.gov registrations</span></div>`;
      if (r2State === 'idle') return '';
      if (r2State === 'loading') return head + '<div class="market-usa-msg">Counting registered sources…</div>';
      if (r2State === 'error') return head + `<div class="market-usa-msg">Source lookup unavailable — <a class="r2-link" href="https://dsbs.sba.gov/search/dsp_dsbs.cfm" target="_blank" rel="noopener">search DSBS directly</a>.</div>`;
      if (r2State === 'limited') return head + `<div class="market-usa-msg">${esc((r2Data && r2Data.note) || 'Lookup limited right now.')} <a class="r2-link" href="https://dsbs.sba.gov/search/dsp_dsbs.cfm" target="_blank" rel="noopener">Search DSBS →</a></div>`;
      const d = r2Data;
      const certs = (d.certs || []).filter(c => c.count > 0);
      return head + `
        <div class="r2-head"><span class="r2-num">${Number(d.smallUnderNaics).toLocaleString()}</span>
        <span class="r2-lede">active SAM registrants certify as <b>small</b> under NAICS ${esc(naics)}${d.totalRegistrants != null ? ` (of ${Number(d.totalRegistrants).toLocaleString()} listing this NAICS)` : ''}</span></div>
        ${certs.length ? `<div class="market-usa-lbl">Socioeconomic representations among them</div><div class="comp-sa">${certs.map(c => `<span class="comp-sa-chip">${esc(c.label)} <b>${Number(c.count).toLocaleString()}</b></span>`).join('')}</div>` : ''}
        <div class="veh-note">Registration signals — but does not prove — capability. Confirm through sources sought, <a class="r2-link" href="https://dsbs.sba.gov/search/dsp_dsbs.cfm" target="_blank" rel="noopener">DSBS</a>, and market outreach before the RFO Part 19 set-aside determination.</div>`;
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
      .narr{border:1px solid var(--brass-line);border-left:3px solid var(--brass-ink);border-radius:9px;padding:12px 15px;background:#fff;}
      .narr p{font-size:10.5px;line-height:1.66;color:var(--ink2);margin:0 0 8px;} .narr p:last-child{margin-bottom:0;}
      .narr-hint{font-size:8.5px;font-style:italic;color:var(--muted2);margin-top:5px;}
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
    // ── Narrative summary — deterministic sentences computed from the pinned
    // set + loaded award data (no AI, no paraphrase of reg text). Written to be
    // lifted straight into the "results of market research" section of an MR
    // report: factual counts first, one measured reading of the competitive
    // signal, and a verify-before-filing close.
    function mrNarrative() {
      const n = board.length;
      if (!n) return [];
      const q = (query?.value || '').trim();
      const today = new Date().toISOString().slice(0, 10);
      const winSel = $('#market-window-select');
      const winTxt = winSel && winSel.options[winSel.selectedIndex] ? winSel.options[winSel.selectedIndex].text.toLowerCase() : '';
      const listTop = (entries, k) => entries.slice(0, k).map(([v, c]) => `${v} (${c})`).join(', ');
      const noun = (c, s, p) => `${c} ${c === 1 ? s : p}`;
      const paras = [];
      const types = tally(o => o.type), offices = tally(o => o.organization);
      const naics = mrDistinct(o => o.naicsCode), pscs = mrDistinct(o => o.classificationCode);
      // 1 — scope & method
      let p1 = `Market research was conducted on ${today} using SAM.gov opportunity data${winTxt ? `, covering the ${winTxt}` : ''}${q ? `, for “${q}”` : ''}. `;
      p1 += `${noun(n, 'comparable notice was', 'comparable notices were')} reviewed in detail${mrSpan() !== '—' ? ` (postings ${mrSpan()})` : ''}`;
      const scope = [];
      if (naics.length) scope.push(`NAICS ${naics.slice(0, 4).join(', ')}`);
      if (pscs.length) scope.push(`PSC ${pscs.slice(0, 4).join(', ')}`);
      p1 += scope.length ? `, concentrated in ${scope.join(' and ')}.` : '.';
      paras.push(p1);
      // 2 — who is buying, and how
      const bits = [];
      if (types.length) bits.push(`Notice activity comprises ${listTop(types, 5)}${types.length > 5 ? ', among others' : ''}`);
      if (offices.length) bits.push(offices.length === 1
        ? `all issued by ${offices[0][0]}`
        : `issued by ${offices.length} buying offices, led by ${offices[0][0]} (${offices[0][1]} of ${n})`);
      if (bits.length) paras.push(bits.join(', ') + '.');
      // 3 — competitive / set-aside signal
      const saEntries = tally(o => o.setAside);
      const saCount = board.filter(o => (o.setAside || '').trim()).length;
      if (saCount) {
        const pct = Math.round(100 * saCount / n);
        paras.push(`${noun(saCount, 'notice', 'notices')} of the ${n} reviewed (${pct}%) carried a set-aside designation — ${listTop(saEntries, 3)} — indicating established small-business participation in this market. See RFO Part 19 for the set-aside determination.`);
      } else {
        paras.push(`None of the reviewed notices carried a set-aside designation; the set-aside determination under RFO Part 19 should rest on capable-source research beyond these postings.`);
      }
      // 4 — incumbency, when the award data is on screen
      if (usaState === 'ready' && usaData && (usaData.recipients || []).length) {
        const recs = usaData.recipients || [];
        const total = recs.reduce((s, r) => s + (Number(r.total) || 0), 0);
        const cnt = recs.reduce((s, r) => s + (Number(r.count) || 0), 0);
        const top = recs[0];
        const share = total > 0 ? Math.round(100 * (Number(top.total) || 0) / total) : 0;
        paras.push(`Historical award data (USASpending.gov, last ${usaData.years} fiscal years) shows ${cnt ? noun(cnt, 'award', 'awards') + ' across ' : ''}the top ${noun(recs.length, 'recipient', 'recipients')} totaling ${usaFmt(total)}; ${top.name} leads at ${usaFmt(top.total)}${share ? ` (${share}% of that total)` : ''}. Award history is the stronger incumbency signal; the notices above are the demand signal.`);
      }
      // 4b — how the market buys, when the competition profile is on screen
      if (compState === 'ready' && compData && compData.competed.sharePct != null) {
        const cd = compData;
        const saTxt = (cd.setAsides || []).slice(0, 3).map(s => `${s.label} ${s.sharePct}%`).join(', ');
        paras.push(`Competition profile (USASpending.gov/FPDS, last 3 FY): of ${compFmtB(cd.totalDollars)} obligated across ${(cd.totalActions || 0).toLocaleString()} contract actions in this market, ${cd.competed.sharePct}% of extent-labeled dollars were competitively awarded${cd.competed.actionSharePct != null ? ` (${cd.competed.actionSharePct}% of actions)` : ''}.${saTxt ? ` Set-aside share of dollars: ${saTxt}.` : ''}`);
      }
      // 4c — capable-sources signal, when the Rule-of-Two lookup succeeded
      if (r2State === 'ready' && r2Data && r2Data.smallUnderNaics != null) {
        const certTxt = (r2Data.certs || []).filter(c => c.count > 0).map(c => `${c.label} ${Number(c.count).toLocaleString()}`).join(', ');
        paras.push(`Capable-sources signal (SAM.gov registrations): ${Number(r2Data.smallUnderNaics).toLocaleString()} active registrants certify as small under NAICS ${r2Data.naics}${certTxt ? `, including ${certTxt}` : ''}. Registration signals capability but does not establish it — the RFO Part 19 determination should rest on sources-sought responses and market outreach.`);
      }
      // 5 — existing vehicles, when discovery has run
      if (vehState === 'ready' && vehData && (vehData.vehicles || []).length) {
        const vs = vehData.vehicles || [];
        const active = vs.filter(v => v.orderingAgencies > 1).length;
        const top = vs[0];
        const topName = (top.desc || top.piid || 'the leading vehicle').replace(/^IGF::[A-Z]+::IGF\s*/i, '').slice(0, 70);
        paras.push(`Existing contract vehicles were considered (RFO Part 8; fair opportunity per RFO 16.505): ${vs.length} vehicle${vs.length === 1 ? '' : 's'} show recent ordering in this market${active ? `, ${active} with multi-agency ordering in practice` : ''}, led by ${topName} (${top.recentOrders} order${top.recentOrders === 1 ? '' : 's'}, ${usaFmt(top.recentObligated)} over the last 2 years). Vehicle access rules and fees should be confirmed with the sponsor before selecting an ordering vehicle.`);
      }
      paras.push('These observations are drawn mechanically from the records itemized below — verify each against the source notice or award record before relying on it in the file.');
      return paras;
    }
    // Competition-profile section for the printable note
    function compNoteHTML() {
      if (compState !== 'ready' || !compData || compData.competed.sharePct == null) return '';
      const d = compData;
      const chips = [
        `<span class="chip">Obligated <b>${esc(compFmtB(d.totalDollars))}</b></span>`,
        `<span class="chip">Actions <b>${(d.totalActions || 0).toLocaleString()}</b></span>`,
        `<span class="chip">Competed $ <b>${d.competed.sharePct}%</b></span>`,
        d.competed.actionSharePct != null ? `<span class="chip">Competed actions <b>${d.competed.actionSharePct}%</b></span>` : ''
      ].filter(Boolean).join('');
      const sa = (d.setAsides || []).map(s => `<span class="chip">${esc(s.label)} <b>${s.sharePct}%</b></span>`).join('');
      return `<div class="sec"><div class="sec-eyebrow"><span class="sec-title">Competition profile</span></div>
        <div class="pat"><div class="pat-row"><div class="pat-k">Market, last 3 FY</div><div class="pat-v">${chips}</div></div>
        ${sa ? `<div class="pat-row"><div class="pat-k">Set-aside $ share</div><div class="pat-v">${sa}</div></div>` : ''}</div>
        <div class="foot" style="margin-top:8px;border:none;padding:0;">Source: USASpending.gov (FPDS) — shares of obligated dollars, last 3 fiscal years; competed shares are of extent-labeled dollars. Supports the competition approach and the RFO Part 19 set-aside determination.</div></div>`;
    }
    // Capable-sources section for the printable note
    function r2NoteHTML() {
      if (r2State !== 'ready' || !r2Data || r2Data.smallUnderNaics == null) return '';
      const certs = (r2Data.certs || []).filter(c => c.count > 0).map(c => `<span class="chip">${esc(c.label)} <b>${Number(c.count).toLocaleString()}</b></span>`).join('');
      return `<div class="sec"><div class="sec-eyebrow"><span class="sec-title">Capable sources — Rule of Two signal</span></div>
        <div class="pat"><div class="pat-row"><div class="pat-k">NAICS ${esc(r2Data.naics)}</div><div class="pat-v"><span class="chip">Small registrants <b>${Number(r2Data.smallUnderNaics).toLocaleString()}</b></span>${r2Data.totalRegistrants != null ? `<span class="chip">All registrants listing this NAICS <b>${Number(r2Data.totalRegistrants).toLocaleString()}</b></span>` : ''}</div></div>
        ${certs ? `<div class="pat-row"><div class="pat-k">Representations</div><div class="pat-v">${certs}</div></div>` : ''}</div>
        <div class="foot" style="margin-top:8px;border:none;padding:0;">Source: SAM.gov Entity Management — active registrations certifying small under this NAICS. Registration signals capability but does not establish it; confirm via sources sought, DSBS, and outreach before the RFO Part 19 determination.</div></div>`;
    }
    // Existing-vehicles section for the printable note
    function vehNoteHTML() {
      const c = vehCodes();
      const hasLive = vehState === 'ready' && vehData && (vehData.vehicles || []).length;
      const m = vehDir ? vehDirMatches(c) : { matched: [], always: [] };
      if (!hasLive && !m.matched.length) return '';
      let rows = '';
      if (hasLive) {
        rows = (vehData.vehicles || []).slice(0, 6).map(v => {
          const name = (v.desc || '').replace(/^IGF::[A-Z]+::IGF\s*/i, '').trim() || v.piid || 'Vehicle';
          const sun = vehSunset(v.lastOrder);
          return `<tr><td><div class="t-title">${esc(name.slice(0, 80))}</div><div class="t-org">${esc([v.piid, v.agency].filter(Boolean).join(' · '))}</div></td><td class="t-mono">${esc(v.typeLabel || '—')}</td><td class="t-mono">${v.recentOrders} · ${esc(usaFmt(v.recentObligated))}</td><td class="t-mono">${v.orderingAgencies > 1 ? v.orderingAgencies + ' agencies' : 'sponsor only'}</td><td class="t-mono">${esc(sun ? sun.txt.replace(/^ordering /, '') : '—')}</td></tr>`;
        }).join('');
      }
      const named = m.matched.slice(0, 5).map(v => {
        const model = (VEH_MODEL[v.ordering] || [''])[0];
        return `<span class="chip">${esc(v.name)} <b>${esc(model)}${v.fee ? ' · ' + esc(v.fee) : ''}</b></span>`;
      }).join('');
      return `<div class="sec"><div class="sec-eyebrow"><span class="sec-title">Existing contract vehicles considered</span></div>
        ${named ? `<div class="pat"><div class="pat-row"><div class="pat-k">Named vehicles</div><div class="pat-v">${named}</div></div></div>` : ''}
        ${rows ? `<table style="margin-top:10px"><thead><tr><th style="width:38%">Vehicle</th><th style="width:12%">Type</th><th style="width:18%">Orders · $ (2 yrs)</th><th style="width:16%">Ordering agencies</th><th style="width:16%">Ordering window</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
        <div class="foot" style="margin-top:8px;border:none;padding:0;">Live vehicle data: USASpending.gov (FPDS) order activity grouped by parent vehicle. Named-vehicle rules from official sponsor pages${vehDir && vehDir.verified_as_of ? `, verified ${esc(vehDir.verified_as_of)}` : ''} — confirm fees, DPA requirements, and ordering eligibility with the sponsor. See RFO Part 8 (required sources) and RFO 16.505 (fair opportunity).</div></div>`;
    }
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
      const compSec = compNoteHTML();
      const r2Sec = r2NoteHTML();
      const vehSec = vehNoteHTML();  // present only when vehicle data/matches exist
      const narr = mrNarrative();
      const narrSec = narr.length ? `<div class="sec"><div class="sec-eyebrow"><span class="sec-title">Narrative summary</span></div><div class="narr">${narr.map(p => `<p>${esc(p)}</p>`).join('')}</div><div class="narr-hint no-print">Drafted from the records below — select, copy, and edit to fit the market research report.</div></div>` : '';
      return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><base href="${base}/"><title>AcqVault — Market Research Summary</title><style>${MRCSS}</style></head><body>
        <div class="toolbar no-print"><button data-action="print">⤓ Save as PDF</button><span>Opens your browser's print dialog — choose “Save as PDF.”</span></div>
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
          ${narrSec}
          <div class="sec"><div class="sec-eyebrow"><span class="sec-title">Market landscape</span></div><div class="pat">${pats}</div></div>
          <div class="sec"><div class="sec-eyebrow"><span class="sec-title">Comparable notices reviewed</span></div>
            <table><thead><tr><th style="width:15%">Type / posted</th><th style="width:34%">Notice</th><th style="width:16%">NAICS · PSC</th><th style="width:20%">Set-aside</th><th style="width:15%">Notice #</th></tr></thead><tbody>${rows}</tbody></table>
            <div class="foot" style="margin-top:8px;border:none;padding:0;">Source records retrieved from SAM.gov via AcqVault. Open each notice at <b>sam.gov</b> using its notice number for the authoritative file, attachments, and full description.</div>
          </div>
          ${usaSec}
          ${compSec}
          ${r2Sec}
          ${vehSec}
          <div class="guide"><div class="guide-k">Governing guidance</div><div class="guide-t">This market research supports <a href="/rfo/part-10">RFO Part 10</a> (Market Research). Small-business set-asides recur in this market — see <a href="/rfo/part-19">RFO Part 19</a> for the set-aside determination. For commercial-item treatment by PSC, see <a href="/rfo/part-12">RFO Part 12</a>. Existing vehicles: <a href="/rfo/part-8">RFO Part 8</a> and <a href="/?q=16.505">RFO 16.505</a>.</div></div>
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
      L.push(`Prepared: ${new Date().toISOString().slice(0, 10)}`);
      const narr = mrNarrative();
      if (narr.length) { L.push('', 'NARRATIVE SUMMARY'); narr.forEach(p => L.push('  ' + p)); }
      L.push('', 'MARKET LANDSCAPE');
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
      if (compState === 'ready' && compData && compData.competed.sharePct != null) {
        const cd = compData;
        L.push('', 'COMPETITION PROFILE (USASpending.gov/FPDS, last 3 FY)');
        L.push(`    Obligated: ${compFmtB(cd.totalDollars)} across ${(cd.totalActions || 0).toLocaleString()} contract actions`);
        L.push(`    Competed: ${cd.competed.sharePct}% of extent-labeled dollars${cd.competed.actionSharePct != null ? ` · ${cd.competed.actionSharePct}% of actions` : ''}`);
        (cd.setAsides || []).forEach(s => L.push(`    Set-aside — ${s.label}: ${s.sharePct}% of dollars`));
      }
      if (r2State === 'ready' && r2Data && r2Data.smallUnderNaics != null) {
        L.push('', `CAPABLE SOURCES — RULE OF TWO SIGNAL (SAM.gov, NAICS ${r2Data.naics})`);
        L.push(`    ${Number(r2Data.smallUnderNaics).toLocaleString()} active registrants certify as small under this NAICS${r2Data.totalRegistrants != null ? ` (${Number(r2Data.totalRegistrants).toLocaleString()} total registrants listing this NAICS)` : ''}`);
        (r2Data.certs || []).filter(c => c.count > 0).forEach(c => L.push(`    ${c.label}: ${Number(c.count).toLocaleString()}`));
        L.push('    Registration signals capability but does not establish it — confirm via sources sought/DSBS before the Part 19 determination.');
      }
      if (vehState === 'ready' && vehData && (vehData.vehicles || []).length) {
        L.push('', 'EXISTING CONTRACT VEHICLES CONSIDERED (USASpending.gov order activity, last 2 yrs)');
        (vehData.vehicles || []).slice(0, 6).forEach(v => {
          const name = (v.desc || '').replace(/^IGF::[A-Z]+::IGF\s*/i, '').trim() || v.piid || 'Vehicle';
          const sun = vehSunset(v.lastOrder);
          L.push(`    ${name.slice(0, 80)} — ${v.piid || ''} · ${v.typeLabel || ''} · ${v.recentOrders} orders / ${usaFmt(v.recentObligated)} · ${v.orderingAgencies > 1 ? v.orderingAgencies + ' agencies ordering' : 'sponsor-only ordering'}${sun ? ' · ' + sun.txt : ''}`);
          if (v.link) L.push(`      ${v.link}`);
        });
        const m = vehDir ? vehDirMatches(vehCodes()) : { matched: [] };
        if (m.matched.length) {
          L.push('  Named vehicles that may fit (confirm with sponsor):');
          m.matched.slice(0, 5).forEach(v => L.push(`    ${v.name} — ${(VEH_MODEL[v.ordering] || [''])[0]}${v.fee ? ' · ' + v.fee : ''} · ${v.url}`));
        }
        L.push('  See RFO Part 8 (required sources) and RFO 16.505 (fair opportunity on orders).');
      }
      L.push('', 'GOVERNING GUIDANCE: RFO Part 10 (Market Research); RFO Part 19 (set-asides); RFO Part 12 (commercial by PSC); RFO Part 8 / 16.505 (existing vehicles).', '', `Generated by AcqVault (acqvault.com) on ${new Date().toISOString().slice(0, 10)} from SAM.gov data. Unofficial research aid — verify against the official record before filing.`);
      return L.join('\n');
    }
    function generateMrNote() {
      if (!board.length) return;
      const w = window.open('', '_blank');
      if (!w) { srAnnounceMR('Allow pop-ups to open the report, or use Copy snapshot.'); return; }
      w.document.open(); w.document.write(mrHTML()); w.document.close();
      // The report window doesn't load app.js, so wire its print button from here
      // (keeps the exported doc free of inline handlers for the strict CSP).
      const printBtn = w.document.querySelector('[data-action="print"]');
      if (printBtn) printBtn.addEventListener('click', () => w.print());
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
        <div class="market-board-body">${n ? patternsHTML() + ((usaCodes().naics.length || usaCodes().psc.length) ? '<div class="market-usa" id="market-usa"></div>' : '') + ((vehCodes().naics.length || vehCodes().psc.length) ? '<div class="market-usa market-comp" id="market-comp"></div>' : '') + (r2Naics() ? '<div class="market-usa market-r2" id="market-r2"></div>' : '') + '<div class="market-usa market-veh" id="market-veh"></div>' + board.map(boardItemHTML).join('') : '<div class="market-board-empty"><strong>No pinned opportunities yet.</strong>Use the pin on any result card to start building your working set.</div>' + ((vehCodes().naics.length || vehCodes().psc.length) ? '<div class="market-usa market-comp" id="market-comp"></div>' : '') + (r2Naics() ? '<div class="market-usa market-r2" id="market-r2"></div>' : '') + '<div class="market-usa market-veh" id="market-veh"></div>'}</div>
        ${n ? '<div class="market-board-foot"><div class="market-board-foot-actions"><button type="button" class="market-board-gen" data-mr-note="1">Generate report</button><button type="button" class="market-board-copy" data-mr-copy="1">Copy snapshot</button></div><button type="button" class="market-board-clear" data-board-clear="1">Clear board</button></div>' : ''}`;
      if (n) loadUsa();
      loadVeh(); // works off searched codes even with an empty board
      loadComp();
      loadR2();
    }
    function openTray() {
      renderBoardTray();
      boardBackdrop.hidden = false; boardTray.hidden = false;
      // force a reflow so the slide-in transition plays, then add the open
      // classes synchronously (rAF can be throttled in some render contexts)
      void boardTray.offsetWidth;
      boardBackdrop.classList.add('show'); boardTray.classList.add('open');
      trayOpen = true;
      boardTray.setAttribute('aria-modal', 'true');
      boardTray.querySelector('.market-board-close')?.focus();
      if (typeof window.trapFocus === 'function') { try { window.trapFocus(boardTray); } catch (e) {} }
    }
    function closeTray() {
      boardTray.classList.remove('open'); boardBackdrop.classList.remove('show');
      trayOpen = false;
      setTimeout(() => { if (!trayOpen) { boardTray.hidden = true; boardBackdrop.hidden = true; } }, 300);
      if (typeof window.releaseFocus === 'function') { try { window.releaseFocus(); } catch (e) {} }
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
      if (e.target.closest('[data-veh-all]')) {
        vehShowAll = true; paintVeh();
        boardTray.querySelector('#market-veh')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.closest('[data-veh-back]')) { vehShowAll = false; vehFilter = ''; paintVeh(); return; }
      if (e.target.closest('[data-board-clear]')) { clearBoard(); }
    });
    // Browse-all filter: update only the list so the input keeps focus while typing.
    boardTray.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'veh-all-filter') {
        vehFilter = e.target.value;
        const list = boardTray.querySelector('#veh-all-list');
        if (list) list.innerHTML = vehAllListHTML();
      }
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
      const q = (data.query || query?.value || '').trim();
      if (!opps.length) {
        if (data.titleScoped) {
          if (count) count.textContent = 'No matches';
          list.innerHTML = `<div class="market-empty"><strong>No title matches for “${esc(q)}”.</strong>The keyword only searches notice titles, so most of this market won't show here. Scan by NAICS or PSC code instead:${suggestionChips(codeHintFor(q)) || examplesHTML()}</div>`;
          return;
        }
        renderEmptyState('No matches', 'Nothing came back for these filters. Try removing NAICS/PSC, widening the window, or keeping Notice type on All — or start from a common market:', { examples: true, count: 'No matches' });
        return;
      }
      // Honest coverage note: title-scoped searches see only titles; a code scan sees all.
      const note = data.titleScoped ? titleNoteHTML(q)
        : (data.broadened ? '<div class="market-note market-note-soft">Showing the full market for this code, with keyword-relevant notices ranked first, including awards and closed notices.</div>' : '');
      lastOppByKey = {};
      list.innerHTML = note + opps.map(item => {
        const key = oppKey(item); lastOppByKey[key] = item;
        const pinned = isPinned(key);
        const meta = [item.solicitationNumber, item.naicsCode ? `NAICS ${item.naicsCode}` : '', item.classificationCode ? `PSC ${item.classificationCode}` : '', item.setAside].filter(Boolean);
        const foot = [deadlineFlag(item), item.attachments ? `<span class="market-opp-attach">${item.attachments} attachment${item.attachments === 1 ? '' : 's'}</span>` : ''].filter(Boolean).join('');
        return `<div class="market-opp-card">
          <div class="market-opp-top"><span class="market-opp-type">${esc(item.type || 'Opportunity')}</span><span class="market-opp-top-right"><span class="market-opp-date">${esc(item.postedDate || '')}</span><button type="button" class="market-opp-pin${pinned ? ' pinned' : ''}" data-pin="${escAttr(key)}" aria-pressed="${pinned}" aria-label="${pinned ? 'Remove from board' : 'Pin to board'}" title="${pinned ? 'Pinned to your board' : 'Pin to your board'}">${PIN_SVG}</button></span></div>
          <div class="market-opp-title"><a class="market-opp-title-link" href="${escAttr(item.uiLink || 'https://sam.gov/search/?index=opp')}" target="_blank" rel="noopener">${esc(item.title)}</a></div>
          <div class="market-opp-org">${esc(item.organization || 'SAM.gov opportunity')}</div>
          <div class="market-opp-meta">${meta.map(value => `<span>${esc(value)}</span>`).join('')}</div>
          ${awardLine(item)}
          ${foot ? `<div class="market-opp-foot">${foot}</div>` : ''}
        </div>`;
      }).join('');
      updateBoardBtn();
    }
    // Race guard, same shape as dashReqToken above: the suggestion chips and the Enter key
    // bypass the button-disable, so without a token a slower earlier request repaints over
    // the newer results the user is already looking at.
    let marketReqToken = 0;
    async function runMarketSearch() {
      if (!list) return;
      renderActiveFilters();
      renderLoading();
      btn?.setAttribute('disabled', 'disabled');
      const token = ++marketReqToken;
      try {
        const response = await fetch('/api/market-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...currentFilters(), noticeTypes: selectedTypes() })
        });
        const data = await response.json().catch(() => ({}));
        if (token !== marketReqToken) return;   // superseded by a newer search
        if (!response.ok) throw new Error(data.detail || data.error || 'Market research search failed.');
        renderOpportunities(data);
      } catch (error) {
        if (token !== marketReqToken) return;
        renderError(error.message || 'The market research service could not be reached.');
      } finally {
        if (token === marketReqToken) btn?.removeAttribute('disabled');
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
      const sg = event.target.closest('[data-suggest-naics],[data-suggest-psc]');
      if (sg) {
        // Keep whatever keyword is typed; adding the code flips the server into broaden
        // mode (keyword ranks the code pool instead of hard-filtering by title).
        event.preventDefault();
        if (sg.dataset.suggestNaics) { const n = $('#market-naics-input'); if (n) n.value = sg.dataset.suggestNaics; }
        if (sg.dataset.suggestPsc) { const p = $('#market-psc-input'); if (p) p.value = sg.dataset.suggestPsc; }
        // Re-rendering the list destroys this button, so keyboard focus would land on
        // <body>. Move it onto the refreshed results region instead.
        Promise.resolve(runMarketSearch()).then(() => {
          if (!list) return;
          list.setAttribute('tabindex', '-1');
          try { list.focus({ preventScroll: true }); } catch (e) { list.focus(); }
        });
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
      // Vehicles — the discovery affordance for "what can I already order against?"
      // Opens the tray and lands on the vehicles panel (which self-explains when
      // there's no NAICS/PSC context yet).
      const vehBtn = document.createElement('button');
      vehBtn.type = 'button';
      vehBtn.className = 'market-board-btn market-veh-btn';
      vehBtn.setAttribute('aria-haspopup', 'dialog');
      vehBtn.setAttribute('aria-label', 'Existing contract vehicles for this market');
      vehBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="13" height="9" rx="1.5"/><path d="M16 11h3.2L21 14v3h-2"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="17" cy="17" r="1.6"/></svg><span>Vehicles</span>';
      resultsHead.appendChild(right);
      right.appendChild(count);
      right.appendChild(vehBtn);
      right.appendChild(boardBtn);
      boardBtn.addEventListener('click', () => {
        if (trayOpen) { closeTray(); return; }
        vehShowAll = false; // Board opens on the pins, not mid-directory
        openTray();
      });
      // One click to the vehicles: with a market context, land on the matches;
      // without one, go straight to the full browsable directory (no extra hop).
      function openVehicles() {
        const c = vehCodes();
        vehShowAll = !(c.naics.length || c.psc.length);
        if (!trayOpen) openTray(); else paintVeh();
        setTimeout(() => { boardTray.querySelector('#market-veh')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
      }
      vehBtn.addEventListener('click', openVehicles);
      document.getElementById('market-veh-chip')?.addEventListener('click', openVehicles);
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
      // Home leads the menu — it lives beside the logo on desktop (not in nav-center),
      // so it must be added here explicitly. /?home=1 beats the per-tab view restore.
      let html = `<a class="mm-link" href="/?home=1">Home<span class="mm-arrow" aria-hidden="true">→</span></a>`;
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


/* ── THE COMBINATION: home-strip board loader ─────────────────────────────── */
(function () {
  var strip = document.getElementById('daily-strip');
  if (!strip) return;
  fetch('/api/feedback?board=1').then(function (r) { return r.json(); }).then(function (b) {
    if (!b.configured || !b.top || !b.top.length) return; // strip stays CTA-only
    var list = document.getElementById('daily-board-list');
    var count = document.getElementById('daily-board-count');
    var board = document.getElementById('daily-board');
    if (!list || !board) return;
    list.innerHTML = b.top.slice(0, 3).map(function (e, i) {
      var name = String(e.n || 'Anonymous').replace(/[<>&"]/g, '');
      return '<li><b>' + (i + 1) + '</b>' + name + '<span>' + (e.g === 'X' ? '—' : e.g + '/6') + '</span></li>';
    }).join('');
    if (count) count.textContent = b.count + ' on today\u2019s board';
    board.hidden = false;
  }).catch(function () {});
})();
