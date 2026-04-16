/**
 * Extr - Markdown Extractor (Expanded + Config Modal + QoL)
 */

const log = (act, data) => console.log(`[Extr:${act}]`, data);
log('active')

// --- Configuration Management ---
const DEFAULT_CONFIG = {
  junk: ['.mw-editsection', '.edit-button', '.ad-container', '.nav', '.sidebar', 'header', 'footer', 'script', 'style', 'noscript', 'svg', 'mjx-assistive-mml'].join(', '),
  router: {
    'en.wikipedia.org': '#mw-content-text',
    'github.com': 'article.markdown-body',
    'medium.com': 'article',
    'stackoverflow.com': '#mainbar'
  }
};

window.ExtrConfig = { ...DEFAULT_CONFIG };

// Load persisted config
try {
  chrome.storage.local.get(['extrConfig'], (res) => {
    if (res.extrConfig) window.ExtrConfig = { ...DEFAULT_CONFIG, ...res.extrConfig };
    updateRoute();
  });
} catch (e) { log('warn', 'chrome.storage.local unavailable, using defaults.'); updateRoute(); }

const saveConfig = (newConfig) => {
  window.ExtrConfig = newConfig;
  try { chrome.storage.local.set({ extrConfig: newConfig }); } catch (e) {}
  updateRoute();
  Util.toast('Extr settings saved');
};

// --- Utilities ---
const cleanUrl = (url) => {
  if (!url) return '';
  try {
    const u = new URL(url, window.location.href); 
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(p => u.searchParams.delete(p));
    return u.href;
  } catch { return url; }
};

const getMathContent = (node) => 
  node.getAttribute('data-math') || node.getAttribute('data-tex') || node.getAttribute('alttext') ||
  node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ||
  (node.tagName === 'MJX-CONTAINER' && node.previousElementSibling?.type?.includes('math/tex') ? node.previousElementSibling.textContent : null) ||
  node.querySelector('mjx-assistive-mml')?.textContent || node.textContent?.trim() || '';

const parseNode = (node, depth = 0) => {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';

  if (node.matches && window.ExtrConfig.junk && node.matches(window.ExtrConfig.junk)) return '';

  const tag = node.tagName.toLowerCase();

  if (node.hasAttribute('data-math') || ['mjx-container', 'math'].includes(tag) || node.classList.contains('math-display')) {
    const tex = getMathContent(node);
    const isBlock = ['block', 'true'].includes(node.getAttribute('display')) || node.classList.contains('math-block') || tag === 'mjx-container';
    return isBlock ? `\n$$\n${tex}\n$$\n` : `$${tex}$`;
  }

  if (tag === 'pre') {
    const code = node.querySelector('code') || node;
    const lang = code.className.match(/language-(\w+)/)?.[1] || '';
    return `\n\`\`\`${lang}\n${code.textContent.replace(/\n\s*\n/g, '\n').trim()}\n\`\`\`\n`;
  }

  const parseChildren = (d = depth) => Array.from(node.childNodes).map(c => parseNode(c, d)).join('');

  if (tag === 'a') return `[${parseChildren(depth)}](${cleanUrl(node.href)})`;
  if (tag === 'img') return `![${node.getAttribute('alt') || ''}](${cleanUrl(node.src)})`;
  if (tag === 'hr') return `\n---\n`;
  if (tag === 'blockquote') return `\n> ${parseChildren(depth).trim().replace(/\n/g, '\n> ')}\n`;
  if (['ul', 'ol'].includes(tag)) return `\n${parseChildren(depth + 1)}\n`;
  if (tag === 'li') return `\n${'  '.repeat(Math.max(0, depth - 1))}- ${parseChildren(depth).trim()}`;
  if (tag === 'table') return `\n${parseChildren()}\n`;
  if (tag === 'tr') {
    const cells = Array.from(node.children).map(c => parseNode(c).trim());
    return node.querySelector('th') ? `\n| ${cells.join(' | ')} |\n| ${cells.map(() => '---').join(' | ')} |` : `\n| ${cells.join(' | ')} |`;
  }
  if (['td', 'th'].includes(tag)) return parseChildren();

  const content = parseChildren();
  return {
    p: `\n\n${content}\n\n`, br: '\n',
    b: `**${content.trim()}**`, strong: `**${content.trim()}**`,
    i: `*${content.trim()}*`, em: `*${content.trim()}*`,
    code: `\`${content.trim()}\``,
    h1: `\n# ${content}\n`, h2: `\n## ${content}\n`, h3: `\n### ${content}\n`, h4: `\n#### ${content}\n`
  }[tag] ?? content;
};

