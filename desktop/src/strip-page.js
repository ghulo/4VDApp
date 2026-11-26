// The title strip's page: three keys and the dashboard's page title. main.js does the work (strip-preload.js).
const strip = window.fourvdStrip;
const keys = { menu: document.getElementById('menu'), back: document.getElementById('back'), forward: document.getElementById('forward') };
const title = document.getElementById('title');

keys.menu.addEventListener('click', () => {
  const box = keys.menu.getBoundingClientRect();
  strip.menu(Math.round(box.left), Math.round(box.bottom));
});
keys.back.addEventListener('click', () => strip.back());
keys.forward.addEventListener('click', () => strip.forward());

strip.onState((state) => {
  document.documentElement.lang = state.language;
  // The page title is the dashboard's own text: shown as text, never as markup.
  title.textContent = state.title || '4VD';
  document.title = state.title || '4VD';
  keys.back.disabled = !state.canBack;
  keys.forward.disabled = !state.canForward;
  for (const [id, label] of Object.entries({ menu: state.words.menu, back: state.words.back, forward: state.words.forward })) {
    keys[id].setAttribute('aria-label', label);
  }
  keys.menu.title = state.words.menu;
  keys.back.title = `${state.words.back} (Alt+Left)`;
  keys.forward.title = `${state.words.forward} (Alt+Right)`;
  document.body.classList.toggle('is-blurred', !state.focused);
});
