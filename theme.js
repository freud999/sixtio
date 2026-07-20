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
    syncThemeToggles();
  }

  // --- sun/moon theme toggle button, auto-wired on every page ---
  // Any <button data-theme-toggle> gets the correct icon + click behaviour.
  function themeIconSVG(t){
    return t === 'dark'
      ? '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M4.3 4.3l1.6 1.6M18.1 18.1l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.3 19.7l1.6-1.6M18.1 5.9l1.6-1.6"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 14.6A8 8 0 0 1 9.4 4 7 7 0 1 0 20 14.6z"/></svg>';
  }
  function syncThemeToggles(){
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    var t = root.getAttribute('data-theme') || 'light';
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++){
      btns[i].innerHTML = themeIconSVG(t);
      btns[i].setAttribute('aria-label', 'Змінити тему');
    }
  }
  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); } catch(err){}
    if (window.SixtioTheme) window.SixtioTheme.toggle();
  });
  window.addEventListener('sixtio:themechange', syncThemeToggles);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncThemeToggles);
  else syncThemeToggles();

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
