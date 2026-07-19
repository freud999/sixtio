// Sixtio theme runtime («Clarity»): applies light/dark (porcelain ⇄ ember).
// Source of truth: a manual override in localStorage, else Telegram colorScheme,
// else the OS preference. Accent is theme-driven — gender no longer changes it.
// Include in <head> of every page.
(function(){
  var tg = window.Telegram && window.Telegram.WebApp;
  var root = document.documentElement;

  function stored(){
    try { var v = localStorage.getItem('sixtio_theme'); return (v === 'light' || v === 'dark') ? v : null; } catch(e){ return null; }
  }
  function systemScheme(){
    return (tg && tg.colorScheme) ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function applyScheme(){
    var scheme = stored() || systemScheme();
    root.setAttribute('data-theme', scheme === 'dark' ? 'dark' : 'light');
    try {
      if (tg && tg.setHeaderColor) tg.setHeaderColor('bg_color');
    } catch(e){}
  }
  applyScheme();

  // follow live system/Telegram changes only while there is no manual override
  if (tg && tg.onEvent) { try { tg.onEvent('themeChanged', function(){ if (!stored()) applyScheme(); }); } catch(e){} }
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){ if (!stored()) applyScheme(); });
    } catch(e){}
  }

  // keep the legacy gender attribute (harmless — CSS neutralises its accent effect)
  var g = null;
  try { g = localStorage.getItem('sixtio_gender'); } catch(e){}
  if (g === 'male' || g === 'female') root.setAttribute('data-gender', g);

  window.SixtioTheme = {
    setGender: function(gender){
      if (gender !== 'male' && gender !== 'female') return;
      try { localStorage.setItem('sixtio_gender', gender); } catch(e){}
      root.setAttribute('data-gender', gender);
    },
    get: function(){ return root.getAttribute('data-theme') || 'light'; },
    set: function(theme){
      if (theme !== 'light' && theme !== 'dark') return;
      try { localStorage.setItem('sixtio_theme', theme); } catch(e){}
      root.setAttribute('data-theme', theme);
      try { window.dispatchEvent(new CustomEvent('sixtio:themechange', { detail: theme })); } catch(e){}
    },
    toggle: function(){ this.set(this.get() === 'dark' ? 'light' : 'dark'); return this.get(); }
  };
})();
