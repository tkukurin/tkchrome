// Unified social media thread extractor for Twitter and Bluesky

const Social = {
  twitter: {
    match: () => location.hostname === 'twitter.com' || location.hostname === 'x.com',
    
    clickShowMore: (container = document) => {
      container.querySelectorAll('button').forEach(btn => {
        if (btn.textContent.trim().toLowerCase().includes('show more')) {
          console.log('click:', btn.textContent.trim());
          btn.click();
        }
      });
    },

    parse: (container) => {
      if (!container) return null;
      const article = container.querySelector('[data-testid="tweet"]');
      if (!article) return null;

      const username = article.querySelector('[data-testid="User-Name"] span')?.textContent || 'Unknown User';
      const handle = article.querySelector('[data-testid="User-Name"] a')?.href.split('/').pop() || 'unknown_handle';
      const time = article.querySelector('time')?.textContent || 'Unknown Time';

      const tweets = article.querySelector('[data-testid="tweetText"]');
      const texts = tweets.querySelectorAll('span:not(a>span),a');
      const text = Array.from(texts).map(t => 
        t.nodeName == "A" ? `[${t.innerText.trim()}](${t.href})` : t.innerText.trim()
      ).join(' ');

      const imgElements = article.querySelectorAll('[data-testid="tweetPhoto"] img');
      const imgSrcs = Array.from(imgElements).map(img => `![](${img.src})`).join('\n');

      const videoElement = article.querySelector('[data-testid="videoPlayer"] video');
      const videoSrc = videoElement ? `Video: [Watch Video](${videoElement.src})` : '';

      const gifElement = article.querySelector('[data-testid="tweetGif"] img');
      const gifSrc = gifElement ? `GIF: ![](${gifElement.src})` : '';

      const out = `@${handle} (${username}) @ ${time}\n${text}\n\n${imgSrcs}\n${videoSrc}\n${gifSrc}`;
      return {
        username, handle,
        text: out.trim(),
        time: new Date((time || {}).dateTime).getTime(),
      };
    },

    getSelector: () => 'main div[aria-label="Timeline: Conversation"] > div > div',
  },

  bsky: {
    match: () => location.hostname === 'bsky.app',

    parse: (container) => {
      const text = container.textContent.trim();
      return text ? {text, time: Date.now()} : null;
    },

    getSelector: () => 'div[data-testid^="postThreadItem-"]',
  },

  getCurrentSite: () => {
    if (Social.twitter.match()) return Social.twitter;
    if (Social.bsky.match()) return Social.bsky;
    return null;
  },
};

class Thread {
  content = [];

  addFrom(nodes) {
    const site = Social.getCurrentSite();
    if (!site) return;
    
    if (site.clickShowMore) {
      for (let node of nodes) site.clickShowMore(node);
    }
    
    Array.from(nodes)
      .filter(x => x)
      .map(site.parse)
      .filter(t => t && t.text)
      .forEach(obj => this.#add(obj));
    this.content = this.content.sort(c => c.time);
  }

  #add(obj) {
    if (this.content.length > 99) return;
    if (this.content.find(o => o.text == obj.text)) return;
    this.content.push(obj);
  }

  format() {
    const site = Social.getCurrentSite();
    if (!site) return 'No content';
    
    const url = document.location.href;
    const tweets = this.content.map(c => c.text).join('\n\n---\n\n');
    
    if (site === Social.twitter) {
      const user = this.content[0]?.username || this.content[0]?.handle || 'User';
      return `# [Tweet from ${user}](${url})\n\n${tweets}`;
    }
    return tweets;
  }
}

(function() {
  const site = Social.getCurrentSite();
  if (!site) return;

  function initThreadReader(thread) {
    if (window.thread) return;
    window.thread = thread;
    Util.toast('Thread read init.');

    let obsNewNodes = new MutationObserver(muts =>
      Array.from(muts).map(m => m.addedNodes).forEach(ns => thread.addFrom(ns)));

    let curHref = document.location.href;
    Util.observe((_, self) => {
      if (curHref != document.location.href) {
        console.log('Changed href. Disconnect observer.');
        window.thread = undefined;
        obsNewNodes.disconnect();
        self.disconnect();
      }
    });

    Q.el('main').then(el => obsNewNodes.observe(el, {childList:true, subtree: true}));
    thread.addFrom(Q.all(site.getSelector()));
  }

  document.onkeyup = Shortcut.init({
    a: [
      Shortcut.fun('t', () => initThreadReader(new Thread())),
      Shortcut.fun('c', () => {
        try {
          if (!window.thread) throw 'Forgot thread init?';
          const formatted = window.thread.format();
          navigator.clipboard.writeText(formatted);
          Util.toast('Copied');
        } catch(e) {
          Util.toast(`Error: "${e}"`);
          console.error('(tk)', e);
        }
      })
    ],
  });
})();
