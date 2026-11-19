// Apply the saved theme before anything paints (same rules as src/theme/theme.ts).
// A file, not an inline script, so the Content-Security-Policy in _headers can refuse inline scripts.
(function () {
  var choice = 'system';
  try { choice = localStorage.getItem('4vd.theme') || 'system'; } catch (e) {}
  // Inside the Windows app the window frame follows the same choice (src/styles/desktop.css).
  if (window.fourvdDesktop) {
    document.documentElement.dataset.shell = 'desktop';
    window.fourvdDesktop.setTheme(choice === 'light' || choice === 'dark' ? choice : 'system');
  }
  if (choice !== 'light' && choice !== 'dark') {
    choice = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = choice;
  // A business in its own colours: put them back before the first paint (src/theme/applyBrand.ts keeps them).
  try {
    var brand = localStorage.getItem('4vd.brand');
    if (brand && /^[\w\s:;#\-[\]'=(),.{}]+$/.test(brand)) {
      var style = document.createElement('style');
      style.id = 'brand-theme';
      style.textContent = brand;
      document.head.appendChild(style);
    }
  } catch (e) {}
})();
