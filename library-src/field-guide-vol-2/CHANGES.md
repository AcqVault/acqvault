# Field Guide Vol. 2 — change log

Source: `index.html` + `guide.css`. Build and lock with `python3 library-src/build_field_guides.py 2`
(`--no-lock` writes an unlocked draft to the temp dir for proofing).

## v4 — 19 Oct 2026 (rebuilt from the v3 PDF of 29 Jul 2026)

The v3 source was lost, so v4 was recovered from the PDF (text, styling and structure) and rebuilt as
HTML/CSS with the same look. Everything below was checked against `output/documents.json`
(RFO, R-DFARS, PGI, DoW FMR, DAF COMPASS) as indexed on 19 Oct 2026. Wording and structure that
aren't listed here are unchanged from v3.

### J&A and fair-opportunity approval tiers (the big one)
- **Competition (CICA), step 4 + Know cold:** the RFO 6.104-2 ladder (≤$900K CO · ≤$20M CA · ≤$90M/$150M DoD
  "HPA/PEO" · SPE) is replaced for DoD by **R-DFARS 206.104-71 Table 206-1** (Class Deviation 2026-O0017 Rev 2):
  ≤$10M CO certification · ≤$100M Competition Advocate (not delegable) · ≤$500M HCA (delegable only to GO/FO
  or SES-equivalent) · above SPE. RFO ladder kept as the civilian baseline. "PEO" dropped from the RFO tier
  (the RFO says head of the procuring activity).
- **New ladder table** after the walk-through: RFO vs. DoD Table 206-1 vs. **DAF Part 6 Table 1** (COMPASS,
  DAF Class Deviation 2026-U0001: CO/COCO ≤$10M · CCA ≤$100M · PAE/PEO if GO/SES, otherwise SCO or HPA,
  ≤$500M · SPE (SAF/AQ or SAF/SQ)), plus notes: same authorities for D&As (216.507-6(e)); DoD sole-source 8(a)
  over $100M → HCA (206.104-71(d)); non-competitive follow-ons → PGI 206.104-71; DAF Legal review over $10M.
- Answers that changed: "$40M J&A" → Competition Advocate (DAF: CCA), was HPA/PEO · "$15M" → CA (same) ·
  "$18M / $95M DoD / $160M DoD" → CA / **CA** / **HCA** (were CA / HPA/PEO / SPE) · messy-scenario "$2.8M" →
  **CO certification** (was Competition Advocate) · IDIQ "$12M D&A" → CA (unchanged, now explained) ·
  Bank 05 "$1.4M D&A" → **CO certification** (was Competition Advocate).
- **IDIQ step 4 + Know cold:** D&A tiers now cite R-DFARS 216.507-6(e) / Table 206-1; posting 14 days (30 urgency).
- **Threshold card + Appendix B:** tier lines rewritten for DoD/DAF/civilian.
- 8(a) follow-up: DoD J&A only above $100M (206.104-70(b)), approved by HCA (206.104-71(d)); civilian $30M (6.103-5(e)).
- J&A posting: "national-security actions are exempt from synopsis" → not posted where posting would
  compromise national security (RFO 6.301(e)).

### Protests
- Stay rule corrected to RFO 33.105-3(b): 5 days after the **offered** date of a required debriefing; added DoD
  **R-DFARS 233.105-70** prongs (10 days after a task/delivery order **over $35M**; 5 days after an offered date even
  if declined; 5 days after a debriefing concludes). Updated walk-through, Know cold, follow-up, debrief, answers.
- Override: HCA finding is **nondelegable** and GAO must be notified before performance resumes (33.105-3(b)(2), (c)).
- IDIQ protest step and threshold card note the DoD $35M order stay prong.

