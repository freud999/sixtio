import { useState } from 'react';
import { ibg, PATHS } from '../lib/icons.js';
import { haptic } from '../lib/telegram.js';
import { prefersReducedMotion } from '../lib/theme.js';

function Switch({ on, onToggle, hue, tokens, reduced }) {
  const { accRGB, accGrad } = tokens;
  const track = { width: '50px', height: '30px', flex: 'none', borderRadius: '999px', border: 'none', cursor: 'pointer', position: 'relative', background: on ? (hue || accGrad) : 'var(--track)', boxShadow: on ? '0 6px 16px -7px rgba(' + accRGB + ',.55)' : 'inset 0 1px 3px rgba(0,0,0,.12)', transition: reduced ? 'none' : 'background .25s' };
  const knob = { position: 'absolute', top: '3px', left: on ? '23px' : '3px', width: '24px', height: '24px', borderRadius: '50%', background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,.25)', transition: reduced ? 'none' : 'left .28s cubic-bezier(.34,1.4,.5,1)' };
  return <button onClick={onToggle} style={track}><span style={knob} /></button>;
}

export default function SettingsScreen({ open, tokens, theme, onClose, onToggleTheme }) {
  const { dark } = tokens;
  const reduced = prefersReducedMotion();
  const iRead = dark ? '#D8D2E4' : '#403c48';
  const [sw, setSw] = useState({ showMe: true, incognito: false, readReceipts: true, notifMatch: true, notifMsg: true });
  const tk = (k) => { haptic('select'); setSw((s) => ({ ...s, [k]: !s[k] })); };

  const panel = { position: 'absolute', inset: 0, zIndex: 45, background: 'var(--bg1)', overflowY: 'auto', padding: '50px 20px 44px', boxSizing: 'border-box', transform: open ? 'translateX(0)' : 'translateX(100%)', visibility: open ? 'visible' : 'hidden', transition: reduced ? 'none' : 'transform .36s cubic-bezier(.2,.8,.25,1), visibility .36s' };
  const group = { marginTop: '8px', borderRadius: '22px', background: 'var(--surface)', overflow: 'hidden', boxShadow: '0 14px 34px -20px rgba(60,45,30,.4)' };
  const label = { fontSize: '10.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)', margin: '24px 6px 4px' };
  const rowTop = { display: 'flex', alignItems: 'center', gap: '13px', padding: '15px 16px' };
  const row = { ...rowTop, borderTop: '1px solid var(--track)' };
  const chev = ibg(PATHS.chevron, { stroke: 'var(--faint)', sw: 2, size: 16 });

  return (
    <div className="no-scrollbar" style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
        <button onClick={onClose} style={{ width: '40px', height: '40px', borderRadius: '14px', border: '1px solid var(--hair2)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px -8px rgba(60,45,30,.5)' }}>
          <span style={ibg(PATHS.back, { stroke: iRead, sw: 2.2, size: 20 })} />
        </button>
        <span className="sx-ink" style={{ fontSize: '26px', fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink)' }}>Налаштування</span>
      </div>

      <div style={label}>Акаунт</div>
      <div style={group}>
        <button style={{ ...rowTop, width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ flex: 1, fontSize: '14.5px', color: 'var(--ink)' }}>Редагувати профіль</span><span style={chev} />
        </button>
        <div style={row}>
          <span style={{ flex: 1, fontSize: '14.5px', color: 'var(--ink)' }}>Верифікація</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 600, color: '#3B9E6B' }}><span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#3B9E6B' }} />Пройдено</span>
        </div>
        <div style={row}>
          <span style={{ flex: 1, fontSize: '14.5px', color: 'var(--ink)' }}>Номер телефону</span>
          <span style={{ fontSize: '13.5px', color: 'var(--muted)' }}>+380 •• ••• 42</span>
        </div>
      </div>

      <div style={label}>Показ у стрічці</div>
      <div style={group}>
        <div style={rowTop}>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: '14.5px', color: 'var(--ink)' }}>Показувати мене</span>
            <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--muted2)', marginTop: '2px' }}>Твій профіль бачитимуть інші</span>
          </span>
          <Switch on={sw.showMe} onToggle={() => tk('showMe')} tokens={tokens} reduced={reduced} />
        </div>
        <button style={{ ...row, width: '100%', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ flex: 1, fontSize: '14.5px', color: 'var(--ink)' }}>Вікові межі</span>
          <span style={{ fontSize: '13.5px', color: 'var(--muted)', marginRight: '2px' }}>22–30</span><span style={chev} />
        </button>
        <button style={{ ...row, width: '100%', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ flex: 1, fontSize: '14.5px', color: 'var(--ink)' }}>Максимальна відстань</span>
          <span style={{ fontSize: '13.5px', color: 'var(--muted)', marginRight: '2px' }}>25 км</span><span style={chev} />
        </button>
      </div>

      <div style={label}>Приватність</div>
      <div style={group}>
        <div style={rowTop}>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: '14.5px', color: 'var(--ink)' }}>Режим інкогніто</span>
            <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--muted2)', marginTop: '2px' }}>Тебе бачать лише ті, кого ти вподобав</span>
          </span>
          <Switch on={sw.incognito} onToggle={() => tk('incognito')} hue="linear-gradient(90deg,#FF5A2C,#FF8A5C)" tokens={tokens} reduced={reduced} />
        </div>
        <div style={row}>
          <span style={{ flex: 1, fontSize: '14.5px', color: 'var(--ink)' }}>Позначки прочитання</span>
          <Switch on={sw.readReceipts} onToggle={() => tk('readReceipts')} tokens={tokens} reduced={reduced} />
        </div>
        <button style={{ ...row, width: '100%', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ flex: 1, fontSize: '14.5px', color: 'var(--ink)' }}>Заблоковані</span>
          <span style={{ fontSize: '13.5px', color: 'var(--muted)', marginRight: '2px' }}>0</span><span style={chev} />
        </button>
      </div>

      <div style={label}>Сповіщення</div>
      <div style={group}>
        <div style={rowTop}>
          <span style={{ flex: 1, fontSize: '14.5px', color: 'var(--ink)' }}>Нові метчі</span>
          <Switch on={sw.notifMatch} onToggle={() => tk('notifMatch')} tokens={tokens} reduced={reduced} />
        </div>
        <div style={row}>
          <span style={{ flex: 1, fontSize: '14.5px', color: 'var(--ink)' }}>Повідомлення</span>
          <Switch on={sw.notifMsg} onToggle={() => tk('notifMsg')} tokens={tokens} reduced={reduced} />
        </div>
      </div>

      <div style={label}>Вигляд</div>
      <div style={group}>
        <div style={rowTop}>
          <span style={{ flex: 1, fontSize: '14.5px', color: 'var(--ink)' }}>Темна тема</span>
          <Switch on={dark} onToggle={onToggleTheme} tokens={tokens} reduced={reduced} />
        </div>
      </div>

      <button style={{ marginTop: '24px', width: '100%', padding: '15px', borderRadius: '18px', border: '1px solid var(--hair2)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', fontSize: '14.5px', fontWeight: 600, color: 'var(--ink2)', boxShadow: '0 10px 26px -18px rgba(60,45,30,.4)' }}>
        <span style={ibg(PATHS.logout, { stroke: iRead, sw: 1.9, size: 18 })} />Вийти з акаунта
      </button>
      <button style={{ marginTop: '10px', width: '100%', padding: '15px', borderRadius: '18px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', fontSize: '13.5px', fontWeight: 600, color: '#E5472B' }}>
        <span style={ibg(PATHS.trash, { stroke: '#E5472B', sw: 1.9, size: 17 })} />Видалити акаунт
      </button>
      <div style={{ textAlign: 'center', marginTop: '18px', fontSize: '11px', color: 'var(--faint)' }}>Sixtio · версія 1.0.4</div>
    </div>
  );
}
