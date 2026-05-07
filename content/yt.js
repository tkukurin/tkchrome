/**
 * YT Ad Skip - Analyzes transcripts via Gemini to skip ads/filler.
 *
 * SETUP:
 *   chrome://extensions → TamperScripts → service worker console:
 *   chrome.storage.local.set({GOOGLE_API_KEY: 'your-key'})
 *
 * USAGE:
 *   alt+g  analyze & skip    alt+f  follow-up    alt+p  toggle panel    alt+o  load transcript
 *
 * HOW IT WORKS:
 *   1. Fetches transcript (DOM or YT timedtext API fallback)
 *   2. Sends to Gemini to identify useless sections
 *   3. Caches in localStorage, auto-skips on revisit
 *
 * CONSOLE:
 *   ytAdSkipCache.list()         // all cached videos
 *   ytAdSkipCache.get('ID')      // full data (transcript, useless)
 *   ytAdSkipCache.clear('ID')    // clear specific / all
 *   ytAdSkipCache.reanalyze()    // re-analyze current video
 *   JSON.parse(localStorage.getItem('yt_adskip_history'))  // raw
 */

console.log("YT Ad Skip loaded");

const getVideo = () => document.querySelector('video');

function getVideoId() {
  const match = /[?&]v=([^&]+)/.exec(window.location.search);
  return match ? match[1] : null;
}

function getUrl(timeStr) {
  const id = /\?v\=([^&]+)/g.exec(window.location.search);
  const suffix = (timeStr && `?t=${timeStr}`) || '';
  return (id && `https://youtu.be/${id[1]}${suffix}`) ||
    window.location.href.replace(/&t\=[^&]+/, `&t=${timeStr}`);
}

// --- Ad Skip State Management ---
// Cache stored in localStorage for easy console access
//
// Access from console:
//   JSON.parse(localStorage.getItem('yt_adskip_history'))  // all history
//   ytAdSkipCache.get('VIDEO_ID')                          // specific video
//   ytAdSkipCache.list()                                   // list all video IDs
//   ytAdSkipCache.clear()                                  // clear all
//   ytAdSkipCache.clear('VIDEO_ID')                        // clear specific
//
const CACHE_STORAGE_KEY = 'yt_adskip_history';

const AdSkipManager = {
  currentVideoId: null,
  currentInterval: null,

  getCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  },

  setCache(videoId, data) {
    const cache = this.getCache();
    cache[videoId] = {
      ...data,
      videoId,
      timestamp: new Date().toISOString(),
      url: window.location.href
    };
    // Evict oldest entries if cache is too large (keep last 50)
    const MAX_ENTRIES = 50;
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => (cache[a].timestamp || '').localeCompare(cache[b].timestamp || ''));
      for (let i = 0; i < keys.length - MAX_ENTRIES; i++) delete cache[keys[i]];
    }
    try {
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch (e) {
      // Quota exceeded — aggressively evict half and retry
      const remaining = Object.keys(cache);
      remaining.sort((a, b) => (cache[a].timestamp || '').localeCompare(cache[b].timestamp || ''));
      const half = Math.floor(remaining.length / 2);
      for (let i = 0; i < half; i++) delete cache[remaining[i]];
      try {
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
      } catch (e2) {
        console.warn('[YT-AdSkip] localStorage quota exceeded, clearing cache', e2);
        localStorage.removeItem(CACHE_STORAGE_KEY);
      }
    }
    console.log('[YT-AdSkip] Cached data for', videoId);
  },

  getCached(videoId) {
    const cache = this.getCache();
    return cache[videoId] || null;
  },

  clearCache(videoId) {
    if (videoId) {
      const cache = this.getCache();
      delete cache[videoId];
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
      console.log('[YT-AdSkip] Cleared cache for', videoId);
    } else {
      localStorage.removeItem(CACHE_STORAGE_KEY);
      console.log('[YT-AdSkip] Cleared all cache');
    }
  },

  listCached() {
    const cache = this.getCache();
    return Object.keys(cache).map(id => ({
      videoId: id,
      title: cache[id].title,
      sections: cache[id].useless?.length || 0,
      timestamp: cache[id].timestamp
    }));
  },

  cleanup() {
    if (this.currentInterval) {
      clearInterval(this.currentInterval);
      console.log('[YT-AdSkip] Cleared interval for video:', this.currentVideoId);
      this.currentInterval = null;
    }
    this.currentVideoId = null;
  },

  start(videoId, intervalId) {
    this.cleanup();
    this.currentVideoId = videoId;
    this.currentInterval = intervalId;
  }
};

