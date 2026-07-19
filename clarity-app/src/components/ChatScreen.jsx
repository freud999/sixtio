import { ibgOnly, PATHS } from '../lib/icons.js';
import { CHAT_SRC, DECK } from '../lib/data.js';
import Header from './Header.jsx';

export default function ChatScreen({ tokens, theme, onToggleTheme }) {
  const { acc, accRGB } = tokens;
  const sparkIcon = { width: '15px', height: '15px', flex: 'none', marginTop: '1px', ...ibgOnly(PATHS.spark, { fill: acc, size: 15 }) };
  const left = <div className="sx-ink" style={{ fontSize: '28px', fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink)' }}>Чат</div>;

  return (
    <div className="no-scrollbar" style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '50px 20px 120px' }}>
      <Header leftNode={left} theme={theme} onToggleTheme={onToggleTheme} tokens={tokens} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {CHAT_SRC.map((c) => (
          <button key={c.name} style={{ textAlign: 'left', width: '100%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 13px', borderRadius: '22px', background: 'var(--surface)', boxShadow: '0 12px 30px -20px rgba(60,45,30,.5)' }}>
            <div style={{ position: 'relative', flex: 'none' }}>
              <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: DECK[c.g].grad }} />
              <span style={{ position: 'absolute', bottom: 0, right: 0, width: '13px', height: '13px', borderRadius: '50%', background: c.on ? '#3B9E6B' : 'var(--faint)', border: '2.5px solid var(--surface)' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
                <span style={{ fontSize: '16.5px', fontWeight: 600, color: 'var(--ink)' }}>{c.name}</span>
                <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>{c.age}</span>
                <span style={{ fontSize: '10.5px', color: 'var(--faint)', marginLeft: 'auto' }}>{c.time}</span>
              </div>
              <div style={{ fontSize: '12.5px', color: c.unread ? 'var(--ink)' : 'var(--muted)', fontWeight: c.unread ? 600 : 400, marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last}</div>
            </div>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '11px', marginTop: '18px', padding: '15px', borderRadius: '20px', background: 'var(--chip2)', border: '1px solid rgba(' + accRGB + ',.1)' }}>
        <span style={sparkIcon} />
        <span style={{ fontSize: '12px', lineHeight: 1.45, color: 'var(--ink3)' }}>
          <span style={{ color: 'var(--acc)', fontWeight: 600 }}>AI-підказка&nbsp;·&nbsp;</span>Sixtio пропонує теми для розмови на основі ваших спільних цінностей.
        </span>
      </div>
    </div>
  );
}
