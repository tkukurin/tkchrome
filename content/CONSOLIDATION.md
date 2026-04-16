# Content Scripts Consolidation Summary

## Changes Made

### 1. Bug Fix: `cookies.js`
**Issue**: Duplicate function definition
- `findInNode()` was defined twice (originally at lines ~90 and ~110)
- Removed the first duplicate, keeping the second definition
- **Impact**: -44 lines, cleaner code, no functional change

### 2. Consolidation: `social.js` (replaces `twitter.js` + `bsky.js`)
**Rationale**: DEEP module principle - one comprehensive social media handler vs two shallow site-specific ones

**Architecture**:
```js
Social = {
  twitter: { match, clickShowMore, parse, getSelector },
  bsky: { match, parse, getSelector },
  getCurrentSite: () => {...}
}

Thread.addFrom(nodes)  // site-agnostic
Thread.format()        // site-specific output
```

**Features preserved**:
- Twitter: Full markdown with @handle, username, timestamps, images, videos, GIFs
- Bluesky: Simple text extraction from `postThreadItem-*` divs
- Same shortcuts: `alt-t` (init), `alt-c` (copy)
- Thread deduplication (max 99 items)
- URL change detection (cleanup observers)

**Manifest update**:
```json
// Before: 3 separate entries (twitter.com, x.com, bsky.app)
// After: 1 unified entry with all three domains → social.js
```

**Files obsolete** (can delete):
- `content/twitter.js` (174 lines)
- `content/bsky.js` (21 lines)

**New file**:
- `content/social.js` (151 lines)

**Net result**: ~44 lines saved + cleaner abstraction

---

## Testing

### Running Tests
```sh
open tkchrome/content/test.html  # macOS
# or just open the file in any browser
```

No build system. No dependencies. Pure HTML + inline JS.

### Coverage
- `cookies.js`: visibility checks, duplicate verification
- `social.js`: site detection, thread deduplication, formatting, parsers for both platforms

### Test Philosophy
Minimal tests focused on:
1. Consolidation correctness
2. Regression prevention (duplicate bug)
3. Core logic validation

Not aiming for 100% coverage - just key invariants.

---

## Migration Guide

### If you had bookmarks/shortcuts to old files
- `twitter.js` → `social.js`
- `bsky.js` → `social.js`

### User-facing changes
**None**. Shortcuts and behavior identical.

### Developer changes
To add new social media site:
```js
Social.newsite = {
  match: () => location.hostname === 'example.com',
  parse: (container) => ({text: '...', time: Date.now()}),
  getSelector: () => '.post-container',
  clickShowMore: (container) => { /* optional */ }
};
```

Update `Social.getCurrentSite()` and manifest.json.

---

## Design Decisions

### Why consolidate twitter + bsky?
- Both extract threaded social media posts
- Shared logic: Thread class, deduplication, formatting, shortcuts
- Different only in DOM selectors and parsing details
- DEEP module: one well-abstracted handler > two ad-hoc scripts

### Why keep other scripts separate?
- `vim.js`: Complex state machine, unrelated domain
- `speed.js`: Video playback control, different purpose
- `yt.js`: YouTube-specific caption extraction
- `latex.js`: Math extraction, specialized
- Each serves distinct purpose with minimal overlap

### Abstraction boundaries
Shared utilities already in `util/include.js`:
- `Q.el/all` - DOM queries with Promises
- `Util.toast` - notifications
- `Shortcut.init` - keyboard handling
- `F.guard/ret*` - functional helpers

Content scripts stay thin, site-specific adapters.

---

## Metrics

**Before consolidation**:
- 11 content script files
- `findInNode` duplicate bug in cookies.js
- 2 similar thread extraction implementations

**After consolidation**:
- 10 content script files (9 after deleting old ones)
- Bug fixed
- 1 unified social media handler
- ~44 net lines saved
- Easier to extend (add Instagram, Mastodon, etc.)

**Philosophy alignment**:
✓ DEEP modules (Social is deeper than twitter/bsky were)
✓ Minimal LOCs (removed duplicates)
✓ No ceremony (unified without over-engineering)
✓ Functional style (preserved throughout)