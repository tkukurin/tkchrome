/**
 * Quick and dirty plugin to copy captions from a YT video.
 */

console.log("Caption plugin loaded");

const getVideo = () => document.querySelector('video');

function getUrl(timeStr) {
  const id = /\?v\=([^&]+)/g.exec(window.location.search);
  const suffix = (timeStr && `?t=${timeStr}`) || '';
  return (id && `https://youtu.be/${id[1]}${suffix}`) ||
    window.location.href.replace(/&t\=[^&]+/, `&t=${timeStr}`);
}

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
    const base = `---\ntitle: "${title}"\nsource: ${url}\n--\n\n`
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
