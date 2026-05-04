(function () {
  'use strict';

  function collectPageInfo() {
    return {
      url: window.location.href,
      title: document.title || '',
      timestamp: new Date().toISOString()
    };
  }

  function reportPageInfo() {
    const payload = collectPageInfo();

    if (window.console && typeof window.console.debug === 'function') {
      window.console.debug('[content_reporter] page info', payload);
    }

    return payload;
  }

  function handleMessage(message, sender, sendResponse) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'REPORT_PAGE_INFO') {
      sendResponse({ success: true, data: reportPageInfo() });
    }
  }

  const ContentReporter = {
    collectPageInfo,
    reportPageInfo,
    init() {
      if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          const handled = handleMessage(message, sender, sendResponse);
          return Boolean(handled);
        });
      }
      return reportPageInfo();
    }
  };

  window.ContentReporter = ContentReporter;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ContentReporter.init();
    }, { once: true });
  } else {
    ContentReporter.init();
  }
})();
