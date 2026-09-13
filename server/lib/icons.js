'use strict';

/**
 * Inline stroke icon set (24x24, currentColor, 1.6 stroke).
 * No emoji anywhere in the product — icons only.
 */

const P = {
  shield: '<path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6l7-3z"/><path d="M9.2 12.1l1.9 1.9 3.7-3.8"/>',
  shieldAlert: '<path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6l7-3z"/><path d="M12 8.5v4"/><circle cx="12" cy="15.6" r=".7" fill="currentColor" stroke="none"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="M10.9 11.1L20 2"/><path d="M16.5 5.5l2.5 2.5"/><path d="M14 8l2.5 2.5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/><path d="M12 14.4v2.4"/>',
  unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 017.8-1.2"/>',
  cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="9.8" y="9.8" width="4.4" height="4.4" rx="1"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
  fingerprint: '<path d="M12 4.5a7.5 7.5 0 00-7.5 7.5v1.5"/><path d="M19.5 12a7.5 7.5 0 00-4.2-6.7"/><path d="M7.5 12a4.5 4.5 0 019 0v2.5a6 6 0 01-.7 2.9"/><path d="M12 12v3.5a7.5 7.5 0 01-1 3.8"/><path d="M9.6 19.4A5.5 5.5 0 0010.5 16v-4"/>',
  download: '<path d="M12 3.5v11"/><path d="M7.8 10.5l4.2 4.2 4.2-4.2"/><path d="M4.5 17v2.2a1.3 1.3 0 001.3 1.3h12.4a1.3 1.3 0 001.3-1.3V17"/>',
  upload: '<path d="M12 20.5v-11"/><path d="M7.8 13.5L12 9.3l4.2 4.2"/><path d="M4.5 7V4.8a1.3 1.3 0 011.3-1.3h12.4a1.3 1.3 0 011.3 1.3V7"/>',
  card: '<rect x="2.8" y="5.5" width="18.4" height="13" rx="2.4"/><path d="M2.8 10h18.4"/><path d="M6.5 14.6h3.2"/>',
  bank: '<path d="M3.5 9.5L12 4.5l8.5 5"/><path d="M5.5 9.5v8M9.5 9.5v8M14.5 9.5v8M18.5 9.5v8"/><path d="M3.5 19.5h17"/>',
  wallet: '<path d="M3.5 7.8A2.3 2.3 0 015.8 5.5h11a2 2 0 012 2v1.2"/><rect x="3.5" y="7.8" width="17" height="11.2" rx="2.3"/><circle cx="16.4" cy="13.4" r="1.1" fill="currentColor" stroke="none"/>',
  flask: '<path d="M9.5 3.5h5"/><path d="M10.5 3.5v6.2L5.4 18a2 2 0 001.7 3h9.8a2 2 0 001.7-3l-5.1-8.3V3.5"/><path d="M7.6 14.5h8.8"/>',
  check: '<path d="M4.5 12.6l4.8 4.8L19.5 7.2"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.6"/><path d="M8.3 12.3l2.6 2.6 4.8-5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  xCircle: '<circle cx="12" cy="12" r="8.6"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  alert: '<path d="M12 4.2L2.9 19.4h18.2L12 4.2z"/><path d="M12 10v3.6"/><circle cx="12" cy="16.6" r=".75" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4"/><circle cx="12" cy="8.1" r=".75" fill="currentColor" stroke="none"/>',
  user: '<circle cx="12" cy="8.2" r="3.7"/><path d="M4.8 20.2a7.2 7.2 0 0114.4 0"/>',
  users: '<circle cx="9.4" cy="8.4" r="3.4"/><path d="M3.2 19.6a6.2 6.2 0 0112.4 0"/><path d="M16.2 5.4a3.4 3.4 0 010 6.5"/><path d="M17.6 14.4a6.2 6.2 0 013.2 5.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.4a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5v.2a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1h-.2a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3h.1a1.6 1.6 0 001-1.5v-.2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8v.1a1.6 1.6 0 001.5 1h.2a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  chart: '<path d="M3.5 20.2h17"/><rect x="5.2" y="11.5" width="3.4" height="6.2" rx="1"/><rect x="10.3" y="7.2" width="3.4" height="10.5" rx="1"/><rect x="15.4" y="13.6" width="3.4" height="4.1" rx="1"/>',
  activity: '<path d="M2.8 12.4h4.1l2.5-6.9 4.4 13.8 2.6-6.9h4.8"/>',
  gauge: '<path d="M4.2 17.5a9 9 0 1115.6 0"/><path d="M12 13.8l3.6-3.9"/><circle cx="12" cy="14.6" r="1.3"/>',
  terminal: '<rect x="2.8" y="4.2" width="18.4" height="15.6" rx="2.4"/><path d="M6.8 9.6l3 2.6-3 2.6"/><path d="M12.6 15.2h4.6"/>',
  code: '<path d="M8.6 7.2L3.8 12l4.8 4.8"/><path d="M15.4 7.2L20.2 12l-4.8 4.8"/><path d="M13.6 4.6l-3.2 14.8"/>',
  zap: '<path d="M13.2 2.8L4.6 13.4h6.1l-.9 7.8 8.6-10.6h-6.1l.9-7.8z"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.3 2"/>',
  calendar: '<rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.4"/><path d="M3.4 10h17.2M8.2 3.2v4M15.8 3.2v4"/>',
  box: '<path d="M20.4 8.1v7.8a1.7 1.7 0 01-.9 1.5l-6.6 3.5a1.7 1.7 0 01-1.6 0l-6.6-3.5a1.7 1.7 0 01-.9-1.5V8.1a1.7 1.7 0 01.9-1.5l6.6-3.5a1.7 1.7 0 011.6 0l6.6 3.5a1.7 1.7 0 01.9 1.5z"/><path d="M3.6 7.2l8.4 4.5 8.4-4.5M12 21v-9.3"/>',
  layers: '<path d="M12 3.2l8.6 4.5-8.6 4.5-8.6-4.5 8.6-4.5z"/><path d="M3.4 12.4L12 16.9l8.6-4.5"/><path d="M3.4 16.9L12 21.4l8.6-4.5"/>',
  refresh: '<path d="M20.2 11.4A8.2 8.2 0 006.3 6.6L3.8 9"/><path d="M3.8 4.6V9h4.4"/><path d="M3.8 12.6a8.2 8.2 0 0013.9 4.8l2.5-2.4"/><path d="M20.2 19.4V15h-4.4"/>',
  logout: '<path d="M14.6 4.4H6.2A1.8 1.8 0 004.4 6.2v11.6a1.8 1.8 0 001.8 1.8h8.4"/><path d="M16.4 8.6l3.4 3.4-3.4 3.4"/><path d="M19.6 12H9.8"/>',
  login: '<path d="M9.4 4.4h8.4a1.8 1.8 0 011.8 1.8v11.6a1.8 1.8 0 01-1.8 1.8H9.4"/><path d="M13.6 8.6L17 12l-3.4 3.4"/><path d="M4.4 12h12.4"/>',
  eye: '<path d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.1"/>',
  eyeOff: '<path d="M9.9 5.2A9.8 9.8 0 0112 5c6 0 9.4 6.1 9.4 6.1a17 17 0 01-2.7 3.7M6.3 6.6A16.6 16.6 0 002.6 11.1S6 17.2 12 17.2a9.5 9.5 0 003.6-.7"/><path d="M10.1 10.2a2.8 2.8 0 003.9 3.9"/><path d="M3.4 3.4l17.2 17.2"/>',
  copy: '<rect x="8.6" y="8.6" width="12" height="12" rx="2.2"/><path d="M15.4 5.6a2 2 0 00-2-2H5.6a2 2 0 00-2 2v7.8a2 2 0 002 2"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.4"/><path d="M15.5 15.5l4.3 4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4.6 6.8h14.8"/><path d="M9.4 6.8V4.9a1.4 1.4 0 011.4-1.4h2.4a1.4 1.4 0 011.4 1.4v1.9"/><path d="M6.6 6.8l.9 12.2a1.8 1.8 0 001.8 1.6h5.4a1.8 1.8 0 001.8-1.6l.9-12.2"/><path d="M10.4 10.8v6M13.6 10.8v6"/>',
  edit: '<path d="M16.6 3.9a2.1 2.1 0 013 3L8.4 18.1l-4 1 1-4L16.6 3.9z"/>',
  ban: '<circle cx="12" cy="12" r="8.6"/><path d="M6 6l12 12"/>',
  server: '<rect x="3.2" y="4.2" width="17.6" height="6.4" rx="2"/><rect x="3.2" y="13.4" width="17.6" height="6.4" rx="2"/><path d="M7 7.4h.01M7 16.6h.01"/>',
  bell: '<path d="M18 9.4a6 6 0 10-12 0c0 5.4-2 7-2 7h16s-2-1.6-2-7"/><path d="M13.7 20a2 2 0 01-3.4 0"/>',
  arrowRight: '<path d="M4.4 12h15"/><path d="M13.6 6.2l5.8 5.8-5.8 5.8"/>',
  arrowUpRight: '<path d="M7.4 16.6L16.6 7.4"/><path d="M9.2 7.4h7.4v7.4"/>',
  chevronDown: '<path d="M6.4 9.4l5.6 5.6 5.6-5.6"/>',
  chevronRight: '<path d="M9.4 6.4l5.6 5.6-5.6 5.6"/>',
  menu: '<path d="M3.8 6.8h16.4M3.8 12h16.4M3.8 17.2h16.4"/>',
  external: '<path d="M14.4 4.4h5.2v5.2"/><path d="M19.6 4.4l-8.2 8.2"/><path d="M17.6 13.6v5a1.8 1.8 0 01-1.8 1.8H5.6a1.8 1.8 0 01-1.8-1.8V8.4a1.8 1.8 0 011.8-1.8h5"/>',
  globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.6 12h16.8"/><path d="M12 3.4a13.6 13.6 0 010 17.2 13.6 13.6 0 010-17.2z"/>',
  list: '<path d="M8.4 6.4h12M8.4 12h12M8.4 17.6h12"/><circle cx="4.4" cy="6.4" r=".9" fill="currentColor" stroke="none"/><circle cx="4.4" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="4.4" cy="17.6" r=".9" fill="currentColor" stroke="none"/>',
  filter: '<path d="M3.6 5.2h16.8l-6.6 7.8v5.6l-3.6 2v-7.6L3.6 5.2z"/>',
  power: '<path d="M12 3.4v8.4"/><path d="M17.6 6.6a8 8 0 11-11.2 0"/>',
  play: '<path d="M7.4 4.8l11 7.2-11 7.2V4.8z"/>',
  file: '<path d="M13.6 3.4H7a1.8 1.8 0 00-1.8 1.8v13.6A1.8 1.8 0 007 20.6h10a1.8 1.8 0 001.8-1.8V8.6l-5.2-5.2z"/><path d="M13.6 3.4v5.2h5.2"/>',
  database: '<ellipse cx="12" cy="6.2" rx="7.6" ry="3"/><path d="M4.4 6.2v11.6c0 1.7 3.4 3 7.6 3s7.6-1.3 7.6-3V6.2"/><path d="M4.4 12c0 1.7 3.4 3 7.6 3s7.6-1.3 7.6-3"/>',
  link: '<path d="M10.2 13.8a4 4 0 005.7 0l2.8-2.8a4 4 0 10-5.7-5.7l-1.4 1.4"/><path d="M13.8 10.2a4 4 0 00-5.7 0l-2.8 2.8a4 4 0 105.7 5.7l1.4-1.4"/>',
  spark: '<path d="M12 3.4l1.9 5.2 5.2 1.9-5.2 1.9L12 17.6l-1.9-5.2L4.9 10.5l5.2-1.9L12 3.4z"/><path d="M18.6 16.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/>',
  target: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  ticket: '<path d="M3.4 8.6V6.8a1.6 1.6 0 011.6-1.6h14a1.6 1.6 0 011.6 1.6v1.8a2.6 2.6 0 000 5.2v1.8a1.6 1.6 0 01-1.6 1.6H5a1.6 1.6 0 01-1.6-1.6v-1.8a2.6 2.6 0 000-5.2z"/><path d="M13.4 5.2v2M13.4 11v2M13.4 16.8v2"/>',
  message: '<path d="M20.4 12.2c0 4-3.8 7.2-8.4 7.2a9.8 9.8 0 01-2.7-.4L4.4 20.6l1.4-3.6a6.8 6.8 0 01-2.2-4.8c0-4 3.8-7.2 8.4-7.2s8.4 3.2 8.4 7.2z"/>',
  send: '<path d="M21 3.6L10.6 14"/><path d="M21 3.6l-6.6 17.2-3.8-6.8-6.8-3.8L21 3.6z"/>',
  discord: '<path d="M18.4 6.2a15 15 0 00-3.7-1.1l-.3.6a11 11 0 013.1 1.5 12.6 12.6 0 00-11 0 11 11 0 013.1-1.5l-.3-.6a15 15 0 00-3.7 1.1C5.2 9.8 4.6 13.3 4.9 16.8a15 15 0 004.5 2.2l.9-1.4a9.6 9.6 0 01-1.5-.7l.4-.3a10.8 10.8 0 009.6 0l.4.3a9.6 9.6 0 01-1.5.7l.9 1.4a15 15 0 004.5-2.2c.4-4-.7-7.5-3.1-10.6z"/><circle cx="9.6" cy="13.6" r="1.4" fill="currentColor" stroke="none"/><circle cx="14.4" cy="13.6" r="1.4" fill="currentColor" stroke="none"/>',
  telegram: '<path d="M21 4.6L2.8 11.4l5 1.6 1.9 5.8 2.6-3.2 4.3 3.2L21 4.6z"/><path d="M7.8 13l9.6-6.2-6.6 8"/>',
  logo: '<path d="M12 2.8l8 3.4v6c0 4.9-3.3 8.9-8 10.4-4.7-1.5-8-5.5-8-10.4v-6l8-3.4z"/><path d="M8.2 12.2h2.3l1-2 1.6 4.2 1.2-2.2h1.9"/>',
  history: '<path d="M3.6 12a8.4 8.4 0 108.4-8.4A8.4 8.4 0 006 6.6"/><path d="M3.6 3.6v4h4"/><path d="M12 7.8V12l2.8 1.7"/>',
  gift: '<rect x="3.4" y="8.6" width="17.2" height="4" rx="1.2"/><path d="M4.8 12.6v6.6a1.4 1.4 0 001.4 1.4h11.6a1.4 1.4 0 001.4-1.4v-6.6"/><path d="M12 8.6v12"/><path d="M12 8.6S10.8 4 8.6 4a2.3 2.3 0 000 4.6H12zm0 0s1.2-4.6 3.4-4.6a2.3 2.3 0 010 4.6H12z"/>',
  qr: '<rect x="3.6" y="3.6" width="6.4" height="6.4" rx="1.4"/><rect x="14" y="3.6" width="6.4" height="6.4" rx="1.4"/><rect x="3.6" y="14" width="6.4" height="6.4" rx="1.4"/><path d="M14 14h2.4v2.4H14zM18 18h2.4v2.4H18zM14 20.4h2M20.4 14v2"/>',
  sliders: '<path d="M4.4 6.4h9.2M17.6 6.4h2M4.4 12h2M10.4 12h9.2M4.4 17.6h9.2M17.6 17.6h2"/><circle cx="15.6" cy="6.4" r="2"/><circle cx="8.4" cy="12" r="2"/><circle cx="15.6" cy="17.6" r="2"/>'
};

function icon(name, className = '', size = null) {
  const body = P[name];
  if (!body) return '';
  const cls = className ? ` class="${className}"` : '';
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls}${dim}>${body}</svg>`;
}

icon.names = Object.keys(P);

module.exports = { icon, names: Object.keys(P) };