### Certified cost or pricing data / pricing
- $10M line now cited to **R-DFARS 215.403-3(a)** (FY26 NDAA §1804, 10 U.S.C. 3702): prime contracts *expected to
  exceed* $10M and *awarded after* 30 Jun 2026 (was "at or above $10M, actions entered after"); earlier awards and
  their mods keep $2.5M; civilian agencies stay at $2.5M (RFO 15.403-3). Watch-out rewritten (R-DFARS now carries the
  number; the old "statute controls over the printed RFO" framing removed).
- DCMA/DCAA support thresholds re-cited to **PGI 215.406** (renumbered): DCMA field pricing for FP over the
  certified-data threshold (was "~$2.5M"), cost-type over $10M; DCAA audit FP >$10M / cost >$100M (unchanged).
- "TINA Lite": was "DPCAP guide, FY26 NDAA §812(c) … CO with DPCAP-level approval" → **R-DFARS 215.403-72**,
  10 U.S.C. 3709, **HCA approval without delegation**, >$50M, recurring buys with reliable actual cost data.
- §1826: "nontraditionals **and small businesses** exempted" → nontraditional defense contractors only (unless waived),
  from certified data (215.403-71(a)(5), 252.215-7013), Part 31 (231.001-70) and purchasing systems (244.071).
  No small-business exemption found.
- CAS (§1806): "per-contract trigger raised" made specific — contract-level applicability $35M; full coverage /
  disclosure $100M for DoD-only business units (R-DFARS 230.201-70, 230.301).
- CPFF fee ceilings now cite RFO 15.404-9 on the threshold card.

### Contract types
- E.O. 14402 (RFO 16.104): covered = other-than-fixed-price, **FFP level-of-effort**, and hybrids (was "non-FFP");
  thresholds "at or above" — DoD $100M, NASA $35M, DHS $25M, others $10M; exceptions (MAC-level awards, emergencies,
  R&D, pre-production major-system development); DoD approval before solicitations issued on/after 15 Jul 2026
  (PGI 216.104-70). Dropped the unverified "July 2026 Part 16 revision" dating; dek cite 16.102–16.104 → 16.102–16.103.

### IDIQ ordering
- Exceptions list per RFO 16.507-6(b): added **DoD: any RFO 6.103 exception**; order-level small-business set-asides
  moved out of the exception list — they're a separate authority with no justification/approval/posting (16.507-6(c)).
- Added DoD enhanced post-award debriefing for orders ≥$15M (R-DFARS 216.507-5(c)) next to the $7.5M RFO line.

### Options
- 17.204-1 gates brought to the RFO text: added timely written notice, **synopsized**, **evaluated in the original
  competition (Part 6)**; "performance considered" → **acceptable** performance; price test is "fair and reasonable at
  current market conditions + best interest". Added DoD SAM-record and SPRS/NIST/CMMC checks (R-DFARS 217.204-70).
  Updated walk-through, Know cold, answers, Bank 01.
- 5-year services rail now cites RFO 22.1002-2 (Service Contract Labor Standards).

### Interagency
- "Best-procurement-approach D&F" for non-DoD vehicles → **R-DFARS 217.670** review (best interest of DoD: customer
  requirements, schedule, cost incl. fees, administration; scope; funding) and RFO 17.603 compliance certification for
  assisted buys over the SAT. Messy-scenario debrief updated.
- Economy Act D&F conditions: "their contract, their expertise, **or their statutory authorization**" → existing
  contract or expertise only (RFO 17.502-2(b)); added DoW FMR Vol 11 §4.

### Fiscal law (FMR naming)
- Added DoW Financial Management Regulation cites (**DoW 7000.14-R**, Sept 2026 edition — Vol 3 §8, §9; Vol 14) in the dek.
- Severable services: "current-year funds, may cross FYs, ≤12 months" → funds of the year services are rendered; cross
  FYs only under statutory (12-month) authority (DoW 7000.14-R Vol 3 §8.5.2).
- Limitation of Cost/Funds: added the 60-day/75% default and its 30–90 day / 75–85% range (RFO 32.706-2).

