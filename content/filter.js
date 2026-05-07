/**
 * Content Filter - Hide elements on any website using CSS selector + regex.
 *
 * USAGE:
 *   Alt+H  - Open filter UI (add/remove rules, pick elements)
 *
 * Rules are stored per-hostname in chrome.storage.local.
 * Each rule: { selector: "CSS selector", regex: "pattern", flags: "gi" }
 *
 * Example: Hide YouTube recommendations on the home page:
 *   selector: ytd-rich-item-renderer
 *   regex:    .* (match all)
 *
 * Example: Hide specific YouTube recommendations by title:
 *   selector: ytd-rich-item-renderer
 *   regex:    shorts|react|minecraft
 */

const FILTER_STORAGE_KEY = 'contentFilterRules';

const ContentFilter = {
  rules: [],   // rules for current hostname
  hidden: [],  // currently hidden elements
  observer: null,

  async loadRules() {
    try {
      const data = await chrome.storage.local.get(FILTER_STORAGE_KEY);
      const allRules = data[FILTER_STORAGE_KEY] || {};
      this.rules = allRules[location.hostname] || [];
    } catch (e) {
      console.warn('[filter] storage unavailable', e);
      this.rules = [];
    }
  },

  async saveRules() {
    try {
      const data = await chrome.storage.local.get(FILTER_STORAGE_KEY);
      const allRules = data[FILTER_STORAGE_KEY] || {};
      allRules[location.hostname] = this.rules;
      await chrome.storage.local.set({ [FILTER_STORAGE_KEY]: allRules });
    } catch (e) {
      console.warn('[filter] failed to save', e);
    }
  },

  apply() {
    // unhide previously hidden
    for (const el of this.hidden) {
      el.style.removeProperty('display');
      el.removeAttribute('data-tk-filtered');
    }
    this.hidden = [];

    for (const rule of this.rules) {
      try {
        const re = new RegExp(rule.regex, rule.flags || 'i');
        const els = document.querySelectorAll(rule.selector);
        for (const el of els) {
          if (el.getAttribute('data-tk-filtered')) continue;
          const text = el.textContent || '';
          if (re.test(text)) {
            el.style.display = 'none';
            el.setAttribute('data-tk-filtered', '1');
            this.hidden.push(el);
          }
        }
      } catch (e) {
        console.warn('[filter] bad rule', rule, e);
      }
    }
  },

  startObserver() {
    if (this.observer) return;
    let timeout = null;
    this.observer = new MutationObserver(() => {
      // debounce
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => this.apply(), 300);
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
  },

  async init() {
    await this.loadRules();
    if (this.rules.length > 0) {
      // apply once DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          this.apply();
          this.startObserver();
        });
      } else {
        this.apply();
        this.startObserver();
      }
    }
  }
};

// --- UI ---

