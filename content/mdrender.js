function renderMarkdown() {
  const rawText = document.body.textContent; 
  document.body.innerHTML = '';
  
  const themes = {
      "GitHub Light": "https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown-light.min.css",
      "LaTeX (Academic)": "https://latex.vercel.app/style.min.css",
      "Water.css (Auto)": "https://cdn.jsdelivr.net/npm/water.css@2/out/water.css",
      "Marx (Clean Sans)": "https://unpkg.com/marx-css/css/marx.min.css",
      "GitHub Dark": "https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown-dark.min.css",
  };

  // 1. Setup Styles
  const link = document.createElement('link');
  link.id = 'tk-theme-css';
  link.rel = 'stylesheet';
  link.href = themes["GitHub Light"]; 
  document.head.appendChild(link);

  const hljsLink = document.createElement('link');
  hljsLink.rel = 'stylesheet';
  hljsLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
  document.head.appendChild(hljsLink);

  const katexCss = document.createElement('link');
  katexCss.rel = 'stylesheet';
  katexCss.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
  document.head.appendChild(katexCss);

  const style = document.createElement('style');
  style.textContent = `
      body { margin: 0; background: transparent; }
      .markdown-body { box-sizing: border-box; min-width: 200px; max-width: 850px; margin: 0 auto; padding: 40px; }
      #tk-md-header { 
          position: fixed; left: 0; top: 0; width: 100vw; box-sizing: border-box;
          background: #eef1f5; border-bottom: 1px solid #ccc; 
          padding: 8px 20px; z-index: 99999; display: flex; justify-content: flex-end; gap: 10px; 
          font-family: sans-serif; font-size: 13px;
      }
      #tk-md-header button, #tk-md-header select { cursor: pointer; padding: 4px 8px; border-radius: 4px; border: 1px solid #aaa; background: #fff; color: #333; }
      #tk-md-header button.active { background: #d1e7dd; border-color: #a3cfbb; }
      #tk-md-header button:hover { background: #e0e0e0; }
      .markdown-body, #tk-md-raw { padding-top: 60px !important; }
  `;
  document.head.appendChild(style);

  // 2. Setup Header & Controls
  const header = document.createElement('div');
  header.id = "tk-md-header";

  const themeSelect = document.createElement('select');
  for (const name in themes) {
      const opt = document.createElement('option');
      opt.value = themes[name];
      opt.innerText = name;
      themeSelect.appendChild(opt);
  }
  themeSelect.onchange = (e) => {
      document.getElementById('tk-theme-css').href = e.target.value;
      container.className = e.target.value.includes("github-markdown") ? 'markdown-body' : '';
  };

  const copyBtn = document.createElement('button');
  copyBtn.innerText = "Copy Raw MD";
  copyBtn.onclick = () => {
      navigator.clipboard.writeText(rawText).then(() => {
          copyBtn.innerText = "Copied!";
          setTimeout(() => copyBtn.innerText = "Copy Raw MD", 2000);
      });
  };

  const bellBtn = document.createElement('button');
  bellBtn.innerText = "Bells: ON";
  bellBtn.classList.add('active');

  const toggleBtn = document.createElement('button');
  toggleBtn.innerText = "View Raw";
  
  header.append(themeSelect, bellBtn, copyBtn, toggleBtn);
  document.body.appendChild(header);

  // 3. Render Engine
  const container = document.createElement('div');
  container.className = 'markdown-body';
  document.body.appendChild(container);

  function doRender(useBells) {
      if (useBells) {
          if (typeof katex !== 'undefined') globalThis.katex = katex;
          if (typeof markedKatex !== 'undefined') marked.use(markedKatex({ throwOnError: false }));
      } else {
          // Effectively disable extensions
          if (marked.defaults) marked.defaults.extensions = null;
      }

      try {
          container.innerHTML = marked.parse(rawText);
          if (useBells && typeof hljs !== 'undefined') { hljs.highlightAll(); }
      } catch (e) {
          console.error("[tk] Render crash, falling back...", e);
          if (marked.defaults) marked.defaults.extensions = null;
          container.innerHTML = marked.parse(rawText);
      }
  }

  // Initial Run
  doRender(true);

  // 4. Toggle Logic
  let isRendered = true;
  let bellsOn = true;

  bellBtn.onclick = () => {
      bellsOn = !bellsOn;
      bellBtn.innerText = bellsOn ? "Bells: ON" : "Bells: OFF";
      bellBtn.classList.toggle('active');
      if (isRendered) doRender(bellsOn);
  };

  toggleBtn.onclick = () => {
      isRendered = !isRendered;
      const rawContainer = document.getElementById('tk-md-raw') || createRaw();
      container.style.display = isRendered ? 'block' : 'none';
      rawContainer.style.display = isRendered ? 'none' : 'block';
      toggleBtn.innerText = isRendered ? "View Raw" : "View Rendered";
      themeSelect.style.display = isRendered ? 'block' : 'none';
      bellBtn.style.display = isRendered ? 'block' : 'none';
  };

  function createRaw() {
      const pre = document.createElement('pre');
      pre.id = "tk-md-raw";
      pre.style.cssText = "display: none; max-width: 850px; margin: 0 auto; padding: 40px; white-space: pre-wrap; word-wrap: break-word; font-family: monospace;";
      pre.textContent = rawText;
      document.body.appendChild(pre);
      return pre;
  }
}

let wl = window.location;
if (wl.pathname.endsWith('.md') || wl.host === 'defuddle.md') {
  renderMarkdown();
}
