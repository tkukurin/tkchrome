// Accept only minimal cookies by default.
// Reduces time spent on annoying regulations.
//

/**
 * @typedef {'id'|'class'|'attribute'|'text'} SelectorType
 */

/**
 * @type {{selector: string, type: SelectorType, text?: string[]}}
 */
const selectors = [
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

// Gemini added this for the shadow dom traversal
selectors.concat([
  // --- High-Confidence: Specific IDs ---
  { type: 'id', selector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinDecline' },
  { type: 'id', selector: '#cookie-pro-reject-btn' },
  { type: 'id', selector: '#onetrust-reject-all-handler' },

  // --- High-Confidence: Data Attributes ---
  { type: 'attribute', selector: '[data-testid="cookie-policy-manage-dialog-decline-button"]' },
  { type: 'attribute', selector: '[data-cc-action="deny"]' },
  
  // --- Medium-Confidence: Common Class Names ---
  { type: 'class', selector: '.cc-btn.cc-deny' },
  { type: 'class', selector: '.cookie-decline-button' },

  // --- Low-Confidence: Text Content (last resort) ---
  {
    type: 'text',
    selector: 'button, a',
    text: ['reject all', 'decline', 'necessary only', 'accept only essential']
  }
]);

/**
 * Checks if an element is visible and interactable.
 * @param {HTMLElement} el 
 * @returns {boolean}
 */
function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && window.getComputedStyle(el).visibility !== 'hidden';
}



/**
 * Recursively searches for the target element within a node and its shadow roots.
 * @param {Document|ShadowRoot} node 
 * @returns {boolean} - True if an element was found and clicked, otherwise false.
 */
function findInNode(node) {
  for (const item of selectors) {
    try {
      const elements = Array.from(node.querySelectorAll(item.selector));
      if (!elements.length) continue;

      for (const el of elements) {
        let found = false;
        if (item.type === 'text') {
          const elText = el.textContent.toLowerCase().trim();
          if (item.text.some(t => elText.includes(t)) && isVisible(el)) {
            found = true;
          }
        } else { // For id, class, attribute
          if (isVisible(el)) {
            found = true;
          }
        }
        if (found) {
          clickElement(el);
          return true; // Found and clicked, stop all searching.
        }
      }
    } catch (error) {
      // Ignore errors from invalid selectors in shadow DOMs that don't support them
    }
  }

  // If not found, search deeper in shadow roots within the current node
  const allElements = node.querySelectorAll('*');
  for (const el of allElements) {
    if (el.shadowRoot) {
      if (findInNode(el.shadowRoot)) {
        return true; // Element found in a nested shadow root, stop.
      }
    }
  }
  return false; // Not found in this node or any of its children
}

/**
 * Clicks an element and sends a runtime message.
 * @param {HTMLElement} el 
 */
function clickElement(el) {
  el.click();
  console.log('(tk)', el);
  Util.toast(`Minimal Cookies: Clicked element with text "${el.textContent.trim()}"`);
  chrome.runtime.sendMessage({ message: "minimal_cookies_accepted" });
}


setTimeout(() => findInNode(document.body)), 1500);

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
