// Maps app theme state → render tokens.
// Per handoff: the dark theme is shown as "ember" (warm orange accent).
export function tokensFor(theme) {
  const ember = theme === 'dark';
  const acc = ember ? '#FF6A1A' : '#4B3BFF';
  const acc2 = ember ? '#FFA51E' : '#7C6BFF';
  const accRGB = ember ? '255,106,26' : '75,59,255';
  const accGrad = 'linear-gradient(150deg,' + acc + ',' + acc2 + ')';
  const themeAttr = ember ? 'ember' : 'light';
  return { ember, dark: ember, acc, acc2, accRGB, accGrad, themeAttr };
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
