/**
 * YT Ad Skip - Analyzes transcripts via Gemini to skip ads/filler.
 *
 * SETUP:
 *   chrome://extensions → TamperScripts → service worker console:
 *   chrome.storage.local.set({GOOGLE_API_KEY: 'your-key'})
 *
 * USAGE:
 *   alt+g  analyze & skip    alt+p  toggle panel    alt+o  load transcript
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
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
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

    const panel = document.createElement('div');
    panel.id = 'yt-adskip-panel';
    panel.innerHTML = `
      <div class="adskip-header">
        <span class="adskip-title">⏭️ Ad Skip</span>
        <div class="adskip-controls">
          <button class="adskip-btn adskip-add" title="Add skip">+</button>
          <button class="adskip-btn adskip-minimize">_</button>
          <button class="adskip-btn adskip-close">✕</button>
        </div>
      </div>
      <div class="adskip-body">
        <table class="adskip-table">
          <thead><tr><th>Start</th><th>End</th><th>Reason</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
        <div class="adskip-footer">
          <button class="adskip-btn adskip-reanalyze">🔄 Re-analyze</button>
          <button class="adskip-btn adskip-clear">🗑️ Clear</button>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #yt-adskip-panel {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 400px;
        max-height: 300px;
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        color: #e0e0e0;
        z-index: 99999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        overflow: hidden;
      }
      #yt-adskip-panel.minimized .adskip-body { display: none; }
      #yt-adskip-panel.minimized { max-height: none; }
      .adskip-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: #252525;
        cursor: move;
        user-select: none;
        border-bottom: 1px solid #333;
      }
      .adskip-title { font-weight: 600; }
      .adskip-controls { display: flex; gap: 4px; }
      .adskip-btn {
        background: #333;
        border: none;
        color: #e0e0e0;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      .adskip-btn:hover { background: #444; }
      .adskip-body {
        max-height: 240px;
        overflow-y: auto;
        padding: 8px;
      }
      .adskip-table {
        width: 100%;
        border-collapse: collapse;
      }
      .adskip-table th, .adskip-table td {
        padding: 6px 8px;
        text-align: left;
        border-bottom: 1px solid #333;
      }
      .adskip-table th {
        background: #252525;
        font-weight: 600;
        position: sticky;
        top: 0;
      }
      .adskip-table tr:hover { background: #252525; }
      .adskip-table .skip-btn, .adskip-table .rm-btn {
        padding: 2px 6px;
        font-size: 11px;
      }
      .adskip-table .skip-btn { background: #3a6a9a; }
      .adskip-table .skip-btn:hover { background: #4a7aaa; }
      .adskip-table .rm-btn { background: #8a3a3a; }
      .adskip-table .rm-btn:hover { background: #a54545; }
      .adskip-add { font-weight: bold; }
      .adskip-footer {
        display: flex;
        gap: 8px;
        padding: 8px 0 4px;
        border-top: 1px solid #333;
        margin-top: 8px;
      }
      .adskip-empty {
        text-align: center;
        padding: 20px;
        color: #888;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);
    this.panel = panel;

    // Event listeners
    panel.querySelector('.adskip-close').onclick = () => this.hide();
    panel.querySelector('.adskip-minimize').onclick = () => panel.classList.toggle('minimized');
    panel.querySelector('.adskip-reanalyze').onclick = () => ytAdSkipCache.reanalyze();
    panel.querySelector('.adskip-add').onclick = () => this.promptAdd();
    panel.querySelector('.adskip-clear').onclick = () => {
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
    const header = panel.querySelector('.adskip-header');
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

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1 }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('[YT-AdSkip] Gemini API error:', response.status, err);
      window.lastGeminiResponse = { error: true, status: response.status, body: err };
      Util.toast(`Gemini API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log('[YT-AdSkip] Raw Gemini response:', data);

    // Store full response for debugging
    window.lastGeminiResponse = data;
    localStorage.setItem('lastGeminiResponse', JSON.stringify(data));

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('[YT-AdSkip] Response text:', text);

    if (!text) {
      console.log('[YT-AdSkip] No text in response. Check lastGeminiResponse');
      Util.toast('No response from Gemini');
      return null;
    }

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      console.error('[YT-AdSkip] Could not parse JSON from response:', text);
      Util.toast('Could not parse Gemini response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log('[YT-AdSkip] Parsed result:', parsed);
    return parsed;
  } catch (e) {
    console.error('[YT-AdSkip] Gemini request failed:', e);
    window.lastGeminiResponse = { error: true, exception: e.message };
    Util.toast('Gemini request failed');
    return null;
  }
}

async function initAdSkipForVideo(videoId) {
  if (!videoId) return;

  // Check cache first
  const cached = AdSkipManager.getCached(videoId);
  if (cached && cached.useless?.length) {
    console.log('[YT-AdSkip] Using cached data for', videoId);
    console.log('[YT-AdSkip] Title:', cached.title);
    console.log('[YT-AdSkip] Skipping', cached.useless.length, 'sections:');
    console.table(cached.useless);
    const intervalId = ytAdSkip(cached.useless);
    AdSkipManager.start(videoId, intervalId);
    // Show panel minimized for cached (less intrusive)
    SkipPanel.show(cached.useless, cached.title, true);
    return;
  }

  // No cache - will need transcript analysis
  console.log('[YT-AdSkip] No cached data for', videoId, '- press alt+g to analyze');
}

// Store pending results for review
window.pendingUseless = null;

// Get transcript - multiple strategies with fallback
const TranscriptFetcher = {
  // Strategy 1: New YT DOM structure (2024+)
  fromNewDOM() {
    const segments = document.querySelectorAll('transcript-segment-view-model');
    if (!segments.length) return null;
    console.log('[YT-AdSkip] Using new DOM structure');
    return Array.from(segments).map(seg => {
      const time = seg.querySelector('.ytwTranscriptSegmentViewModelTimestamp')?.textContent?.trim() || '';
      const text = seg.querySelector('span.yt-core-attributed-string')?.textContent?.trim() || '';
      return `${time} ${text}`;
    });
  },

  // Strategy 2: Old YT DOM structure
  fromOldDOM() {
    const sel = '#body #segments-container yt-formatted-string.segment-text';
    const segments = document.querySelectorAll(sel);
    if (!segments.length) return null;
    console.log('[YT-AdSkip] Using old DOM structure');
    return Array.from(segments).map(x => x.parentNode.innerText);
  },

  // Strategy 3: Alternative old structure
  fromLegacyDOM() {
    const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (!segments.length) return null;
    console.log('[YT-AdSkip] Using legacy DOM structure');
    return Array.from(segments).map(x => x.innerText);
  },

  // Strategy 4: Fetch from YouTube's timedtext API
  async fromAPI(videoId) {
    console.log('[YT-AdSkip] Trying API fetch for', videoId);
    try {
      // First get the caption track URL from player response
      const playerResponse = window.ytInitialPlayerResponse ||
        await this.fetchPlayerResponse(videoId);

      if (!playerResponse) {
        console.log('[YT-AdSkip] No player response found');
        return null;
      }

      const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!captions?.length) {
        console.log('[YT-AdSkip] No caption tracks found');
        return null;
      }

      // Prefer English, fall back to first available
      const track = captions.find(t => t.languageCode?.startsWith('en')) || captions[0];
      console.log('[YT-AdSkip] Found caption track:', track.languageCode);

      // Fetch the actual captions (request JSON format)
      const url = track.baseUrl + '&fmt=json3';
      const resp = await fetch(url);
      const data = await resp.json();

      if (!data.events) {
        console.log('[YT-AdSkip] No events in caption data');
        return null;
      }

      return data.events
        .filter(e => e.segs)
        .map(e => {
          const time = this.formatTime(e.tStartMs / 1000);
          const text = e.segs.map(s => s.utf8).join('');
          return `${time} ${text}`;
        });
    } catch (err) {
      console.error('[YT-AdSkip] API fetch failed:', err);
      return null;
    }
  },

  async fetchPlayerResponse(videoId) {
    try {
      const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
      const html = await resp.text();
      const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
      if (match) {
        return JSON.parse(match[1]);
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

  // Try to open the transcript panel in the YT UI
  async openTranscriptPanel() {
    try {
      // Click the "..." menu button under the video
      document.querySelector('#info #button > yt-icon.ytd-menu-renderer')?.click();
      await new Promise(r => setTimeout(r, 300));

      // Find and click the "Show transcript" button
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          /\b(Show transcript|Display transcript|Transcript|View transcript|See transcript)\b/i.test(node.nodeValue)
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      });
      while (walker.nextNode()) {
        let el = walker.currentNode;
        for (let i = 0; i < 5 && el; i++, el = el.parentNode) {
          if (el.tagName === 'BUTTON') { el.click(); return true; }
        }
      }
    } catch (e) {
      console.log('[YT-AdSkip] Failed to open transcript panel:', e);
    }
    return false;
  },

  // Main entry - tries all strategies
  async get(videoId) {
    // Try DOM strategies first (faster, if panel already open)
    let result = this.fromNewDOM() || this.fromOldDOM() || this.fromLegacyDOM();

    if (result?.length) {
      return this.dedupe(result);
    }

    // Try opening the transcript panel, then re-check DOM
    console.log('[YT-AdSkip] DOM strategies failed, trying to open transcript panel...');
    if (await this.openTranscriptPanel()) {
      await new Promise(r => setTimeout(r, 500));
      result = this.fromNewDOM() || this.fromOldDOM() || this.fromLegacyDOM();
      if (result?.length) {
        return this.dedupe(result);
      }
    }

    // Fall back to API
    console.log('[YT-AdSkip] Panel strategies failed, trying API...');
    result = await this.fromAPI(videoId);

    if (result?.length) {
      return this.dedupe(result);
    }

    return null;
  },

  dedupe(transcripts) {
    const seen = new Set();
    return transcripts.filter(x => {
      const normalized = x.trim().replace(/\s+/g, ' ');
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }
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
window.onkeyup = document.onkeyup = Shortcut.init({
  a: [
    // alt-a to copy url at current tstamp without captions
    Shortcut.fun('a', () => copyUrl(false)),
    // alt-c to copy url around current tstamp with captions
    Shortcut.fun('c', () => copyUrl(true)),
    // alt-g to analyze transcript with Gemini and start ad skip
    Shortcut.fun('g', () => analyzeAndSkip()),
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
