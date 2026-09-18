// Shared light/dark theme handling, loaded early (blocking, in <head>,
// before any stylesheet needs it) on every page so the correct theme is
// set before first paint — avoids a flash of the wrong theme on load.
(function () {
  var STORAGE_KEY = 'crm-theme';

  function getStoredTheme() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch (err) {
      return null;
    }
  }

  function applyTheme(theme) {
    var resolved = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', resolved);
    return resolved;
  }

  function setTheme(theme) {
    var resolved = applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, resolved);
    } catch (err) {
      // Private browsing / storage disabled — theme just won't persist.
    }
    document.dispatchEvent(new CustomEvent('crm-theme-change', { detail: { theme: resolved } }));
    return resolved;
  }

  function getTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    return attr === 'dark' ? 'dark' : 'light';
  }

  function toggleTheme() {
    return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  }

  // Apply immediately — this script tag must load before body content
  // renders, so there is no flash of the default (light) theme first.
  applyTheme(getStoredTheme() || 'light');

  window.crmTheme = { getTheme: getTheme, setTheme: setTheme, toggleTheme: toggleTheme };
})();
