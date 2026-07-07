// Sixtio paywall — one reusable glassmorphism overlay for the whole app.
// Usage:  SixtioPaywall.open({ initData, starsBalance, onSuccess: fn(result) })
// It handles the /api/interact purchase call itself, updates cached sixtio_me, and
// calls onSuccess with the fresh entitlement so the caller can un-blur / refresh.
(function () {
  var PREMIUM_PRICE = 150;
  var PACK_PRICE = 10;
  var injected = false;

  // Real Telegram Stars top-up packs (Task 19). Ids MUST match STAR_PACKS in
  // api/interact.js; the actual price/credit is enforced server-side.
  // Tags are i18n dictionary keys (Task 26), resolved at open() time.
  var STAR_PACKS = [
    { id: 'pack_50',  stars: 50 },
    { id: 'pack_100', stars: 100, tagKey: 'pw_tag_popular' },
    { id: 'pack_250', stars: 250, tagKey: 'pw_tag_value' },
  ];

  // Localized copy via SixtioI18n (i18n.js loads before this file on every
  // page that uses the paywall); the raw key is the last-resort fallback.
  function t(key, params) {
    return (window.SixtioI18n && window.SixtioI18n.t)
      ? window.SixtioI18n.t(key, params) : key;
  }

  var CSS =
    '.pw-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;' +
    'justify-content:center;background:rgba(6,4,16,.55);-webkit-backdrop-filter:blur(6px);' +
    'backdrop-filter:blur(6px);opacity:0;transition:opacity .22s ease;padding:16px;' +
    'overscroll-behavior:contain;' +
    'padding-bottom:calc(env(safe-area-inset-bottom) + 16px);}' +
    '.pw-overlay.show{opacity:1;}' +
    // The SHEET scrolls, never the page behind it: cap its height to the viewport
    // and own the overflow; overscroll-behavior stops the scroll chaining to the
    // background (open()/close() also hard-lock <body> scroll as a belt-and-braces).
    '.pw-sheet{width:100%;max-width:440px;border-radius:26px;padding:22px 20px 20px;' +
    'position:relative;transform:translateY(24px);transition:transform .26s cubic-bezier(.2,.8,.2,1);' +
    'max-height:calc(100dvh - 32px - env(safe-area-inset-bottom));overflow-y:auto;' +
    '-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}' +
    '.pw-overlay.show .pw-sheet{transform:translateY(0);}' +
    '.pw-close{position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;' +
    'border:1px solid var(--glass-border);background:var(--faux-glass);color:var(--text);' +
    'font-size:15px;cursor:pointer;font-family:inherit;line-height:1;}' +
    '.pw-title{font-size:15px;letter-spacing:.14em;text-align:center;}' +
    '.pw-sub{font-size:13px;line-height:1.5;color:var(--hint);text-align:center;margin-top:8px;}' +
    '.pw-bal{font-size:13px;color:var(--hint);text-align:center;margin-top:10px;}' +
    '.pw-bal b{color:var(--neon-b);font-weight:800;}' +
    '.pw-opt{display:block;width:100%;text-align:left;margin-top:14px;padding:16px 16px;' +
    'border-radius:20px;cursor:pointer;font-family:inherit;color:var(--text);' +
    'background:var(--faux-glass);border:1px solid var(--glass-border);' +
    'transition:transform .12s ease;}' +
    '.pw-opt:active{transform:scale(.985);}' +
    '.pw-premium{color:#fff;border:1px solid color-mix(in srgb, var(--neon-p) 55%, transparent);' +
    'background:linear-gradient(135deg, color-mix(in srgb, var(--neon-p) 80%, #000), var(--neon-p));' +
    'box-shadow:0 14px 40px -14px color-mix(in srgb, var(--neon-p) 70%, transparent);}' +
    // Attention pulse when the sheet was opened as a Premium upsell (highlight:'premium')
    '.pw-premium.pw-hi{animation:pwHi 1.6s ease-in-out 3;}' +
    '@keyframes pwHi{0%,100%{box-shadow:0 14px 40px -14px color-mix(in srgb, var(--neon-p) 70%, transparent);}' +
    '50%{box-shadow:0 0 34px 0 color-mix(in srgb, var(--neon-p) 85%, transparent);transform:scale(1.015);}}' +
    '.pw-tag{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;' +
    'font-size:10px;font-weight:800;letter-spacing:.06em;vertical-align:middle;' +
    'background:rgba(255,255,255,.22);color:#fff;}' +
    '.pw-opt-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}' +
    '.pw-opt-name{font-size:16px;font-weight:800;}' +
    '.pw-price{font-size:15px;font-weight:800;white-space:nowrap;}' +
    '.pw-benefits{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;}' +
    '.pw-benefits li{font-size:13px;line-height:1.4;opacity:.95;}' +
    '.pw-opt-note{font-size:12.5px;color:var(--hint);margin-top:6px;line-height:1.45;}' +
    '.pw-invite{font-size:12.5px;color:var(--hint);text-align:center;margin-top:14px;}' +
    '.pw-invite u{color:var(--neon-b);cursor:pointer;text-decoration:none;}' +
    '.pw-note{font-size:12.5px;color:var(--neon-b);text-align:center;min-height:16px;margin-top:10px;}' +
    // --- Real Stars top-up packs (Task 19) ---
    // NOTE: deposit classes are pw-dep* on purpose — the '+30 likes' option button
    // historically carried a 'pw-pack' class, and sharing that name made the
    // deposit click-handler (and styling) swallow internal purchases (Task 22).
    '.pw-deposit-h{font-size:11px;letter-spacing:.14em;color:var(--hint);text-align:center;' +
    'margin-top:18px;text-transform:uppercase;}' +
    '.pw-deps{display:flex;gap:8px;margin-top:10px;}' +
    '.pw-dep{flex:1;position:relative;padding:14px 8px;border-radius:18px;cursor:pointer;' +
    'font-family:inherit;color:var(--text);text-align:center;' +
    'background:var(--faux-glass);transition:transform .12s ease;' +
    'border:1px solid color-mix(in srgb, var(--neon-b) 40%, transparent);' +
    'box-shadow:0 10px 30px -18px color-mix(in srgb, var(--neon-b) 80%, transparent);}' +
    '.pw-dep:active{transform:scale(.96);}' +
    '.pw-dep-amt{font-size:17px;font-weight:800;color:var(--neon-b);}' +
    '.pw-dep-tag{position:absolute;top:-8px;left:50%;transform:translateX(-50%);' +
    'padding:2px 7px;border-radius:999px;font-size:9px;font-weight:800;letter-spacing:.05em;' +
    'white-space:nowrap;background:var(--neon-b);color:#04121a;}';

  function injectStyle() {
    if (injected) return;
    injected = true;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function tg() { return window.Telegram && window.Telegram.WebApp; }
  function haptic(kind) {
    var t = tg();
    if (t && t.HapticFeedback) { try { t.HapticFeedback.impactOccurred(kind); } catch (e) {} }
  }
  function notify(type) {
    var t = tg();
    if (t && t.HapticFeedback) { try { t.HapticFeedback.notificationOccurred(type); } catch (e) {} }
  }

  function open(opts) {
    opts = opts || {};
    injectStyle();
    var initData = opts.initData || (tg() && tg().initData) || '';
    var balance = opts.starsBalance || 0;
    // Caller-supplied context line (shop vs swipe-limit) — defaults to the limit copy.
    var subtitle = opts.subtitle || t('pw_default_sub');

    var overlay = document.createElement('div');
    overlay.className = 'pw-overlay';
    overlay.innerHTML =
      '<div class="pw-sheet glass">' +
        '<button class="pw-close" aria-label="' + t('close') + '">✕</button>' +
        '<div class="pw-title led grad-text">SIXTIO PREMIUM</div>' +
        '<div class="pw-sub">' + subtitle + '</div>' +
        '<div class="pw-bal">' + t('pw_balance') + ' <b>' + balance + ' ⭐</b></div>' +
        '<button class="pw-opt pw-premium" data-item="premium">' +
          '<div class="pw-opt-head"><span class="pw-opt-name">' + t('pw_premium_name') +
          '<span class="pw-tag">' + t('pw_hit') + '</span></span>' +
          '<span class="pw-price">150 ⭐</span></div>' +
          '<ul class="pw-benefits">' +
            '<li>' + t('pw_b1') + '</li>' +
            '<li>' + t('pw_b2') + '</li>' +
            '<li>' + t('pw_b3') + '</li>' +
            '<li>' + t('pw_b4') + '</li>' +
          '</ul>' +
        '</button>' +
        '<button class="pw-opt" data-item="swipe_pack">' +
          '<div class="pw-opt-head"><span class="pw-opt-name">' + t('pw_pack_name') + '</span>' +
          '<span class="pw-price">10 ⭐</span></div>' +
          '<div class="pw-opt-note">' + t('pw_pack_note') + '</div>' +
        '</button>' +
        '<div class="pw-deposit-h">' + t('pw_deposit_h') + '</div>' +
        '<div class="pw-deps">' +
          STAR_PACKS.map(function (p) {
            return '<button class="pw-dep" data-pack="' + p.id + '" data-stars="' + p.stars + '">' +
              (p.tagKey ? '<span class="pw-dep-tag">' + t(p.tagKey) + '</span>' : '') +
              '<div class="pw-dep-amt">+' + p.stars + ' ⭐</div>' +
            '</button>';
          }).join('') +
        '</div>' +
        '<div class="pw-invite">' + t('pw_invite_q') + ' <u id="pwInvite">' + t('pw_invite_u') + '</u></div>' +
        '<div class="pw-note" id="pwNote"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    // Premium-focused entry (e.g. tapping a locked intimate block): pulse the
    // Premium option so the eye lands on the unlock path first.
    if (opts.highlight === 'premium') {
      var prem = overlay.querySelector('.pw-premium');
      if (prem) prem.classList.add('pw-hi');
    }
    // Lock background scroll while the sheet is open (restored on close). The
    // sheet itself scrolls via its own overflow-y (see .pw-sheet CSS).
    var prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { overlay.classList.add('show'); });

    var note = overlay.querySelector('#pwNote');
    var busy = false;

    function close() {
      document.body.style.overflow = prevBodyOverflow;
      overlay.classList.remove('show');
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 240);
    }
    function updateBal() { overlay.querySelector('.pw-bal b').textContent = balance + ' ⭐'; }

    overlay.querySelector('.pw-close').addEventListener('click', function () { haptic('light'); close(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('#pwInvite').addEventListener('click', function () {
      close();
      window.location.href = 'profile.html';   // referral system lives on the profile
    });

    // --- Real Stars top-up via Telegram.WebApp.openInvoice (Task 19) --------
    // Fetch a fresh invoice link from the server, open Telegram's native Stars
    // sheet, and on 'paid' optimistically reflect the credit (the webhook applies
    // it server-side moments later, so we also reconcile from /api/me shortly after).
    function reconcileDeposit(added) {
      // Immediate optimistic bump of any on-page wallet badge (profile header).
      try {
        var el = document.getElementById('starsBalance');
        if (el) el.textContent = (parseInt(el.textContent, 10) || 0) + added;
      } catch (e) {}
      // Authoritative refresh once the webhook has had time to land.
      setTimeout(function () {
        if (opts.onSuccess) { try { opts.onSuccess({ ok: true, deposit: true, starsAdded: added }); } catch (e) {} }
      }, 2500);
    }

    Array.prototype.forEach.call(overlay.querySelectorAll('.pw-dep'), function (btn) {
      btn.addEventListener('click', function () {
        if (busy) return;
        var twa = tg();   // NOT `t` — that's the i18n lookup in this module
        if (!twa || typeof twa.openInvoice !== 'function') {
          note.textContent = t('pw_tg_only');
          return;
        }
        var packId = btn.getAttribute('data-pack');
        var stars = parseInt(btn.getAttribute('data-stars'), 10) || 0;
        busy = true;
        note.textContent = t('pw_invoice_prep');
        haptic('medium');
        fetch('/api/interact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'create_stars_invoice', initData: initData, packId: packId }),
        }).then(function (r) { return r.json(); }).then(function (res) {
          busy = false;
          if (!res || !res.ok || !res.invoiceLink) {
            note.textContent = t('pw_invoice_fail');
            return;
          }
          note.textContent = '';
          twa.openInvoice(res.invoiceLink, function (status) {
            if (status === 'paid') {
              notify('success');
              balance += stars; updateBal();
              note.textContent = t('pw_paid', { n: stars });
              try { console.info('[Sixtio] Stars deposit paid:', packId, '(+' + stars + ' ⭐)'); } catch (e) {}
              reconcileDeposit(stars);
            } else if (status === 'failed') {
              note.textContent = t('pw_pay_fail');
            } else {
              note.textContent = '';   // cancelled / pending — no-op
            }
          });
        }).catch(function () {
          busy = false;
          note.textContent = t('pw_net_err');
        });
      });
    });

    Array.prototype.forEach.call(overlay.querySelectorAll('.pw-opt'), function (btn) {
      btn.addEventListener('click', function () {
        if (busy) return;
        var item = btn.getAttribute('data-item');
        var price = item === 'premium' ? PREMIUM_PRICE : PACK_PRICE;
        if (balance < price) {
          note.textContent = t('pw_insufficient_invite');
          return;
        }
        busy = true;
        note.textContent = t('pw_processing');
        haptic('medium');
        fetch('/api/interact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'purchase', initData: initData, item: item }),
        }).then(function (r) { return r.json(); }).then(function (res) {
          busy = false;
          if (!res || !res.ok) {
            if (res && typeof res.starsBalance === 'number') { balance = res.starsBalance; updateBal(); }
            note.textContent = (res && res.reason === 'insufficient')
              ? t('pw_insufficient') : t('pw_fail');
            return;
          }
          notify('success');
          // Frictionless confirmation: a concise client log of what was bought and
          // the resulting entitlement (never any token/secret) for support & QA.
          try {
            console.info('[Sixtio] Purchase confirmed:', item, '→',
              { premium: res.premium, starsBalance: res.starsBalance });
          } catch (e) {}
          // Keep the cached profile in sync so every screen sees the new state.
          try {
            var me = JSON.parse(localStorage.getItem('sixtio_me') || 'null');
            if (me && me.user) {
              me.user.starsBalance = res.starsBalance;
              me.user.premium = res.premium;
              me.user.premiumUntil = res.premiumUntil;
              me.user.likesLeft = res.likesLeft;
              me.user.blur = res.blur;
              localStorage.setItem('sixtio_me', JSON.stringify(me));
            }
          } catch (e) {}
          close();
          if (opts.onSuccess) opts.onSuccess(res);
        }).catch(function () {
          busy = false;
          note.textContent = t('pw_net_err');
        });
      });
    });

    return { close: close };
  }

  window.SixtioPaywall = { open: open };
})();
