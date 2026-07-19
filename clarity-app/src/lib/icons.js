// Inline-SVG → data-URI icon helpers (ported from the handoff).
// Icons are redrawn per state colour, so no external icon files are needed.

export function src(inner, o = {}) {
  const size = o.size || 21;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" fill="' + (o.fill || 'none') + '" stroke="' + (o.stroke || 'none') + '" stroke-width="' + (o.sw || 1.8) +
    '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// full box style with icon centred
export function ibg(inner, o = {}) {
  return {
    width: (o.size || 21) + 'px', height: (o.size || 21) + 'px', flex: 'none',
    backgroundImage: 'url("' + src(inner, o) + '")',
    backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
  };
}

// only the background props (caller sets the box)
export function ibgOnly(inner, o = {}) {
  return {
    backgroundImage: 'url("' + src(inner, o) + '")',
    backgroundSize: (o.size || 21) + 'px', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
  };
}

export const PATHS = {
  cards: '<rect x="4" y="4.5" width="16" height="7" rx="2.2"/><rect x="4" y="14" width="16" height="5.5" rx="2"/>',
  heart: '<path d="M12 20.4S3.6 15.4 3.6 9.3C3.6 6.2 5.9 4.2 8.3 4.6 10 4.9 11.3 6 12 7.3 12.7 6 14 4.9 15.7 4.6c2.4-.4 4.7 1.6 4.7 4.7 0 6.1-8.4 11.1-8.4 11.1z"/>',
  bubble: '<path d="M20 3.5H4A1.6 1.6 0 0 0 2.4 5.1v9.6A1.6 1.6 0 0 0 4 16.3h3.2v4L11.7 16.3H20a1.6 1.6 0 0 0 1.6-1.6V5.1A1.6 1.6 0 0 0 20 3.5z"/>',
  person: '<circle cx="12" cy="7.6" r="3.8"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0z"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  spark: '<path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6z"/>',
  star: '<path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.6 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z"/>',
  sliders: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h9M17 17.5h3"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="17.5" r="2"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  cam: '<rect x="3" y="6.5" width="18" height="13" rx="3"/><circle cx="12" cy="13" r="3.4"/><path d="M8 6.5l1.4-2.2h5.2L16 6.5"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M4.3 4.3l1.6 1.6M18.1 18.1l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.3 19.7l1.6-1.6M18.1 5.9l1.6-1.6"/>',
  moon: '<path d="M20 14.6A8 8 0 0 1 9.4 4 7 7 0 1 0 20 14.6z"/>',
  logout: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 12h9M16 8l4 4-4 4"/>',
  trash: '<path d="M4 7h16M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4L18 7"/>',
};

export const NAV_ICONS = [PATHS.cards, PATHS.heart, PATHS.bubble, PATHS.person];
