// General heuristic document extractor with scoring
// Runs multiple strategies and picks the best result

// ============================================================================
// SCORING FUNCTIONS - Edit these to tune extraction quality
// ============================================================================

const Score = {
  // Base score penalties
  EMPTY_PENALTY: -1000,
  SHORT_TEXT_PENALTY: -50,  // Text under MIN_TEXT_LENGTH
  MIN_TEXT_LENGTH: 50,

  // Weights for different quality signals
  weights: {
    textLength: 0.3,
    structuredContent: 0.4,
    metadataPresence: 0.2,
    linkQuality: 0.1,
  },

  // Calculate overall score for an extraction result
  calculate: (result) => {
    if (!result) return Score.EMPTY_PENALTY;
    if (!result.text || result.text.trim().length === 0) return Score.EMPTY_PENALTY;

    let score = 0;
    score += Score.textScore(result);
    score += Score.structureScore(result);
    score += Score.metadataScore(result);
    score += Score.linkScore(result);
    return score;
  },

  // Score based on text length and quality
  textScore: (result) => {
    const text = result.text || '';
    const len = text.trim().length;
    if (len < Score.MIN_TEXT_LENGTH) return Score.SHORT_TEXT_PENALTY;
    // Logarithmic scaling to avoid huge scores for very long text
    return Math.log10(len + 1) * 20 * Score.weights.textLength;
  },

  // Score based on structured content (headings, lists, etc)
  structureScore: (result) => {
    const text = result.text || '';
    let score = 0;
    // Markdown headings
    const headings = (text.match(/^#{1,6}\s/gm) || []).length;
    score += Math.min(headings * 5, 25);
    // Lists
    const lists = (text.match(/^[\-\*]\s/gm) || []).length;
    score += Math.min(lists * 2, 20);
    // Paragraphs (double newlines)
    const paragraphs = (text.match(/\n\n/g) || []).length;
    score += Math.min(paragraphs * 3, 30);
    return score * Score.weights.structuredContent;
  },

  // Score based on metadata presence
  metadataScore: (result) => {
    let score = 0;
    if (result.title) score += 20;
    if (result.author) score += 15;
    if (result.time || result.date) score += 10;
    if (result.url) score += 5;
    if (result.siteName) score += 5;
    return score * Score.weights.metadataPresence;
  },

  // Score based on link quality (not broken, markdown formatted)
  linkScore: (result) => {
    const text = result.text || '';
    const mdLinks = (text.match(/\[.+?\]\(.+?\)/g) || []).length;
    return Math.min(mdLinks * 3, 30) * Score.weights.linkQuality;
  },
};


// ============================================================================
// HEURISTIC EXTRACTION FUNCTIONS - Add new strategies here
// ============================================================================

const Heuristics = {
  // Extract using article tag (common for blogs, news)
  article: () => {
    const article = Q.one('article') || Q.one('[role="article"]');
    if (!article) return null;

    const title = Q.one('h1', article)?.textContent?.trim() ||
                  Q.one('h1')?.textContent?.trim() ||
                  document.title;
    const content = Heuristics._extractContent(article);
    const time = Heuristics._extractTime(article);

    return {
      text: `# ${title}\n\n${content}`,
      title,
      time,
      strategy: 'article',
    };
  },

  // Extract main content area
  main: () => {
    const main = Q.one('main') || Q.one('[role="main"]');
    if (!main) return null;

    const title = document.title;
    const content = Heuristics._extractContent(main);

    return {
      text: `# ${title}\n\n${content}`,
      title,
      strategy: 'main',
    };
  },

  // Extract based on content density (most text-heavy container)
  density: () => {
    const candidates = Q.all('div, section, article').filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 300 && rect.height > 200;
    });

    let best = null;
    let bestRatio = 0;

    for (const el of candidates) {
      const text = el.textContent?.trim() || '';
      const html = el.innerHTML?.length || 1;
      const ratio = text.length / html; // Higher = more text, less markup

      if (text.length > 200 && ratio > bestRatio) {
        bestRatio = ratio;
        best = el;
      }
    }

    if (!best) return null;

    return {
      text: `# ${document.title}\n\n${Heuristics._extractContent(best)}`,
      title: document.title,
      strategy: 'density',
    };
  },

  // Extract using common content class names
  contentClasses: () => {
    const selectors = [
      '.post-content', '.entry-content', '.article-content',
      '.content', '.post-body', '.article-body',
      '[itemprop="articleBody"]', '.story-body',
      '.blog-post', '.post', '.entry',
    ];

    for (const sel of selectors) {
      const el = Q.one(sel);
      if (el && el.textContent?.trim().length > 100) {
        return {
          text: `# ${document.title}\n\n${Heuristics._extractContent(el)}`,
          title: document.title,
          strategy: 'contentClasses',
        };
      }
    }
    return null;
  },

  // Extract OpenGraph / meta data enhanced content
  metaEnhanced: () => {
    const og = (prop) => Q.one(`meta[property="og:${prop}"]`)?.content;
    const meta = (name) => Q.one(`meta[name="${name}"]`)?.content;

    const title = og('title') || meta('title') || document.title;
    const description = og('description') || meta('description');
    const author = meta('author') || Q.one('[rel="author"]')?.textContent;
    const siteName = og('site_name');

    // Try to find main content
    const article = Q.one('article') || Q.one('main') || Q.one('.content');
    const content = article ? Heuristics._extractContent(article) : description || '';

    if (!content || content.length < 50) return null;

    let text = `# ${title}\n\n`;
    if (author) text += `*By ${author}*\n\n`;
    text += content;

    return {
      text,
      title,
      author,
      siteName,
      description,
      strategy: 'metaEnhanced',
    };
  },

  // Readability-style extraction (simplified)
  readable: () => {
    // Remove unwanted elements
    const unwanted = [
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '.sidebar', '.advertisement', '.ads', '.comments', '.related',
      '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
    ];

    // Clone body to avoid modifying actual DOM
    const clone = document.body.cloneNode(true);
    unwanted.forEach(sel =>
      clone.querySelectorAll(sel).forEach(el => el.remove())
    );

    const text = Heuristics._cleanText(clone.textContent);
    if (text.length < 100) return null;

    return {
      text: `# ${document.title}\n\n${text}`,
      title: document.title,
      strategy: 'readable',
    };
  },

  // ---- Helper functions ----

  _extractContent: (el) => {
    if (!el) return '';

    const blocks = [];
    const walk = (node, depth = 0) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) blocks.push(text);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();

      // Skip unwanted elements
      if (['script', 'style', 'nav', 'aside'].includes(tag)) return;

      // Handle special elements
      if (tag === 'a' && node.href) {
        blocks.push(`[${node.textContent.trim()}](${node.href})`);
        return;
      }
      if (tag === 'img' && node.src) {
        const alt = node.alt || 'image';
        blocks.push(`![${alt}](${node.src})`);
        return;
      }
      if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {
        const level = '#'.repeat(parseInt(tag[1]));
        blocks.push(`\n${level} ${node.textContent.trim()}\n`);
        return;
      }
      if (tag === 'li') {
        blocks.push(`- ${node.textContent.trim()}`);
        return;
      }
      if (tag === 'blockquote') {
        blocks.push(`> ${node.textContent.trim()}`);
        return;
      }
      if (tag === 'code' || tag === 'pre') {
        blocks.push(`\`${node.textContent.trim()}\``);
        return;
      }
      if (['p', 'div', 'section'].includes(tag)) {
        node.childNodes.forEach(child => walk(child, depth + 1));
        blocks.push('\n');
        return;
      }

      node.childNodes.forEach(child => walk(child, depth + 1));
    };

    walk(el);
    return Heuristics._cleanText(blocks.join(' '));
  },

  _extractTime: (el) => {
    const time = Q.one('time', el) || Q.one('[datetime]', el);
    if (time) {
      const dt = time.getAttribute('datetime') || time.textContent;
      return new Date(dt).getTime() || Date.now();
    }
    return Date.now();
  },

  _cleanText: (text) => {
    return text
      .replace(/\s+/g, ' ')           // Collapse whitespace
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Max 2 newlines
      .replace(/^\s+|\s+$/g, '')       // Trim
      .replace(/ +/g, ' ');            // Single spaces
  },
};


