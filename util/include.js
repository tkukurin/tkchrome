/** Stuff that seems relatively generic. */
if (!window.__tkIncludeLoaded) {
window.__tkIncludeLoaded = true;

// Not the best idea but whatevs, monkey patching
NodeList.prototype.forEach = Array.prototype.forEach;
NodeList.prototype.flatMap = Array.prototype.flatMap;
NodeList.prototype.filter = Array.prototype.filter;
NodeList.prototype.map = Array.prototype.map;
NodeList.prototype.concat = function(other) {
  if (other instanceof NodeList) {
    other = Object.values(other);
  }
  return Object.values(this).concat(other);
}

HTMLCollection.prototype.forEach = Array.prototype.forEach;
HTMLCollection.prototype.flatMap = Array.prototype.flatMap;
HTMLCollection.prototype.filter = Array.prototype.filter;
HTMLCollection.prototype.map = Array.prototype.map;

Promise.try = function(fn, ...args) {
  return new Promise((ok, err) => {
    try { ok(fn(...args)); }
    catch(e) { err(e); }
  });
};


// Function wrappers
const F = {};
F.bestEffort = (fn, logOnException) => ((...a) => {
  try {
    return fn(...a);
  } catch(e) {
    logOnException && console.error(e);
  }
});
F.ret = val => fn => (...a) => {
  fn(...a);
  return val;
};
F.guard = x => (x && Promise.resolve(x)) || Promise.reject(`${x} not found`);
F.retSelf = fn => (a) => F.ret(a)(fn)(a);
F.retTrue = F.ret(true);
F.retFalse = F.ret(false);

// Query
const Q = {}
Q.el = (sel, el=document) => F.guard(el.querySelector(sel));
Q.doc = (sel) => Q.el(sel, document);
Q.one = (sel, el=document) => el.querySelector(sel);
Q.all = (sel, el=document) => el.querySelectorAll(sel);


/** Constant backoff retry. Throws after `maxRetries` failures. */
class Retry {
  #sleepMs = 100
  #maxRetries = 7
  static sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async call(fn) {
    for (let i = 0; i < this.#maxRetries; i++) {
      await Retry.sleep(this.#sleepMs);
      let result = fn();
      if (result) return result;
    }
    throw `Retry failed after ${this.maxRetries} at ${this.sleepMs}ms`;
  }
}


/** According to SO, there is no sorted container in JS :'( */
class SortedArray {
  INSERT_NEW = 0;
  INSERT_REPLACE = 1;

  constructor(data, key) { // data is sorted eg. (data=[{a:1}, {a:5}], key='a')
    this.data = data;
    this.key = key;
  }

  map(f) { return this.data.map(f); }

  insert(obj) { // insert *after*. [1,2] => (key=1->[1, *1*, 2])
    const where = this.getIndex(obj[this.key]);
    const rest = this.data.splice(where);
    this.data.push(obj, ...rest);
    return SortedArray.INSERT_NEW;
  }

  get(startKey, maybeEndKey) {
    const i0 = this.getIndex(startKey);
    let i1 = i0 + 1;
    if (maybeEndKey) {
      i1 = this.getIndex(maybeEndKey || startKey + 1);
    } else {
      // TODO do another binary search? depends on expected behavior
      while (this.data[i1] && this.data[i1][this.key] == this.data[i0][this.key]) {
        i1++;
      }
    }
    return this.data.slice(i0, i1);
  }

  getIndex(key, startIndex = 0) { // [1,1,5] => (key=4->2), (key=5->3)
    let start = startIndex;
    let end = this.data.length;
    while (start < end) {
      let mid = Math.floor(start + (end - start) / 2);
      let cur = this.data[mid];
      if (cur && cur[this.key] >= key) end = mid;
      else start = mid + 1;
    }
    return start;
  }
}

/** Same as sorted, except it makes sure keys are unique. */
class SortedUniqueArray extends SortedArray {
  insert(obj) {  // return true if new object inserted
    const key = obj[this.key];
    const i0 = this.getIndex(key);
    if (this.data[i0] && this.data[i0][this.key] == key) {
      this.data[i0] = obj;
      return SortedArray.INSERT_REPLACE;
    }
    const rest = this.data.splice(i0 + 1);
    this.data.push(obj, ...rest);
    return SortedArray.INSERT_NEW;
  }
}

const Util = {
  newEl: (type, propsOrString) => {
    const el = document.createElement(type);
    if (typeof(propsOrString) === 'string') {
      el.innerHTML = propsOrString;
    } else {
      for (let prop in propsOrString) {
        el[prop] = propsOrString[prop];
      }
    }
    return el;
  },
  isInput: el => (
    ['INPUT', 'TEXTAREA'].indexOf(el.tagName) >= 0 || el.contentEditable === 'true'),
  isVisible: el => {
    // + window.getComputedStyle(el).visibility !== 'hidden' maybe?
    // This getBoundingClientRect thing doesn't seem corect for all cases.
    const rect = el.getBoundingClientRect();
    const W = window.innerWidth || document.documentElement.clientWidth;
    const H = window.innerHeight || document.documentElement.clientHeight;
    const visible = rect.width && rect.height;
    const inBounds = 0 <= rect.x && rect.x <= W && 0 <= rect.y && rect.y <= H;
    return visible && inBounds;
  }
}


// cf. https://www.w3schools.com/howto/howto_js_snackbar.asp
// TODO(tk) could cache elements for speed, but I don't expect to use this a lot
Util.toast = text => {
  const toast = Util.newEl('div', {className: '__util_toast', innerHTML: text});
  document.body.prepend(toast);
  setTimeout(() => toast.remove(), 3000);
  return toast;
}

Util.sidebar = content => {
  const side = Util.newEl('div', {className: '__util_side'});
  side.appendChild(content);

  let _open = false;
  function _stoggle() {
    let width = _open ? 0 : '250px';
    let inner = _open ? '&larr;' : '&times;';
    Q.el('.__util_sbtn').then(el => el.innerHTML = inner);
    Q.el('.__util_side').then(el => el.style.width = width);
    document.body.style.marginLeft = width;
    _open = !_open;
  }

  document.body.prepend(Util.newEl('button',
    {className:'__util_sbtn', onclick: _stoggle, innerHTML: '&larr;'}));
  document.body.prepend(side);

  return side;
};

Util.observe = (f, el=document.body, opts={childList:true, subtree:true}) => {
  const observer = new MutationObserver(f);
  observer.observe(el, opts);
  return observer;
}

Util.mod = (x, len) => (x + len) % len;

const Shortcut = {
  sel: (k, sel, ...mods) => ({k:k, sel:sel, mods:mods}),
  fun: (k, fn, ...mods) => ({k:k, fn:fn, mods:mods}),
  // 'a'.charCodeAt() == 96, e.which == 65 for 'a'
  kcode: k => k.charCodeAt ? k.charCodeAt() - 32 : k,
};

Shortcut.init = shortcuts => Shortcut._init(
  Array.isArray(shortcuts) ? shortcuts : Object.entries(shortcuts).flatMap(
    str2shortObj => str2shortObj[1].map(Shortcut.norm(str2shortObj[0]))
    // Consider: sort by #modifiers and pick only one shortctut in init
    //.sort((x, y) => y.mods.length - x.mods.length)
))

Shortcut._init = shortcuts => e => shortcuts.forEach(shortcut => {
  if (shortcut.mods.every(mod => mod(e)) && e.which == shortcut.k) {
    // If s.fn returns true (was invoked), don't click anything
    (shortcut.fn && shortcut.fn(e)) || shortcut.sel.forEach(
      F.bestEffort(s => Q.one(s).click()));
    (e.stopPropagation && e.stopPropagation());
  }
});

Shortcut.norm = (...modKeys) => F.retSelf(shortcut => {
  shortcut.k = Shortcut.kcode(shortcut.k);
  if (shortcut.fn) shortcut.fn = F.retTrue(shortcut.fn);
  if (!Array.isArray(shortcut.sel)) shortcut.sel = [shortcut.sel];
  shortcut.mods = (shortcut.mods||[]).concat(modKeys).map(m => ({
    s:e => e.ShiftKey, a: e => e.altKey, c: e => e.ctrlKey, m: e => e.metaKey,
  })[m])
});

Util.matchByText = (patterns, containers) => {
  let matched = []
  containers.forEach(container => {
    const textContent = container.textContent || "";
    for (const pattern of patterns) {
      if (pattern.test(textContent)) {
        matched.push(container)
        break;
      }
    }
  });
  return matched;
}

Util.inputBox = (maybeActionFn, maybeDelimiter=";") => {
  /* If maybeActionFn provided, it'll run it on key=enter.
  e.g.
  let f = (e) => {
    const conts = document.querySelectorAll('.containerICareAbout);
    const matched = Util.matchByText(pats, conts);
    for (const m of matched) {
      document.body.removeChild(m);
    }
    return "close";
  }
  const box = Util.inputBox(f);
  */
  const inputBox = document.createElement("input");
  inputBox.type = "text";
  inputBox.style.position = "fixed";
  inputBox.style.top = "50%";
  inputBox.style.left = "50%";
  inputBox.style.transform = "translate(-50%, -50%)";
  inputBox.style.zIndex = 10000;
  inputBox.style.padding = "10px";
  inputBox.style.border = "1px solid #007bff";
  inputBox.style.borderRadius = "5px";
  inputBox.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0.1)";
  inputBox.style.fontSize = "16px";
  inputBox.style.width = "300px";
  inputBox.style.textAlign = "center";
  inputBox.value = "";

  document.body.appendChild(inputBox);
  inputBox.focus();

  if (maybeActionFn) {
    inputBox.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const data = inputBox.value.trim()
        const delimited = data.split(maybeDelimiter)
        const ret = maybeActionFn(data, delimited, e);
        if (["close", "done", null, undefined].includes(ret)) {
          document.body.removeChild(inputBox);
        } else {
          console.debug(`[tk] ${ret}: keeping window open`);
        }
      } else if (e.key === "Escape") {
        document.body.removeChild(inputBox);
      }
    })
  }

  return inputBox;
}

// TODO dumb hack for node tests. investigate better.
if (window.__test) {
  module.exports = {
    SortedArray,
    SortedUniqueArray
  };
}

// Export to window so other content scripts can access them
window.F = F;
window.Q = Q;
window.Util = Util;
window.Shortcut = Shortcut;
window.Retry = Retry;
window.SortedArray = SortedArray;
window.SortedUniqueArray = SortedUniqueArray;

} // end include guard
