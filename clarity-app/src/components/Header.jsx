import { ibg, PATHS } from '../lib/icons.js';

// Shared top bar: title/subtitle (or a custom left node) + theme toggle + Stars balance.
export default function Header({ title = 'Sixtio', subtitle, size = 25, theme, onToggleTheme, tokens, leftNode, align = 'flex-end' }) {
  const dark = tokens.dark;
  const iIcon = dark ? '#CFC7DE' : '#3c3a44';
  const themeIcon = dark
    ? ibg(PATHS.sun, { stroke: iIcon, sw: 1.8, size: 19 })
    : ibg(PATHS.moon, { fill: iIcon, size: 18 });
  const starIcon = ibg(PATHS.star, { fill: '#F6B93B', size: 15 });

  return (
    <div style={{ display: 'flex', alignItems: align, justifyContent: 'space-between', paddingBottom: '18px', flex: 'none' }}>
      {leftNode || (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span className="sx-ink" style={{ fontSize: size + 'px', fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink)' }}>{title}</span>
          {subtitle && <span style={{ fontSize: '10px', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>{subtitle}</span>}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button onClick={onToggleTheme} style={{ width: '38px', height: '38px', borderRadius: '16px', border: '1px solid var(--hair2)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px -8px rgba(60,45,30,.5)' }}>
          <span style={themeIcon} />
        </button>
        <button style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 13px', borderRadius: '16px', border: '1px solid var(--star-border)', background: 'var(--star-bg)', cursor: 'pointer' }}>
          <span style={starIcon} />
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--star-ink)' }}>122</span>
        </button>
      </div>
    </div>
  );
}