// ============================================================================
// DOMAIN-SPECIFIC EXTRACTORS - Higher priority than heuristics
// ============================================================================

const DomainExtractors = {
  // Use existing Social extractors for Twitter/Bluesky
  // These are more accurate than heuristics for their domains

  match: () => {
    const host = location.hostname;

    // Known domains with specific extractors (external handlers)
    if (host === 'twitter.com' || host === 'x.com') return 'twitter';
    if (host === 'bsky.app' || host.endsWith('.bsky.social')) return 'bluesky';

    // Domains with extractors in this file
    if (host.includes('medium.com')) return 'medium';
    if (host.includes('substack.com')) return 'substack';
    if (host.includes('github.com')) return 'github';
    if (host.includes('reddit.com')) return 'reddit';
    if (host === 'news.ycombinator.com') return 'hackernews';
    if (host.includes('wikipedia.org')) return 'wikipedia';
    if (host.includes('stackoverflow.com') || host.includes('stackexchange.com')) return 'stackoverflow';
    if (host.includes('arxiv.org')) return 'arxiv';
    if (host.includes('dev.to')) return 'devto';

    return null;
  },

  // Medium-specific extractor
  medium: () => {
    const article = Q.one('article');
    if (!article) return null;

    const title = Q.one('h1', article)?.textContent?.trim() || document.title;
    const author = Q.one('[data-testid="authorName"]')?.textContent ||
                   Q.one('a[rel="author"]')?.textContent;
    const content = Heuristics._extractContent(article);

    return {
      text: `# ${title}\n\n*By ${author || 'Unknown'}*\n\n${content}`,
      title,
      author,
      siteName: 'Medium',
      strategy: 'medium',
    };
  },

  // Substack-specific extractor
  substack: () => {
    const post = Q.one('.post') || Q.one('article');
    if (!post) return null;

    const title = Q.one('h1.post-title')?.textContent?.trim() ||
                  Q.one('h1')?.textContent?.trim() || document.title;
    const author = Q.one('.author-name')?.textContent ||
                   Q.one('[rel="author"]')?.textContent;
    const content = Heuristics._extractContent(Q.one('.body') || post);

    return {
      text: `# ${title}\n\n*By ${author || 'Unknown'}*\n\n${content}`,
      title,
      author,
      siteName: 'Substack',
      strategy: 'substack',
    };
  },

  // GitHub README/issues/PR extractor
  github: () => {
    // README
    const readme = Q.one('#readme article') || Q.one('.markdown-body');
    if (readme) {
      return {
        text: `# ${document.title}\n\n${Heuristics._extractContent(readme)}`,
        title: document.title,
        siteName: 'GitHub',
        strategy: 'github',
      };
    }

    // Issue/PR
    const issueTitle = Q.one('.js-issue-title')?.textContent?.trim();
    const issueBody = Q.one('.comment-body');
    if (issueTitle && issueBody) {
      return {
        text: `# ${issueTitle}\n\n${Heuristics._extractContent(issueBody)}`,
        title: issueTitle,
        siteName: 'GitHub',
        strategy: 'github',
      };
    }

    return null;
  },

  // Reddit thread extractor
  reddit: () => {
    const title = Q.one('h1')?.textContent?.trim() || document.title;
    const post = Q.one('[data-test-id="post-content"]') ||
                 Q.one('.usertext-body');
    const content = post ? Heuristics._extractContent(post) : '';

    // Collect comments
    const comments = Q.all('.comment .usertext-body, [data-testid="comment"]')
      .slice(0, 20)
      .map(c => c.textContent?.trim())
      .filter(Boolean)
      .join('\n\n---\n\n');

    return {
      text: `# ${title}\n\n${content}\n\n## Comments\n\n${comments}`,
      title,
      siteName: 'Reddit',
      strategy: 'reddit',
    };
  },

  // Hacker News extractor
  hackernews: () => {
    const title = Q.one('.titleline a')?.textContent?.trim() || document.title;
    const url = Q.one('.titleline a')?.href;

    const comments = Q.all('.commtext')
      .slice(0, 30)
      .map(c => c.textContent?.trim())
      .filter(Boolean)
      .join('\n\n---\n\n');

    let text = `# ${title}\n\n`;
    if (url) text += `[Original Article](${url})\n\n`;
    text += `## Comments\n\n${comments}`;

    return {
      text,
      title,
      url,
      siteName: 'Hacker News',
      strategy: 'hackernews',
    };
  },

  // Wikipedia extractor
  wikipedia: () => {
    const title = Q.one('#firstHeading')?.textContent?.trim() || document.title;
    const content = Q.one('#mw-content-text .mw-parser-output');
    if (!content) return null;

    // Remove unwanted sections
    const clone = content.cloneNode(true);
    clone.querySelectorAll('.infobox, .navbox, .toc, .mw-editsection, .reference')
      .forEach(el => el.remove());

    return {
      text: `# ${title}\n\n${Heuristics._extractContent(clone)}`,
      title,
      siteName: 'Wikipedia',
      strategy: 'wikipedia',
    };
  },

  // Stack Overflow / Stack Exchange extractor
  stackoverflow: () => {
    const title = Q.one('#question-header h1')?.textContent?.trim() ||
                  Q.one('h1')?.textContent?.trim() || document.title;
    const question = Q.one('.question .js-post-body, .question .postcell');
    const questionText = question ? Heuristics._extractContent(question) : '';

    // Get accepted or top answer
    const accepted = Q.one('.accepted-answer .js-post-body');
    const topAnswer = Q.one('.answer .js-post-body');
    const answerEl = accepted || topAnswer;
    const answerText = answerEl ? Heuristics._extractContent(answerEl) : '';

    let text = `# ${title}\n\n## Question\n\n${questionText}`;
    if (answerText) text += `\n\n## Answer\n\n${answerText}`;

    return {
      text,
      title,
      siteName: 'Stack Overflow',
      strategy: 'stackoverflow',
    };
  },

  // arXiv paper extractor
  arxiv: () => {
    const title = Q.one('.title')?.textContent?.replace('Title:', '')?.trim() ||
                  document.title;
    const authors = Q.one('.authors')?.textContent?.replace('Authors:', '')?.trim();
    const abstract = Q.one('.abstract')?.textContent?.replace('Abstract:', '')?.trim();

    // Try to get PDF link
    const pdfLink = Q.one('a[href*="/pdf/"]')?.href;

    let text = `# ${title}\n\n`;
    if (authors) text += `*${authors}*\n\n`;
    if (abstract) text += `## Abstract\n\n${abstract}\n\n`;
    if (pdfLink) text += `[PDF](${pdfLink})`;

    return {
      text,
      title,
      author: authors,
      siteName: 'arXiv',
      strategy: 'arxiv',
    };
  },

  // dev.to extractor
  devto: () => {
    const title = Q.one('h1')?.textContent?.trim() || document.title;
    const author = Q.one('.crayons-article__subheader a')?.textContent?.trim() ||
                   Q.one('[rel="author"]')?.textContent?.trim();
    const article = Q.one('#article-body') || Q.one('.crayons-article__main');
    const content = article ? Heuristics._extractContent(article) : '';

    let text = `# ${title}\n\n`;
    if (author) text += `*By ${author}*\n\n`;
    text += content;

    return {
      text,
      title,
      author,
      siteName: 'DEV Community',
      strategy: 'devto',
    };
  },
};


