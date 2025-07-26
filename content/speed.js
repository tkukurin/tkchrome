// ==UserScript==
// @name         LightSpeed Video
// @namespace    tkukurin
// @version      v0.5.9 (01-2020)
// @description  Faster/lightweight video speed controller based on
//               https://github.com/igrigorik/videospeed
// @author       tkukurin
// @match        https://www.youtube.com/*
// @match        https://vimeo.com/*
// @match        https://www.twitch.tv/videos/*
// @match        https://twitter.com/*
// @match        https://slideslive.com/*
// @match        http://videolectures.net/*
// @match        https://complexityexplorer.org/*
// @match        https://drive.google.com/*/view
// @require      file:///home/toni/.config/tampermonkey/include.js
// @grant        GM_addStyle
// ==/UserScript==

console.log("Video speed plugin loaded.");

function isElementVisible(el) {
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

const shadowCss = (top, left, opacity) => `
  *{font: 13px/1.8em sans-serif}
  :host(:hover) #controls {display: inline}
  #controller {top:${top}; left:${left}; opacity:${opacity}; position: absolute;
    background: black; color: white; border-radius: 5px; padding: 5px; margin:
    10px 10px 10px 15px; cursor: default; z-index: 9999999;}
  #controller:hover {opacity: 0.7}
  button {cursor: pointer; border-radius: 5px; padding: 1px 6px 3px 6px; border:
  1px solid white; font: bold 14px/1 monospace; margin-bottom: 2px; }
  button:focus {outline: 0}
  button:hover {opacity: 1}
  button:active {background: #ccc}
  button.rw {opacity: 0.65}
  button.hideButton {margin-right: 2px;opacity: 0.5;}`;
let controls = `<span id="controls">
  <button data-action="rewind" class="rw">«</button>
  <button data-action="slower">&minus;</button>
  <button data-action="faster">&plus;</button>
  <button data-action="advance" class="rw">»</button>
  <button data-action="display" class="hideButton">&times;</button>
</span>`; controls = ''; // NOTE(tk) disabled on purpose
const shadowHTML = (top, left, opacity, speed) => `
  <style>${shadowCss(top, left, opacity)}</style>
  <div id="controller"><span>${speed}</span>${controls}</div>`;

const SPEED = 'speed';
const tc = {
  settings: {
    lastSpeed: localStorage.getItem(SPEED) || 1.0,
    enabled: true,
    speeds: {},
    displayKeyCode: 67,
    rememberSpeed: true,
    audioBoolean: false,
    startHidden: true,
    controllerOpacity: 0.3,
    keyBindings: [],
  }
};

// NOTE(tk) Prefer Tampermonkey whitelist.
// const regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
// blacklist: ``.replace(regStrip, "").trim().split('\n').map(match => new RegExp(match))
// Unnecessary, AppleTV related
// https://github.com/igrigorik/videospeed/pull/541
// function getShadow(parent) { ... }

(function() {
  const storage = {};
  tc.settings.keyBindings = [];
  tc.settings.keyBindings.push({
    action: "slower",
    key: Number(storage.slowerKeyCode) || 219, // [
    value: Number(storage.speedStep) || 0.1,
    force: false,
    predefined: true
  });
  tc.settings.keyBindings.push({
    action: "faster",
    key: Number(storage.fasterKeyCode) || 221, // ]
    value: Number(storage.speedStep) || 0.1,
    force: false,
    predefined: true
  });
  tc.settings.keyBindings.push({
    action: "rewind",
    key: Number(storage.rewindKeyCode) || 90,
    value: Number(storage.rewindTime) || 10,
    force: false,
    predefined: true
  }); // default: Z
  tc.settings.keyBindings.push({
    action: "advance",
    key: Number(storage.advanceKeyCode) || 88,
    value: Number(storage.advanceTime) || 10,
    force: false,
    predefined: true
  }); // default: X
  tc.settings.keyBindings.push({
    action: "reset",
    key: Number(storage.resetKeyCode) || 222, // "
    value: 1.0,
    force: false,
    predefined: true
  });
  tc.settings.keyBindings.push({
    action: "fast",
    key: Number(storage.fastKeyCode) || 220, // backslash
    value: Number(storage.fastSpeed) || 1.8,
    force: false,
    predefined: true
  });
  tc.settings.keyBindings.push({
    action: "display",
    key: Number(storage.displayKeyCode) || tc.settings.displayKeyCode,
    value: 0,
    force: false,
    predefined: true
  });

  initializeWhenReady(document);
})();

function getKeyBindings(action, what = "value") {
  const kbs = tc.settings.keyBindings;
  return (kbs.find(item => item.action == action) || {})[what];
}

function setKeyBindings(action, value) {
  const kbs = tc.settings.keyBindings;
  (kbs.find(item => item.action === action) || {}).value = value;
}

function defineVideoController() {
  tc.videoController = function(target, parent) {
    if (target.dataset.vscid) return target.vsc;
    this.video = target;
    this.parent = target.parentElement || parent;
    this.document = target.ownerDocument;
    this.id = Math.random().toString(36).substr(2, 9);

    // settings.speeds[] ensures that same source used across video tags
    // (e.g. fullscreen on YT) retains speed setting
    // this.speed is a controller level variable that retains speed setting
    // across source switches (e.g. video quality, playlist change)
    this.speed = 1.0;

    if (!tc.settings.rememberSpeed) {
      if (!tc.settings.speeds[target.currentSrc]) {
        tc.settings.speeds[target.currentSrc] = this.speed;
      }
      setKeyBindings("reset", getKeyBindings("fast"));
    } else {
      tc.settings.speeds[target.currentSrc] = tc.settings.lastSpeed;
    }

    target.playbackRate = tc.settings.speeds[target.currentSrc];

    this.div = this.initializeControls();

    target.addEventListener(
      "play",
      (this.handlePlay = function(event) {
        if (!tc.settings.rememberSpeed) {
          if (!tc.settings.speeds[target.currentSrc]) {
            tc.settings.speeds[target.currentSrc] = this.speed;
          }
          setKeyBindings("reset", getKeyBindings("fast"));
        } else {
          tc.settings.speeds[target.currentSrc] = tc.settings.lastSpeed;
        }
        target.playbackRate = tc.settings.speeds[target.currentSrc];
      }.bind(this))
    );

    target.addEventListener(
      "ratechange",
      (this.handleRatechange = function(event) {
        // Ignore if 0 == (video not initialized)
        if (event.target.readyState <= 0) return;

        this.speed = this.getSpeed();
        this.speedIndicator.textContent = this.speed;
        tc.settings.speeds[this.video.currentSrc] = this.speed;
        tc.settings.lastSpeed = this.speed;
        localStorage.setItem(SPEED, this.speed);
        runAction("blink", document, null, null);
      }.bind(this))
    );

    new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        const n = mutation.attributeName;
        if (mutation.type === "attributes" && (n == "src" || n == "currentSrc")) {
          Q.el(`div[data-vscid="${this.id}"]`).then(controller => {
            if (!mutation.target.src && !mutation.target.currentSrc) {
              controller.classList.add("vsc-nosource");
            } else {
              controller.classList.remove("vsc-nosource");
            }
          });
        }
      });
    }).observe(target, {attributeFilter: ["src", "currentSrc"]});
  };

  tc.videoController.prototype.getSpeed = function() {
    return parseFloat(this.video.playbackRate).toFixed(2);
  };

  tc.videoController.prototype.remove = function() {
    this.div.remove();
    this.video.removeEventListener("play", this.handlePlay);
    this.video.removeEventListener("ratechange", this.handleRatechange);
    delete this.video.dataset.vscid;
    delete this.video.vsc;
  };

  tc.videoController.prototype.initializeControls = function() {
    var document = this.document;
    var speed = parseFloat(tc.settings.speeds[this.video.currentSrc]).toFixed(2);
    var top = Math.max(this.video.offsetTop, 0) + "px";
    var left = Math.max(this.video.offsetLeft, 0) + "px";

    var wrapper = document.createElement("div");
    wrapper.classList.add("vsc-controller");
    wrapper.dataset.vscid = this.id;

    if (!this.video.currentSrc) {
      wrapper.classList.add("vsc-nosource");
    }

    if (tc.settings.startHidden) {
      wrapper.classList.add("vsc-hidden");
    }

    var shadow = wrapper.attachShadow({mode:"open"});
    shadow.innerHTML = shadowHTML(top, left, tc.settings.controllerOpacity, speed);
    shadow.querySelectorAll("button").forEach(function(button) {
      button.onclick = e => runAction(
        e.target.dataset.action, document, getKeyBindings(e.target.dataset.action), e);
    });

    this.speedIndicator = shadow.querySelector("span");
    var fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);

    this.video.dataset.vscid = this.id;
    switch (true) {
      case location.hostname == "www.amazon.com":
      case location.hostname == "www.reddit.com":
      case /hbogo\./.test(location.hostname):
        // insert before parent to bypass overlay
        this.parent.parentElement.insertBefore(fragment, this.parent);
        break;
      case location.hostname == "tv.apple.com":
        // insert after parent for correct stacking context
        this.parent.getRootNode().querySelector(".scrim").prepend(fragment);
      default:
        // Note: when triggered via a MutationRecord, it's possible that the
        // target is not the immediate parent. This appends the controller as
        // the first element of the target, which may not be the parent.
        this.parent.insertBefore(fragment, this.parent.firstChild);
    }

    return wrapper;
  };
}

