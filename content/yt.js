/**
 * Quick and dirty plugin to copy captions from a YT video.
 */

console.log("Caption plugin loaded");

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
const AdSkipManager = {
  currentVideoId: null,
  currentInterval: null,
  STORAGE_KEY: 'yt_useless_cache',

  async getCache() {
    const data = await chrome.storage.local.get(this.STORAGE_KEY);
    return data[this.STORAGE_KEY] || {};
  },

  async setCache(videoId, useless) {
    const cache = await this.getCache();
    cache[videoId] = useless;
    await chrome.storage.local.set({ [this.STORAGE_KEY]: cache });
  },

  async getCached(videoId) {
    const cache = await this.getCache();
    return cache[videoId] || null;
  },

  cleanup() {
    if (this.currentInterval) {
      clearInterval(this.currentInterval);
      console.log(`Cleared ad skip interval for video: ${this.currentVideoId}`);
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
  const cached = await AdSkipManager.getCached(videoId);
  if (cached) {
    console.log('Using cached useless data for', videoId);
    const intervalId = ytAdSkip(cached);
    AdSkipManager.start(videoId, intervalId);
    return;
  }

  // No cache - will need transcript analysis
  console.log('No cached data for', videoId, '- use alt+o to fetch transcript, then alt+g to analyze');
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

  // Main entry - tries all strategies
  async get(videoId) {
    // Try DOM strategies first (faster)
    let result = this.fromNewDOM() || this.fromOldDOM() || this.fromLegacyDOM();

    if (result?.length) {
      return this.dedupe(result);
    }

    // Fall back to API
    console.log('[YT-AdSkip] DOM strategies failed, trying API...');
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

// Analyze current transcript with Gemini (stores result for review)
window.analyzeAndSkip = async () => {
  const videoId = getVideoId();
  console.log('[YT-AdSkip] Starting analysis for video:', videoId);

  if (!videoId) {
    Util.toast('Not on a video page');
    return;
  }

  Util.toast('Fetching transcript...');
  const transcripts = await TranscriptFetcher.get(videoId);

  if (!transcripts || !transcripts.length) {
    console.log('[YT-AdSkip] All transcript strategies failed.');
    console.log('[YT-AdSkip] Try: 1) Open transcript panel (alt+o), 2) Check if video has captions');
    Util.toast('No transcript found. Try alt+o first or check if video has captions');
    return;
  }

  console.log('[YT-AdSkip] Found', transcripts.length, 'transcript segments');

  const title = document.querySelector('#title h1')?.innerText?.trim() || 'Unknown';
  const transcript = transcripts.join('\n');
  console.log('[YT-AdSkip] Video title:', title);
  console.log('[YT-AdSkip] Transcript preview:', transcript.slice(0, 500) + '...');

  Util.toast('Analyzing transcript with Gemini...');
  const useless = await analyzeTranscriptWithGemini(transcript, title);

  if (useless && useless.length > 0) {
    console.log('[YT-AdSkip] === ANALYSIS COMPLETE ===');
    console.log('[YT-AdSkip] Video:', title);
    console.log('[YT-AdSkip] Found', useless.length, 'useless sections:');
    console.table(useless);

    // Auto-apply
    await AdSkipManager.setCache(videoId, useless);
    const intervalId = ytAdSkip(useless);
    AdSkipManager.start(videoId, intervalId);
    console.log('[YT-AdSkip] Ad skip ACTIVE');
    Util.toast(`Ad skip active: ${useless.length} sections`);
  } else {
    console.log('[YT-AdSkip] No useless sections found');
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
  const hms = [tSec/3600, (tSec/60)%60, (tSec%60)].map(n => parseInt(n));
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
  const tts = t => t.split(':').map(part => parseInt(part, 10)).reduce((acc, cur) => acc*60+cur, 0);
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
      subtitles.push({timeStr, tstamp, content});
    }

    this.subs = new SortedArray(subtitles, 'tstamp');
  }

  around(secs, secsBefore=5, secsAfter=5) {
    return this.get(Math.max(0, secs - secsBefore), secs + secsAfter);
  }

  get(secs, maybeEndSecs) {
    const subs = this.subs.get(secs, maybeEndSecs);
    if (!subs.length) {  // no subs, but return position
      return {tstamp: secs, timeStr: secsToHmsStr(secs)};
    }
    const content = subs.map(x => x.content).join('\n');
    return { content, tstamp: subs[0].tstamp, timeStr: subs[0].timeStr };
  }
}

function tryFindTranscripts() {
  let treeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        if (/\b(Show transcript|Display transcript|Transcript|View transcript|See transcript)\b/i.test(node.nodeValue)) {
            return NodeFilter.FILTER_ACCEPT;
        }
      }
    },
    false
  );

  function findParentBtn(node) {
    for (var i = 0, parent = node.parentNode; i < 5 && node; i++, parent = (node || {}).parentNode) {
      if (node.tagName == 'BUTTON') {
        return node;
      }
      node = parent;
    }
    return null;
  }

  let nodes = [];
  while(treeWalker.nextNode()) {
    var parentBtn = findParentBtn(treeWalker.currentNode);
    if (parentBtn) {
      nodes.push(parentBtn);
    }
  }
  return nodes;
}

/** Try show subtitles and c/p relevant info. */
async function cpImportantInfo() {
  const subtitleWrapSel = '*[target-id=engagement-panel-searchable-transcript]';
  document.querySelector('#info #button > yt-icon.ytd-menu-renderer').click();
  await Retry.sleep(250);
  const openTranscriptItem = tryFindTranscripts()
  if (!openTranscriptItem.length) return Util.toast('No transcript item found!');
  // this actually does happen on yt ... not sure if should have better chk
  // if (openTranscriptItem.length > 1) { console.log("Found multiple candidates:", openTranscriptItem); }
  openTranscriptItem[0].click();

  new Retry().call(() => {
    let subWrap = document.querySelector(subtitleWrapSel);
    if (subs = subWrap.querySelectorAll('#body ytd-transcript-segment-renderer')) {
      return new Subtitles(subs);
    }
  }).then(subs => {
    window.tamperSubs = subs;
    Util.toast('Tracking with captions');
    return subs
  }).then(async () => {
    await Retry.sleep(500)
    const sel = '#body #segments-container yt-formatted-string.segment-text'
    const allTranscripts = Array.from(document.querySelectorAll(sel))
      .map(x => x.parentNode.innerText)
    const seen = new Set()
    const deduplicated = allTranscripts.filter(x => {
      const normalized = x.trim().replace(/\s+/g, ' ')
      if (seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
    return deduplicated
  }).then(allTranscripts => {
    const url = getUrl()
    const title = document.querySelector('#title h1').innerText.trim()
    const base = `---\ntitle: "${title}"\nsource: ${url}\n---\n\n`
    const presentation = allTranscripts.join('\n')
    navigator.clipboard.writeText(`${base}## Transcript\n\n${presentation}`)
    Util.toast('C/p captions!')
  }).catch(msg => {
    console.error(msg);
    Util.toast('Failed getting captions');
  });

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
    .map(x => ({text: x.innerText.trim(), href: x.href}))
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