// Expose cache helpers to window for console access
window.ytAdSkipCache = {
  get: (videoId) => AdSkipManager.getCached(videoId),
  list: () => { console.table(AdSkipManager.listCached()); return AdSkipManager.listCached(); },
  clear: (videoId) => AdSkipManager.clearCache(videoId),
  getAll: () => AdSkipManager.getCache(),
  // Re-analyze (keeps transcript, just re-runs Gemini)
  reanalyze: async () => {
    const videoId = getVideoId();
    if (!videoId) { console.log('[YT-AdSkip] Not on a video page'); return; }
    AdSkipManager.cleanup();
    await window.analyzeAndSkip(true); // force flag
  }
};

// --- Draggable Panel UI ---
const SkipPanel = {
  panel: null,

  create() {
    if (this.panel) return this.panel;
    if (!document.body) return null; // Not ready yet

    const body = Util.panel('yt-adskip-panel', '⏭️ Ad Skip');
    const panel = body.closest('.__util_panel');
    this.panel = panel;

    // Reposition to bottom-right
    Object.assign(panel.style, { top: 'auto', bottom: '20px', maxHeight: '300px', width: '400px' });

    // Replace close button behavior and add minimize/add controls to header
    const header = panel.querySelector('.__util_panel_hd');
    header.style.cursor = 'move';
    header.innerHTML = `
      <span class="adskip-title">⏭️ Ad Skip</span>
      <div style="display:flex;gap:4px">
        <button class="adskip-add" title="Add skip">+</button>
        <button class="adskip-minimize">_</button>
        <button class="adskip-reanalyze" title="Re-analyze">🔄</button>
        <button class="adskip-clear" title="Clear">🗑️</button>
        <button class="adskip-close">✕</button>
      </div>
    `;

    body.innerHTML = `
      <table class="adskip-table">
        <thead><tr><th>Start</th><th>End</th><th>Reason</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    `;

    // SkipPanel-specific styles (table, minimize)
    const style = document.createElement('style');
    style.textContent = `
      #yt-adskip-panel.minimized .__util_panel_body { display: none; }
      .adskip-table { width: 100%; border-collapse: collapse; }
      .adskip-table th, .adskip-table td {
        padding: 6px 8px; text-align: left; border-bottom: 1px solid #333;
      }
      .adskip-table th { background: #252525; font-weight: 600; position: sticky; top: 0; }
      .adskip-table tr:hover { background: #252525; }
      .adskip-table .skip-btn { background: #3a6a9a; }
      .adskip-table .skip-btn:hover { background: #4a7aaa; }
      .adskip-table .rm-btn { background: #8a3a3a; }
      .adskip-table .rm-btn:hover { background: #a54545; }
      .adskip-empty { text-align: center; padding: 20px; color: #888; }
    `;
    document.head.appendChild(style);

    // Event listeners
    header.querySelector('.adskip-close').onclick = () => this.hide();
    header.querySelector('.adskip-minimize').onclick = () => panel.classList.toggle('minimized');
    header.querySelector('.adskip-reanalyze').onclick = () => ytAdSkipCache.reanalyze();
    header.querySelector('.adskip-add').onclick = () => this.promptAdd();
    header.querySelector('.adskip-clear').onclick = () => {
      const videoId = getVideoId();
      if (videoId) {
        ytAdSkipCache.clear(videoId);
        AdSkipManager.cleanup();
        this.update([]);
        Util.toast('Cache cleared');
      }
    };

    // Dragging
    this.makeDraggable(panel);

    return panel;
  },
  makeDraggable(panel) {
    const header = panel.querySelector('.__util_panel_hd');
    let isDragging = false, offsetX, offsetY;

    header.onmousedown = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      offsetX = e.clientX - panel.offsetLeft;
      offsetY = e.clientY - panel.offsetTop;
      panel.style.transition = 'none';
    };

    document.onmousemove = (e) => {
      if (!isDragging) return;
      panel.style.left = (e.clientX - offsetX) + 'px';
      panel.style.top = (e.clientY - offsetY) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    document.onmouseup = () => { isDragging = false; };
  },

  update(useless, title) {
    const panel = this.create();
    if (!panel) return;
    const tbody = panel.querySelector('tbody');

    if (title) {
      panel.querySelector('.adskip-title').textContent = `⏭️ ${title.slice(0, 30)}${title.length > 30 ? '...' : ''}`;
    }

    if (!useless || useless.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="adskip-empty">No skip sections</td></tr>';
      return;
    }

    tbody.innerHTML = useless.map((s, i) => `
      <tr>
        <td>${s.start}</td>
        <td>${s.end}</td>
        <td title="${s.why}">${s.why.slice(0, 20)}${s.why.length > 20 ? '…' : ''}</td>
        <td>
          <button class="adskip-btn skip-btn" data-idx="${i}">→</button>
          <button class="adskip-btn rm-btn" data-idx="${i}">−</button>
        </td>
      </tr>
    `).join('');

    // Skip to section
    tbody.querySelectorAll('.skip-btn').forEach(btn => {
      btn.onclick = () => {
        const section = useless[parseInt(btn.dataset.idx)];
        const video = document.querySelector('video');
        if (video && section) {
          video.currentTime = section.end.split(':').reduce((a, c) => a * 60 + parseInt(c), 0);
        }
      };
    });

    // Remove section
    tbody.querySelectorAll('.rm-btn').forEach(btn => {
      btn.onclick = () => this.removeSection(parseInt(btn.dataset.idx));
    });
  },

  promptAdd() {
    const video = document.querySelector('video');
    const currentTime = video ? this.formatTime(video.currentTime) : '0:00';
    const start = prompt('Start time:', currentTime);
    if (!start) return;
    const end = prompt('End time:', currentTime);
    if (!end) return;
    const why = prompt('Reason:', 'Manual skip') || 'Manual skip';
    this.addSection({ start, end, why });
  },

  addSection(section) {
    const videoId = getVideoId();
    const cached = AdSkipManager.getCached(videoId) || { useless: [], title: '' };
    cached.useless.push(section);
    cached.useless.sort((a, b) => this.timeToSecs(a.start) - this.timeToSecs(b.start));
    AdSkipManager.setCache(videoId, cached);
    this.update(cached.useless, cached.title);
    // Restart skipper
    AdSkipManager.cleanup();
    AdSkipManager.start(videoId, ytAdSkip(cached.useless));
  },

  removeSection(idx) {
    const videoId = getVideoId();
    const cached = AdSkipManager.getCached(videoId);
    if (!cached?.useless) return;
    cached.useless.splice(idx, 1);
    AdSkipManager.setCache(videoId, cached);
    this.update(cached.useless, cached.title);
    // Restart skipper
    AdSkipManager.cleanup();
    if (cached.useless.length) AdSkipManager.start(videoId, ytAdSkip(cached.useless));
  },

  formatTime(secs) {
    const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  },

  timeToSecs(t) {
    return t.split(':').reduce((a, c) => a * 60 + parseInt(c), 0);
  },

  show(useless, title, minimized = false) {
    if (!this.create()) return; // DOM not ready
    this.update(useless, title);
    this.panel.style.display = 'block';
    this.panel.classList.toggle('minimized', minimized);
  },

  hide() {
    if (this.panel) this.panel.style.display = 'none';
  },

  toggle() {
    if (!document.body) return;
    if (!this.panel || this.panel.style.display === 'none') {
      const videoId = getVideoId();
      const cached = AdSkipManager.getCached(videoId);
      this.show(cached?.useless || [], cached?.title);
    } else {
      this.hide();
    }
  }
};

