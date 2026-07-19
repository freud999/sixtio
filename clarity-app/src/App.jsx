import { useEffect, useRef, useState } from 'react';
import { DECK } from './lib/data.js';
import { tokensFor } from './lib/theme.js';
import { initTelegram, initialTheme, onThemeChange, haptic, inTelegram } from './lib/telegram.js';
import FeedScreen from './components/FeedScreen.jsx';
import MatchesScreen from './components/MatchesScreen.jsx';
import ChatScreen from './components/ChatScreen.jsx';
import ProfileScreen from './components/ProfileScreen.jsx';
import CompatibilitySheet from './components/CompatibilitySheet.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import BottomNav from './components/BottomNav.jsx';
import Toast from './components/Toast.jsx';

export default function App() {
  const [theme, setTheme] = useState(initialTheme());
  const [tab, setTab] = useState(0);
  const [i, setI] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [settings, setSettings] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [age18, setAge18] = useState(true);
  const [toast, setToast] = useState({ show: false, text: '' });
  const toastTimer = useRef(null);

  useEffect(() => { initTelegram(); const off = onThemeChange(setTheme); return off; }, []);

  const tokens = tokensFor(theme);
  const person = DECK[i % DECK.length];
  const nextPerson = DECK[(i + 1) % DECK.length];

  const toggleTheme = () => { haptic('light'); setTheme((t) => (t === 'dark' ? 'light' : 'dark')); };
  const selectTab = (idx) => { haptic('select'); setTab(idx); };

  const showToast = (text) => {
    setToast({ show: true, text });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast((s) => ({ ...s, show: false })), 1400);
  };
  const advance = () => setI((n) => (n + 1) % DECK.length);
  const openProfileFromMatch = (idx) => { setI(idx); setTab(0); };

  return (
    <div className="stage">
      <div className="stage-caption">
        <b>Sixtio · Clarity</b>
        <span>Тягни картку пальцем — плавна фізика, проєкція моменту, гумові межі. Тисни «{person.compat}%» для розкладу сумісності.{inTelegram ? ' · Telegram WebApp активний' : ''}</span>
      </div>

      <div
        data-th={tokens.themeAttr}
        style={{ position: 'relative', width: '390px', height: '844px', borderRadius: '46px', overflow: 'hidden', background: 'linear-gradient(175deg,var(--bg1) 0%,var(--bg2) 100%)', boxShadow: '0 50px 130px -40px rgba(60,45,30,.4), inset 0 0 0 1px var(--hair)' }}
      >
        {/* airy halos */}
        <div style={{ position: 'absolute', top: '-70px', right: '-40px', width: '240px', height: '240px', borderRadius: '50%', background: 'radial-gradient(circle, oklch(0.9 0.07 280), transparent 70%)', filter: 'blur(30px)', opacity: 0.55, animation: 'sxDrift 15s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', bottom: '150px', left: '-70px', width: '220px', height: '220px', borderRadius: '50%', background: 'radial-gradient(circle, oklch(0.9 0.07 40), transparent 70%)', filter: 'blur(30px)', opacity: 0.5, animation: 'sxDrift 18s ease-in-out infinite reverse' }} />

        {tab === 0 && (
          <FeedScreen
            key={'feed'} person={person} nextPerson={nextPerson} tokens={tokens}
            reduced={typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches}
            onAdvance={advance} onOpenSheet={() => setSheet(true)} showToast={showToast}
            theme={theme} onToggleTheme={toggleTheme}
          />
        )}
        {tab === 1 && <MatchesScreen tokens={tokens} theme={theme} onToggleTheme={toggleTheme} onOpenProfile={openProfileFromMatch} onGoFeed={() => setTab(0)} />}
        {tab === 2 && <ChatScreen tokens={tokens} theme={theme} onToggleTheme={toggleTheme} />}
        {tab === 3 && (
          <ProfileScreen
            tokens={tokens} theme={theme} onToggleTheme={toggleTheme}
            onOpenSettings={() => { haptic('light'); setSettings(true); }}
            darkMode={darkMode} onToggleDark={() => { haptic('light'); setDarkMode((v) => !v); }}
            age18={age18} onToggleAge={() => { haptic('select'); setAge18((v) => !v); }}
          />
        )}

        {/* scroll-edge fade into the floating nav */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '120px', pointerEvents: 'none', background: 'linear-gradient(to top, var(--bg2) 0%, var(--bg2-soft) 45%, transparent 100%)' }} />

        <Toast show={toast.show} text={toast.text} />
        <CompatibilitySheet open={sheet} person={person} tokens={tokens} onClose={() => setSheet(false)} />
        <SettingsScreen open={settings} tokens={tokens} theme={theme} onClose={() => { haptic('light'); setSettings(false); }} onToggleTheme={toggleTheme} />

        <BottomNav active={tab} onSelect={selectTab} tokens={tokens} />
      </div>
    </div>
  );
}