### Simplified acquisition / commercial / small business
- SAP dek and steps: under the RFO, commercial buys use Part 12 (12.201-1 RFQ→PO to $9M; micro-purchases at 12.4) and
  Part 13 is only the noncommercial MPT-to-SAT lane (13.001(a)). "Around three quotes" → at least three when soliciting
  directly at/under the SAT (12.201-1(c)(2)). Under-SAT sole source: commercial — documented basis (12.102(a));
  noncommercial — **D&F** (13.101(b)) (was "a paragraph of reasoning").
- CID: approval one level above the CO only when relying on the "of a type"/modification/services-(2) prongs
  (R-DFARS 212.001-70(c)) — was "approved a level above me" for every CID; prior DoD determinations presumptively carry
  over, HCA review to depart (212.001-70(b)) — was "address whether the market moved since".
- Rule of Two: mandatory set-aside for **every contract above the MPT** (RFO 19.104-1(a)) — was "default MPT-to-SAT;
  above SAT when research supports it"; added responsible / quality / delivery elements.

### UCAs
- Approval: "HCA-level, delegable — and further for smaller actions" → HCA (R-DFARS 217.7404-1), incl. adding non-urgent
  spares and scope changes after performance starts; DAF delegations per the DAF approval matrix.
- Definitization: "180 days … also when obligations reach the caps" → earlier of 180 days after the qualifying proposal
  (max +90 days by written HCA-without-redelegation / CCDR / USD(A&S) determination) or obligations **exceeding 50% of
  NTE** (217.7404-3). Added $5M / 15-day reporting (217.7405). Obligation cap wording per 217.7404-4.
- Messy-scenario fee debrief and board answer rewritten: past 180 days, profit reflects the cost risk **as of the
  qualifying proposal** (217.7404-6(b)) — v3 said the delay argued fee *down*.

### Other corrections
- Ratification: HCA ratifies, delegable no lower than COCO (RFO 1.405(b)(2)); the over/under-SAT split is labelled a
  common delegation pattern to confirm locally (was "the standard delegation").
- Data rights: noncommercial TD and software now share one clause (252.227-7989) and validation clause (252.227-7997)
  under Class Deviation 2026-O0036 (was "parallel but distinct tracks"); unmarked-data follow-up adds the contractor's
  6-month window to request omitted markings.
- REA certification over SAT now cites R-DFARS 243.371 (renumbered).
- Construction: "sealed bidding is the default" → only where Part 6's sealed-bid conditions hold, not overseas
  (RFO 36.101-1(a)); added FFP/lump-sum preference and IGE over SAT (36.101-6); "magnitude range" disclosure is now
  FAR Companion guidance (target price range, never the IGE), not RFO text. PBA order of precedence cites 37.101-1(b).
- Appendix B: added a Jul–Oct 2026 R-DFARS box (tiers, stays, TINA Lite, renumbering incl. 201.403-1→201.403-70,
  215.103-170→215.103-71, 216.402-4→216.402-470, data rights, FMR → DoW 7000.14-R). Replaced the §1822
  "commercial-first determination" bullet with the verifiable RFO 10.001(f) / E.O. 14271 / 13.001(a) rule.
  **Removed** the E.O. 14415 supply-chain bullet — not found anywhere in the corpus.
- Front matter: new "Regulatory currency — as of October 2026" box; cover/version → v4 (October 2026); currency line
  "Thresholds current as of July 2026" removed; threshold-card dek → October 2026. Appendix C restored as numbered steps.

### Not verifiable in the corpus (left as-is, flagged)
- FY26 NDAA section numbers §1804 (confirmed via COMPASS) and §1806/§1826 (confirmed in R-DFARS) — OK.
- GAO 100-day decision clock and 60-day corrective-action expectation (GAO rules, not in corpus).
- DAF Part 6 Table 1 comes from COMPASS dated 14 Jun 2026; it (and R-DFARS 216.507-6(e)) still cross-reference
  "206.104-72", while Rev 2 prints Table 206-1 at 206.104-71.