// Expose panel to window
window.ytSkipPanel = SkipPanel;

// Watch for navigation changes (robust: History API + popstate)
let lastVideoId = null;
function checkNavigation() {
  const newVideoId = getVideoId();
  if (newVideoId !== lastVideoId) {
    AdSkipManager.cleanup();
    lastVideoId = newVideoId;
    if (newVideoId) {
      initAdSkipForVideo(newVideoId);
    }
  }
}

// Wrap history methods to detect SPA navigation
const originalPushState = history.pushState.bind(history);
const originalReplaceState = history.replaceState.bind(history);
history.pushState = (...args) => { originalPushState(...args); checkNavigation(); };
history.replaceState = (...args) => { originalReplaceState(...args); checkNavigation(); };
window.addEventListener('popstate', checkNavigation);
window.addEventListener('beforeunload', () => AdSkipManager.cleanup());

// Initialize when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkNavigation);
} else {
  checkNavigation();
}

// --- Gemini API Integration ---
// API key stored in chrome.storage.local (secure, only this extension can access)
// Set via service worker console: chrome.storage.local.set({GOOGLE_API_KEY: 'your-key'})
async function getGeminiApiKey() {
  const data = await chrome.storage.local.get('GOOGLE_API_KEY');
  return data.GOOGLE_API_KEY || null;
}

// Store last raw response for debugging
window.lastGeminiResponse = null;

// Conversation history for follow-up questions
const GeminiConversation = {
  history: [], // Array of {role: 'user'|'model', parts: [{text}]}

  reset() { this.history = []; },

  addUser(text) { this.history.push({ role: 'user', parts: [{ text }] }); },
  addModel(text) { this.history.push({ role: 'model', parts: [{ text }] }); },

  async send(text) {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) { Util.toast('No Gemini API key'); return null; }

    this.addUser(text);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: this.history,
            generationConfig: { temperature: 0.1 }
          })
        }
      );
      if (!response.ok) {
        const err = await response.text();
        console.error('[YT-AdSkip] Gemini API error:', response.status, err);
        Util.toast(`Gemini API error: ${response.status}`);
        return null;
      }
      const data = await response.json();
      window.lastGeminiResponse = data;
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (responseText) this.addModel(responseText);
      return responseText;
    } catch (e) {
      console.error('[YT-AdSkip] Gemini request failed:', e);
      Util.toast('Gemini request failed');
      return null;
    }
  }
};

