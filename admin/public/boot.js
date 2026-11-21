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
  // The Motion setting (same rules as src/theme/motion.ts): Automatic follows the device,
  // and the Windows app on a PC with 4 GB or less starts on Reduced.
  var motion = window.fourvdDesktop && navigator.deviceMemory && navigator.deviceMemory <= 4 ? 'reduced' : 'auto';
  try {
    var savedMotion = localStorage.getItem('4vd.motion');
    if (savedMotion === 'auto' || savedMotion === 'full' || savedMotion === 'reduced' || savedMotion === 'off') motion = savedMotion;
  } catch (e) {}
  if (motion === 'auto') motion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
  document.documentElement.dataset.motion = motion;
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
