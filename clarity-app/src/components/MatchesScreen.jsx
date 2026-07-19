import { ibg, PATHS } from '../lib/icons.js';
import { DECK } from '../lib/data.js';
import Header from './Header.jsx';

export default function MatchesScreen({ tokens, theme, onToggleTheme, onOpenProfile, onGoFeed }) {
  const { accRGB } = tokens;
  const chevIcon = ibg(PATHS.chevron, { stroke: 'var(--faint)', sw: 2, size: 16 });
  const lockIcon = ibg(PATHS.lock, { stroke: 'var(--coral-ink)', sw: 1.8, size: 19 });

  const left = (
    <div>
      <div className="sx-ink" style={{ fontSize: '28px', fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink)' }}>Метчі</div>
      <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '2px' }}>3 збіги · оновлено щойно</div>
    </div>
  );

  return (
    <div className="no-scrollbar" style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '50px 20px 120px' }}>
      <Header leftNode={left} theme={theme} onToggleTheme={onToggleTheme} tokens={tokens} />
      <button onClick={onGoFeed} style={{ width: '100%', padding: '15px', border: 'none', borderRadius: '18px', cursor: 'pointer', fontSize: '14.5px', fontWeight: 600, color: '#fff', background: 'var(--acc)', boxShadow: '0 14px 30px -12px rgba(' + accRGB + ',.6)', marginBottom: '16px' }}>Знайти пару зараз</button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {DECK.map((d, idx) => (
          <button key={d.name} onClick={() => onOpenProfile(idx)} style={{ textAlign: 'left', width: '100%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '14px', padding: '12px', borderRadius: '22px', background: 'var(--surface)', boxShadow: '0 12px 30px -20px rgba(60,45,30,.5)' }}>
            <div style={{ width: '62px', height: '62px', borderRadius: '20px', flex: 'none', background: d.grad }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
                <span style={{ fontSize: '18px', fontWeight: 600, color: 'var(--ink)' }}>{d.name}</span>
                <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{d.age}</span>
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--muted)', margin: '3px 0 8px' }}>{d.city + (d.online ? ' · онлайн' : ' · нещодавно')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--acc)', padding: '3px 9px', borderRadius: '999px', background: 'rgba(' + accRGB + ',.09)', border: '1px solid rgba(' + accRGB + ',.18)' }}>{d.compat}% сумісність</span>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>спільне: {d.values[2].toLowerCase()}</span>
              </div>
            </div>
            <span style={chevIcon} />
          </button>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px', borderRadius: '22px', background: 'linear-gradient(180deg,var(--coral-card1),var(--coral-card2))', border: '1px solid rgba(255,90,44,.18)' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '13px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,90,44,.12)' }}><span style={lockIcon} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink)' }}>Ще 6 збігів чекають</div>
            <div style={{ fontSize: '11.5px', color: 'var(--coral-mut)', marginTop: '2px' }}>Відкрий усі метчі за ⭐ 50</div>
          </div>
          <span style={{ fontSize: '15px', color: 'var(--coral-ink)' }}>›</span>
        </div>
      </div>
    </div>
  );
}