async function analyzeTranscriptWithGemini(transcript, title) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    console.log('[YT-AdSkip] No API key. Set via service worker console: chrome.storage.local.set({GOOGLE_API_KEY: "your-key"})');
    Util.toast('No Gemini API key');
    return null;
  }
  console.log('[YT-AdSkip] Using API key:', apiKey.slice(0, 8) + '...');

  const prompt = `## Video Title
${title}

## Transcript
${transcript}

## Instructions
Extract useless, information-poor, and advertisement sections in JavaScript format with the reasoning for why.
Return ONLY valid JSON array, no markdown, no code blocks. Format:
[
  { "start": "00:00", "end": "01:00", "why": "Ad for xyz" },
  { "start": "05:30", "end": "06:15", "why": "Boring banter" }
]
Use the actual timestamps from the transcript. Be conservative - only mark truly useless sections.
If there are no useless sections, return an empty array: []`;

  console.log('[YT-AdSkip] Sending request to Gemini...');

  // Reset conversation and use it for the initial analysis
  GeminiConversation.reset();
  const text = await GeminiConversation.send(prompt);
  console.log('[YT-AdSkip] Response text:', text);

  if (!text) {
    Util.toast('No response from Gemini');
    return null;
  }

  return parseUselessJson(text);
}

function parseUselessJson(text) {
  const jsonMatch = text.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) {
    console.error('[YT-AdSkip] Could not parse JSON from response:', text);
    Util.toast('Could not parse Gemini response');
    return null;
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    console.log('[YT-AdSkip] Parsed result:', parsed);
    return parsed;
  } catch (e) {
    console.error('[YT-AdSkip] JSON parse error:', e);
    Util.toast('Could not parse Gemini response');
    return null;
  }
}

async function initAdSkipForVideo(videoId) {
  if (!videoId) return;

  // Don't auto-start ad skipping on navigation; user must press alt+g
  const cached = AdSkipManager.getCached(videoId);
  if (cached && cached.useless?.length) {
    console.log('[YT-AdSkip] Cached data exists for', videoId, '- press alt+g to activate');
  } else {
    console.log('[YT-AdSkip] No cached data for', videoId, '- press alt+g to analyze');
  }
}

// Store pending results for review
window.pendingUseless = null;

