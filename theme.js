// Sixtio theme runtime («Clarity»): applies light/dark (porcelain ⇄ ember).
// Source of truth: a manual override in localStorage, else Telegram colorScheme,
// else the OS preference. Accent is theme-driven — gender no longer changes it.
// Include in <head> of every page.
(function(){
  var tg = window.Telegram && window.Telegram.WebApp;
  var root = document.documentElement;

  // --- Vertical swipe: let the PAGE scroll, not the app close -----------------
  //
  // On Android, a downward swipe inside a Mini App is claimed by Telegram to
  // minimise or close the window. That gesture is the same one a person makes to
  // scroll, so on any screen taller than the viewport — the onboarding chat, the
  // profile, the policy — scrolling either did nothing or dropped them out of
  // the app entirely. It is not a layout bug: the container scrolls fine, the
  // touch never reaches it.
  //
  // disableVerticalSwipes() (Bot API 7.7+) hands the gesture back to the page.
  // Guarded twice over — isVersionAtLeast is itself absent on old clients, and an
  // older Telegram must degrade to today's behaviour rather than throw during
  // startup and take the theme down with it.
  //
  // Lives here, in the one file every page already loads, because the bug is
  // every page's and ten copies of this would mean nine chances to miss one.
  try {
    if (tg) {
      if (tg.ready) tg.ready();
      if (tg.expand) tg.expand();
      if (tg.disableVerticalSwipes &&
          (!tg.isVersionAtLeast || tg.isVersionAtLeast('7.7'))) {
        tg.disableVerticalSwipes();
      }
    }
  } catch (e) { /* an old client keeps the old behaviour; nothing else breaks */ }

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
      // theme.js must keep working with no dictionary loaded (it is the one
      // shared asset a page can use on its own), so the Ukrainian default stays
      // as the fallback rather than becoming a bare key.
      var label = window.SixtioI18n ? window.SixtioI18n.t('aria_theme') : 'Змінити тему';
      btns[i].setAttribute('aria-label', label);
    }
  }
  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); } catch(err){}
    if (window.SixtioTheme) window.SixtioTheme.toggle();
  });
  window.addEventListener('sixtio:themechange', syncThemeToggles);
  // The toggle's own label is localized, so it has to be repainted when the
  // language changes — i18n's apply() cannot reach an attribute this file owns.
  window.addEventListener('sixtio:langchange', syncThemeToggles);
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

  // --- background scroll lock, shared by every overlay ---------------------
  // Every sheet in the app is appended to <body> and scrolls inside itself, but
  // the page behind it stayed scrollable: a drag that began on the sheet's
  // backdrop — or continued past the sheet's own top or bottom — moved the
  // profile underneath instead, so closing a sheet left you somewhere else on the
  // page than where you opened it.
  //
  // Every page here makes <body> the scroll container (body{overflow-y:auto}),
  // which is why plain overflow:hidden is enough and the position:fixed trick is
  // not needed: taking the overflow away does not discard the scroll offset, so
  // there is nothing to save and restore, and nothing to get wrong.
  //
  // Reference-counted, because sheets legitimately stack — the 18+ consent sheet
  // opens the interview on top of itself, and the first one closing must not
  // release a lock the second one still needs.
  var lockDepth = 0;
  var lockPrev = null;
  function lockScroll() {
    if (lockDepth++ > 0) return;
    lockPrev = { html: root.style.overflow, body: document.body.style.overflow };
    root.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    if (lockDepth === 0) return;
    if (--lockDepth > 0) return;
    root.style.overflow = (lockPrev && lockPrev.html) || '';
    document.body.style.overflow = (lockPrev && lockPrev.body) || '';
    lockPrev = null;
  }
  // Reveals a sheet that starts at opacity:0 and transitions in on .show.
  //
  // Deliberately NOT requestAnimationFrame, which is what every sheet used to
  // use: rAF is throttled or suspended outright when the page is not being
  // painted, and a frame that never arrives means the class is never added — the
  // overlay sits in the DOM, fully interactive, at zero opacity. Reading a layout
  // property flushes the pre-transition state synchronously instead, which is all
  // rAF was ever being used for here, and it cannot fail to happen.
  window.SixtioReveal = function (el) {
    if (!el) return;
    void el.offsetHeight;
    el.classList.add('show');
  };

  window.SixtioLock = {
    on: lockScroll,
    off: unlockScroll,
    // Guarantees a sheet releases exactly the one lock it took, however many
    // times its own close path runs (✕, backdrop, Escape, a resolve and a
    // reject racing). A double release would unlock the page under a sheet
    // that is still open.
    once: function () {
      var held = true;
      lockScroll();
      return function () { if (held) { held = false; unlockScroll(); } };
    }
  };

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
