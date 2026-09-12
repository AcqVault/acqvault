// The states both specs drive. One list so visual and a11y can never drift apart.
// Every setup() starts from a cleared localStorage (see prep()) and clicks its way in,
// so nothing here depends on run order.

export const STORAGE_KEYS = ['acq-study-v1', 'acqvault_ssim'];

// Seeded PRNG + frozen clock + no animation. The Board Sim picks its scenario with
// Math.random(), so without the seed every run screenshots a different scenario.
export const DETERMINISM = `
  (function () {
    var s = 42;
    Math.random = function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  })();
  document.addEventListener('DOMContentLoaded', function () {
    var st = document.createElement('style');
    st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;' +
      'caret-color:transparent!important;scroll-behavior:auto!important}';
    document.head.appendChild(st);
  });
`;

export async function prep(page) {
  await page.addInitScript(DETERMINISM);
  await page.addInitScript(function () {
    try { ['acq-study-v1', 'acqvault_ssim'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
  });
}

const go = (page, url) => page.goto(url, { waitUntil: 'load' });

export const STATES = [
  {
    name: 'study-cover',
    async setup(page) {
      await go(page, '/study');
      await page.locator('#t-basic').click();
      await page.locator('.rz-cover-h').waitFor();
    },
  },
  {
    name: 'study-board-scenario',
    async setup(page) {
      await go(page, '/study');
      await page.locator('#g-board').click();
      await page.locator('.st-scenario').waitFor();
    },
  },
  {
    name: 'study-board-debrief',
    async setup(page) {
      await go(page, '/study');
      await page.locator('#g-board').click();
      await page.locator('#next').click();          // Reveal the debrief
      await page.locator('.st-walk, .st-script, .st-fact').first().waitFor();
    },
  },
  {
    name: '48cons-cover',
    async setup(page) {
      await go(page, '/48cons');
      await page.locator('.rz-cover-h').waitFor();
    },
  },
  {
    name: '48cons-ladder',
    async setup(page) {
      await go(page, '/48cons');
      await page.locator('.rz-lesson').first().click();
      await page.locator('#lad-board').waitFor();
    },
  },
  {
    name: '48cons-board',
    async setup(page) {
      await go(page, '/48cons');
      await page.locator('.rz-lesson').first().click();
      await page.locator('#lad-board').click();
      await page.locator('.rz-sim').waitFor();
    },
  },
  {
    name: 'source-selection-intro',
    async setup(page) {
      await go(page, '/source-selection');
      await page.locator('#ss-begin').waitFor();
    },
  },
  {
    name: 'source-selection-phase',
    async setup(page) {
      await go(page, '/source-selection');
      await page.locator('#ss-begin').click();
      await page.locator('#ss-ptitle').waitFor();
    },
  },
];
