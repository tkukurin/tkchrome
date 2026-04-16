# Content Scripts Tests

## Running Tests

Open `test.html` in a browser:
```sh
open tkchrome/content/test.html
```

No build system required. Tests run in-browser with mocked dependencies.

## What Was Changed

### 1. Fixed `cookies.js` bug
- **Issue**: `findInNode()` function was defined twice (lines ~90 and ~110)
- **Fix**: Removed duplicate definition

### 2. Consolidated `twitter.js` + `bsky.js` → `social.js`
- **Rationale**: Both extract social media threads - one DEEP module vs two shallow ones
- **Changes**:
  - Created `Social` object with site-specific parsers (twitter, bsky)
  - Unified `Thread` class handles both platforms
  - Site detection via `Social.getCurrentSite()`
  - Twitter: Full markdown with metadata, images, videos
  - Bluesky: Simple text extraction
- **Shortcuts**: Same as before (alt-t init, alt-c copy)
- **Manifest**: Updated to use single `social.js` for all three domains

### Old files (can be deleted)
- `content/twitter.js` 
- `content/bsky.js`

## Test Coverage

- `cookies.js`: Element visibility checks, duplicate function verification
- `social.js`: Site detection, thread deduplication, formatting, parsers

## Adding New Tests

```js
test('description', () => {
  // arrange
  const input = 'test';
  
  // act
  const result = someFunction(input);
  
  // assert
  assertEqual(result, 'expected');
});
```

Tests are minimal, focused on consolidation correctness, not full coverage.