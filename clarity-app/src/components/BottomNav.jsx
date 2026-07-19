import { src, ibg, NAV_ICONS } from '../lib/icons.js';
import { prefersReducedMotion } from '../lib/theme.js';

// Light dock + spring indigo/ember blob that lifts the active icon.
export default function BottomNav({ active, onSelect, tokens }) {
  const { acc, accRGB, accGrad, dark } = tokens;
  const reduced = prefersReducedMotion();
  const iMut = dark ? '#8C84A0' : '#9a9488';

  const lift = {
    position: 'absolute', bottom: '34px',
    left: `calc(20px + 8px + ${active} * ((100% - 40px - 16px)/4) + ((100% - 40px - 16px)/8) - 24px)`,
    width: '48px', height: '48px', borderRadius: '16px',
    backgroundColor: acc,
    backgroundImage: 'url("' + src(NAV_ICONS[active], { fill: '#fff', size: 22 }) + '"), ' + accGrad,
    backgroundSize: '22px, cover', backgroundRepeat: 'no-repeat, no-repeat', backgroundPosition: 'center, center',
    zIndex: 2, boxShadow: '0 12px 26px -6px rgba(' + accRGB + ',.7)',
    transition: reduced ? 'none' : 'left .5s cubic-bezier(.34,1.56,.5,1)',
  };

  return (
    <>
      <div style={lift} />
      <div className="sx-glass" style={{ position: 'absolute', left: '20px', right: '20px', bottom: '26px', height: '64px', display: 'flex', alignItems: 'center', padding: '0 8px', borderRadius: '24px', background: 'var(--glass)', backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)', border: '1px solid rgba(255,255,255,.85)', boxShadow: '0 20px 44px -16px rgba(60,45,30,.5)', zIndex: 1 }}>
        {NAV_ICONS.map((path, idx) => {
          const on = idx === active;
          return (
            <button key={idx} onClick={() => onSelect(idx)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', flex: 1, height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={ibg(path, { fill: on ? 'rgba(0,0,0,0)' : iMut, size: 21 })} />
            </button>
          );
        })}
      </div>
    </>
  );
}
