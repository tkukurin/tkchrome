// Accept only minimal cookies by default.
// Reduces time spent on annoying regulations.
//


// ==CONFIGURATION==
const MAX_SEARCH_SECONDS = 5; // Max time in seconds to search
const MAX_TRAVERSAL_DEPTH = 10; // Max shadow DOM nesting depth
const DEBOUNCE_DELAY_MS = 500; // Wait this long after last DOM change to search
// ==/CONFIGURATION==

// --- State and Selectors ---
let timedOut = false;
let searchTimeoutId = null;
let debounceTimeoutId = null;
let observer = null;
const selectors = [  // @type {{selector: string, type: SelectorType, text?: string[]}}
  // --- High-Confidence: Specific IDs ---
  { type: 'id', selector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinDecline' },
  { type: 'id', selector: '#cookie-pro-reject-btn' },
  { type: 'id', selector: '#onetrust-reject-all-handler' },
  { type: 'id', selector: '#sp_message_panel_310842' }, // Sourcepoint

  // --- High-Confidence: Data Attributes ---
  { type: 'attribute', selector: '[data-testid="cookie-policy-manage-dialog-decline-button"]' },
  { type: 'attribute', selector: '[data-cy="decline-cookies-button"]' },
  { type: 'attribute', selector: '[data-tracking-control-name="ga-cookie.consent.reject.all"]' },
  { type: 'attribute', selector: '[data-cc-action="deny"]' },
  { type: 'attribute', selector: '[data-action="deny-all"]' },

  // --- Medium-Confidence: Common Class Names (more specific first) ---
  { type: 'class', selector: '.cc-btn.cc-deny' },
  { type: 'class', selector: '.cookie-decline-button' },
  { type: 'class', selector: '.reject-all-cookies' },
  { type: 'class', selector: '.cookie-notice-reject-button' },
  { type: 'class', selector: '.btn.btn-secondary.reject-all' },
  { type: 'class', selector: '.cookie-consent-reject' },

  // --- Low-Confidence: Text Content (last resort) ---
  {
    type: 'text',
    selector: 'button, a',
    text: ['reject all', 'decline', 'necessary only', 'essential cookies', 'accept only essential', 'save settings']
  },
  {
    type: 'text',
    selector: 'button, a',
    text: ['minimal', 'necessary', 'reject'] // Broader terms
  }
];

/** Checks if an element is visible and interactable.
 * @param {HTMLElement} el
 */
function isVisible(el) {  // -> bool
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && window.getComputedStyle(el).visibility !== 'hidden';
}



/**
 * Recursively searches for the target element with guardrails.
 * @param {Document|ShadowRoot} node
 * @param {number} depth - The current traversal depth.
 * @returns {boolean} - True if an element was found and clicked.
 */
function findInNode(node, depth) {
    if (timedOut || depth > MAX_TRAVERSAL_DEPTH) {
        return false;
    }

    for (const item of selectors) {
        try {
            const elements = node.querySelectorAll(item.selector);
            for (const el of elements) {
                if (timedOut) return true; // Exit if timeout occurred during loop
                let found = false;
                if (item.type === 'text') {
                    if (item.text.some(t => el.textContent.toLowerCase().includes(t)) && isVisible(el)) {
                        found = true;
                    }
                } else if (isVisible(el)) {
                    found = true;
                }
                if (found) {
                    clickElement(el);
                    return true;
                }
            }
        } catch (e) { /* Ignore errors */ }
    }

    // Search deeper in shadow roots
    const allElements = node.querySelectorAll('*');
    for (const el of allElements) {
        if (el.shadowRoot) {
            if (findInNode(el.shadowRoot, depth + 1)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Recursively searches for the target element with guardrails.
 * @param {Document|ShadowRoot} node
 * @param {number} depth - The current traversal depth.
 * @returns {boolean} - True if an element was found and clicked.
 */
function findInNode(node, depth) {
  if (timedOut || depth > MAX_TRAVERSAL_DEPTH) return false;
  for (const item of selectors) {
    try {
      const elements = node.querySelectorAll(item.selector);
      for (const el of elements) {
        if (timedOut) return true; // Exit if timeout occurred during loop
        let found = false;
        if (item.type === 'text') {
          if (item.text.some(t => el.textContent.toLowerCase().includes(t)) && isVisible(el)) {
            found = true;
          }
        } else if (isVisible(el)) {
          found = true;
        }
        if (found) {
          clickElement(el);
          return true;
        }
      }
    } catch (e) { /* Ignore errors */ }
  }

  // Search deeper in shadow roots
  const allElements = node.querySelectorAll('*');
  for (const el of allElements) {
    if (el.shadowRoot) {
      if (findInNode(el.shadowRoot, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A debounced function to trigger the search.
 */
function debouncedSearch() {
    clearTimeout(debounceTimeoutId);
    if (timedOut) return;
    debounceTimeoutId = setTimeout(() => findInNode(document, 0), DEBOUNCE_DELAY_MS);
}

/**
 * Clicks an element and sends a runtime message.
 * Disconnects observer.
 * @param {HTMLElement} el
 */
function clickElement(el) {
    el.click();
    console.log("(tk.cookies) click", el);
    // Use Util.toast if available, fallback to console
    if (typeof Util !== 'undefined' && Util.toast) {
        Util.toast(`click: "${el.textContent.trim()}"`);
    } else {
        console.log(`[cookies] clicked: "${el.textContent.trim()}"`);
    }
    if (observer) observer.disconnect();
    if (searchTimeoutId) clearTimeout(searchTimeoutId);
    timedOut = true; // Prevent any lingering searches
}


//setTimeout(() => findInNode(document.body)), 1500);

// OLD
// setTimeout(() => {
// for (const item of selectors) {
//   try {
//     const elements = Array.from(document.querySelectorAll(item.selector));
//     if (!elements.length) continue;
//     if (item.type === 'text') {
//       for (const el of elements) {
//         const elText = el.textContent.toLowerCase().trim();
//         if (item.text.some(t => elText.includes(t)) && isVisible(el)) {
//           clickElement(el);
//           return;
//         }
//       }
//     } else { // For id, class, attribute
//       for (const el of elements) {
//         if (isVisible(el)) return clickElement(el)
//       }
//     }
//   } catch (error) {
//     console.error(`(tk) cookies: selector "${item.selector}":`, error);
//   }
// }
// }, 1500);

/*
const selectors = [
  "button:contains('minimal')",
  "button:contains('necessary')",
  "button:contains('reject all')",
  "a:contains('minimal')",
  "a:contains('necessary')",
  "a:contains('reject all')"
];

function acceptMinimalCookies() {
  for (const selector of selectors) {
  const element = document.querySelector(selector);
  if (element) {
    element.click();
    chrome.runtime.sendMessage({
    message: "minimal_cookies_accepted"
    });
    break;
  }
  }
}

setTimeout(acceptMinimalCookies, 1000);
*/
