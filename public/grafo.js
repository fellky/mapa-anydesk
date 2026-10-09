// Grafo interativo: nós se organizam sozinhos, podem ser arrastados; zoom na roda do mouse; arrastar o fundo move a tela.
window.Grafo = function (svg, onSelect) {
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, cls) => { const e = document.createElementNS(NS, tag); if (cls) e.setAttribute('class', cls); return e; };
  const at = (e, o) => { for (const k in o) e.setAttribute(k, o[k]); return e; };
  const root = mk('g'), gl = mk('g'), gn = mk('g');
  root.append(gl, gn); svg.replaceChildren(root);

  const R = { s: 15, p: 8, i: 8 };                    // tamanho por tipo
  const LEN = { sp: 95, pi: 70, si: 95 };            // distância ideal: setor-pc, pc-impressora, setor-impressora
  let nodes = [], links = [], map = new Map();
  let sel = null, hov = null, alpha = 1, running = false, drag = null, pan = null;
  const v = { x: 0, y: 0, k: 1 };

  const size = () => [svg.clientWidth || 800, svg.clientHeight || 500];
  const place = () => root.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`);

  function paint() {
    const a = hov || sel, near = new Set();
    if (a) { near.add(a); for (const l of links) { if (l.a.id === a) near.add(l.b.id); if (l.b.id === a) near.add(l.a.id); } }
    for (const n of nodes) { n.el.classList.toggle('sel', n.id === sel); n.el.classList.toggle('dim', !!a && !near.has(n.id)); }
    for (const l of links) l.el.classList.toggle('dim', !!a && l.a.id !== a && l.b.id !== a);
  }

  function draw() {
    for (const l of links) at(l.el, { x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y });
    for (const n of nodes) n.el.setAttribute('transform', `translate(${n.x} ${n.y})`);
  }

  function step() {
    const [W, H] = size();
    for (const n of nodes) { n.fx = (W / 2 - n.x) * 0.004; n.fy = (H / 2 - n.y) * 0.004; }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
      const F = Math.min(2600 / Math.max(d2, 400), 6) / Math.sqrt(d2);
      a.fx += dx * F; a.fy += dy * F; b.fx -= dx * F; b.fy -= dy * F;
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - l.len) * 0.03 / d;
      l.a.fx += dx * f; l.a.fy += dy * f; l.b.fx -= dx * f; l.b.fy -= dy * f;
    }
    for (const n of nodes) {
      if (n === drag) continue;
      n.vx = (n.vx + n.fx * alpha) * 0.8; n.vy = (n.vy + n.fy * alpha) * 0.8;
      n.x += n.vx; n.y += n.vy;
    }
  }

  function loop() {
    running = true; step(); draw(); alpha *= 0.99;
    if (alpha > 0.02 || drag) requestAnimationFrame(loop); else running = false;
  }
  const kick = a => { alpha = Math.max(alpha, a); if (!running) requestAnimationFrame(loop); };

  const toWorld = e => { const b = svg.getBoundingClientRect(); return [(e.clientX - b.left - v.x) / v.k, (e.clientY - b.top - v.y) / v.k]; };

  svg.addEventListener('pointerdown', e => {
    pan = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y }; svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (drag) {
      [drag.x, drag.y] = toWorld(e); drag.vx = drag.vy = 0;
      drag.moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy); kick(0.3);
    } else if (pan) { v.x = pan.vx + e.clientX - pan.x; v.y = pan.vy + e.clientY - pan.y; place(); }
  });
  svg.addEventListener('pointerup', e => {
    if (drag) { if (drag.moved < 4) { sel = drag.id; paint(); onSelect(sel); } drag = null; }
    else if (pan) { if (Math.hypot(e.clientX - pan.x, e.clientY - pan.y) < 4) { sel = null; paint(); onSelect(null); } }
    pan = null;
  });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const b = svg.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top;
    const k = Math.min(3, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    v.x = mx - (mx - v.x) * k / v.k; v.y = my - (my - v.y) * k / v.k; v.k = k; place();
  }, { passive: false });

  return {
    svg,
    set({ nodes: ns, links: ls }) {
      const old = map, [W, H] = size();
      map = new Map(); gl.replaceChildren(); gn.replaceChildren();
      nodes = ns.map(d => {
        const o = old.get(d.id);
        const n = { ...d, x: o ? o.x : W / 2 + (Math.random() - .5) * 200, y: o ? o.y : H / 2 + (Math.random() - .5) * 200, vx: 0, vy: 0, fx: 0, fy: 0, moved: 0 };
        map.set(d.id, n); return n;
      });
      links = ls.filter(([a, b]) => map.has(a) && map.has(b)).map(([a, b]) => {
        const A = map.get(a), B = map.get(b); return { a: A, b: B, len: LEN[A.tipo + B.tipo] || LEN[B.tipo + A.tipo] || 80 };
      });
      for (const l of links) { l.el = mk('line', 'lk'); gl.append(l.el); }
      for (const n of nodes) {
        const r = R[n.tipo], g = mk('g', 'no ' + n.tipo);
        const shape = n.tipo === 'i' ? at(mk('rect'), { x: -r, y: -r, width: r * 2, height: r * 2 }) : at(mk('circle'), { r });
        const t = at(mk('text'), { y: r + 14, 'text-anchor': 'middle' }); t.textContent = n.label;
        g.append(shape, t); n.el = g; gn.append(g);
        g.addEventListener('pointerdown', e => { e.stopPropagation(); svg.setPointerCapture(e.pointerId); drag = n; n.moved = 0; n.sx = e.clientX; n.sy = e.clientY; });
        g.addEventListener('pointerenter', () => { hov = n.id; paint(); });
        g.addEventListener('pointerleave', () => { hov = null; paint(); });
      }
      draw(); paint(); kick(old.size ? 0.5 : 1);
    },
    select(id) { sel = id && map.has(id) ? id : null; paint(); },
    reset() { v.x = 0; v.y = 0; v.k = 1; place(); }
  };
};