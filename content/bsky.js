// Clean text - remove bidi control characters and normalize whitespace
const cleanText = (text) => (text || '')
  // Remove bidi control chars: LRE, RLE, PDF, LRO, RLO, LRI, RLI, FSI, PDI
  .replace(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// Parse a single bsky post element
const parseBskyPost = (el) => {
  // Display name - first link to profile with actual name text
  const nameEl = el.querySelector('a[href^="/profile/"][aria-label]');
  const displayName = nameEl?.getAttribute('aria-label')?.replace("'s avatar", '') ||
                      nameEl?.textContent?.trim() || '';

  // Handle - from data-testid="postThreadItem-by-HANDLE"
  const testId = el.getAttribute('data-testid') || '';
  const handle = testId.replace('postThreadItem-by-', '@');

  // Post text - the actual content div
  const textEl = el.querySelector('div[data-word-wrap="1"]');
  const text = cleanText(textEl?.textContent);

  if (!text) return null;

  const header = displayName && handle ? `${displayName} (${handle})` :
                 displayName || handle || '';
  return header ? `${header}\n${text}` : text;
};

(function() {

  document.onkeyup = Shortcut.init({
    a: [
      Shortcut.fun('c', () => {
        try {
          const els = document.querySelectorAll('div[data-testid^="postThreadItem-"]');
          const posts = [...els]
            .map(parseBskyPost)
            .filter(Boolean);
          const url = document.location.href;
          const firstUser = posts[0]?.split('\n')[0] || 'Bluesky';
          const joined = posts.join('\n\n---\n\n');
          const out = `# [Thread from ${firstUser}](${url})\n\n${joined}`;
          navigator.clipboard.writeText(out);
          Util.toast(`Copied ${posts.length} posts`);
        } catch(e) {
          Util.toast(`Error: ${e}`);
          console.error('(tk)', e);
        }
      }),
    ],
  });
})();
