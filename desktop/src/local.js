// The words on the app's own pages, in the language the dashboard last used here
// (passed as ?lang=), or the system's before anyone has signed in.
const params = new URLSearchParams(location.search);
const language = params.get('lang') || (navigator.language.startsWith('sq') ? 'sq' : 'en');
const WORDS = {
  sq: {
    label: 'Po hapet 4VD…',
    title: 'Nuk lidhet me 4VD',
    body: 'Kontrolloni internetin e këtij kompjuteri. Do të provojmë sërish çdo disa sekonda.',
    retry: 'Provo sërish',
  },
};

if (WORDS[language]) {
  document.documentElement.lang = language;
  for (const [id, text] of Object.entries(WORDS[language])) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }
}

// Offline: try again on a click, when the connection comes back, or every ten seconds.
const button = document.getElementById('retry');
if (button) {
  const retry = params.get('retry') || 'https://dashboard.4vd.app/';
  const go = () => {
    button.disabled = true;
    location.href = retry;
  };
  button.addEventListener('click', go);
  window.addEventListener('online', go);
  setTimeout(go, 10000);
}
