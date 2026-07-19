import { ibg, PATHS } from '../lib/icons.js';
import { PSYCHO, INTERESTS, KINKS } from '../lib/data.js';
import { prefersReducedMotion } from '../lib/theme.js';
import Header from './Header.jsx';
import AvatarSlot from './AvatarSlot.jsx';

const card = { marginTop: '16px', padding: '20px', borderRadius: '24px', background: 'var(--surface)', boxShadow: '0 14px 34px -20px rgba(60,45,30,.4)' };
const label = { fontSize: '10.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '13px' };

export default function ProfileScreen({ tokens, theme, onToggleTheme, onOpenSettings, darkMode, onToggleDark, age18, onToggleAge }) {
  const { ember, dark, acc } = tokens;
  const reduced = prefersReducedMotion();
  const iStrong = dark ? '#F3EEF7' : '#fff';
  const iRead = dark ? '#D8D2E4' : '#403c48';
  const camIcon = ibg(PATHS.cam, { stroke: iStrong, sw: 1.7, size: 15 });
  const slidersIcon = ibg(PATHS.sliders, { stroke: iRead, sw: 1.8, size: 19 });

  const darkCard18 = ember
    ? { marginTop: '16px', padding: '20px', borderRadius: '24px', background: 'linear-gradient(180deg,#3A1C08,#280F04)', border: '1px solid rgba(255,140,40,.55)', boxShadow: '0 20px 50px -18px rgba(255,110,26,.6), inset 0 0 0 1px rgba(255,150,60,.12), 0 0 34px -12px rgba(255,120,30,.5)' }
    : { marginTop: '16px', padding: '20px', borderRadius: '24px', background: 'linear-gradient(180deg,var(--coral-card1),var(--coral-card2))', border: '1px solid rgba(255,90,44,.42)', boxShadow: '0 20px 46px -20px rgba(255,90,44,.5), inset 0 0 0 1px rgba(255,120,70,.14), 0 0 30px -14px rgba(255,90,44,.45)' };
  const badge18 = ember
    ? { fontSize: '9.5px', fontWeight: 700, color: '#1A0E04', background: 'linear-gradient(135deg,#FFB43C,#FF6A1A)', padding: '2px 7px', borderRadius: '6px', boxShadow: '0 0 14px -2px rgba(255,140,40,.8)' }
    : { fontSize: '9.5px', fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg,#FF7A3C,#FF5A2C)', padding: '2px 7px', borderRadius: '6px', boxShadow: '0 0 12px -2px rgba(255,90,44,.7)' };

  const darkTrack = { width: '52px', height: '30px', flex: 'none', borderRadius: '999px', border: 'none', cursor: 'pointer', position: 'relative', background: darkMode ? 'linear-gradient(90deg,#FF5A2C,#FF8A5C)' : 'var(--track)', boxShadow: darkMode ? '0 6px 16px -6px rgba(255,90,44,.6)' : 'inset 0 1px 3px rgba(0,0,0,.12)', transition: reduced ? 'none' : 'background .25s' };
  const darkKnob = { position: 'absolute', top: '3px', left: darkMode ? '25px' : '3px', width: '24px', height: '24px', borderRadius: '50%', background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,.25)', transition: reduced ? 'none' : 'left .28s cubic-bezier(.34,1.4,.5,1)' };
  const ageBox = { width: '22px', height: '22px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, color: '#fff', flex: 'none', background: age18 ? '#FF5A2C' : 'transparent', border: age18 ? '1px solid #FF5A2C' : '1.5px solid var(--hair-strong)' };

  const gearLeft = (
    <button onClick={onOpenSettings} style={{ width: '40px', height: '40px', borderRadius: '14px', border: 'none', background: 'var(--chip)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={slidersIcon} />
    </button>
  );

  const chip = (t, dotColor = 'var(--acc)', soft = false) => (
    <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 500, color: soft ? 'var(--acc)' : 'var(--ink2)', padding: '8px 14px', borderRadius: '12px', background: soft ? 'rgba(' + tokens.accRGB + ',.08)' : 'var(--chip)', border: soft ? '1px solid rgba(' + tokens.accRGB + ',.16)' : '1px solid var(--hair)' }}>
      {!soft && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: dotColor, opacity: 0.5 }} />}{t}
    </span>
  );

  return (
    <div className="no-scrollbar" style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '50px 20px 120px' }}>
      <Header leftNode={gearLeft} align="center" theme={theme} onToggleTheme={onToggleTheme} tokens={tokens} />

      {/* hero */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: '108px', height: '108px', borderRadius: '50%', padding: '3px', background: 'conic-gradient(from 200deg, var(--acc), var(--acc2), #FF5A2C, var(--acc))', boxShadow: '0 12px 30px -12px rgba(' + tokens.accRGB + ',.55)' }}>
          <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', border: '3px solid var(--bg1)', boxSizing: 'border-box' }}>
            <AvatarSlot />
          </div>
          <button style={{ position: 'absolute', bottom: 0, right: 0, width: '32px', height: '32px', borderRadius: '50%', border: '2.5px solid var(--bg1)', background: 'var(--strong)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px -4px rgba(23,22,28,.5)' }}>
            <span style={camIcon} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '14px' }}>
          <span className="sx-ink" style={{ fontSize: '29px', fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink)' }}>Serhii</span>
          <span style={{ fontSize: '22px', fontWeight: 400, color: 'var(--muted)' }}>24</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--muted)' }} />
          <span style={{ fontSize: '12.5px', color: 'var(--muted2)' }}>Чернівці</span>
        </div>
        <div style={{ marginTop: '14px', padding: '9px 18px', borderRadius: '999px', background: 'rgba(' + tokens.accRGB + ',.1)', border: '1px solid rgba(' + tokens.accRGB + ',.2)', fontSize: '13px', fontWeight: 600, color: 'var(--acc)' }}>Хочу розважитись</div>
      </div>

      {/* profile depth */}
      <button style={{ marginTop: '24px', width: '100%', textAlign: 'left', padding: '16px', border: 'none', borderRadius: '22px', cursor: 'pointer', background: 'var(--surface)', boxShadow: '0 14px 34px -20px rgba(60,45,30,.4)', display: 'flex', alignItems: 'center', gap: '14px' }}>
        <span style={{ position: 'relative', width: '46px', height: '46px', flex: 'none' }}>
          <svg viewBox="0 0 44 44" width="46" height="46" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="22" cy="22" r="19" fill="none" stroke="var(--track)" strokeWidth="4" />
            <circle cx="22" cy="22" r="19" fill="none" stroke="var(--acc)" strokeWidth="4" strokeLinecap="round" strokeDasharray="119.4" strokeDashoffset="0" />
          </svg>
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--acc)' }}>100</span>
        </span>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: '14.5px', fontWeight: 600, color: 'var(--ink)' }}>Глибина профілю</span>
          <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--muted2)', marginTop: '2px' }}>Профіль заповнено повністю</span>
        </span>
        <span style={{ fontSize: '16px', color: 'var(--muted)' }}>›</span>
      </button>

      {/* about */}
      <div style={card}>
        <div style={label}>Про мене</div>
        <div style={{ fontSize: '13px', lineHeight: 1.55, color: 'var(--ink2)' }}>Ціную глибокі розмови пізно ввечері, гарну каву й чесність без пів-тонів. Шукаю не флірт, а людину, з якою цікаво мовчати.</div>
      </div>

      {/* psychotype */}
      <div style={card}>
        <div style={label}>Психотип</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>{PSYCHO.map((p) => chip(p, undefined, true))}</div>
        <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--track)', fontSize: '13px', lineHeight: 1.55, color: 'var(--ink3)' }}>Ти — людина глибокої розумності й чітких кордонів, яка живе інтенсивністю та потребує щирості від оточення. Твоя любов — це перевірка часом і послідовністю, тому ти обираєш людей дуже уважно.</div>
      </div>

      {/* interests */}
      <div style={card}>
        <div style={label}>Інтереси</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>{INTERESTS.map((v) => chip(v))}</div>
      </div>

      {/* achievements */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '13px' }}>
          <span style={{ fontSize: '10.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>Досягнення</span>
          <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--muted2)' }}>3 з 6</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {['Пройшов інтерв\'ю', 'Глибокий профіль', 'Перший метч'].map((t) => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 500, color: 'var(--ink2)', padding: '8px 13px', borderRadius: '12px', background: 'var(--chip)', border: '1px solid var(--hair)' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3B9E6B' }} />{t}
            </span>
          ))}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 500, color: 'var(--faint)', padding: '8px 13px', borderRadius: '12px', background: 'var(--chip2)', border: '1px dashed var(--hair3)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#d3cabc' }} />10 діалогів
          </span>
        </div>
      </div>

      {/* dark mode 18+ */}
      <div style={darkCard18}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)' }}>Dark Mode</span>
              <span style={badge18}>18+</span>
            </div>
            <div style={{ fontSize: '12px', lineHeight: 1.45, color: 'var(--coral-desc)' }}>Анонімний пошук за приватною сумісністю. Видно лише тим, хто теж увімкнув Dark&nbsp;Mode.</div>
          </div>
          <button onClick={onToggleDark} style={darkTrack}><span style={darkKnob} /></button>
        </div>
        <button onClick={onToggleAge} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '15px', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
          <span style={ageBox}>{age18 ? '✓' : ''}</span>
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ink2)' }}>Мені є 18 років</span>
        </button>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '15px' }}>
          {KINKS.map((k) => (
            <span key={k} style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--coral-ink)', padding: '8px 14px', borderRadius: '12px', background: 'rgba(255,90,44,.08)', border: '1px solid rgba(255,90,44,.2)' }}>{k}</span>
          ))}
        </div>
        <a href="#" onClick={(e) => e.preventDefault()} style={{ display: 'inline-block', marginTop: '15px', fontSize: '12.5px', fontWeight: 600, color: '#FF5A2C', textDecoration: 'none' }}>Пройти інтерв'ю знову →</a>
      </div>

      {/* invite */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--ink)' }}>Запроси друзів</div>
          <div style={{ fontSize: '12px', color: 'var(--muted2)', marginTop: '3px' }}>+15 ⭐ за кожного після інтерв'ю</div>
        </div>
        <button style={{ padding: '12px 20px', border: 'none', borderRadius: '16px', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#fff', background: 'var(--acc)', boxShadow: '0 12px 26px -10px rgba(' + tokens.accRGB + ',.6)' }}>Запросити</button>
      </div>

      <div style={{ textAlign: 'center', marginTop: '22px' }}><a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: '12px', color: 'var(--muted)', textDecoration: 'none' }}>Політика конфіденційності</a></div>
    </div>
  );
}