const cleanMkd = (node) => {
  let text = parseNode(node).replace(/\n{3,}/g, '\n\n').trim();
  [/T\s*Terse Custom GemShow thinking/gi, /##\s*.*?said/gi, /(?:^|\s)You said(?:\s|$)/gi].forEach(re => text = text.replace(re, ''));
  return text.trim();
};

const inspectAndSelect = () => new Promise(resolve => {
  Util.toast('Hover & Click. Shift+Click multi. ENTER to capture, ESC cancel.');
  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', background: 'rgba(0,153,255,0.1)', border: '2px solid #0099ff', zIndex: 999998, transition: 'all 0.1s ease' });
  document.body.appendChild(overlay);

  // Highlight junk elements faintly to show they will be ignored
  const style = document.createElement('style');
  style.id = 'extr-junk-highlight';
  style.textContent = `${window.ExtrConfig.junk} { outline: 1px dashed rgba(255,0,0,0.3) !important; opacity: 0.8; }`;
  document.head.appendChild(style);

  const selected = new Set();
  const onMove = e => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || selected.has(el)) return;
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, display: 'block' });
  };

  const onClick = e => {
    e.preventDefault(); e.stopPropagation();
    const t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t) return;
    if (selected.has(t)) { selected.delete(t); t.style.outline = ''; t.style.boxShadow = ''; } 
    else { selected.add(t); t.style.outline = '2px solid #00d8ff'; t.style.boxShadow = 'inset 0 0 10px rgba(0,216,255,0.2)'; }
    if (!e.shiftKey && selected.size === 1) finish();
  };

  const cleanup = () => {
    ['mousemove', 'click', 'keydown'].forEach(ev => document.removeEventListener(ev, ev === 'mousemove' ? onMove : ev === 'click' ? onClick : onKey, true));
    overlay.remove(); style.remove();
    selected.forEach(n => { n.style.outline = ''; n.style.boxShadow = ''; });
  };

  const finish = () => { cleanup(); resolve(Array.from(selected).map((n, i) => ({ role: `section-${i}`, content: cleanMkd(n) }))); };
  const onKey = e => { if (e.key === 'Enter') finish(); if (e.key === 'Escape') { cleanup(); resolve([]); } };

  document.addEventListener('mousemove', onMove); 
  document.addEventListener('click', onClick, true); 
  document.addEventListener('keydown', onKey);
});

