/* Computed-style fingerprint of every element on the page.

   The point: a token consolidation or a component merge is only safe if the
   RENDERED result is identical. Comparing CSS source tells you nothing — the
   whole change is a rewrite of the source. So walk the real DOM in real Chrome
   at a real viewport and record what the engine actually resolved, then diff
   that before vs after. Any drift is a regression, full stop.

   Records the properties these refactors could plausibly move: colour, border,
   radius, shadow, spacing, type, and transition/transform. */
(async () => {
  const PROPS = [
    'color','background-color','background-image',
    'border-top-color','border-right-color','border-bottom-color','border-left-color',
    'border-top-width','border-right-width','border-bottom-width','border-left-width',
    'border-top-left-radius','border-top-right-radius',
    'border-bottom-left-radius','border-bottom-right-radius',
    'box-shadow','outline-color','outline-width',
    'font-size','font-weight','letter-spacing','line-height','text-transform','font-family',
    'padding-top','padding-right','padding-bottom','padding-left',
    'margin-top','margin-right','margin-bottom','margin-left',
    'width','height','display','opacity','transform',
    'transition-property','transition-duration','transition-timing-function',
    'backdrop-filter','fill','stroke',
  ];

  const all = document.querySelectorAll('*');
  const rows = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const cs = getComputedStyle(el);
    const vals = PROPS.map(p => cs.getPropertyValue(p));
    // path is stable across runs: tag + index chain, not class (classes may change)
    let pathParts = [], n = el;
    while (n && n.nodeType === 1 && pathParts.length < 12) {
      const parent = n.parentNode;
      const idx = parent && parent.children ? [...parent.children].indexOf(n) : 0;
      pathParts.unshift(n.tagName.toLowerCase() + ':' + idx);
      n = parent;
    }
    rows.push(pathParts.join('>') + '|' + vals.join(''));
  }

  // pseudo-elements carry a lot of this design's brass rules and textures
  const pseudo = [];
  for (let i = 0; i < all.length; i++) {
    for (const pe of ['::before','::after']) {
      const cs = getComputedStyle(all[i], pe);
      if (cs.content === 'none' || cs.content === '') continue;
      pseudo.push(i + pe + '|' + PROPS.map(p => cs.getPropertyValue(p)).join(''));
    }
  }

  return { count: all.length, pseudoCount: pseudo.length, rows, pseudo,
           title: document.title, vw: innerWidth, vh: innerHeight };
})()
