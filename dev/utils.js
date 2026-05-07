function isVis(el) {
  if (!el) return false;

  const style = window.getComputedStyle(el);

  const isDisplayed = style.display !== 'none';
  const isVisible = style.visibility !== 'hidden' && style.visibility !== 'collapse';
  const isOpaque = parseFloat(style.opacity) !== 0;
  const hasSize = el.offsetWidth > 0 && el.offsetHeight > 0;

  const rect = el.getBoundingClientRect();
  const inViewport = (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.left <= (window.innerWidth || document.documentElement.clientWidth)
  );

  return isDisplayed && isVisible && isOpaque && hasSize && inViewport;
}

let vids = document.querySelectorAll('video');
let v0 = null;
for (let v of vids) {
  if (isVis(v)) {
    v0 = v; break;
  }
}
v0.playbackRate=10
let i0 = setInterval(() => {
  v0.playbackRate=10
}, 100)