// Get transcript via YouTube's timedtext API — no DOM scraping needed.
const TranscriptFetcher = {
  // Get caption tracks from the player response embedded in the page's <script> tags.
  // Content scripts can read script tag text (it's DOM), just can't execute page JS.
  getPlayerResponse() {
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent;
      const marker = 'ytInitialPlayerResponse';
      const idx = text.indexOf(marker);
      if (idx === -1) continue;
      // Find the '=' after the variable name
      const eqIdx = text.indexOf('=', idx + marker.length);
      if (eqIdx === -1) continue;
      // Find the JSON start
      const jsonStart = text.indexOf('{', eqIdx);
      if (jsonStart === -1) continue;
      // Balanced brace match
      let depth = 0;
      for (let i = jsonStart; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(text.substring(jsonStart, i + 1)); }
            catch { return null; }
          }
        }
      }
    }
    return null;
  },

  // Fallback: re-fetch the page HTML if script tags were already cleared (SPA navigation)
  async fetchPlayerResponse(videoId) {
    try {
      const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
      const html = await resp.text();
      const marker = 'ytInitialPlayerResponse = ';
      const startIdx = html.indexOf(marker);
      if (startIdx === -1) return null;
      const jsonStart = startIdx + marker.length;
      let depth = 0;
      for (let i = jsonStart; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) return JSON.parse(html.substring(jsonStart, i + 1)); }
      }
    } catch (err) {
      console.error('[YT-AdSkip] Failed to fetch player response:', err);
    }
    return null;
  },

  formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  },

  parseCaptionEvents(data) {
    if (!data?.events) return null;
    const lines = data.events
      .filter(e => e.segs)
      .map(e => {
        const time = this.formatTime(e.tStartMs / 1000);
        const text = e.segs.map(s => s.utf8).join('').trim();
        return `${time} ${text}`;
      })
      .filter(line => line.replace(/^[\d:]+\s*/, '').length > 0);
    return lines.length ? lines : null;
  },

  async fetchCaptions(captionTracks) {
    const track = captionTracks.find(t => t.languageCode?.startsWith('en')) || captionTracks[0];
    console.log('[YT-AdSkip] Found caption track:', track.languageCode, track.baseUrl?.slice(0, 80));

    // Try json3 format first, then fall back to default XML
    for (const suffix of ['&fmt=json3', '']) {
      try {
        const url = track.baseUrl + suffix;
        const resp = await fetch(url);
        console.log('[YT-AdSkip] timedtext fetch', suffix || 'xml', '→', resp.status, resp.statusText);
        if (!resp.ok) continue;
        const text = await resp.text();
        console.log('[YT-AdSkip] timedtext response length:', text.length, 'preview:', text.slice(0, 200));
        if (!text.length) continue;
        if (text.startsWith('{')) {
          const result = this.parseCaptionEvents(JSON.parse(text));
          if (result) return result;
        } else if (text.includes('<text')) {
          const result = this.parseXmlCaptions(text);
          if (result) return result;
        }
      } catch (e) {
        console.log('[YT-AdSkip] timedtext fetch error', suffix || 'xml', ':', e.message);
      }
    }
    return null;
  },

  parseXmlCaptions(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const texts = doc.querySelectorAll('text');
    if (!texts.length) return null;
    const lines = Array.from(texts).map(node => {
      const secs = parseFloat(node.getAttribute('start') || '0');
      const time = this.formatTime(secs);
      const text = node.textContent.replace(/\n/g, ' ').trim();
      return `${time} ${text}`;
    }).filter(line => line.replace(/^[\d:]+\s*/, '').length > 0);
    return lines.length ? lines : null;
  },

  // Use YouTube's internal get_transcript API (same as their UI uses)
  async fromInternalAPI(videoId) {
    console.log('[YT-AdSkip] Trying internal get_transcript API...');
    try {
      const resp = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' }
          },
          params: btoa(`\n\x0b${videoId}`)
        })
      });
      if (!resp.ok) {
        console.log('[YT-AdSkip] get_transcript API returned', resp.status);
        return null;
      }
      const data = await resp.json();
      const renderer = data?.actions?.[0]?.updateEngagementPanelAction?.content
        ?.transcriptRenderer?.body?.transcriptBodyRenderer;
      if (!renderer?.cueGroups) {
        console.log('[YT-AdSkip] No cueGroups in get_transcript response');
        return null;
      }
      const lines = renderer.cueGroups.map(g => {
        const cue = g.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer;
        if (!cue) return null;
        const ms = parseInt(cue.startOffsetMs || '0');
        const time = this.formatTime(ms / 1000);
        const text = cue.cue?.simpleText || cue.cue?.runs?.map(r => r.text).join('') || '';
        return `${time} ${text.trim()}`;
      }).filter(line => line && line.replace(/^[\d:]+\s*/, '').length > 0);
      return lines.length ? lines : null;
    } catch (e) {
      console.error('[YT-AdSkip] get_transcript API failed:', e);
      return null;
    }
  },

  // Click "Show transcript" button and read segments from the DOM
  async fromPanel() {
    // First expand the description if needed to reveal the transcript button
    const descToggle = document.querySelector('#description tp-yt-paper-button#expand') ||
      document.querySelector('#expand.ytd-text-inline-expander');
    if (descToggle) { descToggle.click(); await new Promise(r => setTimeout(r, 300)); }

    // Click the "Show transcript" button
    const btn = document.querySelector('ytd-video-description-transcript-section-renderer button');
    if (!btn) {
      console.log('[YT-AdSkip] No "Show transcript" button found');
      return null;
    }
    console.log('[YT-AdSkip] Clicking "Show transcript" button...');
    btn.click();
    // Wait for panel to load (transcript segments are fetched async)
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 500));
      const segments = this.readPanelSegments();
      if (segments) return segments;
    }
    console.log('[YT-AdSkip] Transcript panel opened but no segments found');
    return null;
  },

  readPanelSegments() {
    // Try multiple known segment selectors
    const selectors = [
      'ytd-transcript-segment-renderer',
      'transcript-segment-view-model',
    ];
    for (const sel of selectors) {
      const segments = document.querySelectorAll(sel);
      if (!segments.length) continue;
      const lines = Array.from(segments).map(seg => {
        const parts = seg.innerText?.trim().split('\n').map(s => s.trim()).filter(Boolean) || [];
        // First part is typically the timestamp, rest is text
        const time = parts[0] || '';
        const text = parts.slice(1).join(' ');
        return `${time} ${text}`;
      }).filter(line => line.replace(/^[\d:]+\s*/, '').trim().length > 0);
      if (lines.length) {
        console.log('[YT-AdSkip] Got', lines.length, 'segments from panel via', sel);
        return lines;
      }
    }
    return null;
  },

  async get(videoId) {
    console.log('[YT-AdSkip] Fetching transcript for', videoId);

    // 1. Check if transcript panel is already open
    const existing = this.readPanelSegments();
    if (existing) return existing;

    // 2. Click "Show transcript" button and read DOM
    try {
      const result = await this.fromPanel();
      if (result) return result;
    } catch (e) {
      console.log('[YT-AdSkip] Panel approach failed:', e.message);
    }

    // 3. Fallback: YouTube's internal get_transcript API
    try {
      const result = await this.fromInternalAPI(videoId);
      if (result) return result;
    } catch (e) {
      console.log('[YT-AdSkip] Internal API failed:', e.message);
    }

    // 4. Fallback: timedtext API via player response
    for (const getResponse of [
      () => this.getPlayerResponse(),
      () => this.fetchPlayerResponse(videoId),
    ]) {
      try {
        const pr = await getResponse();
        const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks?.length) {
          const result = await this.fetchCaptions(tracks);
          if (result) return result;
        }
      } catch (e) {
        console.log('[YT-AdSkip] timedtext source failed:', e.message);
      }
    }

    console.log('[YT-AdSkip] All transcript sources exhausted');
    return null;
  },
};