// ============================================================================
// MAIN EXTRACTOR - Orchestrates all strategies
// ============================================================================

const Extractor = {
  // Run all extractors and return best result
  extract: () => {
    const results = [];

    // Check for domain-specific extractor first
    const domain = DomainExtractors.match();
    if (domain && DomainExtractors[domain]) {
      const result = F.bestEffort(DomainExtractors[domain])();
      if (result) {
        result.score = Score.calculate(result) + 100; // Domain bonus
        results.push(result);
      }
    }

    // Run all heuristic extractors
    for (const [name, fn] of Object.entries(Heuristics)) {
      if (name.startsWith('_')) continue; // Skip helpers
      const result = F.bestEffort(fn)();
      if (result) {
        result.score = Score.calculate(result);
        results.push(result);
      }
    }

    // Sort by score and return best
    results.sort((a, b) => b.score - a.score);

    console.log('[extractor] Results:', results.map(r =>
      `${r.strategy}: ${r.score.toFixed(1)}`
    ));

    return results[0] || { text: '', score: Score.EMPTY_PENALTY, strategy: 'none' };
  },

  // Get all results for debugging/comparison
  extractAll: () => {
    const results = [];

    const domain = DomainExtractors.match();
    if (domain && DomainExtractors[domain]) {
      const result = F.bestEffort(DomainExtractors[domain])();
      if (result) {
        result.score = Score.calculate(result) + 100;
        results.push(result);
      }
    }

    for (const [name, fn] of Object.entries(Heuristics)) {
      if (name.startsWith('_')) continue;
      const result = F.bestEffort(fn)();
      if (result) {
        result.score = Score.calculate(result);
        results.push(result);
      }
    }

    return results.sort((a, b) => b.score - a.score);
  },

  // Format result for clipboard
  format: (result) => {
    if (!result || !result.text) return 'No content extracted';

    const url = location.href;
    const meta = [];
    if (result.siteName) meta.push(result.siteName);
    if (result.author) meta.push(`by ${result.author}`);

    let out = result.text;
    if (meta.length) out = `*${meta.join(' - ')}*\n\n${out}`;
    out += `\n\n---\nSource: ${url}`;

    return out;
  },
};


// ============================================================================
// KEYBOARD SHORTCUT INTEGRATION
// ============================================================================

(function() {
  // Domains with their own extractors - don't override their shortcuts
  const skipDomains = [
    'twitter.com', 'x.com',
    'bsky.app', 'bsky.social',
    'youtube.com',
  ];
  const host = location.hostname;
  if (skipDomains.some(d => host === d || host.endsWith('.' + d))) return;

  document.onkeyup = Shortcut.init({
    a: [
      Shortcut.fun('e', () => {
        try {
          const result = Extractor.extract();
          const formatted = Extractor.format(result);
          navigator.clipboard.writeText(formatted);
          Util.toast(`Extracted (${result.strategy}: ${result.score.toFixed(0)})`);
        } catch(e) {
          Util.toast(`Error: "${e}"`);
          console.error('(tk extractor)', e);
        }
      }),
      Shortcut.fun('d', () => {
        // Debug: show all extraction results
        const results = Extractor.extractAll();
        console.log('[extractor] All results:', results);
        Util.toast(`${results.length} strategies. Check console.`);
      }),
    ],
  });
})();


// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Extractor, Heuristics, DomainExtractors, Score };
}
