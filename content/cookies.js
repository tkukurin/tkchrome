// Accept only minimal cookies by default.
// Reduces time spent on annoying regulations.
//

const keywords = ['minimal', 'necessary', 'reject all'];
const selectors = ['button', 'a'];

function findAndClick() {
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const elementText = element.textContent.toLowerCase();
      for (const keyword of keywords) {
        if (elementText.includes(keyword)) {
          element.click();
          chrome.runtime.sendMessage({ message: "minimal_cookies_accepted" });
          // console.log(`Clicked: ${element.textContent.trim()}`);
          console.log(element)
          return Util.toast(`Clicked: ${element.textContent.trim()}`);
        }
      }
    }
  }
}

// Wait for the page to likely have rendered the banner
setTimeout(findAndClick, 1000);

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
