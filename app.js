(function () {
  'use strict';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const script = document.createElement('script');
      script.src = 'main.js';
      script.defer = true;
      document.head.appendChild(script);
    }, { once: true });
  } else {
    const script = document.createElement('script');
    script.src = 'main.js';
    script.defer = true;
    document.head.appendChild(script);
  }
})();
