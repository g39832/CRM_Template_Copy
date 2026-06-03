(function () {
  'use strict';

  const loaded = new Set();

  function loadScript(src) {
    if (loaded.has(src)) return;
    loaded.add(src);

    const existing = Array.from(document.scripts || []).some((script) => script.src && script.src.endsWith(src));
    if (existing) return;

    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  }

  function bootstrap() {
    if (document.getElementById('marginTrackerRoot')) {
      loadScript('margin-tracker.js');
      return;
    }

    if (document.getElementById('clientList') || document.getElementById('projectPanel')) {
      loadScript('main-renderer.js');
      return;
    }

    if (document.getElementById('financeDashboard') || document.getElementById('finance-year')) {
      loadScript('finance-renderer.js');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