// --- Settings Modal UI ---
const showSettings = () => {
  if (document.getElementById('extr-settings')) return;

  const modal = document.createElement('div');
  modal.id = 'extr-settings';
  Object.assign(modal.style, {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    background: '#1e1e1e', color: '#e0e0e0', padding: '20px', borderRadius: '8px',
    zIndex: 999999, border: '1px solid #333', width: '500px', fontFamily: 'monospace',
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
  });

  const bml = `javascript:void(location.href='https://defuddle.md/'+location.href.replace(/%5Ehttps?:%5C/%5C//,%27%27))`;

  modal.innerHTML = `
    <h2 style="margin:0 0 15px;color:#00d8ff;font-size:16px;">Extr Settings</h2>
    
    <label style="display:block;margin-bottom:5px;font-size:12px;">Junk Selectors (Comma separated):</label>
    <textarea id="extr-cfg-junk" style="width:100%;height:60px;background:#111;color:#fff;border:1px solid #444;margin-bottom:15px;padding:5px;font-family:inherit;">${window.ExtrConfig.junk}</textarea>
    
    <label style="display:block;margin-bottom:5px;font-size:12px;">Router Configuration (JSON):</label>
    <textarea id="extr-cfg-router" style="width:100%;height:100px;background:#111;color:#fff;border:1px solid #444;margin-bottom:15px;padding:5px;font-family:inherit;">${JSON.stringify(window.ExtrConfig.router, null, 2)}</textarea>
    
    <div style="background:#2a2a2a;padding:10px;border-radius:4px;margin-bottom:15px;">
      <span style="font-size:11px;color:#aaa;">Fallback Bookmarklet (Drag to Bookmarks bar):</span><br/>
      <a href="${bml}" style="color:#00d8ff;text-decoration:none;font-size:13px;font-weight:bold;">Defuddle.md</a>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:10px;">
      <button id="extr-cfg-cancel" style="background:#333;color:#fff;border:none;padding:6px 12px;cursor:pointer;border-radius:4px;">Cancel</button>
      <button id="extr-cfg-save" style="background:#00d8ff;color:#000;border:none;padding:6px 12px;cursor:pointer;border-radius:4px;font-weight:bold;">Save</button>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => { modal.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  
  document.getElementById('extr-cfg-cancel').onclick = close;
  document.getElementById('extr-cfg-save').onclick = () => {
    try {
      const parsedRouter = JSON.parse(document.getElementById('extr-cfg-router').value);
      saveConfig({
        junk: document.getElementById('extr-cfg-junk').value.trim(),
        router: parsedRouter
      });
      close();
    } catch (e) {
      Util.toast('Invalid JSON in Router config!');
    }
  };
  
  document.addEventListener('keydown', onEsc);
};

// --- SPA Routing ---
let currentRouteSel = null;
const updateRoute = () => {
  currentRouteSel = window.ExtrConfig.router[window.location.hostname] || (document.querySelector('article') ? 'article' : null);
};

['pushState', 'replaceState'].forEach(method => {
  const original = history[method];
  history[method] = function(...args) { original.apply(this, args); updateRoute(); };
});
window.addEventListener('popstate', updateRoute);

// --- Core API ---
window.Extr = {
  extract: async (sel = currentRouteSel) => {
    if (sel) {
      const nodes = Array.from(document.querySelectorAll(sel));
      if (nodes.length) return nodes.map((n, i) => ({ role: `section-${i}`, content: cleanMkd(n) }));
    }
    return inspectAndSelect();
  },
  format: msgs => msgs.map(m => m.content).join('\n\n---\n\n'),
  copy: async (text) => { 
    if (!text) return Util.toast('Nothing extracted');
    await navigator.clipboard.writeText(text); 
    Util.toast(`Copied ${text.length} chars. Ready to paste.`); 
  }
};

const runExtr = async () => {
  const msgs = await window.Extr.extract();
  await window.Extr.copy(window.Extr.format(msgs));
};

// --- Shortcut Registration ---
const prevKeydown = window.onkeydown || document.onkeydown;
const prevKeyup = window.onkeyup || document.onkeyup;

// Hook Alt+E (Extraction) via tkchrome
const extrShortcutHandler = Shortcut.init({ a: [Shortcut.fun('e', runExtr)] });

window.onkeyup = document.onkeyup = (e) => {
  if (prevKeyup && prevKeyup !== extrShortcutHandler) { try { prevKeyup(e); } catch(err){} }
  extrShortcutHandler(e);
};

// Hook Ctrl+E (Settings Modal) directly to avoid tkchrome conflict
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    showSettings();
  }
}, true);
