import { prefersReducedMotion } from '../lib/theme.js';

export default function Toast({ show, text }) {
  const reduced = prefersReducedMotion();
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: '84px', display: 'flex', justifyContent: 'center', zIndex: 30, opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(-10px)', pointerEvents: 'none', transition: reduced ? 'none' : 'all .28s' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 20px', borderRadius: '16px', background: 'var(--strong)', fontSize: '13.5px', fontWeight: 600, color: '#fff', boxShadow: '0 16px 40px -12px rgba(23,22,28,.6)' }}>{text}</span>
    </div>
  );
}