// Analyze transcript with Gemini. force=true re-runs even if cached.
window.analyzeAndSkip = async (force = false) => {
  const videoId = getVideoId();
  console.log('[YT-AdSkip] Starting analysis for video:', videoId);

  if (!videoId) {
    Util.toast('Not on a video page');
    return;
  }

  // 1. Check cache first
  const cached = AdSkipManager.getCached(videoId);
  let transcript = cached?.transcript;
  let title = cached?.title;

  // 2. If no cached transcript, fetch it
  if (!transcript) {
    Util.toast('Fetching transcript...');
    // Try cache → DOM → API (in TranscriptFetcher)
    const transcripts = await TranscriptFetcher.get(videoId);

    if (!transcripts?.length) {
      console.log('[YT-AdSkip] All transcript strategies failed.');
      Util.toast('No transcript. Try alt+o first');
      return;
    }

    console.log('[YT-AdSkip] Fetched', transcripts.length, 'segments');
    transcript = transcripts.join('\n');
    title = document.querySelector('#title h1')?.innerText?.trim() || 'Unknown';
  } else {
    console.log('[YT-AdSkip] Using cached transcript');
  }

  // 3. Skip if already analyzed (unless force)
  if (!force && cached?.useless?.length) {
    console.log('[YT-AdSkip] Already analyzed, use reanalyze() to re-run');
    Util.toast('Already analyzed. Use Re-analyze to re-run.');
    SkipPanel.show(cached.useless, title);
    return;
  }

  console.log('[YT-AdSkip] Title:', title);
  console.log('[YT-AdSkip] Transcript preview:', transcript.slice(0, 300) + '...');

  Util.toast('Analyzing transcript with Gemini...');
  const useless = await analyzeTranscriptWithGemini(transcript, title);

  if (useless && useless.length > 0) {
    console.log('[YT-AdSkip] === ANALYSIS COMPLETE ===');
    console.log('[YT-AdSkip] Found', useless.length, 'useless sections:');
    console.table(useless);

    // Cache full data
    AdSkipManager.setCache(videoId, { title, transcript, useless });

    // Auto-apply
    const intervalId = ytAdSkip(useless);
    AdSkipManager.start(videoId, intervalId);
    console.log('[YT-AdSkip] Ad skip ACTIVE');
    SkipPanel.show(useless, title);
  } else {
    // Cache transcript even if no useless sections
    AdSkipManager.setCache(videoId, { title, transcript, useless: [] });
    console.log('[YT-AdSkip] No useless sections found (cached)');
    Util.toast('No useless sections found');
  }
};

// Follow up on ad filtering with a prompt (e.g. "skip more aggressively" or "keep the intro")
async function adSkipFollowUp() {
  const videoId = getVideoId();
  if (!videoId) return Util.toast('Not on a video page');

  // Rebuild conversation from cache if needed (e.g. after navigation or cached analysis)
  const cached = AdSkipManager.getCached(videoId);
  if (!GeminiConversation.history.length) {
    if (!cached?.transcript || !cached?.useless) return Util.toast('Run alt+g first to analyze');
    GeminiConversation.reset();
    GeminiConversation.addUser(`## Video Title\n${cached.title}\n\n## Transcript\n${cached.transcript}\n\nExtract useless sections as JSON array.`);
    GeminiConversation.addModel(JSON.stringify(cached.useless));
  }

  Util.toast('Type your follow-up and press Enter');
  const input = await new Promise(resolve => {
    const box = Util.inputBox((data) => { resolve(data); });
    box.placeholder = 'e.g. "skip more", "keep the intro", "less aggressive"';
    box.style.width = '500px';
  });

  if (!input) return;

  Util.toast('Sending follow-up to Gemini...');
  const followUpPrompt = `${input}

Return the UPDATED complete list of useless sections as a JSON array. Same format:
[{ "start": "MM:SS", "end": "MM:SS", "why": "reason" }]
Return ONLY the JSON array, no markdown, no code blocks.`;

  const responseText = await GeminiConversation.send(followUpPrompt);
  if (!responseText) return;

  const useless = parseUselessJson(responseText);
  if (!useless) return;

  console.log('[YT-AdSkip] Follow-up result:', useless.length, 'sections');
  console.table(useless);

  const title = cached?.title || document.querySelector('#title h1')?.innerText?.trim() || 'Unknown';
  AdSkipManager.setCache(videoId, { ...cached, title, useless });

  AdSkipManager.cleanup();
  if (useless.length) {
    const intervalId = ytAdSkip(useless);
    AdSkipManager.start(videoId, intervalId);
  }
  SkipPanel.show(useless, title);
  Util.toast(`Updated: ${useless.length} skip sections`);
}

