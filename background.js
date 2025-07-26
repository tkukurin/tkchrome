
// Service worker for manifest v3
// Import utilities - note: importScripts needed for service worker
try {
  importScripts('util/sw-include.js');
} catch (e) {
  console.warn('Could not import service worker utilities:', e);
  // Fallback utilities
  const Util = { mod: (x, len) => (x + len) % len };
}

// also see content/cookies.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === "minimal_cookies_accepted") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "Cookie Notice",
      message: "Minimal cookies have been automatically accepted."
    });
  }
});

function tabsel(tab, count) {
  chrome.tabs.query({windowId: tab.windowId}, tabs => {
    const index = Util.mod(count + tab.index, tabs.length);
    return chrome.tabs.update(tabs[index].id, {active: true});
  });
}

chrome.runtime.onMessage.addListener((req, sender, callback) => {
  if (req.cmd === 'tab') {
    chrome.tabs.query({active: true, currentWindow: true}, e =>
      tabsel(e[0], (req.key === 'j' ? 1 : -1)));
  } else if (req.cmd == 'meta') {
    // TODO I wanted to store tab content on this action
  }
});

// chrome.webRequest.onBeforeRequest.addListener(
//   function(details) {
//     console.log("Request URL: ", details.url);
//     // You can perform additional logging or data processing here
//   },
//   { urls: ["<all_urls>"] },
//   ["blocking"]
// );


// details.url: The URL of the intercepted request.
// details.method: The HTTP method of the request (e.g., "GET", "POST").
// details.requestHeaders: An array of the request headers.
// details.requestBody: Information about the request body if present.
// details.frameId: The ID of the frame that initiated the request.
// details.tabId: The ID of the tab that initiated the request.
// details.type: The type of resource being requested (e.g., "main_frame", "script").
// details.initiator: The initiator of the request.
// details.timeStamp: The timestamp when the request was initiated.
// details.incognito: Indicates whether the request is in incognito mode.
// details.documentUrl: The URL of the document in which the request originated.


// Open or create the IndexedDB database
const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open("tk_NetworkRequests", 1);
  request.onerror = function (event) {
    console.error("Error opening database:", event.target.errorCode);
    reject(event.target.errorCode);
  };
  request.onupgradeneeded = function (event) {
    const db = event.target.result;
    if (!db.objectStoreNames.contains("requests")) {
      const objectStore = db.createObjectStore(
        "requests", { keyPath: "id", autoIncrement: true }
      );
      objectStore.createIndex("url", "url", { unique: false });
      objectStore.createIndex("body", "body", { unique: true });
    }
    if (!db.objectStoreNames.contains("requests")) {
    }
  };

  request.onsuccess = function (event) {
    const db = event.target.result;
    resolve(db);
  };
});

function saveToIndexedDB(url, details) {
  const requestData = {
    url: url,
    method: details.method,
    requestHeaders: details.requestHeaders,
    // Add more properties as needed
  };

  // Open the database and perform the transaction
  dbPromise.then((db) => {
    const transaction = db.transaction(["requests"], "readwrite");
    const objectStore = transaction.objectStore("requests");

    // Add the data to the 'requests' object store
    const request = objectStore.add(requestData);

    request.onsuccess = function (event) {
      console.log("Data saved to IndexedDB:", requestData);
    };

    request.onerror = function (event) {
      console.error("Error saving data to IndexedDB:", event.target.errorCode);
    };
  });
}

function saveToIndexedDB(url, details) {
  const requestData = {
    url: url,
    method: details.method,
    requestHeaders: details.requestHeaders,
    timestamp: new Date().toISOString(),
  };

  dbPromise.then((db) => {
    const transaction = db.transaction(["requests"], "readwrite");
    const objectStore = transaction.objectStore("requests");

    const urlIndex = objectStore.index("url");
    const request = urlIndex.get(url);

    request.onsuccess = function (event) {
      const existingRequest = event.target.result;

      if (!existingRequest) {
        // If the URL doesn't exist, add the data to the object store
        objectStore.add(requestData).onsuccess = function () {
          console.log("Data saved to IndexedDB:", requestData);
        };
      } else {
        console.log("Duplicate request, not saved:", requestData);
      }
    };

    request.onerror = function (event) {
      console.error("Error checking duplicate URL:", event.target.errorCode);
    };
  });
}


// Service worker startup - register listeners on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  
  // Set up web request listeners if needed
  if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        saveToIndexedDB(details.url, details);
      },
      { urls: ["https://statquest.org/statquest-store/"] },
      ["requestBody"] // Note: "blocking" not needed for data collection
    );
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension startup');
});
