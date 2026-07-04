// Sixtio paywall — one reusable glassmorphism overlay for the whole app.
// Usage:  SixtioPaywall.open({ initData, starsBalance, onSuccess: fn(result) })
// It handles the /api/purchase call itself, updates the cached sixtio_me, and
// calls onSuccess with the fresh entitlement so the caller can un-blur / refresh.
(function () {
  var PREMIUM_PRICE = 150;
  var PACK_PRICE = 10;
  var injected = false;

  var CSS =
    '.pw-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;' +
    'justify-content:center;background:rgba(6,4,16,.55);-webkit-backdrop-filter:blur(6px);' +
    'backdrop-filter:blur(6px);opacity:0;transition:opacity .22s ease;padding:16px;' +
    'padding-bottom:calc(env(safe-area-inset-bottom) + 16px);}' +
    '.pw-overlay.show{opacity:1;}' +
    '.pw-sheet{width:100%;max-width:440px;border-radius:26px;padding:22px 20px 20px;' +
    'position:relative;transform:translateY(24px);transition:transform .26s cubic-bezier(.2,.8,.2,1);}' +
    '.pw-overlay.show .pw-sheet{transform:translateY(0);}' +
    '.pw-close{position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;' +
    'border:1px solid var(--glass-border);background:var(--faux-glass);color:var(--text);' +
    'font-size:15px;cursor:pointer;font-family:inherit;line-height:1;}' +
    '.pw-title{font-size:15px;letter-spacing:.14em;text-align:center;}' +
    '.pw-sub{font-size:13px;line-height:1.5;color:var(--hint);text-align:center;margin-top:8px;}' +
    '.pw-bal{font-size:13px;color:var(--hint);text-align:center;margin-top:10px;}' +
    '.pw-bal b{color:var(--a1);font-weight:800;}' +
    '.pw-opt{display:block;width:100%;text-align:left;margin-top:14px;padding:16px 16px;' +
    'border-radius:20px;cursor:pointer;font-family:inherit;color:var(--text);' +
    'background:var(--faux-glass);border:1px solid var(--glass-border);' +
    'transition:transform .12s ease;}' +
    '.pw-opt:active{transform:scale(.985);}' +
    '.pw-premium{background:linear-gradient(135deg, var(--a2), var(--a1));color:#fff;' +
    'border:none;box-shadow:0 14px 34px -14px var(--glow);}' +
    '.pw-opt-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}' +
    '.pw-opt-name{font-size:16px;font-weight:800;}' +
    '.pw-price{font-size:15px;font-weight:800;white-space:nowrap;}' +
    '.pw-benefits{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;}' +
    '.pw-benefits li{font-size:13px;line-height:1.4;opacity:.95;}' +
    '.pw-opt-note{font-size:12.5px;color:var(--hint);margin-top:6px;line-height:1.45;}' +
    '.pw-invite{font-size:12.5px;color:var(--hint);text-align:center;margin-top:14px;}' +
    '.pw-invite u{color:var(--a1);cursor:pointer;text-decoration:none;}' +
    '.pw-note{font-size:12.5px;color:var(--a1);text-align:center;min-height:16px;margin-top:10px;}';

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

    var overlay = document.createElement('div');
    overlay.className = 'pw-overlay';
    overlay.innerHTML =
      '<div class="pw-sheet glass">' +
        '<button class="pw-close" aria-label="Закрити">✕</button>' +
        '<div class="pw-title led grad-text">SIXTIO PREMIUM</div>' +
        '<div class="pw-sub">Твій ліміт вподобань на сьогодні вичерпано. Обери, як продовжити 💜</div>' +
        '<div class="pw-bal">Баланс: <b>' + balance + ' ⭐</b></div>' +
        '<button class="pw-opt pw-premium" data-item="premium">' +
          '<div class="pw-opt-head"><span class="pw-opt-name">Premium · 30 днів</span>' +
          '<span class="pw-price">150 ⭐</span></div>' +
          '<ul class="pw-benefits">' +
            '<li>♾️ Безлімітні вподобання</li>' +
            '<li>👁 Фото без розмиття</li>' +
            '<li>🧠 Аналітика Digital Twin</li>' +
          '</ul>' +
        '</button>' +
        '<button class="pw-opt pw-pack" data-item="swipe_pack">' +
          '<div class="pw-opt-head"><span class="pw-opt-name">+30 вподобань</span>' +
          '<span class="pw-price">10 ⭐</span></div>' +
          '<div class="pw-opt-note">Топ-ап на сьогодні. Фото лишаються розмитими.</div>' +
        '</button>' +
        '<div class="pw-invite">Мало зірок? <u id="pwInvite">Запроси друзів (+15 ⭐ за кожного)</u></div>' +
        '<div class="pw-note" id="pwNote"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });

    var note = overlay.querySelector('#pwNote');
    var busy = false;

    function close() {
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

    Array.prototype.forEach.call(overlay.querySelectorAll('.pw-opt'), function (btn) {
      btn.addEventListener('click', function () {
        if (busy) return;
        var item = btn.getAttribute('data-item');
        var price = item === 'premium' ? PREMIUM_PRICE : PACK_PRICE;
        if (balance < price) {
          note.textContent = 'Недостатньо зірок — запроси друзів, щоб заробити ⭐';
          return;
        }
        busy = true;
        note.textContent = 'Обробка…';
        haptic('medium');
        fetch('/api/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: initData, item: item }),
        }).then(function (r) { return r.json(); }).then(function (res) {
          busy = false;
          if (!res || !res.ok) {
            if (res && typeof res.starsBalance === 'number') { balance = res.starsBalance; updateBal(); }
            note.textContent = (res && res.reason === 'insufficient')
              ? 'Недостатньо зірок.' : 'Не вдалося. Спробуй ще раз.';
            return;
          }
          notify('success');
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
          note.textContent = 'Помилка мережі. Спробуй ще раз.';
        });
      });
    });

    return { close: close };
  }

  window.SixtioPaywall = { open: open };
})();