// Apply pending useless sections
window.applyUseless = async () => {
  if (!window.pendingUseless) {
    console.log('[YT-AdSkip] No pending results. Run analyzeAndSkip() first.');
    Util.toast('No pending results');
    return;
  }

  const { videoId, useless, title } = window.pendingUseless;
  console.log('[YT-AdSkip] Applying', useless.length, 'sections for:', title);

  await AdSkipManager.setCache(videoId, useless);
  const intervalId = ytAdSkip(useless);
  AdSkipManager.start(videoId, intervalId);

  window.pendingUseless = null;
  console.log('[YT-AdSkip] Ad skip ACTIVE');
  Util.toast(`Ad skip active: ${useless.length} sections`);
};

// Discard pending results
window.skipUseless = () => {
  window.pendingUseless = null;
  console.log('[YT-AdSkip] Pending results discarded');
  Util.toast('Results discarded');
};

function secsToHmsStr(tSec) {
  const hms = [tSec / 3600, (tSec / 60) % 60, (tSec % 60)].map(n => parseInt(n));
  return hms.map((n, i) => n ? `${n}${'hms'[i]}` : '').join('');
}

function renderCaption(c) {
  const timeStr = secsToHmsStr(c.tstamp);
  const url = getUrl(timeStr);
  return `[@${timeStr}](${url})\n${c.content}`.trim();
}

/** NB, if `withCaptions` is true it'll copy around the current tstamp. */
function copyUrl(withCaptions) {
  const vid = getVideo();
  const subs = window.tamperSubs;
  const tstamp = vid.currentTime;
  const content = (withCaptions && subs && subs.around(tstamp)) || '';
  navigator.clipboard.writeText(renderCaption(content || { tstamp, content }));
  Util.toast(`Copied time ${content ? 'with' : 'without'} captions`);
}

function ytAdSkip(useless) {
  // const useless = [{ start: "0:00", end: "0:34", ...},];
  const videoElement = document.querySelector('video');
  const timeDisplayElement = document.querySelector('.ytp-time-current');
  if (!videoElement || !timeDisplayElement) {
    return Util.toast('Ad Skipper: Could not find video or time display element.');
  }
  const tts = t => t.split(':').map(part => parseInt(part, 10)).reduce((acc, cur) => acc * 60 + cur, 0);
  const skipAdCheck = () => {
    for (const ad of useless) {
      let s = tts(ad.start); let e = tts(ad.end);
      if (videoElement.currentTime >= s && videoElement.currentTime < e) {
        Util.toast(`adskip: ${ad.start} to ${ad.end}`);
        videoElement.currentTime = e;
        break;
      }
    }
  };
  let i = setInterval(skipAdCheck, 1000);
  console.log(`Ad skipper active. use clearInterval(i) to stop. i=${i}`);
  Util.toast(`Ad skipper active. use clearInterval(i) to stop. i=${i}`);
  return i;
}

/** Wrapper for all subtitles in the current video. */
class Subtitles {
  constructor(subtitleDivs) {
    const subtitles = [];
    for (let subtitleDiv of subtitleDivs) {
      let [timeStr, content] = subtitleDiv.innerText.split('\n', 2);
      let tstamp = timeStr.split(':').map(n => parseInt(n)).reverse()
        .map((n, i) => (n * Math.pow(60, i)))
        .reduce((a, b) => a + b);
      subtitles.push({ timeStr, tstamp, content });
    }

    this.subs = new SortedArray(subtitles, 'tstamp');
  }

  /** Build from TranscriptFetcher output (array of "M:SS text" strings). */
  static fromTranscriptLines(lines) {
    const subtitles = lines.map(line => {
      const match = line.match(/^([\d:]+)\s+([\s\S]*)/);
      if (!match) return null;
      const timeStr = match[1].trim();
      const content = match[2].trim();
      const tstamp = timeStr.split(':').map(n => parseInt(n)).reverse()
        .map((n, i) => (n * Math.pow(60, i)))
        .reduce((a, b) => a + b);
      return { timeStr, tstamp, content };
    }).filter(Boolean);
    const subs = Object.create(Subtitles.prototype);
    subs.subs = new SortedArray(subtitles, 'tstamp');
    return subs;
  }

  around(secs, secsBefore = 5, secsAfter = 5) {
    return this.get(Math.max(0, secs - secsBefore), secs + secsAfter);
  }

  get(secs, maybeEndSecs) {
    const subs = this.subs.get(secs, maybeEndSecs);
    if (!subs.length) {  // no subs, but return position
      return { tstamp: secs, timeStr: secsToHmsStr(secs) };
    }
    const content = subs.map(x => x.content).join('\n');
    return { content, tstamp: subs[0].tstamp, timeStr: subs[0].timeStr };
  }
}