function initializeWhenReady(document) {
  // NOTE(tk) use tampermonkey whitelist instead.
  // if (tc.settings.blacklist.some(re => re.test(location.href))) return;
  window.onload = () => initializeNow(window.document);
  if (document) {
    const complete = d => (d.readyState == "complete") && initializeNow(d);
    document.onreadystatechange = () => complete(document);
    complete(document);
  }
}

function isAudioVideo(node) {
  const n = node.nodeName || node.tagName;
  return (n == "VIDEO" || (tc.settings.audioBoolean && n == "AUDIO"));
}

function initializeNow(document) {
  if (!tc.settings.enabled) return;
  if (!document.body || document.body.matches(".vsc-initialized")) return;
  document.body.classList.add("vsc-initialized");

  if (document === window.document) {
    defineVideoController();
  }

  var docs = Array(document);
  try {
    const inIframe = !window || window.self !== window.top;
    if (inIframe) docs.push(window.top.document);
  } catch (e) {
    console.error(e);
  }

  docs.forEach(function(doc) {
    doc.addEventListener(
      "keydown",
      F.retFalse(function(e) {
        const isModifier = !e.getModifierState || [
          'Alt','Control','Fn','Meta','Hyper','OS'].some(code => e.getModifierState(code));
        const isTyping = e.target.isContentEditable || [
          'INPUT', 'TEXTAREA'].indexOf(e.target.nodeName) >= 0
        if (isModifier || isTyping) {
          return false;
        }

        const item = tc.settings.keyBindings.find(item => item.key === e.keyCode);
        if (item) {
          runAction(item.action, document, item.value);
          if (item.force) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }),
      true
    );
  });

  function checkForVideo(node, parent, added) {
    // Only proceed with supposed removal if node is missing from DOM
    if (!added && document.body.contains(node)) return;
    if (isAudioVideo(node)) {
      if (added) {
        node.vsc = new tc.videoController(node, parent);
      } else if (node.dataset.vscid) {
        node.vsc.remove();
      }
    }

    (node.children || []).forEach(child =>
      checkForVideo(child, child.parentNode || parent, added));
  }

  new MutationObserver(function(mutations) {
    requestIdleCallback(_ => mutations.forEach(mutation => {
      switch (mutation.type) {
        case "childList":
          mutation.addedNodes.filter(n => typeof node != "function").forEach(node => {
            checkForVideo(node, node.parentNode || mutation.target, true);
          });
          mutation.removedNodes.filter(n => typeof node != "function").forEach(node => {
            checkForVideo(node, node.parentNode || mutation.target, false);
          });
        // NOTE(tk) not entirely sure any of this is useful => case "attributes":
      }}), { timeout: 1000 });
  }).observe(document, {
    childList: true,
    subtree: true
  });

  Q.all(`video ${tc.settings.audioBoolean ? ',audio' : ''}`).forEach(
    node => node.vsc = new tc.videoController(node));

  // errors out on frames we don't have permission to access (different origin).
  Q.all('iframe').forEach(frame => initializeWhenReady(frame.contentDocument));
}

function runAction(action, document, value, e) {
  Q.all(`iframe,video ${tc.settings.audioBoolean ? ',audio' : ''}`).forEach(function(v) {
    if (!v.vsc) return;

    const controller = v.vsc.div;
    const hasOtherController = e && e.target.getRootNode().host != controller;
    const cancelled = v.matches(".vsc-cancelled");
    if (hasOtherController || cancelled) return;

    if (action === "rewind") {
      v.currentTime -= value;
    } else if (action === "advance") {
      v.currentTime += value;
    } else if (action === "faster") {
      // https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/media/html_media_element.cc?gsn=kMinRate&l=166
      const chromeMax = 16;
      v.playbackRate = Number(Math.min(Math.max(0, v.playbackRate) + value, chromeMax).toFixed(2));
    } else if (action === "slower") {
      const chromeMin = 0.07;
      v.playbackRate = Number(Math.max(v.playbackRate - value, chromeMin).toFixed(2));
    } else if (action === "reset") {
      v.playbackRate = 1.0;
    } else if (action === "fast") {
      if (v.playbackRate !== getKeyBindings('fast')) {
        setKeyBindings('reset', v.playbackRate);
        v.playbackRate = getKeyBindings('fast');
      } else {
        v.playbackRate = getKeyBindings('reset');
      }
    } else if (action === "display") {
      controller.classList.add("vsc-manual");
      controller.classList.toggle("vsc-hidden");
    } else if (action === "blink") {
      if (controller.blinkTimeOut || controller.matches(".vsc-hidden")) {
        clearTimeout(controller.blinkTimeOut);
        controller.classList.remove("vsc-hidden");
        controller.blinkTimeOut = setTimeout(() => {
          controller.classList.add("vsc-hidden");
          controller.blinkTimeOut = undefined;
        }, value || 1000);
      }
    } else if (action === "pause") {
      (v.paused && v.play()) || v.pause();
    } else if (action === "muted") {
      v.muted = v.muted !== true;
    } else if (action === "mark") {
      v.vsc.mark = v.currentTime;
    } else if (action === "jump" && v.vsc.mark) {
      v.currentTime = v.vsc.mark;
    }
  });
}
