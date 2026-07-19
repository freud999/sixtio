import { useRef, useEffect, useState } from 'react';
import { ibg, ibgOnly, PATHS } from '../lib/icons.js';
import { haptic } from '../lib/telegram.js';
import Header from './Header.jsx';

/*
  Feed screen — editorial match card with Apple-style fluid gestures:
  1:1 drag with grab-offset, photo parallax, anticipatory buttons, momentum
  projection on release, spring return / fly-off, rubber-banded vertical drag.
  Physics run outside React state (refs + rAF) so we never re-render per frame.
*/
export default function FeedScreen({ person, nextPerson, tokens, reduced, onAdvance, onOpenSheet, showToast, theme, onToggleTheme }) {
  const cardRef = useRef(null);
  const photoRef = useRef(null);
  const likeRef = useRef(null);
  const nopeRef = useRef(null);
  const badgeRef = useRef(null);
  const aiRef = useRef(null);
  const likeBtnRef = useRef(null);
  const passBtnRef = useRef(null);

  const phys = useRef({ x: 0, y: 0, dragging: false, raf: null, hinted: 0, hist: [], grabX: 0, grabY: 0, downRect: null, downX: 0, downY: 0 });
  const [photoIdx, setPhotoIdx] = useState(0);

  // keep latest props reachable from imperative paint/commit without re-binding handlers
  const ctx = useRef({});
  ctx.current = { person, tokens, reduced, onAdvance, showToast };

  const gallery = person.photos || [person.grad];
  const pIdx = photoIdx % gallery.length;

  const buzz = (kind) => haptic(kind);

  const paint = () => {
    const c = cardRef.current; if (!c) return;
    const P = phys.current;
    const accRGB = ctx.current.tokens.accRGB;
    c.style.transform = `translate3d(${P.x}px, ${P.y}px, 0) rotate(${P.x * 0.04}deg)`;
    const t = Math.min(1, Math.abs(P.x) / 120);
    if (likeRef.current) likeRef.current.style.opacity = P.x > 0 ? t : 0;
    if (nopeRef.current) nopeRef.current.style.opacity = P.x < 0 ? t : 0;
    c.style.boxShadow = '0 ' + (30 + Math.abs(P.x) * 0.12) + 'px ' + (70 + Math.abs(P.x) * 0.18) + 'px -26px rgba(60,45,30,' + (0.5 + t * 0.15) + ')';
    if (photoRef.current) photoRef.current.style.transform = 'scale(1.06) translateX(' + (-P.x * 0.05) + 'px)';
    if (badgeRef.current) badgeRef.current.style.opacity = 1 - t * 0.5;
    if (aiRef.current) aiRef.current.style.opacity = 1 - t * 0.7;
    const lb = likeBtnRef.current, pb = passBtnRef.current;
    if (lb) {
      const s = P.x > 0 ? 1 + Math.min(0.22, P.x / 560) : 1; lb.style.transform = 'scale(' + s + ')';
      lb.style.boxShadow = P.x > 0 ? '0 14px 32px -6px rgba(' + accRGB + ',' + (0.55 + t * 0.4) + ')' : '0 12px 28px -8px rgba(' + accRGB + ',.6)';
    }
    if (pb) {
      const s = P.x < 0 ? 1 + Math.min(0.22, -P.x / 560) : 1; pb.style.transform = 'scale(' + s + ')';
      pb.style.borderColor = P.x < 0 ? 'rgba(255,90,44,' + (0.25 + t * 0.6) + ')' : 'var(--hair3)';
    }
  };

  const cancelRaf = () => { const P = phys.current; if (P.raf) { cancelAnimationFrame(P.raf); P.raf = null; } };
  const rubber = (v, dim, c = 0.55) => (v * dim * c) / (dim + c * Math.abs(v));
  const project = (v, d = 0.998) => (v / 1000) * d / (1 - d);
  const velFromHist = () => {
    const h = phys.current.hist; if (!h || h.length < 2) return { vx: 0, vy: 0 };
    const a = h[0], b = h[h.length - 1], dt = (b.t - a.t) / 1000 || 0.016;
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  };

  const springTo = (tx, ty, vx0, vy0, bounce, done) => {
    cancelRaf();
    const P = phys.current;
    const resp = bounce ? 0.4 : 0.35, zeta = bounce ? 0.8 : 1.0;
    const w = 2 * Math.PI / resp, k = w * w, cc = 2 * zeta * w;
    let vx = vx0 * 0.6, vy = vy0 * 0.6, last = performance.now();
    const step = () => {
      const now = performance.now(); let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05;
      const ax = -k * (P.x - tx) - cc * vx; vx += ax * dt; P.x += vx * dt;
      const ay = -k * (P.y - ty) - cc * vy; vy += ay * dt; P.y += vy * dt;
      paint();
      if (Math.hypot(P.x - tx, P.y - ty) < 0.5 && Math.hypot(vx, vy) < 6) {
        P.x = tx; P.y = ty; paint(); P.raf = null; if (done) done(); return;
      }
      P.raf = requestAnimationFrame(step);
    };
    P.raf = requestAnimationFrame(step);
  };

  const materialize = () => {
    const c = cardRef.current; if (!c) return;
    if (ctx.current.reduced) { c.style.transform = 'none'; return; }
    c.style.transform = 'scale(.92)'; c.style.opacity = '0';
    requestAnimationFrame(() => {
      c.style.transition = 'transform .34s cubic-bezier(.2,.8,.25,1), opacity .28s ease';
      c.style.transform = 'none'; c.style.opacity = '1';
      setTimeout(() => { if (c) c.style.transition = ''; }, 360);
    });
  };

  const next = () => {
    const P = phys.current; P.x = 0; P.y = 0;
    if (likeRef.current) likeRef.current.style.opacity = 0;
    if (nopeRef.current) nopeRef.current.style.opacity = 0;
    setPhotoIdx(0);
    ctx.current.onAdvance();       // parent advances the deck index
    requestAnimationFrame(materialize);
  };

  const commit = (dir, vx, vy) => {
    buzz(dir > 0 ? 'success' : 'medium');
    ctx.current.showToast(dir > 0 ? '♥ Вподобано' : '✕ Пас');
    const target = dir * 520;
    if (ctx.current.reduced) { phys.current.x = target; paint(); next(); return; }
    springTo(target, phys.current.y, vx, vy, true, next);
  };

  const tapPhoto = () => {
    const P = phys.current; const r = P.downRect; if (!r) return;
    if ((P.downY - r.top) > r.height * 0.6) return;   // taps land on the photo region only
    const g = ctx.current.person.photos || [ctx.current.person.grad];
    const n = g.length; if (n < 2) return;
    const dir = (P.downX - r.left) < r.width / 2 ? -1 : 1;
    buzz('select');
    setPhotoIdx((s) => (s + dir + n) % n);
    const p = photoRef.current;
    if (p && !ctx.current.reduced) {
      p.style.transition = 'none'; p.style.opacity = '0.4';
      requestAnimationFrame(() => { p.style.transition = 'opacity .3s ease'; p.style.opacity = '1'; });
    }
  };

  const onDown = (e) => {
    if (e.target.closest('button')) return;
    cancelRaf();
    e.currentTarget.setPointerCapture(e.pointerId);
    const P = phys.current;
    P.dragging = true; P.hinted = 0;
    P.downRect = e.currentTarget.getBoundingClientRect(); P.downX = e.clientX; P.downY = e.clientY;
    P.grabX = e.clientX - P.x; P.grabY = e.clientY - P.y;
    P.hist = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    e.currentTarget.style.cursor = 'grabbing';
  };

  const onMove = (e) => {
    const P = phys.current; if (!P.dragging) return;
    P.x = e.clientX - P.grabX;
    P.y = rubber(e.clientY - P.grabY, 400);
    P.hist.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (P.hist.length > 6) P.hist.shift();
    if (!P.hinted && Math.abs(P.x) > 120) { P.hinted = Math.sign(P.x); buzz('light'); }
    paint();
  };

  const onUp = (e) => {
    const P = phys.current; if (!P.dragging) return;
    P.dragging = false;
    if (e.currentTarget.style) e.currentTarget.style.cursor = 'grab';
    if (Math.abs(P.x) < 8 && Math.abs(P.y) < 8) { tapPhoto(); P.x = 0; P.y = 0; paint(); return; }
    const { vx, vy } = velFromHist();
    const projected = P.x + project(vx);
    const flick = Math.abs(vx) > 500;
    if (Math.abs(P.x) > 90 || Math.abs(projected) > 150 || flick) commit(P.x > 0 ? 1 : -1, vx, vy);
    else springTo(0, 0, vx, vy, false);
  };

  useEffect(() => { paint(); return cancelRaf; }, []); // eslint-disable-line

  const { acc, accRGB } = tokens;
  const cityLine = person.online ? person.city + ' · онлайн' : person.city;
  const deg = person.compat * 3.6;

  const stampBase = {
    position: 'absolute', top: '20px', width: '56px', height: '56px', borderRadius: '50%', opacity: 0,
    left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  };
  const sparkIcon = { width: '15px', height: '15px', flex: 'none', marginTop: '1px', ...ibgOnly(PATHS.spark, { fill: acc, size: 15 }) };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '50px 20px 120px' }}>
      <Header subtitle="Твоя добірка на сьогодні" theme={theme} onToggleTheme={onToggleTheme} tokens={tokens} />

      {/* deck */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {/* next card peeking (depth) */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '34px', overflow: 'hidden', transform: 'scale(.94) translateY(16px)', opacity: 0.6, boxShadow: '0 20px 50px -24px rgba(60,45,30,.4)' }}>
          <div style={{ position: 'absolute', inset: 0, background: nextPerson.grad }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(251,248,243,.4)' }} />
        </div>

        {/* draggable card */}
        <div
          ref={cardRef}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          style={{ position: 'absolute', inset: 0, borderRadius: '34px', overflow: 'hidden', background: 'var(--surface)', boxShadow: '0 30px 70px -26px rgba(60,45,30,.5)', cursor: 'grab', touchAction: 'none', willChange: 'transform' }}
        >
          {/* photo region */}
          <div style={{ position: 'relative', height: '60%', overflow: 'hidden' }}>
            <div ref={photoRef} style={{ position: 'absolute', inset: 0, background: gallery[pIdx] }} />
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '90px', background: 'linear-gradient(to bottom, rgba(23,22,28,.28), transparent)', pointerEvents: 'none' }} />
            {/* photo-count segments */}
            <div style={{ position: 'absolute', top: '13px', left: '16px', right: '16px', display: 'flex', gap: '5px' }}>
              {gallery.map((_, k) => (
                <span key={k} style={{ flex: 1, height: '3px', borderRadius: '999px', background: k === pIdx ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.4)', boxShadow: k === pIdx ? '0 1px 3px rgba(0,0,0,.3)' : 'none' }} />
              ))}
            </div>
            {/* gesture hint stamps */}
            <div ref={likeRef} style={{ ...stampBase, background: 'rgba(' + accRGB + ',.82)', boxShadow: '0 10px 30px -8px rgba(' + accRGB + ',.7)' }}>
              <span style={ibg(PATHS.heart, { fill: '#fff', size: 26 })} />
            </div>
            <div ref={nopeRef} style={{ ...stampBase, background: 'rgba(60,60,72,.6)', boxShadow: '0 10px 30px -8px rgba(23,22,28,.5)' }}>
              <span style={ibg(PATHS.cross, { stroke: '#fff', sw: 2.4, size: 24 })} />
            </div>
            {/* AI chip */}
            <div ref={aiRef} className="sx-glass" style={{ position: 'absolute', top: '28px', left: '16px', display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 12px', borderRadius: '14px', background: 'var(--glass-soft)', backdropFilter: 'blur(12px) saturate(150%)', WebkitBackdropFilter: 'blur(12px) saturate(150%)', border: '1px solid var(--glass-soft)' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--acc)', boxShadow: '0 0 8px var(--acc)' }} />
              <span style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '.03em', color: 'var(--ink2)' }}>AI-метч на сьогодні</span>
            </div>
          </div>

          {/* content region */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%', padding: '24px 22px 22px', boxSizing: 'border-box', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: '11px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px' }}>
              <span className="sx-ink" style={{ fontSize: '30px', fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink)' }}>{person.name}</span>
              <span style={{ fontSize: '22px', fontWeight: 400, color: 'var(--muted)' }}>{person.age}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: 'auto' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#3B9E6B', boxShadow: '0 0 0 3px rgba(59,158,107,.18)' }} />
                <span style={{ fontSize: '11.5px', fontWeight: 500, color: 'var(--muted2)' }}>{cityLine}</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '11px 13px', borderRadius: '15px', background: 'var(--chip2)', border: '1px solid rgba(' + accRGB + ',.1)' }}>
              <span style={sparkIcon} />
              <span style={{ fontSize: '12px', lineHeight: 1.4, color: 'var(--ink3)' }}>
                <span style={{ color: 'var(--acc)', fontWeight: 600 }}>Чому збіг&nbsp;·&nbsp;</span>{person.why}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: 'auto' }}>
              {person.values.map((v) => (
                <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 500, color: 'var(--ink2)', padding: '7px 13px', borderRadius: '12px', background: 'var(--chip)', border: '1px solid var(--hair)' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--acc)', opacity: 0.55 }} />{v}
                </span>
              ))}
            </div>
          </div>

          {/* floating compatibility ring on the seam */}
          <button
            ref={badgeRef} onClick={onOpenSheet}
            style={{ position: 'absolute', top: '60%', right: '20px', transform: 'translateY(-50%)', border: 'none', cursor: 'pointer', width: '74px', height: '74px', borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'conic-gradient(' + acc + ' 0 ' + deg + 'deg, rgba(255,255,255,.55) ' + deg + 'deg 360deg)', boxShadow: '0 14px 32px -10px rgba(23,22,28,.55)' }}
          >
            <span style={{ width: '60px', height: '60px', borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--glass-badge)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}>
              <span style={{ fontWeight: 700, fontSize: '23px', lineHeight: 0.9, letterSpacing: '-.03em', color: 'var(--ink)' }}>{person.compat}<span style={{ fontSize: '12px', color: 'var(--acc)' }}>%</span></span>
              <span style={{ fontSize: '6.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)', marginTop: '1px' }}>збіг</span>
            </span>
          </button>
        </div>
      </div>

      {/* action row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '18px', flex: 'none' }}>
        <button
          ref={passBtnRef} onClick={() => commit(-1, -900, 0)}
          style={{ width: '58px', height: '58px', flex: 'none', borderRadius: '20px', background: 'var(--surface)', border: '1px solid var(--hair3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 28px -8px rgba(' + accRGB + ',.6)' }}
        >
          <span style={ibg(PATHS.cross, { stroke: '#FF5A2C', sw: 2.2, size: 24 })} />
        </button>
        <button
          onClick={onOpenSheet}
          style={{ flex: 1, height: '58px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '15px', fontWeight: 600, color: '#fff', background: 'var(--strong)', boxShadow: '0 14px 30px -12px rgba(23,22,28,.7)', transition: 'transform 100ms ease-out' }}
          onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(.97)')}
          onPointerUp={(e) => (e.currentTarget.style.transform = 'none')}
          onPointerLeave={(e) => (e.currentTarget.style.transform = 'none')}
        >Дізнатись більше</button>
        <button
          ref={likeBtnRef} onClick={() => commit(1, 900, 0)}
          style={{ width: '58px', height: '58px', flex: 'none', borderRadius: '20px', background: 'var(--acc)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 28px -8px rgba(' + accRGB + ',.6)' }}
        >
          <span style={ibg(PATHS.heart, { fill: '#fff', size: 24 })} />
        </button>
      </div>
    </div>
  );
}
