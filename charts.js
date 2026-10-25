// Pure SVG builders for the dashboard. Input: plain data + pixel width. Output: SVG markup.
// Text uses theme classes (never series colors); marks use category colors.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const hrs = (min) => { const m = Math.round(min), h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };

function niceMax(min) {
  const h = Math.max(1, min / 60);
  const step = h <= 4 ? 1 : h <= 8 ? 2 : h <= 16 ? 4 : 6;
  return { top: Math.ceil(h / step) * step * 60, step: step * 60 };
}
// Rect with rounded top corners only (data end), anchored to the baseline.
function topRounded(x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// days: [{ label, sub, today, plan, segs: [{ color, min }], tip }]
export function weekBars(days, width) {
  const W = Math.max(280, Math.round(width)), H = 230, L = 34, R = 6, T = 22, B = 42;
  const peak = Math.max(60, ...days.map((d) => Math.max(d.plan, d.segs.reduce((s, x) => s + x.min, 0))));
  const { top, step } = niceMax(peak);
  const iw = W - L - R, ih = H - T - B, slot = iw / days.length, bw = Math.min(40, slot * 0.46);
  const y = (m) => T + ih - (m / top) * ih;
  let g = '';
  for (let m = step; m <= top; m += step) g += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}"/><text class="ch-ax" x="${L - 6}" y="${y(m) + 4}" text-anchor="end">${m / 60}h</text>`;
  g += `<line class="ch-base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
  days.forEach((d, i) => {
    const cx = L + slot * i + slot / 2, x = cx - bw / 2;
    let cum = 0;
    const segs = d.segs.filter((s) => s.min > 0);
    segs.forEach((s, j) => {
      const y1 = y(cum + s.min), hgt = y(cum) - y1 - (j ? 2 : 0); // 2px surface gap between stacked fills
      if (hgt > 0.5) g += j === segs.length - 1
        ? `<path d="${topRounded(x, y1, bw, hgt, 4)}" fill="${s.color}"/>`
        : `<rect x="${x}" y="${y1}" width="${bw}" height="${hgt}" fill="${s.color}"/>`;
      cum += s.min;
    });
    if (d.plan > 0) g += `<line class="ch-plan" x1="${x - 5}" x2="${x + bw + 5}" y1="${y(d.plan)}" y2="${y(d.plan)}"/>`;
    if (cum > 0) g += `<text class="ch-lbl" x="${cx}" y="${Math.min(y(cum), d.plan > 0 ? y(d.plan) : Infinity) - 6}" text-anchor="middle">${hrs(cum)}</text>`;
    g += `<text class="ch-ax${d.today ? ' ch-today' : ''}" x="${cx}" y="${H - B + 16}" text-anchor="middle">${esc(d.label)}</text>`;
    if (d.sub) g += `<text class="ch-sub" x="${cx}" y="${H - B + 31}" text-anchor="middle">${esc(d.sub)}</text>`;
    g += `<rect class="ch-hit" x="${L + slot * i}" y="${T - 16}" width="${slot}" height="${ih + 16 + B}" data-tip="${esc(d.tip)}"/>`;
  });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Logged time per day">${g}</svg>`;
}

// points: [{ v: number|null, label, tip }] ; fmt(v) -> string ; lo/hi fix the scale (e.g. 0..1 for %)
export function spark(points, width, { fmt, lo = 0, hi } = {}) {
  const W = Math.max(160, Math.round(width)), H = 64, P = 8, T = 8, B = 18;
  const vals = points.map((p) => p.v).filter((v) => v != null);
  const top = hi ?? Math.max(1e-9, ...vals) * 1.1;
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, points.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (top - lo || 1));
  let d = '', g = `<line class="ch-base" x1="${P}" x2="${W - P}" y1="${y(lo)}" y2="${y(lo)}"/>`, pen = false;
  points.forEach((p, i) => {
    if (p.v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i)},${y(p.v)}`;
    pen = true;
  });
  if (d) g += `<path class="ch-line" d="${d}"/>`;
  points.forEach((p, i) => {
    if (p.v != null && i === points.length - 1) g += `<circle class="ch-dot" cx="${x(i)}" cy="${y(p.v)}" r="5"/>`;
    g += `<rect class="ch-hit" x="${x(i) - (W - 2 * P) / (2 * Math.max(1, points.length - 1))}" y="0" width="${(W - 2 * P) / Math.max(1, points.length - 1)}" height="${H}" data-tip="${esc(p.tip || (p.v == null ? `${p.label}: no data` : `${p.label}: ${fmt(p.v)}`))}"/>`;
  });
  g += `<text class="ch-sub" x="${P}" y="${H - 4}">${esc(points[0]?.label || '')}</text><text class="ch-sub" x="${W - P}" y="${H - 4}" text-anchor="end">${esc(points.at(-1)?.label || '')}</text>`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
