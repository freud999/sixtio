// Sixtio theme runtime: applies Telegram light/dark and the gender accent
// (pink = female, blue = male) before first paint. Include in <head> of every page.
(function(){
  var tg = window.Telegram && window.Telegram.WebApp;
  var root = document.documentElement;

  function applyScheme(){
    var scheme = (tg && tg.colorScheme) ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.setAttribute('data-theme', scheme === 'dark' ? 'dark' : 'light');
  }
  applyScheme();
  if (tg && tg.onEvent) { try { tg.onEvent('themeChanged', applyScheme); } catch(e){} }
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyScheme);
    } catch(e){}
  }

  var stored = null;
  try { stored = localStorage.getItem('sixtio_gender'); } catch(e){}
  if (stored === 'male' || stored === 'female') root.setAttribute('data-gender', stored);

  window.SixtioTheme = {
    setGender: function(gender){
      if (gender !== 'male' && gender !== 'female') return;
      try { localStorage.setItem('sixtio_gender', gender); } catch(e){}
      root.setAttribute('data-gender', gender);
    }
  };
})();
