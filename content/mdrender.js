function renderMarkdown() {
  const rawText = document.body.textContent; 
  document.body.innerHTML = '';
  const themes = {
      "GitHub Light": "https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown-light.min.css",
      "LaTeX (Academic)": "https://latex.vercel.app/style.min.css",
      "Water.css (Auto)": "https://cdn.jsdelivr.net/npm/water.css@2/out/water.css",
      "Marx (Clean Sans)": "https://unpkg.com/marx-css/css/marx.min.css"
      "GitHub Dark": "https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown-dark.min.css",
  };

  // 1. Setup Styles
  const link = document.createElement('link');
  link.id = 'tk-theme-css';
  link.rel = 'stylesheet';
  link.href = themes["GitHub Light"]; // Default theme
  document.head.appendChild(link);

  const style = document.createElement('style');
  style.textContent = `
      body { margin: 0; background: transparent; }
      .markdown-body { box-sizing: border-box; min-width: 200px; max-width: 850px; margin: 0 auto; padding: 40px; }
      /* Give header a neutral look so it works with light and dark mode */
      #tk-md-header { 
          position: sticky; top: 0; background: #eef1f5; border-bottom: 1px solid #ccc; 
          padding: 8px 20px; z-index: 100; display: flex; justify-content: flex-end; gap: 10px; 
          font-family: sans-serif; font-size: 13px;
      }
      #tk-md-header button, #tk-md-header select { cursor: pointer; padding: 4px 8px; border-radius: 4px; border: 1px solid #aaa; background: #fff; color: #333; }
      #tk-md-header button:hover { background: #e0e0e0; }
  `;
  document.head.appendChild(style);

  // 2. Setup Header & Controls
  const header = document.createElement('div');
  header.id = "tk-md-header";

  // -- Theme Selector
  const themeSelect = document.createElement('select');
  for (const name in themes) {
      const opt = document.createElement('option');
      opt.value = themes[name];
      opt.innerText = name;
      themeSelect.appendChild(opt);
  }
  themeSelect.onchange = (e) => {
      document.getElementById('tk-theme-css').href = e.target.value;
      // Water.css doesn't use the .markdown-body class, so we toggle it
      if (e.target.value.includes("water.css")) {
          container.classList.remove('markdown-body');
      } else {
          container.classList.add('markdown-body');
      }
  };

  // -- Copy Button
  const copyBtn = document.createElement('button');
  copyBtn.innerText = "Copy Raw MD";
  copyBtn.onclick = () => {
      navigator.clipboard.writeText(rawText).then(() => {
          copyBtn.innerText = "✅ Copied!";
          setTimeout(() => copyBtn.innerText = "Copy Raw MD", 2000);
      });
  };

  // -- View Toggle Button
  const toggleBtn = document.createElement('button');
  toggleBtn.innerText = "View Raw";
  
  header.appendChild(themeSelect);
  header.appendChild(copyBtn);
  header.appendChild(toggleBtn);
  document.body.appendChild(header);

  // 3. Setup Rendered Container
  const container = document.createElement('div');
  container.classList.add('markdown-body');
  container.innerHTML = marked.parse(rawText);
  document.body.appendChild(container);

  // 4. Setup Raw Container (Hidden by default)
  const rawContainer = document.createElement('pre');
  rawContainer.style.cssText = "display: none; max-width: 850px; margin: 0 auto; padding: 40px; white-space: pre-wrap; word-wrap: break-word; font-family: monospace; color: #333;";
  rawContainer.textContent = rawText;
  document.body.appendChild(rawContainer);

  // 5. Toggle Logic
  let isRendered = true;
  toggleBtn.onclick = () => {
      isRendered = !isRendered;
      container.style.display = isRendered ? 'block' : 'none';
      rawContainer.style.display = isRendered ? 'none' : 'block';
      toggleBtn.innerText = isRendered ? "View Raw" : "View Rendered";
      // Hide theme selector when viewing raw
      themeSelect.style.display = isRendered ? 'block' : 'none';
  };
}

let wl = window.location;
console.log(`[tk] markdown: ${wl.href}`); 
if (wl.pathname.endsWith('.md') || wl.host === 'defuddle.md') {
  renderMarkdown();
}