const FilterUI = {
  panel: null,
  picking: false,
  pickHighlight: null,

  create() {
    if (this.panel) {
      this.panel.style.display = this.panel.style.display === 'none' ? 'block' : 'none';
      this.refresh();
      return;
    }

    const panel = document.createElement('div');
    panel.id = '__tk_filter_panel';
    panel.innerHTML = `
      <style>
        #__tk_filter_panel {
          position: fixed; top: 60px; right: 20px; z-index: 999999;
          background: #1a1a2e; color: #eee; border: 1px solid #444;
          border-radius: 8px; padding: 16px; width: 420px;
          font-family: monospace; font-size: 13px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          max-height: 80vh; overflow-y: auto;
        }
        #__tk_filter_panel h3 { margin: 0 0 12px; color: #7ec8e3; font-size: 14px; }
        #__tk_filter_panel .tk-f-row { display: flex; gap: 6px; margin-bottom: 8px; align-items: center; }
        #__tk_filter_panel input[type="text"] {
          flex: 1; background: #0f0f1a; color: #eee; border: 1px solid #555;
          border-radius: 4px; padding: 6px 8px; font-family: monospace; font-size: 12px;
        }
        #__tk_filter_panel button {
          background: #2d2d44; color: #ccc; border: 1px solid #555;
          border-radius: 4px; padding: 6px 10px; cursor: pointer; font-size: 12px;
        }
        #__tk_filter_panel button:hover { background: #3d3d5c; }
        #__tk_filter_panel button.tk-f-danger { color: #ff6b6b; }
        #__tk_filter_panel button.tk-f-primary { color: #7ec8e3; border-color: #7ec8e3; }
        #__tk_filter_panel .tk-f-rules { margin-top: 12px; }
        #__tk_filter_panel .tk-f-rule {
          background: #0f0f1a; border: 1px solid #333; border-radius: 4px;
          padding: 8px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;
        }
        #__tk_filter_panel .tk-f-rule-info { flex: 1; overflow: hidden; }
        #__tk_filter_panel .tk-f-rule-sel { color: #7ec8e3; }
        #__tk_filter_panel .tk-f-rule-re { color: #ffc857; }
        #__tk_filter_panel .tk-f-hint { color: #888; font-size: 11px; margin-bottom: 8px; }
        #__tk_filter_panel .tk-f-count { color: #6f6; font-size: 11px; margin-left: 8px; }
        .__tk_filter_highlight {
          outline: 3px solid #ff6b6b !important;
          outline-offset: 2px !important;
        }
      </style>
      <h3>Content Filter <span style="color:#888">(${location.hostname})</span></h3>
      <div class="tk-f-hint">Pick an element or type a CSS selector + regex to hide matching content.</div>
      <div class="tk-f-row">
        <input type="text" id="__tk_f_sel" placeholder="CSS selector (e.g. ytd-rich-item-renderer)">
        <button id="__tk_f_pick" class="tk-f-primary" title="Click an element on the page">⊹ Pick</button>
      </div>
      <div class="tk-f-row">
        <input type="text" id="__tk_f_re" placeholder="Regex pattern (e.g. shorts|react)">
        <input type="text" id="__tk_f_flags" placeholder="flags" style="width:50px;flex:none" value="i">
      </div>
      <div class="tk-f-row">
        <button id="__tk_f_test" class="tk-f-primary">Test</button>
        <button id="__tk_f_add" class="tk-f-primary">+ Add Rule</button>
        <span id="__tk_f_testcount" class="tk-f-count"></span>
      </div>
      <div class="tk-f-rules" id="__tk_f_rules"></div>
    `;
    document.body.appendChild(panel);
    this.panel = panel;

    // Event listeners
    panel.querySelector('#__tk_f_pick').addEventListener('click', () => this.startPick());
    panel.querySelector('#__tk_f_add').addEventListener('click', () => this.addRule());
    panel.querySelector('#__tk_f_test').addEventListener('click', () => this.testRule());

    // close on Escape
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        panel.style.display = 'none';
        this.stopPick();
      }
    });

    this.refresh();
  },

  refresh() {
    const container = this.panel.querySelector('#__tk_f_rules');
    container.innerHTML = '';
    for (let i = 0; i < ContentFilter.rules.length; i++) {
      const rule = ContentFilter.rules[i];
      const div = document.createElement('div');
      div.className = 'tk-f-rule';
      div.innerHTML = `
        <div class="tk-f-rule-info">
          <div class="tk-f-rule-sel">${this.esc(rule.selector)}</div>
          <div class="tk-f-rule-re">/${this.esc(rule.regex)}/${rule.flags || 'i'}</div>
        </div>
      `;
      const rmBtn = document.createElement('button');
      rmBtn.className = 'tk-f-danger';
      rmBtn.textContent = '✕';
      rmBtn.title = 'Remove rule';
      rmBtn.addEventListener('click', () => this.removeRule(i));
      div.appendChild(rmBtn);
      container.appendChild(div);
    }
  },

  esc(s) {
    const d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  },

  async addRule() {
    const sel = this.panel.querySelector('#__tk_f_sel').value.trim();
    const re = this.panel.querySelector('#__tk_f_re').value.trim();
    const flags = this.panel.querySelector('#__tk_f_flags').value.trim() || 'i';
    if (!sel || !re) {
      Util.toast('Need both selector and regex');
      return;
    }
    // validate
    try { new RegExp(re, flags); } catch (e) {
      Util.toast('Invalid regex: ' + e.message);
      return;
    }
    try { document.querySelectorAll(sel); } catch (e) {
      Util.toast('Invalid selector: ' + e.message);
      return;
    }

    ContentFilter.rules.push({ selector: sel, regex: re, flags });
    await ContentFilter.saveRules();
    ContentFilter.apply();
    ContentFilter.startObserver();
    this.refresh();
    Util.toast(`Rule added — hiding ${ContentFilter.hidden.length} elements`);
  },

  async removeRule(index) {
    ContentFilter.rules.splice(index, 1);
    await ContentFilter.saveRules();
    ContentFilter.apply();
    this.refresh();
    Util.toast('Rule removed');
  },

  testRule() {
    const sel = this.panel.querySelector('#__tk_f_sel').value.trim();
    const re = this.panel.querySelector('#__tk_f_re').value.trim();
    const flags = this.panel.querySelector('#__tk_f_flags').value.trim() || 'i';
    const countEl = this.panel.querySelector('#__tk_f_testcount');

    if (!sel || !re) { countEl.textContent = ''; return; }
    try {
      const regex = new RegExp(re, flags);
      const els = document.querySelectorAll(sel);
      let count = 0;
      for (const el of els) {
        if (regex.test(el.textContent || '')) count++;
      }
      countEl.textContent = `${count}/${els.length} elements match`;
      countEl.style.color = count > 0 ? '#6f6' : '#f66';
    } catch (e) {
      countEl.textContent = 'Error: ' + e.message;
      countEl.style.color = '#f66';
    }
  },

  startPick() {
    this.picking = true;
    this.panel.style.pointerEvents = 'none';
    this.panel.style.opacity = '0.5';
    document.addEventListener('mouseover', this._onHover);
    document.addEventListener('click', this._onClick, true);
    document.addEventListener('keydown', this._onEsc);
    Util.toast('Click an element to select it (Esc to cancel)');
  },

  stopPick() {
    this.picking = false;
    if (this.panel) {
      this.panel.style.pointerEvents = '';
      this.panel.style.opacity = '';
    }
    document.removeEventListener('mouseover', this._onHover);
    document.removeEventListener('click', this._onClick, true);
    document.removeEventListener('keydown', this._onEsc);
    if (this.pickHighlight) {
      this.pickHighlight.classList.remove('__tk_filter_highlight');
      this.pickHighlight = null;
    }
  },

  _onHover: (function(e) {
    if (FilterUI.pickHighlight) {
      FilterUI.pickHighlight.classList.remove('__tk_filter_highlight');
    }
    const el = e.target;
    if (el.closest('#__tk_filter_panel')) return;
    el.classList.add('__tk_filter_highlight');
    FilterUI.pickHighlight = el;
  }),

  _onClick: (function(e) {
    if (!FilterUI.picking) return;
    const el = e.target;
    if (el.closest('#__tk_filter_panel')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const selector = FilterUI.buildSelector(el);
    FilterUI.panel.querySelector('#__tk_f_sel').value = selector;
    FilterUI.stopPick();
  }),

  _onEsc: (function(e) {
    if (e.key === 'Escape') FilterUI.stopPick();
  }),

  /** Build a reasonable CSS selector for an element */
  buildSelector(el) {
    // Prefer: tag + unique class combo, or tag + data attributes
    if (el.id) return `#${CSS.escape(el.id)}`;

    const tag = el.tagName.toLowerCase();

    // For custom elements (contain hyphens), the tag is often unique enough
    if (tag.includes('-')) {
      // Check if parent context helps
      const parent = el.parentElement;
      if (parent && parent.id) {
        return `#${CSS.escape(parent.id)} > ${tag}`;
      }
      return tag;
    }

    // Try tag + classes
    if (el.classList.length > 0) {
      const classes = Array.from(el.classList)
        .filter(c => !c.startsWith('__tk'))
        .map(c => '.' + CSS.escape(c))
        .join('');
      if (classes) {
        const selector = tag + classes;
        // Check uniqueness
        const count = document.querySelectorAll(selector).length;
        if (count <= 20) return selector;
      }
    }

    // Fallback: build path from parent
    const parts = [];
    let current = el;
    for (let i = 0; i < 3 && current && current !== document.body; i++) {
      const ctag = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      const cls = Array.from(current.classList)
        .filter(c => !c.startsWith('__tk'))
        .slice(0, 2)
        .map(c => '.' + CSS.escape(c))
        .join('');
      parts.unshift(ctag + cls);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }
};

// --- Keyboard shortcut: Alt+H ---
document.addEventListener('keydown', e => {
  if (e.altKey && e.code === 'KeyH' && !Util.isInput(e.target)) {
    e.preventDefault();
    FilterUI.create();
  }
});

// --- Auto-apply on load ---
ContentFilter.init();
