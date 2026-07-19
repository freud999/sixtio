import { useEffect, useRef, useState } from 'react';
import { ME, verdict } from '../lib/data.js';
import { prefersReducedMotion } from '../lib/theme.js';

const RING_C = 2 * Math.PI * 52;

export default function CompatibilitySheet({ open, person, tokens, onClose }) {
  const { acc, accRGB } = tokens;
  const reduced = prefersReducedMotion();
  const [score, setScore] = useState(0);
  const [shown, setShown] = useState(false);
  const raf = useRef(null);

  useEffect(() => {
    if (!open) return;
    setShown(false); setScore(0);
    const id = requestAnimationFrame(() => {
      setShown(true);
      const target = person.compat;
      if (reduced) { setScore(target); return; }
      const dur = 950, t0 = performance.now();
      const ease = (x) => 1 - Math.pow(1 - x, 3);
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        setScore(target * ease(p));
        if (p < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    });
    return () => { cancelAnimationFrame(id); if (raf.current) cancelAnimationFrame(raf.current); };
  }, [open, person, reduced]);

  const ringOffset = (RING_C * (1 - (score || 0) / 100)).toFixed(2);
  const scoreNum = Math.round(score || 0);

  const backdrop = { position: 'absolute', inset: 0, background: 'rgba(30,25,18,.42)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: reduced ? 'opacity .2s' : 'opacity .25s', zIndex: 20 };
  const panel = { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 21, padding: '22px 22px 30px', borderRadius: '30px 30px 46px 46px', background: 'var(--surface)', boxShadow: '0 -20px 60px -20px rgba(60,45,30,.4)', transform: open ? 'translateY(0)' : 'translateY(102%)', transition: reduced ? 'none' : 'transform .34s cubic-bezier(.2,.8,.25,1)' };

  const traits = person.big5.map((b, idx) => {
    const herVal = b.v, myVal = ME[b.k] ?? 70;
    const close = 100 - Math.abs(myVal - herVal);
    const lo = Math.min(myVal, herVal), diff = Math.abs(myVal - herVal);
    const mc = close >= 85 ? '#3B9E6B' : close >= 70 ? acc : '#C98A2E';
    return {
      k: b.k, close, matchColor: mc, myVal, herVal,
      rowStyle: { opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(8px)', transition: reduced ? 'none' : `opacity .4s ease ${idx * 0.06}s, transform .4s cubic-bezier(.2,.8,.25,1) ${idx * 0.06}s` },
      bandStyle: { position: 'absolute', top: '3px', height: '4px', borderRadius: '999px', left: lo + '%', width: diff + '%', background: 'rgba(' + accRGB + ',.28)', transition: reduced ? 'none' : `width .5s ease ${idx * 0.06 + 0.15}s` },
      meDot: { position: 'absolute', top: '-2px', left: `calc(${myVal}% - 7px)`, width: '14px', height: '14px', borderRadius: '50%', background: 'var(--ink)', border: '2px solid var(--surface)', boxShadow: '0 2px 5px rgba(23,22,28,.35)', opacity: shown ? 1 : 0, transition: reduced ? 'none' : `opacity .3s ease ${idx * 0.06 + 0.2}s` },
      herDot: { position: 'absolute', top: '-2px', left: `calc(${herVal}% - 7px)`, width: '14px', height: '14px', borderRadius: '50%', background: acc, border: '2px solid var(--surface)', boxShadow: '0 2px 6px rgba(' + accRGB + ',.5)', opacity: shown ? 1 : 0, transition: reduced ? 'none' : `opacity .3s ease ${idx * 0.06 + 0.28}s` },
    };
  });

  return (
    <>
      <div onClick={onClose} style={backdrop} />
      <div style={panel}>
        <div style={{ width: '38px', height: '4px', borderRadius: '999px', background: 'rgba(23,22,28,.16)', margin: '0 auto 18px' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', marginBottom: '6px' }}>
          <div style={{ position: 'relative', width: '132px', height: '132px' }}>
            <svg viewBox="0 0 120 120" width="132" height="132" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--track)" strokeWidth="11" />
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--acc)" strokeWidth="11" strokeLinecap="round" strokeDasharray={RING_C.toFixed(2)} strokeDashoffset={ringOffset} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700, fontSize: '40px', lineHeight: 1, letterSpacing: '-.04em', color: 'var(--ink)' }}>{scoreNum}</span>
                <span style={{ fontWeight: 700, fontSize: '19px', color: 'var(--acc)' }}>%</span>
              </span>
              <span style={{ fontSize: '8px', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)', marginTop: '3px' }}>сумісність</span>
            </div>
          </div>
          <div className="sx-ink" style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink)', marginTop: '4px' }}>{verdict(person.compat)}</div>
          <div style={{ fontSize: '11.5px', lineHeight: 1.4, color: 'var(--muted2)', textAlign: 'center', maxWidth: '270px' }}>{person.why}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '18px', margin: '18px 0 14px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--ink3)' }}><span style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--strong)' }} />Ти</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--ink3)' }}><span style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--acc)' }} />{person.name}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {traits.map((b) => (
            <div key={b.k} style={b.rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <span style={{ fontSize: '12.5px', color: 'var(--ink2)' }}>{b.k}</span>
                <span style={{ fontSize: '11.5px', fontWeight: 600, color: b.matchColor }}>{b.close}% збіг</span>
              </div>
              <div style={{ position: 'relative', height: '10px' }}>
                <div style={{ position: 'absolute', top: '3px', left: 0, right: 0, height: '4px', borderRadius: '999px', background: 'var(--track)' }} />
                <div style={b.bandStyle} />
                <div style={b.meDot} />
                <div style={b.herDot} />
              </div>
            </div>
          ))}
        </div>

        <button onClick={onClose} style={{ marginTop: '24px', border: 'none', cursor: 'pointer', width: '100%', padding: '16px', borderRadius: '20px', fontSize: '15px', fontWeight: 600, color: '#fff', background: 'var(--acc)', boxShadow: '0 14px 30px -10px rgba(' + accRGB + ',.6)' }}>Написати {person.name}</button>
      </div>
    </>
  );
}
