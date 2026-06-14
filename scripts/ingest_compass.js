const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DEFAULT_INPUT = '/Users/iz/Downloads/daf-compass-all-pages.json';
const INPUT = process.argv[2] || DEFAULT_INPUT;
const OUTPUT = path.join(REPO, 'output', 'documents.json');
const ORIGIN = 'https://usaf.dps.mil';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#58;/g, ':')
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&#44;/g, ',')
    .replace(/&#40;/g, '(')
    .replace(/&#41;/g, ')')
    .replace(/&#160;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function normalizeHeading(value) {
  return stripTags(value)
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escMd(text) {
  return String(text || '').replace(/\]/g, '\\]').replace(/\[/g, '\\[');
}

function absUrl(url, baseUrl) {
  const raw = decodeHtml(url || '').trim();
  if (!raw) return '';
  if (/^(https?:|mailto:)/i.test(raw)) return raw;
  if (raw.startsWith('/:')) return ORIGIN + raw;
  if (raw.startsWith('/')) return ORIGIN + raw;
  if (baseUrl) {
    if (/^https?:/i.test(baseUrl)) return new URL(raw, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').toString();
    return new URL(raw, ORIGIN + (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/')).toString();
  }
  return ORIGIN + '/' + raw.replace(/^\/+/, '');
}

function makeId(...parts) {
  return parts.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parsePart(title, fileRef) {
  const text = `${title || ''} ${fileRef || ''}`;
  const m = text.match(/Part[-\s]*(\d{1,3})/i);
  return m ? m[1] : '';
}

function parseWebparts(canvas) {
  return [...String(canvas || '').matchAll(/data-sp-webpartdata="([\s\S]*?)"/g)]
    .map(match => {
      try { return JSON.parse(decodeHtml(match[1])); }
      catch { return null; }
    })
    .filter(Boolean);
}

function extractTextControls(canvas) {
  const decoded = decodeHtml(canvas || '');
  return [...decoded.matchAll(/<div data-sp-canvascontrol=""[\s\S]*?controlType":4[\s\S]*?contentVersion":5}">([\s\S]*?)(?=<div data-sp-canvascontrol=""|$)/g)]
    .map(match => stripTags(match[1]))
    .map(text => text
      .replace(/&#160;/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim())
    .filter(Boolean)
    .filter(text => text.length > 28)
    .filter(text => !/^DATE\s+SECTION\s+FROM\s+TO\s+LINK/i.test(text))
    .filter(text => !/^See all process changes/i.test(text))
    .filter(text => !/^Click on the tabs below/i.test(text));
}

function itemIndexes(plain) {
  return [...new Set(Object.keys(plain || {})
    .map(key => (key.match(/^items\[(\d+)\]\./) || [])[1])
    .filter(v => v != null)
    .map(Number))]
    .sort((a, b) => a - b);
}

function groupTitle(plain, props, fallback) {
  return stripTags(plain.title || plain.listTitle || props.title || props.Title || props.Description || fallback || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function addUnique(arr, seen, value) {
  const clean = String(value || '').trim();
  if (!clean || seen.has(clean)) return;
  seen.add(clean);
  arr.push(clean);
}

function guidanceLinesFromText(text) {
  const normalized = String(text || '')
    .replace(/&#160;/g, ' ')
    .replace(/\s+-\s*/g, '\n- ')
    .replace(/\s+•\s*/g, '\n• ')
    .replace(/\s{2,}/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  return normalized;
}

function guidanceTitleFromText(text, fallback) {
  const first = guidanceLinesFromText(text)[0] || fallback || 'Compass guidance';
  if (first.length <= 86 && (/^[A-Z0-9\s,;:()'"/&.-]+$/.test(first) || first.endsWith('?'))) {
    return first.replace(/\s+/g, ' ');
  }
  return fallback || 'Compass guidance';
}

function isSubstantiveImage(label, url) {
  const text = `${label || ''} ${url || ''}`.toLowerCase();
  if (/contracting-compass-long|abstract|background|seal|shield|logo|war-u|image\.url/.test(text)) return false;
  return /table|matrix|chart|process|flow|checklist|template|form|timeline|guide|map|search|tool|market|pricing|source|selection|decision|comparison|faq|training|documentation|results|reporting/.test(text);
}

function mdLink(label, url, note = '') {
  const cleanLabel = stripTags(label).replace(/\s+/g, ' ').trim();
  if (!cleanLabel) return '';
  const shortLabelRaw = cleanLabel.length > 96
    ? cleanLabel.replace(/\s*(?:While the contents|DO NOT CHECK OUT|Please check).*$/i, '').trim() || cleanLabel.slice(0, 96).trim()
    : cleanLabel;
  const shortLabel = shortLabelRaw.replace(/\s+/g, ' ').trim();
  const cleanNote = note || (shortLabel !== cleanLabel ? cleanLabel.slice(shortLabel.length).replace(/^[-–—:\s]+/, '').trim() : '');
  return url
    ? `- [${escMd(shortLabel)}](${url})${cleanNote ? ` — ${cleanNote}` : ''}`
    : `- ${shortLabel}${cleanNote ? ` — ${cleanNote}` : ''}`;
}

function extractPage(page) {
  const title = page.Title || 'DAF Contracting Compass';
  const part = parsePart(title, page.FileRef);
  const sourceUrl = absUrl(page.FileRef);
  const webparts = parseWebparts(page.CanvasContent1);
  const textControls = extractTextControls(page.CanvasContent1);

  const sections = [];
  const intro = [];
  const quickActions = [];
  const guidanceGroups = [];
  const resourceGroups = [];
  const lists = [];
  const pocs = [];
  const visuals = [];
  const seenLine = new Set();

  addUnique(intro, seenLine, `[Open original DAF Contracting Compass page](${sourceUrl})`);

  for (const wp of webparts) {
    const spc = wp.serverProcessedContent || {};
    const plain = spc.searchablePlainTexts || {};
    const links = spc.links || {};
    const htmlStrings = spc.htmlStrings || {};
    const imageSources = spc.imageSources || {};
    const props = wp.properties || {};
    const baseUrl = links.baseUrl || props.baseUrl || '';

    const htmlText = [htmlStrings.headline, htmlStrings.titleHTML, htmlStrings.description]
      .map(stripTags)
      .filter(Boolean);
    if (htmlText.length) {
      const heading = normalizeHeading(htmlText[0]);
      const body = htmlText.slice(1).join('\n').split('\n').map(normalizeHeading).filter(Boolean);
      if (heading && body.some(line => line.toLowerCase() !== heading.toLowerCase())) {
        const lines = body.map(line => line.startsWith('•') ? line : line);
        guidanceGroups.push({ title: heading, lines });
      } else if (heading && !/^(saf\/aqc poc|poc)$/i.test(heading)) {
        guidanceGroups.push({ title: heading, lines: [] });
      }
      continue;
    }

    if (plain['button.label']) {
      const label = stripTags(plain['button.label']);
      const url = absUrl(links['button.linkUrl'] || links.linkUrl, baseUrl);
      if (label && url && !/back to the top/i.test(label)) {
        quickActions.push(mdLink(label, url).replace(/^- /, '- '));
      }
    }

    if (plain.label && links.linkUrl && !/back to the top/i.test(plain.label)) {
      const label = stripTags(plain.label);
      const url = absUrl(links.linkUrl, baseUrl);
      if (label && url) quickActions.push(mdLink(label, url).replace(/^- /, '- '));
    }

    const idxs = itemIndexes(plain);
    if (idxs.length) {
      const titleText = groupTitle(plain, props, '');
      const lines = [];
      for (const i of idxs) {
        const itemTitle = stripTags(plain[`items[${i}].title`] || '');
        const desc = stripTags(plain[`items[${i}].description`] || '');
        const url = absUrl(links[`items[${i}].sourceItem.url`] || links[`items[${i}].url`], baseUrl);
        if (!itemTitle) continue;
        lines.push(mdLink(itemTitle, url, desc));
      }
      if (lines.length) resourceGroups.push({ title: titleText || 'Resources', lines });
    }

    if (plain.listTitle) {
      const listTitle = stripTags(plain.listTitle);
      const url = absUrl(props.selectedListUrl || props.webRelativeListUrl || links.linkUrl, baseUrl);
      if (listTitle) lists.push(mdLink(listTitle, url));
    }

    const personIndexes = [...new Set(Object.keys(plain)
      .map(key => (key.match(/^persons\[(\d+)\]\./) || [])[1])
      .filter(v => v != null)
      .map(Number))]
      .sort((a, b) => a - b);
    for (const i of personIndexes) {
      const name = stripTags(plain[`persons[${i}].name`] || '');
      const email = stripTags(plain[`persons[${i}].email`] || '');
      if (name || email) {
        pocs.push(email ? `- ${name} — [${email}](mailto:${email})` : `- ${name}`);
      }
    }

    for (const [key, val] of Object.entries(imageSources)) {
      const img = absUrl(val, baseUrl);
      if (!img || !/\.(png|jpe?g|gif|webp)(\?|$)/i.test(img)) continue;
      const label = stripTags(props.fileName || plain.title || props.title || key);
      if (label && !/encodedImage/i.test(label) && isSubstantiveImage(label, img)) visuals.push(`- [${escMd(label)}](${img})`);
    }
  }

  const pushSection = (heading, lines) => {
    const clean = [...new Set(lines.map(line => String(line || '').trim()).filter(Boolean))];
    if (clean.length) sections.push(`## ${heading}\n${clean.join('\n')}`);
  };

  const headingCounts = {};
  for (const text of textControls) {
    const titleText = guidanceTitleFromText(text, 'Compass guidance');
    const lines = guidanceLinesFromText(text);
    if (lines.length > 1 && lines[0] === titleText) lines.shift();
    guidanceGroups.push({ title: titleText, lines });
  }

  for (const group of guidanceGroups) {
    let heading = group.title || 'Guidance';
    const key = heading.toLowerCase();
    headingCounts[key] = (headingCounts[key] || 0) + 1;
    if (/^what is it\??$/i.test(heading)) {
      const body = group.lines.join(' ').toLowerCase();
      if (body.includes('tactical market research')) heading = 'Tactical market research';
      else if (body.includes('continuously throughout')) heading = 'Strategic market research';
      else if (headingCounts[key] > 1) heading = `What it means (${headingCounts[key]})`;
    } else if (headingCounts[key] > 1) {
      heading = `${heading} (${headingCounts[key]})`;
    }
    pushSection(heading, group.lines);
  }
  const supportLines = intro.concat(quickActions);
  for (const group of resourceGroups) {
    supportLines.push(`### ${group.title || 'Resources'}`, ...group.lines);
  }
  if (lists.length) supportLines.push('### Templates and document libraries', ...lists);
  if (pocs.length) supportLines.push('### Points of contact', ...pocs);
  pushSection('Supporting resources', supportLines);
  pushSection('Images and visual references', visuals.slice(0, 12));

  return {
    id: makeId('compass', 'part', part || title),
    source: 'compass',
    source_label: 'DAF Contracting Compass',
    part: part || '',
    title,
    content: `${title}\n${sections.join('\n\n')}`.replace(/\n{3,}/g, '\n\n').trim(),
    filename: 'daf-compass-all-pages.json',
    status: 'Live',
    date: new Date().toISOString().slice(0, 10),
    url: sourceUrl,
    indexed_at: new Date().toISOString()
  };
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`Compass export not found: ${INPUT}`);
    process.exit(1);
  }
  const bundle = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const compassDocs = (bundle.pages || [])
    .filter(page => !page.error && page.CanvasContent1)
    .map(extractPage)
    .filter(doc => doc.part)
    .sort((a, b) => Number(a.part || 9999) - Number(b.part || 9999) || a.title.localeCompare(b.title));

  const docs = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
  const next = docs.filter(doc => doc.source !== 'compass').concat(compassDocs);
  fs.writeFileSync(OUTPUT, JSON.stringify(next, null, 2) + '\n');

  console.log(`Wrote ${compassDocs.length} Compass docs to ${path.relative(REPO, OUTPUT)}`);
  console.log(`Total docs: ${next.length}`);
}

main();