/** Try show subtitles and c/p relevant info. */
async function cpImportantInfo() {
  const videoId = getVideoId();
  if (!videoId) return Util.toast('Not on a video page');

  Util.toast('Fetching transcript...');
  const transcripts = await TranscriptFetcher.get(videoId);

  if (!transcripts?.length) {
    Util.toast('No transcript found');
    return;
  }

  // Build Subtitles for real-time caption tracking (alt+c)
  window.tamperSubs = Subtitles.fromTranscriptLines(transcripts);
  Util.toast('Tracking with captions');

  const url = getUrl();
  const title = document.querySelector('#title h1')?.innerText?.trim() || 'Unknown';
  const base = `---\ntitle: "${title}"\nsource: ${url}\n---\n\n`;
  const presentation = transcripts.join('\n');
  navigator.clipboard.writeText(`${base}## Transcript\n\n${presentation}`);
  Util.toast('C/p captions!');
}

/** Quick&dirty class encapsulating all captions within a session. */
class Tracker {
  static TIME_JITTER = 5;
  prev = null;
  trackedCaptions = new SortedUniqueArray([], 'tstamp');
  /** Toggles state: 1st starts tracking subtitles, then stores them. */
  ckpt() {
    const subs = window.tamperSubs;
    const vid = getVideo();
    if (!subs) return Util.toast('Subs not active');
    if (!this.prev) {
      Util.toast('Started tracking captions.');
      this.prev = vid.currentTime;
    } else {
      // TODO this should work better with consolidating span overlaps
      const caps = subs.get(
        this.prev - Tracker.TIME_JITTER,
        vid.currentTime + Tracker.TIME_JITTER);
      this.trackedCaptions.insert(caps);
      Promise.try(
        caps => caps.map(renderCaption).join('\n'), this.trackedCaptions)
        .then(c => navigator.clipboard.writeText(c)).then(c => {
          this.prev = null;
          Util.toast('Copied captions.');
        }).catch(err => {
          console.error(err);
          Util.toast('Failed copying');
        });
    }
  }
}

function getPlaylistLines() {
  const sel = '#contents ytd-playlist-video-renderer a#video-title'
  const titles = Array
    .from(document.querySelectorAll(sel))
    .map(x => ({ text: x.innerText.trim(), href: x.href }))
  const presentation = titles
    .map(t => `[${t.text}](${t.href})`)
    .join('\n* ');
  return `* ${presentation}`
}

const tracker = new Tracker();
const ytShortcutHandler = Shortcut.init({
  a: [
    // alt-a to copy url at current tstamp without captions
    Shortcut.fun('a', () => copyUrl(false)),
    // alt-c to copy url around current tstamp with captions
    Shortcut.fun('c', () => copyUrl(true)),
    // alt-g to analyze transcript with Gemini and start ad skip
    Shortcut.fun('g', () => analyzeAndSkip()),
    // alt-f to follow up on ad filtering
    Shortcut.fun('f', () => adSkipFollowUp()),
    // alt-p to toggle skip panel
    Shortcut.fun('p', () => SkipPanel.toggle()),
    // alt-v multiple times to track particular sections of the video
    Shortcut.fun('v', () => tracker.ckpt()),
    // alt-w to copy the title
    Shortcut.fun('w', () => {
      if (window.location.pathname == '/playlist') {
        const presentation = getPlaylistLines()
        if (presentation) {
          navigator.clipboard.writeText(presentation)
          Util.toast('Copied playlist')
        } else {
          Util.toast('Could not find playlist')
        }
      } else {
        const title = document.querySelector(
          "#info h1.title.ytd-video-primary-info-renderer").textContent;
        const url = getUrl();
        navigator.clipboard.writeText(`[${title}](${url})`);
        Util.toast(`Copied title`);
      }
    }),
    Shortcut.fun('o', () => {
      if (window.location.pathname == '/playlist') {
        const presentation = getPlaylistLines()
        if (presentation) {
          navigator.clipboard.writeText(presentation)
          Util.toast('Copied playlist')
        } else {
          Util.toast('Could not find playlist')
        }
      } else {
        cpImportantInfo()
      }
    }),

    Shortcut.sel('i', '.ytp-miniplayer-button'),
    Shortcut.sel('i', '.ytp-miniplayer-expand-watch-page-button'),

    Shortcut.sel('m', '.ytp-mute-button'),
    Shortcut.sel('t', '.ytp-size-button'),
    Shortcut.sel('s', '.ytp-subtitles-button'),
    Shortcut.sel('b', '.ytp-fullscreen-button'),
  ],
  m: [Shortcut.sel('b', '.ytp-fullscreen-button.ytp-button'),]
});
// Use addEventListener to avoid being overwritten by other content scripts
document.addEventListener('keyup', ytShortcutHandler, true);
