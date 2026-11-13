// Agent Arena characters: small low-poly 3D models in the style of PS2 memory card icons.
// Every model is built from code (no model files): boxes, prisms and textured "screens" for faces.
// Each agent has three moods: "neutral", "win" and "lose", each with its own pose, face and animation.
//
// One shared WebGL2 renderer draws every model on the page, then copies each picture into that model's
// own small 2D canvas. That keeps the page to a single WebGL context however many models are showing.
//
// Usage: const stop = mountAgentModel(canvas, "diva", "win"); ... stop();
// Returns null when WebGL2 isn't available (the caller shows its fallback instead).

// CSS pixels per rendered pixel: the chunky, PS2-icon look (small models get finer pixels so they stay readable)
const pixelFor = (cssWidth) => (cssWidth < 150 ? 1.2 : 1.45);

const { mountAgentModel, AGENT_MODEL_IDS } = (() => {
  // ================= Tiny matrix helpers (column-major) =================
  const M = {
    id: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    t: (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
    s: (x, y, z) => new Float32Array([x, 0, 0, 0, 0, y === undefined ? x : y, 0, 0, 0, 0, z === undefined ? x : z, 0, 0, 0, 0, 1]),
    rx: (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    ry: (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    rz: (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    chain(...ms) { return ms.reduce((acc, m) => M.mul(acc, m)); },
    persp(fovy, aspect, n, f) { const k = 1 / Math.tan(fovy / 2), nf = 1 / (n - f); return new Float32Array([k / aspect, 0, 0, 0, 0, k, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]); },
    look(eye, at) {
      const sub = (a, b) => a.map((v, i) => v - b[i]), nrm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const f = nrm(sub(at, eye)), r = nrm(cross(f, [0, 1, 0])), u = cross(r, f);
      return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1]);
    },
  };
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // ================= Building low-poly parts =================
  function Part() { return { pos: [], nor: [], col: [], uv: [], tex: [], glow: [] }; }
  function tri(p, a, b, c, color, opts = {}) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
    const uvs = opts.uv || [[0, 0], [0, 0], [0, 0]];
    [a, b, c].forEach((q, i) => { p.pos.push(...q); p.nor.push(...n); p.col.push(...color); p.uv.push(...uvs[i]); p.tex.push(opts.tex ? 1 : 0); p.glow.push(opts.glow || 0); });
  }
  function quad(p, a, b, c, d, color, opts = {}) {
    const uv = opts.uv;
    tri(p, a, b, c, color, { ...opts, uv: uv && [uv[0], uv[1], uv[2]] });
    tri(p, a, c, d, color, { ...opts, uv: uv && [uv[0], uv[2], uv[3]] });
  }
  const UV = [[0, 1], [1, 1], [1, 0], [0, 0]];
  // a textured rectangle facing +z (a face screen, a sign, a page)
  function plate(p, [cx, cy, z], [w, h], opts = {}) { quad(p, [cx - w / 2, cy - h / 2, z], [cx + w / 2, cy - h / 2, z], [cx + w / 2, cy + h / 2, z], [cx - w / 2, cy + h / 2, z], [1, 1, 1], { tex: true, uv: UV, ...opts }); }
  function box(p, [cx, cy, cz], [sx, sy, sz], color, opts = {}) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const shade = (k) => color.map((c) => c * k);
    quad(p, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, opts);
    quad(p, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], shade(0.95), opts);
    quad(p, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color, opts);
    quad(p, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], shade(0.9), opts);
    quad(p, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, opts);
    quad(p, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, opts);
  }
  // a ring-shaped prism: radius r0 at y0 and r1 at y1, with n sides
  function frustum(p, y0, y1, r0, r1, n, color, opts = {}) {
    const ring = (y, r, k) => { const a = (k / n) * Math.PI * 2 + (opts.twist || 0); return [Math.sin(a) * r, y, Math.cos(a) * r]; };
    for (let k = 0; k < n; k++) {
      const a0 = ring(y0, r0, k), a1 = ring(y0, r0, k + 1), b0 = ring(y1, r1, k), b1 = ring(y1, r1, k + 1);
      const c = opts.stripes && k % 2 ? opts.stripes : color;
      quad(p, a0, a1, b1, b0, c, opts);
      if (opts.caps !== false) { tri(p, [0, y1, 0], b0, b1, opts.capColor || color, opts); tri(p, [0, y0, 0], a1, a0, opts.capColor || color, opts); }
    }
  }
  function ball(p, [cx, cy, cz], r, color, lat = 4, lon = 6, opts = {}) {
    const pt = (i, j) => { const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2; return [cx + Math.sin(th) * Math.sin(ph) * r, cy + Math.cos(th) * r, cz + Math.sin(th) * Math.cos(ph) * r]; };
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      if (i === 0) tri(p, a, b, c, color, opts); else if (i === lat - 1) tri(p, a, b, d, color, opts); else quad(p, a, b, c, d, color, opts);
    }
  }
  function star(p, size, color) { // a flat four-pointed sparkle
    const s = size, w = size * 0.22;
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) tri(p, [-dy * w, dx * w, 0], [dx * s, dy * s, 0], [dy * w, -dx * w, 0], color, { glow: 1 });
  }
  // copy one part into another, moved by a matrix (rotation and translation)
  function add(p, src, m) {
    for (let i = 0; i < src.pos.length; i += 3) {
      const [x, y, z] = src.pos.slice(i, i + 3), [nx, ny, nz] = src.nor.slice(i, i + 3);
      p.pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      p.nor.push(m[0] * nx + m[4] * ny + m[8] * nz, m[1] * nx + m[5] * ny + m[9] * nz, m[2] * nx + m[6] * ny + m[10] * nz);
    }
    p.col.push(...src.col); p.uv.push(...src.uv); p.tex.push(...src.tex); p.glow.push(...src.glow);
  }
  // an arm: upper arm hangs from the shoulder, forearm from the elbow. Angles are [x, y, z] turns.
  // Returns the hand's matrix (for props). x < 0 swings forward; z > 0 lifts a right arm outward (z < 0 for a left arm).
  function arm(out, parent, [sx, sy], a, names = ['upper', 'fore'], lens = [0.32, 0.36]) {
    const upper = M.chain(parent, M.t(sx, sy, 0), M.rx(a.up[0]), M.ry(a.up[1]), M.rz(a.up[2]));
    out.push([names[0], upper]);
    const fore = M.chain(upper, M.t(0, -lens[0], 0), M.rx(a.fore[0]), M.ry(a.fore[1]), M.rz(a.fore[2]));
    out.push([names[1], fore]);
    return M.chain(fore, M.t(0, -lens[1], 0));
  }

  // ================= Drawing faces and signs (small canvases used as textures) =================
  function screen(top, bottom, draw, scan = 0.16) {
    const W = 64, H = 40, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bottom);
    c.fillStyle = g; c.fillRect(0, 0, W, H); c.lineCap = 'round'; c.lineJoin = 'round';
    const pen = {
      c, bg: g,
      line(w, color, pts) { c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(...pts[0]); for (const p of pts.slice(1)) { if (p.length === 4) c.quadraticCurveTo(...p); else c.lineTo(...p); } c.stroke(); },
      fill(color, fn) { c.fillStyle = color; c.beginPath(); fn(); c.fill(); },
      dot(x, y, r, color) { c.fillStyle = color; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); },
      ring(x, y, r, w, color) { c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); },
      spark(x, y, s, color) { c.fillStyle = color; c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s * 0.25, y - s * 0.25); c.lineTo(x + s, y); c.lineTo(x + s * 0.25, y + s * 0.25); c.lineTo(x, y + s); c.lineTo(x - s * 0.25, y + s * 0.25); c.lineTo(x - s, y); c.lineTo(x - s * 0.25, y - s * 0.25); c.fill(); },
    };
    draw(pen);
    c.fillStyle = `rgba(0,0,0,${scan})`; for (let y = 0; y < H; y += 2) c.fillRect(0, y, W, 1);
    return cv;
  }
  function sign(text, { w = 32, h = 40, bg = '#fff6fb', fg = '#12030c', size = 22, border = true } = {}) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    if (border) { c.strokeStyle = fg; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2); }
    c.fillStyle = fg; c.font = `bold ${size}px "Avenir Next", system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    String(text).split('\n').forEach((ln, i, all) => c.fillText(ln, w / 2, h / 2 + 1 + (i - (all.length - 1) / 2) * size));
    return cv;
  }
  function chart(kind) { // the Analyst's clipboard
    const cv = document.createElement('canvas'); cv.width = 30; cv.height = 40; const c = cv.getContext('2d');
    c.fillStyle = '#f4f7fb'; c.fillRect(0, 0, 30, 40);
    c.strokeStyle = '#c5cfdd'; c.lineWidth = 1; for (let y = 10; y < 40; y += 7) { c.beginPath(); c.moveTo(3, y); c.lineTo(27, y); c.stroke(); }
    const ys = kind === 'up' ? [32, 27, 28, 19, 14, 7] : kind === 'down' ? [8, 13, 12, 22, 27, 34] : [22, 18, 23, 17, 21, 18];
    c.strokeStyle = kind === 'down' ? '#e0304a' : '#0aa3b5'; c.lineWidth = 2.5; c.beginPath(); ys.forEach((y, i) => (i ? c.lineTo(4 + i * 4.4, y) : c.moveTo(4, y))); c.stroke();
    return cv;
  }

  // =====================================================================================================
  // THE DIVA: a couture queen. Mermaid gown, standing collar, spiked crown, hoops, opera gloves, a folding fan.
  // =====================================================================================================
  const Diva = (() => {
    const C = { gown: [0.07, 0.05, 0.09], panel: [0.86, 0.1, 0.48], corset: [0.9, 0.12, 0.5], shell: [0.1, 0.08, 0.12], gold: [1.0, 0.78, 0.25], goldDeep: [0.78, 0.52, 0.12], gem: [1.0, 0.3, 0.6], skin: [0.95, 0.75, 0.82], flash: [1, 1, 0.92] };
    function face(mood) {
      return screen('#ff6db8', '#d92a86', (p) => {
        const BLACK = '#12030c', LIP = '#8a0030', SHADOW = '#7a1aa0', c = p.c;
        // one eye; dir is +1 when the outer corner (and the liner's wing) is on the right, -1 on the left
        const eye = (x, y, dir, kind, look = 0) => {
          if (kind === 'open' || kind === 'side') {
            p.fill(SHADOW, () => c.ellipse(x, y - 2.5, 8, 4, 0, Math.PI, 0));
            p.fill('#fff', () => c.ellipse(x, y, 7, kind === 'side' ? 2.6 : 3.6, 0, 0, Math.PI * 2));
            p.dot(x + look, y + 0.3, 2.3, BLACK); p.dot(x + look - 0.8, y - 0.6, 0.7, '#fff');
            if (kind === 'side') p.fill(p.bg, () => c.rect(x - 8, y - 6, 16, 4.6));          // heavy lid: unimpressed
            p.line(1.8, BLACK, [[x - 7.5 * dir, y - 1.2], [x, y - 4.6, x + 7.5 * dir, y - 1.2], [x + 11 * dir, y - 4.5]]);
          } else if (kind === 'wink') p.line(1.8, BLACK, [[x - 7 * dir, y], [x, y - 4.5, x + 7 * dir, y], [x + 10 * dir, y - 3.5]]);
          else p.line(1.8, BLACK, [[x - 7 * dir, y - 1], [x, y + 3.5, x + 7 * dir, y - 1], [x + 10 * dir, y - 3]]); // closed
          const down = kind === 'closed';
          for (let k = -1; k <= 1; k++) p.line(1, BLACK, [[x + (k * 3.5 + 2) * dir, y - (down ? -1.5 : 3.6)], [x + (k * 3.5 + 4) * dir, y - (down ? -4 : 6)]]);
        };
        if (mood === 'neutral') {
          eye(19, 15, -1, 'side', 3.2); eye(45, 15, 1, 'side', 3.2);                               // both eyes cut to the side
          p.line(1.6, BLACK, [[10, 6], [18, 4, 26, 7]]); p.line(1.6, BLACK, [[38, 6], [45, 0.5, 54, 4]]);
          p.fill(LIP, () => { c.moveTo(25, 30); c.quadraticCurveTo(32, 26, 41, 28); c.quadraticCurveTo(34, 34, 25, 30); });
          p.line(1, '#ffb3d6', [[30, 29], [33, 28.5]]);
        } else if (mood === 'win') {
          eye(19, 15, -1, 'wink'); eye(45, 15, 1, 'open');
          p.line(1.6, BLACK, [[10, 6], [18, 2, 26, 5]]); p.line(1.6, BLACK, [[38, 5], [46, 1, 54, 5]]);
          p.fill(LIP, () => { c.moveTo(22, 26); c.quadraticCurveTo(32, 23, 42, 26); c.quadraticCurveTo(32, 38, 22, 26); });
          p.fill('#fff', () => { c.moveTo(25, 27); c.quadraticCurveTo(32, 25, 39, 27); c.quadraticCurveTo(32, 30, 25, 27); });
          p.spark(58, 8, 4, '#fff'); p.spark(6, 31, 3.5, '#fff');
        } else {
          eye(19, 15, -1, 'closed'); eye(45, 15, 1, 'closed');
          p.line(1.6, BLACK, [[10, 6], [18, 6, 25, 2]]); p.line(1.6, BLACK, [[39, 2], [46, 6, 54, 6]]);
          for (const [x0, len] of [[14, 20], [21, 13], [43, 14], [50, 21]]) p.line(1.4, BLACK, [[x0, 18], [x0 + 1.5, 18 + len / 2, x0, 18 + len]]); // mascara running
          p.fill(LIP, () => { c.moveTo(25, 33); c.quadraticCurveTo(32, 27, 39, 33); c.quadraticCurveTo(32, 31, 25, 33); });
        }
      });
    }
    function build() {
      const parts = {};
      let p = Part();
      frustum(p, 0.42, 0.95, 0.27, 0.36, 8, C.gown, { stripes: C.panel, caps: false });
      frustum(p, 0.0, 0.42, 0.74, 0.27, 8, C.gown, { stripes: C.panel, caps: false });
      frustum(p, 0.0, 0.07, 0.78, 0.76, 8, C.gold, { capColor: C.gown });
      quad(p, [-0.55, 0.02, -0.35], [0.55, 0.02, -0.35], [0.35, 0.01, -1.35], [-0.35, 0.01, -1.35], C.panel);   // train
      quad(p, [-0.5, 0.25, -0.3], [0.5, 0.25, -0.3], [0.55, 0.02, -0.4], [-0.55, 0.02, -0.4], C.gown);
      parts.body = p;
      p = Part();
      frustum(p, 0.92, 1.38, 0.24, 0.34, 6, C.corset, { stripes: C.gown });
      box(p, [0, 0.98, 0], [0.5, 0.07, 0.36], C.gold);
      ball(p, [0, 0.98, 0.2], 0.07, C.gem, 2, 4, { glow: 0.6 });
      for (const sx of [-1, 1]) {                                                                                // gold shoulder spikes
        const x = 0.36 * sx;
        tri(p, [x - 0.14 * sx, 1.36, 0.14], [x + 0.2 * sx, 1.32, 0], [x, 1.62, 0], C.gold);
        tri(p, [x + 0.2 * sx, 1.32, 0], [x - 0.14 * sx, 1.36, -0.14], [x, 1.62, 0], C.goldDeep);
        tri(p, [x - 0.14 * sx, 1.36, -0.14], [x - 0.14 * sx, 1.36, 0.14], [x, 1.62, 0], C.gold);
      }
      for (let k = 0; k < 9; k++) {                                                                              // standing collar
        const a = -1.25 + (k / 8) * 2.5, b = a + 0.29, R = 0.9, y0 = 1.36;
        const P = (ang, rr) => [Math.sin(ang) * rr * 0.9, y0 + Math.cos(ang) * rr * 0.9, -0.3];
        tri(p, [Math.sin(a) * 0.2, y0 + 0.05, -0.18], P(a, R), P(b, R * 1.08), k % 2 ? C.gown : C.panel);
        tri(p, P(a, R), P(a + 0.14, R * 1.16), P(b, R * 1.08), C.gold, { glow: 0.45 });
      }
      box(p, [0, 1.42, 0], [0.13, 0.12, 0.13], C.shell);
      parts.torso = p;
      p = Part();
      box(p, [0, 0.4, 0], [0.98, 0.68, 0.6], C.shell);
      box(p, [0, 0.42, 0.29], [0.86, 0.56, 0.04], C.gold);
      plate(p, [0, 0.42, 0.315], [0.8, 0.5]);
      for (const sx of [-1, 1]) {                                                                                // hoops
        const hoop = Part(); frustum(hoop, -0.018, 0.018, 0.15, 0.15, 10, C.gold, { caps: false, glow: 0.15 });
        add(p, hoop, M.chain(M.t(0.53 * sx, 0.0, 0.02), M.rz(Math.PI / 2)));
        box(p, [0.5 * sx, 0.22, 0.02], [0.05, 0.07, 0.05], C.gold);
      }
      const crownY = 0.74;
      frustum(p, crownY, crownY + 0.09, 0.27, 0.3, 12, C.gold, { caps: false });
      for (let k = 0; k < 7; k++) {
        const a0 = (k / 7) * Math.PI * 2, a1 = ((k + 0.5) / 7) * Math.PI * 2, a2 = ((k + 1) / 7) * Math.PI * 2, r = 0.3, y = crownY + 0.09;
        const tall = 0.32 + 0.26 * Math.max(0, Math.cos(a1)), P = (a, rr, yy) => [Math.sin(a) * rr, yy, Math.cos(a) * rr];
        tri(p, P(a0, r, y), P(a2, r, y), P(a1, r * 0.95, y + tall), k % 2 ? C.gold : C.goldDeep);
        tri(p, P(a2, r * 0.8, y), P(a0, r * 0.8, y), P(a1, r * 0.8, y + tall * 0.92), C.gown);
        ball(p, P(a1, r * 0.95, y + tall * 0.45), 0.04, C.gem, 2, 4, { glow: 0.7 });
      }
      parts.head = p;
      p = Part(); box(p, [0, -0.16, 0], [0.12, 0.32, 0.12], C.skin); ball(p, [0, 0, 0], 0.09, C.gold, 3, 6); parts.upper = p;
      p = Part(); box(p, [0, -0.15, 0], [0.11, 0.3, 0.11], C.gown); ball(p, [0, -0.34, 0], 0.085, C.gown, 3, 6); box(p, [0, -0.06, 0], [0.13, 0.04, 0.13], C.gold); parts.fore = p;
      for (const [name, col] of [['ribA', C.gown], ['ribB', C.panel]]) {                                         // one rib of the fan
        p = Part(); tri(p, [0, 0, 0], [0.09, 0.44, 0], [-0.09, 0.44, 0], col); tri(p, [0, 0, 0.001], [-0.09, 0.44, 0.001], [0.09, 0.44, 0.001], col);
        quad(p, [-0.09, 0.44, 0.002], [0.09, 0.44, 0.002], [0.08, 0.4, 0.002], [-0.08, 0.4, 0.002], C.gold); parts[name] = p;
      }
      p = Part(); star(p, 0.16, C.flash); parts.flash = p;
      p = Part(); plate(p, [0, 0.2, 0], [0.32, 0.4]); box(p, [0, -0.2, -0.01], [0.03, 0.4, 0.02], C.goldDeep); parts.card = p;
      return parts;
    }
    const VOGUE = [
      { R: { up: [0, 0, 1.95], fore: [0, 0, 1.55] }, L: { up: [0, 0, -1.95], fore: [0, 0, -1.55] }, head: [0, -0.15], hip: 0, yaw: 0, fan: 0.15 },
      { R: { up: [0, -0.2, 1.35], fore: [0, 0, 0.15] }, L: { up: [0, 0, -0.75], fore: [0, 0, 2.0] }, head: [0.18, -0.2], hip: 0.08, yaw: -0.45, fan: 1 },
      { R: { up: [-0.3, 0, 2.5], fore: [0, 0, 0.35] }, L: { up: [0, 0, -0.75], fore: [0, 0, 2.0] }, head: [-0.15, -0.28], hip: -0.1, yaw: 0.5, fan: 1 },
      { R: { up: [0, 0, 0.75], fore: [0, 0, -2.0] }, L: { up: [0, 0, -0.75], fore: [0, 0, 2.0] }, head: [0.12, -0.32], hip: 0.12, yaw: 0, fan: 0 },
    ];
    const lerpArm = (a, b, k) => ({ up: a.up.map((v, i) => lerp(v, b.up[i], k)), fore: a.fore.map((v, i) => lerp(v, b.fore[i], k)) });
    const snap = (x) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
    function pose(mood, t, turn) {
      const out = [];
      let rootY = 0, yaw = 0, lean = 0, hip = 0, headTilt = 0, headNod = 0, arms, fan = 1, fanWave = 0, fanOnFloor = false;
      if (mood === 'neutral') {
        yaw = Math.sin(t * 0.45) * 0.5; hip = 0.07 + Math.sin(t * 0.9) * 0.02; headTilt = 0.1; headNod = -0.14; fanWave = Math.sin(t * 7) * 0.35;
        arms = { R: { up: [-0.55, 0, 0.75], fore: [-0.75, 0, 0.95] }, L: { up: [0, 0, -0.75], fore: [0, 0, 2.0] } };
      } else if (mood === 'win') {
        const beat = 0.85, k = Math.floor(t / beat), into = (t % beat) / 0.2;
        const A = VOGUE[(k + VOGUE.length - 1) % VOGUE.length], B = VOGUE[k % VOGUE.length], e = into >= 1 ? 1 : snap(into);
        arms = { R: lerpArm(A.R, B.R, e), L: lerpArm(A.L, B.L, e) };
        headTilt = lerp(A.head[0], B.head[0], e); headNod = lerp(A.head[1], B.head[1], e); hip = lerp(A.hip, B.hip, e); yaw = lerp(A.yaw, B.yaw, e);
        fan = clamp01(lerp(A.fan, B.fan, Math.min(1, into * 1.6))); rootY = Math.max(0, Math.sin(Math.min(1, into) * Math.PI)) * 0.08;
      } else {
        yaw = 0.25 + Math.sin(t * 0.5) * 0.1; lean = -0.22 + Math.sin(t * 0.8) * 0.03; headNod = -0.45 + Math.sin(t * 0.8) * 0.04; headTilt = 0.22;
        arms = { R: { up: [-0.35, 0, 1.75], fore: [-0.2, 0, 1.75] }, L: { up: [0.05, 0, -0.32], fore: [0.1, 0, -0.15] } };
        fanOnFloor = true; fan = 0;
      }
      const root = M.chain(M.t(0, rootY, 0), M.ry(yaw + turn));
      out.push(['body', M.chain(root, M.rz(hip * 0.5))]);
      const torso = M.chain(root, M.t(0, 0.95, 0), M.rx(lean), M.rz(-hip), M.t(0, -0.95, 0));
      out.push(['torso', torso], ['head', M.chain(torso, M.t(0, 1.47, 0), M.rz(headTilt), M.rx(headNod))]);
      const hand = arm(out, torso, [0.4, 1.3], arms.R); arm(out, torso, [-0.4, 1.3], arms.L);
      const fanBase = fanOnFloor ? M.chain(root, M.t(0.45, 0.03, 0.55), M.rx(-Math.PI / 2), M.rz(0.6)) : M.chain(hand, M.t(0, 0, 0.04), M.rz(Math.PI), M.ry(fanWave + (mood === 'neutral' ? -0.6 : 0)));
      const spread = 0.2 + fan * 2.6;
      for (let k = 0; k < 9; k++) out.push([k % 2 ? 'ribA' : 'ribB', M.chain(fanBase, M.rz(-spread / 2 + (k / 8) * spread), M.t(0, 0, k * 0.002))]);
      const cards = mood === 'win' ? ['10', '10', '10'] : mood === 'lose' ? ['0', '0', '0'] : [];
      [-1.12, 0.98, 1.3].forEach((x, i) => cards[i] && out.push(['card', M.chain(M.t(x, (mood === 'win' ? 0.45 + Math.abs(Math.sin(t * 2 + i)) * 0.12 : 0.3 + Math.sin(t * 0.7 + i) * 0.04), 1.1 - i * 0.25), M.rz((x < 0 ? 1 : -1) * (mood === 'win' ? 0.12 : 0.2))), { tex: cards[i] }]));
      if (mood === 'win') for (let k = 0; k < 5; k++) {
        const life = (t * 1.3 + k * 0.37) % 1, seed = Math.floor(t * 1.3 + k * 0.37) * 7 + k, sc = life < 0.25 ? life * 4 : Math.max(0, 1 - (life - 0.25) * 3);
        if (sc > 0.02) out.push(['flash', M.chain(M.t(Math.sin(seed * 12.9) * 1.4, 1.0 + (Math.sin(seed * 78.2) * 0.5 + 0.5) * 1.6, 0.6), M.ry(-turn), M.s(sc * 1.4))]);
      }
      return out;
    }
    return {
      id: 'diva', name: 'The Diva', accent: '#ff4fa3', grey: 0.2, noReflect: ['card', 'flash'],
      tagline: 'Supremely confident, takes losses personally. A couture queen: mermaid gown, standing collar, spiked crown, and a fan she snaps open on every pose.',
      captions: { neutral: 'Hand on hip, fan going, side-eye for the competition. Unbothered.', win: 'Hits pose after pose while the judges hold up 10s and the cameras flash.', lose: 'A full dramatic swoon, mascara running, fan dropped at her feet, and the judges hold up 0s.' },
      backdrops: { neutral: [[0.30, 0.03, 0.18], [0.12, 0.02, 0.12], [0.04, 0.02, 0.06], [0.18, 0.03, 0.12]], win: [[0.42, 0.26, 0.06], [0.36, 0.04, 0.22], [0.10, 0.03, 0.10], [0.24, 0.14, 0.05]], lose: [[0.14, 0.06, 0.18], [0.06, 0.05, 0.12], [0.02, 0.02, 0.05], [0.08, 0.04, 0.10]] },
      build, pose, textures: (mood) => ({ face: face(mood), '10': sign('10'), '0': sign('0') }),
    };
  })();

  // =====================================================================================================
  // THE ANALYST: plays the odds. An office-computer accountant: monitor head with glasses, vest and tie, a clipboard.
  // =====================================================================================================
  const Analyst = (() => {
    const C = { beige: [0.82, 0.8, 0.72], beigeDark: [0.62, 0.6, 0.54], vest: [0.05, 0.55, 0.62], shirt: [0.93, 0.96, 1.0], tie: [0.85, 0.15, 0.25], navy: [0.1, 0.13, 0.25], shoe: [0.06, 0.06, 0.08], board: [0.5, 0.33, 0.18], steel: [0.7, 0.75, 0.82], cyan: [0.2, 0.95, 1.0], red: [1.0, 0.25, 0.3], yellow: [1, 0.9, 0.4] };
    function face(mood) {
      return screen('#06262c', '#031418', (p) => {
        const INK = '#39f0ff', c = p.c;
        const glasses = (tilt) => { c.save(); c.translate(32, 16); c.rotate(tilt); for (const x of [-13, 13]) { c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(x - 9, -7, 18, 13); } p.line(2, INK, [[-4, -2], [4, -2]]); c.restore(); };
        if (mood === 'neutral') {
          glasses(0); p.dot(19, 16, 2.2, INK); p.dot(45, 16, 2.2, INK);
          p.line(2, INK, [[25, 32], [39, 32]]);
        } else if (mood === 'win') {
          glasses(0); p.line(2.2, INK, [[14, 17], [19, 13, 24, 17]]); p.line(2.2, INK, [[40, 17], [45, 13, 50, 17]]);     // pleased, eyes closed
          p.line(1.5, '#fff', [[11, 11], [15, 7]]); p.line(1.5, '#fff', [[37, 11], [41, 7]]);                              // glint on the lenses
          p.line(2, INK, [[25, 31], [33, 34, 41, 29]]);                                                                    // a small, satisfied smile
        } else {
          glasses(0.14); const RED = '#ff5566';
          for (const x of [19, 46]) { p.line(2, RED, [[x - 3, 14], [x + 3, 20]]); p.line(2, RED, [[x + 3, 14], [x - 3, 20]]); }  // X eyes
          p.line(2, RED, [[22, 33], [26, 30], [30, 33], [34, 30], [38, 33], [42, 30]]);                                    // zigzag mouth
          p.line(1, INK, [[52, 4], [56, 9], [53, 10], [58, 16]]);                                                          // a crack
        }
      });
    }
    function build() {
      const parts = {};
      let p = Part(); box(p, [0, -0.26, 0], [0.17, 0.52, 0.17], C.navy); box(p, [0, -0.56, 0.06], [0.2, 0.1, 0.32], C.shoe); parts.leg = p;
      p = Part();
      box(p, [0, 0.36, 0], [0.62, 0.72, 0.4], C.vest);
      quad(p, [-0.11, 0.02, 0.202], [0.11, 0.02, 0.202], [0.16, 0.72, 0.202], [-0.16, 0.72, 0.202], C.shirt);            // shirt front
      tri(p, [-0.05, 0.66, 0.206], [0.05, 0.66, 0.206], [0, 0.58, 0.206], C.tie);                                          // tie knot
      quad(p, [-0.04, 0.58, 0.206], [0.04, 0.58, 0.206], [0.07, 0.24, 0.206], [-0.07, 0.24, 0.206], C.tie);
      tri(p, [-0.07, 0.24, 0.206], [0.07, 0.24, 0.206], [0, 0.14, 0.206], C.tie);
      box(p, [0.2, 0.52, 0.21], [0.14, 0.12, 0.02], C.shirt); box(p, [0.17, 0.6, 0.215], [0.02, 0.1, 0.02], C.red); box(p, [0.22, 0.6, 0.215], [0.02, 0.1, 0.02], C.navy); // pocket and pens
      box(p, [0, 0.78, 0], [0.16, 0.12, 0.16], C.beigeDark);                                                              // neck
      parts.torso = p;
      p = Part();
      box(p, [0, 0.4, 0], [0.92, 0.7, 0.62], C.beige);
      box(p, [0, 0.42, 0.29], [0.8, 0.56, 0.05], C.beigeDark);
      plate(p, [0, 0.43, 0.32], [0.72, 0.46]);
      box(p, [0.3, 0.1, 0.32], [0.08, 0.03, 0.02], C.cyan, { glow: 1 });                                                  // power light
      box(p, [-0.28, 0.84, 0], [0.03, 0.22, 0.03], C.steel); ball(p, [-0.28, 0.97, 0], 0.05, C.red, 2, 4, { glow: 0.6 });  // antenna
      box(p, [0.5, 0.52, 0.1], [0.03, 0.03, 0.4], C.yellow);                                                              // pencil tucked on the side
      parts.head = p;
      p = Part(); box(p, [0, -0.16, 0], [0.14, 0.32, 0.14], C.shirt); parts.upper = p;
      p = Part(); box(p, [0, -0.14, 0], [0.12, 0.28, 0.12], C.shirt); ball(p, [0, -0.34, 0], 0.085, C.beige, 3, 6); box(p, [0, -0.24, 0], [0.14, 0.05, 0.14], C.vest); parts.fore = p;
      p = Part(); box(p, [0, 0.24, 0], [0.34, 0.46, 0.03], C.board); plate(p, [0, 0.22, 0.017], [0.28, 0.37]); box(p, [0, 0.45, 0.02], [0.12, 0.05, 0.03], C.steel); parts.clipboard = p;
      p = Part(); box(p, [0, 0.5, 0], [0.16, 1, 0.16], C.cyan, { glow: 0.75 }); parts.bar = p;
      p = Part(); box(p, [0, 0.5, 0], [0.16, 1, 0.16], C.red, { glow: 0.75 }); parts.barRed = p;
      p = Part(); plate(p, [0, 0, 0], [0.6, 0.36]); parts.tag = p;
      p = Part(); star(p, 0.13, C.yellow); parts.spark = p;
      p = Part(); quad(p, [-0.11, -0.14, 0], [0.11, -0.14, 0], [0.11, 0.14, 0], [-0.11, 0.14, 0], C.shirt); quad(p, [0.11, -0.14, -0.001], [-0.11, -0.14, -0.001], [-0.11, 0.14, -0.001], [0.11, 0.14, -0.001], C.shirt); parts.paper = p;
      return parts;
    }
    function pose(mood, t, turn) {
      const out = [];
      let yaw = 0, rootY = 0, lean = 0, headNod = 0, headTilt = 0, headYaw = 0, R, L, knee = 0, board = 'hand';
      if (mood === 'neutral') {
        yaw = -0.25 + Math.sin(t * 0.4) * 0.12; rootY = Math.sin(t * 1.6) * 0.012;
        const lookUp = clamp01(Math.sin(t * 0.7) * 3 - 1.6);                       // glances up from the clipboard now and then
        headNod = lerp(0.3, -0.05, lookUp); headYaw = lerp(0.25, -0.2, lookUp);
        const push = clamp01(Math.sin(t * 0.7 + 2.2) * 4 - 2.6);                   // pushes his glasses up
        R = { up: [-0.75, 0, 0.25], fore: [-1.15, 0, -0.35] };
        L = { up: [lerp(-0.1, -1.0, push), 0, lerp(-0.15, -0.55, push)], fore: [lerp(-0.2, -1.9, push), 0, lerp(0, 0.5, push)] };
      } else if (mood === 'win') {
        rootY = Math.abs(Math.sin(t * 3.2)) * 0.06; yaw = Math.sin(t * 0.8) * 0.2; headNod = -0.15 + Math.sin(t * 3.2) * 0.05;
        R = { up: [0, 0, 2.55], fore: [0, 0, 0.3] };                                // the chart, held high
        const pump = Math.max(0, Math.sin(t * 6.4));                               // one small, dignified fist pump after another
        L = { up: [-0.3, 0, -0.35], fore: [lerp(-1.6, -2.3, pump), 0, 0] };
      } else {
        yaw = Math.sin(t * 9) * 0.03; lean = 0.05; rootY = Math.sin(t * 13) * 0.008; knee = 0.1;
        headTilt = Math.sin(t * 2.2) * 0.2; headNod = 0.1;                         // head lolling, does not compute
        R = { up: [-0.2, 0, 2.2], fore: [0, 0, 1.85] }; L = { up: [-0.2, 0, -2.2], fore: [0, 0, -1.85] };   // both hands on his head
        board = 'floor';
      }
      const root = M.chain(M.t(0, rootY + 0.62 - knee * 0.3, 0), M.ry(yaw + turn));
      out.push(['leg', M.chain(root, M.t(0.17, 0, 0), M.rz(knee))], ['leg', M.chain(root, M.t(-0.17, 0, 0), M.rz(-knee))]);
      const torso = M.chain(root, M.rx(lean));
      out.push(['torso', torso], ['head', M.chain(torso, M.t(0, 0.84, 0), M.ry(headYaw), M.rz(headTilt), M.rx(headNod))]);
      const hand = arm(out, torso, [0.38, 0.62], R, ['upper', 'fore'], [0.32, 0.34]); arm(out, torso, [-0.38, 0.62], L, ['upper', 'fore'], [0.32, 0.34]);
      const chartTex = mood === 'win' ? 'up' : mood === 'lose' ? 'down' : 'flat';
      if (board === 'hand') out.push(['clipboard', M.chain(hand, mood === 'win' ? M.chain(M.rz(Math.PI), M.t(0, -0.1, 0.05)) : M.chain(M.rx(1.9), M.rz(0.35), M.t(0, -0.2, 0.03))), { tex: chartTex }]);
      else out.push(['clipboard', M.chain(M.ry(turn), M.t(0.75, 0.02, 0.5), M.rx(-Math.PI / 2), M.rz(0.5)), { tex: chartTex }]);
      // a little floating bar chart beside him
      const heights = [0, 1, 2, 3].map((i) => mood === 'win' ? 0.25 + i * 0.22 + Math.max(0, Math.sin(t * 3.2 - i * 0.5)) * 0.12 : mood === 'lose' ? Math.max(0.05, 0.75 - i * 0.2 - ((t * 0.6) % 1) * 0.3) : 0.3 + 0.18 * Math.sin(t * 1.3 + i * 1.9) + 0.1 * Math.sin(t * 2.9 + i));
      heights.forEach((h, i) => out.push([mood === 'lose' ? 'barRed' : 'bar', M.chain(M.ry(turn), M.t(-1.3 + i * 0.22, 0.75, 0.25 - i * 0.03), M.s(1, h, 1)), { fade: 0.85 }]));
      const float = (name, x, y, i) => out.push(['tag', M.chain(M.t(x, y + Math.sin(t * 1.4 + i * 2) * 0.06, 0.5), M.rz(Math.sin(t + i) * 0.06)), { tex: name }]);
      if (mood === 'win') { float('+EV', 1.05, 1.9, 0); float('97%', -1.05, 2.25, 1); }
      if (mood === 'lose') {
        float('ERR', 1.1, 1.95, 0); float('0%', -1.05, 2.3, 1);
        for (let k = 0; k < 4; k++) { const life = (t * 1.6 + k * 0.29) % 1; out.push(['spark', M.chain(torso, M.t(Math.sin(k * 5.1 + Math.floor(t * 1.6 + k * 0.29)) * 0.4, 1.55 + life * 0.5, 0.2), M.ry(-yaw - turn), M.s(1 - life))]); }
        for (let k = 0; k < 3; k++) { const life = (t * 0.35 + k / 3) % 1; out.push(['paper', M.chain(M.t(-0.6 + k * 0.7 + Math.sin(t * 2 + k) * 0.15, 2.6 - life * 2.6, 0.6 - k * 0.3), M.rz(Math.sin(t * 2.3 + k) * 0.8), M.rx(t * 1.5 + k))]); }
      }
      return out;
    }
    const tag = (text, bg, fg) => sign(text, { w: 60, h: 36, bg, fg, size: 22 });
    return {
      id: 'analyst', name: 'The Analyst', accent: '#39f0ff', grey: 0, noReflect: ['tag', 'spark', 'paper', 'bar', 'barRed'],
      tagline: 'Plays the odds and speaks in probabilities. An office computer in a vest and tie, never without his clipboard.',
      captions: { neutral: 'Studies his clipboard, pushes his glasses up, and keeps an eye on a live bar chart.', win: 'Holds the chart high for a small, dignified fist pump. Exactly as projected.', lose: 'Does not compute. Hands on his head, sparks flying, numbers in the red, papers everywhere.' },
      backdrops: { neutral: [[0.03, 0.16, 0.22], [0.03, 0.08, 0.18], [0.02, 0.03, 0.08], [0.02, 0.10, 0.14]], win: [[0.05, 0.3, 0.3], [0.04, 0.14, 0.3], [0.02, 0.05, 0.12], [0.03, 0.18, 0.2]], lose: [[0.2, 0.04, 0.08], [0.08, 0.04, 0.12], [0.03, 0.02, 0.05], [0.12, 0.03, 0.06]] },
      build, pose, textures: (mood) => ({ face: face(mood), up: chart('up'), down: chart('down'), flat: chart('flat'), '+EV': tag('+EV', '#06262c', '#39f0ff'), '97%': tag('97%', '#06262c', '#39f0ff'), ERR: tag('ERR', '#2a060c', '#ff5566'), '0%': tag('0%', '#2a060c', '#ff5566') }),
    };
  })();

  // =====================================================================================================
  // THE CHAOS AGENT: deliberately unpredictable. A lopsided jester on a spring, juggling dice.
  // =====================================================================================================
  const Chaos = (() => {
    const C = { red: [0.95, 0.12, 0.15], yellow: [1.0, 0.82, 0.1], purple: [0.45, 0.15, 0.75], black: [0.08, 0.06, 0.1], steel: [0.72, 0.74, 0.8], gold: [1, 0.78, 0.25], white: [0.97, 0.97, 0.95], green: [0.2, 0.9, 0.5] };
    function face(mood) {
      return screen('#1a0508', '#0a0204', (p) => {
        const INK = '#ff3a3a', Y = '#ffd21a', c = p.c;
        if (mood === 'neutral') {
          p.ring(19, 15, 8, 2.5, INK); p.dot(21, 16, 3, Y);                               // one huge eye
          p.dot(46, 13, 3, INK);                                                         // one tiny eye
          p.line(2.2, INK, [[12, 30], [18, 34], [24, 29], [30, 34], [36, 29], [42, 34], [48, 29], [53, 33]]);   // zigzag grin
        } else if (mood === 'win') {
          p.spark(19, 14, 8, Y); p.spark(45, 14, 8, Y);
          p.fill(INK, () => { c.moveTo(13, 25); c.lineTo(51, 25); c.quadraticCurveTo(32, 46, 13, 25); });
          p.fill('#fff', () => c.rect(18, 25, 28, 3.5));
          for (let x = 22; x < 46; x += 5) p.line(1, '#1a0508', [[x, 25], [x, 28.5]]);
        } else {
          p.line(2.5, INK, [[13, 9], [25, 21]]); p.line(2.5, INK, [[25, 9], [13, 21]]);                     // X
          c.strokeStyle = Y; c.lineWidth = 2; c.beginPath(); for (let a = 0; a < 12; a += 0.3) { const r = a * 0.75; c.lineTo(45 + Math.cos(a) * r, 15 + Math.sin(a) * r); } c.stroke();  // spiral
          p.line(2.2, INK, [[16, 30], [24, 27, 32, 31], [40, 34, 48, 29]]);                                  // wobbly grin
          p.fill('#ff7a9a', () => c.ellipse(38, 35, 4, 4.5, 0, 0, Math.PI * 2));                             // tongue out
        }
      }, 0.22);
    }
    function die(pips) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 24; const c = cv.getContext('2d');
      c.fillStyle = '#f7f5ef'; c.fillRect(0, 0, 24, 24); c.strokeStyle = '#b9b3a6'; c.strokeRect(0.5, 0.5, 23, 23); c.fillStyle = '#16080c';
      const at = { 1: [[12, 12]], 5: [[6, 6], [18, 6], [12, 12], [6, 18], [18, 18]], 6: [[6, 5], [18, 5], [6, 12], [18, 12], [6, 19], [18, 19]] }[pips];
      for (const [x, y] of at) { c.beginPath(); c.arc(x, y, 2.4, 0, 7); c.fill(); }
      return cv;
    }
    function build() {
      const parts = {};
      let p = Part(); frustum(p, 0, 0.08, 0.5, 0.44, 8, C.black); frustum(p, 0.08, 0.12, 0.3, 0.3, 8, C.steel); parts.base = p;
      p = Part(); frustum(p, -0.025, 0.025, 0.24, 0.24, 8, C.steel, { caps: false }); frustum(p, -0.025, 0.025, 0.17, 0.17, 8, [0.4, 0.42, 0.5], { caps: false }); parts.coil = p;
      p = Part();
      frustum(p, 0, 0.62, 0.26, 0.46, 5, C.red, { stripes: C.yellow, twist: 0.3 });                       // a lopsided, five-sided body
      box(p, [0.36, 0.38, 0.05], [0.26, 0.2, 0.22], C.purple);                                            // a box that doesn't belong
      box(p, [0, 0.3, -0.36], [0.05, 0.05, 0.22], C.gold); box(p, [0, 0.3, -0.48], [0.3, 0.16, 0.04], C.gold);   // wind-up key
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + 0.3; tri(p, [Math.sin(a) * 0.46, 0.62, Math.cos(a) * 0.46], [Math.sin(a + 1.256) * 0.46, 0.62, Math.cos(a + 1.256) * 0.46], [Math.sin(a + 0.63) * 0.62, 0.5, Math.cos(a + 0.63) * 0.62], k % 2 ? C.yellow : C.purple); } // ruff collar
      parts.body = p;
      p = Part();
      box(p, [0, 0.36, 0], [0.8, 0.62, 0.6], C.black);
      plate(p, [0, 0.36, 0.305], [0.7, 0.5]);
      // jester hat: two horns, one bigger than the other, with bells
      const horn = (sx, len, col) => { const base = [[0.02 * sx, 0.67, 0.22], [0.4 * sx, 0.67, 0.22], [0.4 * sx, 0.67, -0.22], [0.02 * sx, 0.67, -0.22]], mid = [0.55 * sx * len, 0.67 + 0.42 * len, 0], tip = [0.95 * sx * len, 0.67 + 0.25 * len, 0];
        for (let k = 0; k < 4; k++) { const a = base[k], b = base[(k + 1) % 4]; if (sx > 0) tri(p, a, b, mid, col); else tri(p, b, a, mid, col); }
        tri(p, [mid[0] - 0.12 * sx, mid[1] - 0.1, 0.1], [mid[0] - 0.12 * sx, mid[1] - 0.1, -0.1], tip, col); tri(p, [mid[0] - 0.12 * sx, mid[1] - 0.1, -0.1], [mid[0] - 0.12 * sx, mid[1] - 0.1, 0.1], tip, col); tri(p, mid, [mid[0] - 0.12 * sx, mid[1] - 0.1, 0.1], tip, col); tri(p, [mid[0] - 0.12 * sx, mid[1] - 0.1, -0.1], mid, tip, col);
        ball(p, tip, 0.08, C.gold, 3, 5, { glow: 0.3 }); };
      horn(1, 1.15, C.red); horn(-1, 0.7, C.yellow);
      parts.head = p;
      p = Part(); box(p, [0, -0.2, 0], [0.1, 0.4, 0.1], C.purple); ball(p, [0, 0, 0], 0.09, C.yellow, 3, 5); parts.upperLong = p;
      p = Part(); box(p, [0, -0.22, 0], [0.09, 0.44, 0.09], C.red); ball(p, [0, -0.5, 0], 0.15, C.white, 3, 6); parts.foreLong = p;                 // one long arm with a big glove
      p = Part(); box(p, [0, -0.1, 0], [0.1, 0.2, 0.1], C.yellow); ball(p, [0, 0, 0], 0.09, C.purple, 3, 5); parts.upperShort = p;
      p = Part(); box(p, [0, -0.1, 0], [0.09, 0.2, 0.09], C.purple); ball(p, [0, -0.24, 0], 0.08, C.white, 3, 5); parts.foreShort = p;              // one stubby arm
      p = Part(); box(p, [0, 0, 0], [0.24, 0.24, 0.24], C.white, { tex: true, uv: UV }); parts.die = p;
      for (const [name, col] of [['confA', C.yellow], ['confB', C.red], ['confC', C.green], ['confD', C.purple]]) { p = Part(); quad(p, [-0.05, -0.03, 0], [0.05, -0.03, 0], [0.05, 0.03, 0], [-0.05, 0.03, 0], col, { glow: 0.6 }); quad(p, [0.05, -0.03, 0], [-0.05, -0.03, 0], [-0.05, 0.03, 0], [0.05, 0.03, 0], col, { glow: 0.6 }); parts[name] = p; }
      p = Part(); star(p, 0.12, C.yellow); parts.dizzy = p;
      return parts;
    }
    function pose(mood, t, turn) {
      const out = [];
      const world = M.ry(turn);
      if (mood === 'lose') {
        // knocked flat: tipped over on its side, still twitching, stars circling its head
        const twitch = Math.max(0, Math.sin(t * 2.3)) ** 8 * 0.12;
        const root = M.chain(world, M.t(-0.55, 0.5 + twitch, 0), M.rz(-1.42 - twitch), M.ry(0.3));
        out.push(['base', M.chain(world, M.t(-1.1, 0, 0.15), M.rz(-0.12))]);
        for (let k = 0; k < 5; k++) out.push(['coil', M.chain(world, M.t(-1.0 + k * 0.11, 0.2 + k * 0.07 + Math.sin(t * 6 + k) * 0.01, 0.12), M.rz(-0.9 - k * 0.1))]);
        out.push(['body', root]);
        const head = M.chain(root, M.t(0, 0.66, 0), M.rz(0.25 + Math.sin(t * 1.3) * 0.08));
        out.push(['head', head]);
        arm(out, root, [0.42, 0.5], { up: [0, 0, 2.2], fore: [0, 0, 0.4] }, ['upperLong', 'foreLong'], [0.4, 0.44]);
        arm(out, root, [-0.42, 0.5], { up: [0.3, 0, -1.2 + Math.sin(t * 5) * 0.2], fore: [0, 0, -0.5] }, ['upperShort', 'foreShort'], [0.2, 0.2]);
        for (let k = 0; k < 4; k++) { const a = t * 2.4 + k * 1.57; out.push(['dizzy', M.chain(world, M.t(0.6 + Math.cos(a) * 0.45, 1.25 + Math.sin(a * 2) * 0.06, Math.sin(a) * 0.45), M.ry(-turn), M.rz(t * 3))]); }
        [[0.2, 0.5, 0.3], [0.75, 0.75, 1.1], [-0.2, 0.9, 2.0]].forEach(([x, z, r]) => out.push(['die', M.chain(world, M.t(x, 0.12, z), M.ry(r)), { tex: 'die1' }]));   // snake eyes
        return out;
      }
      const win = mood === 'win';
      const squash = win ? Math.sin(t * 7) : Math.sin(t * 3.1);                    // the spring
      const height = 0.62 + squash * (win ? 0.28 : 0.1), hop = win ? Math.max(0, Math.sin(t * 7)) * 0.45 : 0;
      const sway = win ? [Math.sin(t * 5.3) * 0.3, Math.sin(t * 4.1) * 0.3] : [Math.sin(t * 1.7) * 0.22, Math.sin(t * 2.3 + 1) * 0.16];
      const spin = win ? t * 5 : Math.sin(t * 0.9) * 0.6 + Math.sin(t * 2.9) * 0.15;
      out.push(['base', M.chain(world, M.t(0, hop * 0.5, 0))]);
      for (let k = 0; k < 5; k++) out.push(['coil', M.chain(world, M.t(sway[1] * 0.1 * k, hop * 0.5 + 0.14 + (k + 0.5) / 5 * (height - 0.1), 0), M.rz((k % 2 ? 0.16 : -0.16) + sway[1] * 0.15), M.ry(k))]);
      const root = M.chain(world, M.t(sway[1] * 0.45, hop * 0.5 + height, 0), M.ry(spin), M.rz(-sway[1]), M.rx(sway[0]), M.s(1 + squash * -0.06, 1 + squash * 0.1, 1 + squash * -0.06));
      out.push(['body', root]);
      out.push(['head', M.chain(root, M.t(0.03, 0.66, 0), M.rz(sway[1] * 1.3 + 0.18), M.rx(-sway[0] * 0.8), M.ry(win ? 0 : Math.sin(t * 3.7) * 0.3))]);
      const f = win ? 9 : 4.2;
      arm(out, root, [0.44, 0.5], { up: [win ? 0 : -0.5, 0, (win ? 2.4 : 1.2) + Math.sin(t * f) * 0.4], fore: [win ? 0 : -0.6, 0, 0.4 + Math.sin(t * f + 1) * 0.3] }, ['upperLong', 'foreLong'], [0.4, 0.44]);
      arm(out, root, [-0.42, 0.5], { up: [win ? 0 : -0.6, 0, (win ? -2.4 : -1.3) + Math.sin(t * f + 3.1) * 0.4], fore: [-0.3, 0, -0.5] }, ['upperShort', 'foreShort'], [0.2, 0.2]);
      // dice: juggled in a loop (neutral), or flung into a wide orbit (winning)
      for (let k = 0; k < 3; k++) {
        const a = t * (win ? 3.2 : 2.6) + k * 2.094;
        const pos = win ? [Math.sin(a) * 1.25, 1.6 + Math.sin(a * 2 + k) * 0.5, Math.cos(a) * 0.9] : [Math.sin(a) * 0.62, 1.95 + Math.abs(Math.cos(a)) * 0.75 - 0.2, 0.55];
        out.push(['die', M.chain(world, M.t(...pos), M.rx(t * 4 + k), M.rz(t * 3 + k * 2)), { tex: ['die5', 'die6', 'die1'][k] }]);
      }
      if (win) for (let k = 0; k < 16; k++) {
        const life = (t * 0.5 + k * 0.137) % 1;
        out.push([['confA', 'confB', 'confC', 'confD'][k % 4], M.chain(M.t(Math.sin(k * 7.3) * 1.6 + Math.sin(t * 2 + k) * 0.1, 3.4 - life * 3.4, Math.cos(k * 3.1) * 0.9), M.rz(t * 5 + k), M.rx(t * 4 + k * 2))]);
      }
      return out;
    }
    return {
      id: 'chaos', name: 'The Chaos Agent', accent: '#ff3a3a', grey: 0, noReflect: ['confA', 'confB', 'confC', 'confD', 'dizzy'],
      tagline: 'Deliberately unpredictable, lives for surprise. A lopsided jester on a spring, with one long arm, one short one, and a handful of dice.',
      captions: { neutral: 'Wobbles on its spring, juggling dice and looking in two directions at once.', win: 'Spins and bounces sky-high, dice flying, confetti everywhere.', lose: 'Knocked flat with stars circling its head and the dice on snake eyes. Still grinning.' },
      backdrops: { neutral: [[0.3, 0.04, 0.06], [0.16, 0.03, 0.2], [0.05, 0.02, 0.08], [0.14, 0.08, 0.02]], win: [[0.45, 0.2, 0.02], [0.4, 0.04, 0.1], [0.12, 0.03, 0.2], [0.05, 0.2, 0.12]], lose: [[0.12, 0.04, 0.1], [0.06, 0.04, 0.1], [0.02, 0.02, 0.05], [0.08, 0.03, 0.05]] },
      build, pose, textures: (mood) => ({ face: face(mood), die1: die(1), die5: die(5), die6: die(6) }),
    };
  })();

  // =====================================================================================================
  // THE STRATEGIST: patient and positional. A chess-piece general in a long robe, cape and officer's cap.
  // =====================================================================================================
  const Strategist = (() => {
    const C = { robe: [0.06, 0.32, 0.18], robeDark: [0.04, 0.22, 0.13], ivory: [0.93, 0.9, 0.8], gold: [0.95, 0.78, 0.3], dark: [0.07, 0.09, 0.08], cape: [0.03, 0.14, 0.09], lining: [0.75, 0.6, 0.2], green: [0.3, 1.0, 0.5], black: [0.12, 0.12, 0.14] };
    function face(mood) {
      return screen('#04180c', '#020d07', (p) => {
        const INK = '#4dff88', c = p.c;
        if (mood === 'neutral') {
          p.line(2.4, INK, [[11, 15], [26, 15]]); p.line(2.4, INK, [[38, 15], [53, 15]]);              // narrowed, focused eyes
          p.dot(20, 17.5, 2, INK); p.dot(44, 17.5, 2, INK);
          p.line(1.6, INK, [[10, 9], [26, 11]]); p.line(1.6, INK, [[54, 9], [38, 11]]);                 // level brows, slightly knit
          p.line(2, INK, [[26, 31], [38, 31]]);
        } else if (mood === 'win') {
          p.line(2.4, INK, [[12, 16], [19, 12, 26, 16]]); p.line(2.4, INK, [[38, 16], [45, 12, 52, 16]]);   // eyes closed, content
          p.line(2, INK, [[25, 30], [32, 33, 41, 28]]);                                                  // the faintest smile
        } else {
          p.line(2.4, INK, [[12, 15], [19, 19, 26, 15]]); p.line(2.4, INK, [[38, 15], [45, 19, 52, 15]]);   // eyes lowered
          p.line(1.6, INK, [[11, 11], [25, 8]]); p.line(1.6, INK, [[53, 11], [39, 8]]);
          p.line(2, INK, [[26, 33], [32, 30, 38, 33]]);
          p.fill('#8fd0ff', () => { c.moveTo(56, 6); c.quadraticCurveTo(60, 13, 56, 14); c.quadraticCurveTo(52, 13, 56, 6); });   // one bead of sweat
        }
      });
    }
    function board() {
      const cv = document.createElement('canvas'); cv.width = cv.height = 32; const c = cv.getContext('2d');
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { c.fillStyle = (x + y) % 2 ? '#0d4a2a' : '#e9e2c8'; c.fillRect(x * 8, y * 8, 8, 8); }
      return cv;
    }
    function piece(p, col, kingTop) { // a little chess piece, standing on y = 0
      frustum(p, 0, 0.05, 0.13, 0.12, 8, col); frustum(p, 0.05, 0.3, 0.09, 0.05, 8, col, { caps: false }); frustum(p, 0.3, 0.34, 0.09, 0.09, 8, col);
      if (kingTop) { frustum(p, 0.34, 0.46, 0.06, 0.09, 8, col); box(p, [0, 0.54, 0], [0.03, 0.14, 0.03], col); box(p, [0, 0.55, 0], [0.11, 0.03, 0.03], col); }
      else ball(p, [0, 0.42, 0], 0.085, col, 3, 6);
    }
    function build() {
      const parts = {};
      let p = Part();
      frustum(p, 0, 0.12, 0.62, 0.56, 10, C.gold, { capColor: C.dark });                                  // base ring, like a chess piece
      frustum(p, 0.12, 1.15, 0.5, 0.24, 10, C.robe, { stripes: C.robeDark, caps: false });
      frustum(p, 0.55, 0.62, 0.4, 0.38, 10, C.gold, { caps: false });                                     // sash
      parts.body = p;
      p = Part();
      frustum(p, 1.12, 1.24, 0.36, 0.3, 10, C.ivory);                                                      // collar ring
      box(p, [0, 1.2, 0], [0.56, 0.2, 0.3], C.robe);
      for (const sx of [-1, 1]) { box(p, [0.34 * sx, 1.3, 0], [0.2, 0.07, 0.3], C.gold); for (let k = 0; k < 3; k++) box(p, [(0.27 + k * 0.07) * sx, 1.24, 0.14], [0.03, 0.08, 0.02], C.gold); }   // epaulettes
      // cape: from the shoulders down the back to the floor
      quad(p, [0.34, 1.3, -0.14], [-0.34, 1.3, -0.14], [-0.62, 0.05, -0.75], [0.62, 0.05, -0.75], C.cape);
      quad(p, [-0.34, 1.3, -0.13], [0.34, 1.3, -0.13], [0.62, 0.05, -0.74], [-0.62, 0.05, -0.74], C.lining);
      for (const sx of [-1, 1]) tri(p, [0.34 * sx, 1.3, -0.14], [0.62 * sx, 0.05, -0.75], [0.5 * sx, 0.3, -0.1], C.cape);
      box(p, [0, 1.34, 0], [0.14, 0.12, 0.14], C.ivory);
      parts.torso = p;
      p = Part();
      box(p, [0, 0.36, 0], [0.74, 0.6, 0.58], C.ivory);
      box(p, [0, 0.36, 0.28], [0.66, 0.46, 0.04], C.dark);
      plate(p, [0, 0.36, 0.305], [0.6, 0.4]);
      frustum(p, 0.66, 0.74, 0.44, 0.46, 8, C.gold, { caps: false, twist: Math.PI / 8 });                 // cap band
      frustum(p, 0.74, 0.92, 0.46, 0.52, 8, C.robe, { twist: Math.PI / 8 });                               // cap crown
      quad(p, [-0.3, 0.67, 0.36], [0.3, 0.67, 0.36], [0.24, 0.62, 0.62], [-0.24, 0.62, 0.62], C.dark); quad(p, [0.3, 0.67, 0.36], [-0.3, 0.67, 0.36], [-0.24, 0.62, 0.62], [0.24, 0.62, 0.62], C.dark);   // peak
      box(p, [0, 1.02, 0], [0.04, 0.2, 0.04], C.gold); box(p, [0, 1.05, 0], [0.16, 0.04, 0.04], C.gold);  // the king's cross on top
      ball(p, [0, 0.8, 0.5], 0.05, C.gold, 2, 4, { glow: 0.4 });
      parts.head = p;
      p = Part(); box(p, [0, -0.17, 0], [0.13, 0.34, 0.13], C.robe); parts.upper = p;
      p = Part(); box(p, [0, -0.15, 0], [0.14, 0.3, 0.14], C.robeDark); box(p, [0, -0.28, 0], [0.16, 0.05, 0.16], C.gold); ball(p, [0, -0.36, 0], 0.08, C.ivory, 3, 6); parts.fore = p;
      p = Part(); piece(p, C.gold, true); parts.king = p;
      p = Part(); piece(p, C.black, true); parts.darkKing = p;
      p = Part(); piece(p, C.ivory, false); parts.pawn = p;
      p = Part(); piece(p, C.black, false); parts.darkPawn = p;
      p = Part(); box(p, [0, -0.03, 0], [1.0, 0.06, 1.0], C.dark); quad(p, [-0.46, 0.001, 0.46], [0.46, 0.001, 0.46], [0.46, 0.001, -0.46], [-0.46, 0.001, -0.46], [1, 1, 1], { tex: true, uv: UV }); parts.board = p;
      p = Part(); plate(p, [0, 0, 0], [1.3, 0.3]); parts.banner = p;
      return parts;
    }
    function pose(mood, t, turn) {
      const out = [];
      let yaw = 0, lean = 0, headNod = 0, headTilt = 0, headYaw = 0, R, L;
      const breathe = Math.sin(t * 1.1) * 0.008;
      if (mood === 'neutral') {
        yaw = -0.2; headTilt = 0.08; headNod = 0.12; headYaw = 0.3 + Math.sin(t * 0.35) * 0.1;        // studying the board, barely moving
        R = { up: [-0.75, 0, 0.3], fore: [-2.05 + Math.sin(t * 1.4) * 0.06, 0, -0.55] };               // hand at his chin
        L = { up: [0.55, 0, -0.15], fore: [0.9, 0, 0.6] };                                             // other hand behind his back
      } else if (mood === 'win') {
        yaw = Math.sin(t * 0.5) * 0.15; headNod = -0.2 + Math.max(0, Math.sin(t * 1.5)) * 0.14;         // a slow, satisfied nod
        R = { up: [-0.2, 0, 2.45], fore: [0, 0, 0.25] };                                               // his king, held high
        L = { up: [0.55, 0, -0.15], fore: [0.9, 0, 0.6] };
      } else {
        yaw = 0.15; lean = 0.26 + Math.sin(t * 0.9) * 0.02; headNod = 0.16;                             // a deep bow
        R = { up: [-0.6, 0, 0.35], fore: [-1.85, 0, -0.75] };                                          // hand over his heart
        L = { up: [-0.3, 0, -0.12], fore: [-0.2, 0, 0] };
      }
      const root = M.chain(M.t(0, breathe, 0), M.ry(yaw + turn));
      out.push(['body', root]);
      const torso = M.chain(root, M.t(0, 0.9, 0), M.rx(lean), M.t(0, -0.9, 0));
      out.push(['torso', torso], ['head', M.chain(torso, M.t(0, 1.38, 0), M.ry(headYaw), M.rz(headTilt), M.rx(headNod))]);
      const hand = arm(out, torso, [0.36, 1.26], R); arm(out, torso, [-0.36, 1.26], L);
      const world = M.ry(turn);
      if (mood === 'neutral') {
        // a small board hovering beside him; one pawn slides forward and back as he thinks the move through
        const b = M.chain(world, M.t(0.92, 0.95 + Math.sin(t * 0.9) * 0.03, 0.5), M.rx(0.4), M.ry(0.3), M.s(0.85));
        out.push(['board', b, { tex: 'board' }]);
        const slide = (Math.sin(t * 0.8) * 0.5 + 0.5);
        out.push(['pawn', M.chain(b, M.t(-0.11, 0, lerp(0.34, 0.11, slide)))], ['pawn', M.chain(b, M.t(0.34, 0, 0.34))], ['king', M.chain(b, M.t(-0.34, 0, 0.34), M.s(0.8))]);
        out.push(['darkPawn', M.chain(b, M.t(0.11, 0, -0.34))], ['darkKing', M.chain(b, M.t(0.34, 0, -0.34), M.s(0.8))]);
      } else if (mood === 'win') {
        out.push(['king', M.chain(hand, M.rz(Math.PI), M.t(0, 0.02, 0), M.s(1.1))]);
        out.push(['darkKing', M.chain(world, M.t(0.95, 0.12, 0.75), M.ry(0.5), M.rz(-1.52 + Math.sin(t * 1.3) * 0.05), M.s(1.5))]);   // the other king, toppled
        out.push(['banner', M.chain(M.t(0, 2.85 + Math.sin(t * 1.2) * 0.04, 0.3)), { tex: 'checkmate' }]);
      } else {
        out.push(['king', M.chain(world, M.t(0.2, 0.12, 0.95), M.ry(-0.4 + Math.sin(t * 0.7) * 0.15), M.rz(1.52), M.s(1.5))]);       // his own king, laid down
        out.push(['banner', M.chain(M.t(0, 2.7 + Math.sin(t * 1.2) * 0.04, 0.3)), { tex: 'resigns' }]);
      }
      return out;
    }
    const banner = (text) => sign(text, { w: 130, h: 30, bg: '#04180c', fg: '#4dff88', size: 19 });
    return {
      id: 'strategist', name: 'The Strategist', accent: '#4dff88', grey: 0.15, noReflect: ['banner', 'board', 'pawn', 'darkPawn'],
      tagline: 'Patient, positional, always a few moves ahead. A chess-piece general in a long robe and cape, with the king\'s cross on his cap.',
      captions: { neutral: 'Hand at his chin, the other behind his back, thinking one pawn move through again and again.', win: 'Holds his king high over the other one, toppled at his feet, with a slow nod. Checkmate.', lose: 'Lays his own king down and bows, hand over his heart. A graceful resignation.' },
      backdrops: { neutral: [[0.03, 0.18, 0.1], [0.03, 0.1, 0.1], [0.01, 0.04, 0.03], [0.04, 0.12, 0.05]], win: [[0.22, 0.24, 0.05], [0.04, 0.24, 0.12], [0.02, 0.07, 0.04], [0.14, 0.14, 0.03]], lose: [[0.07, 0.1, 0.12], [0.05, 0.08, 0.1], [0.02, 0.03, 0.04], [0.05, 0.07, 0.08]] },
      build, pose, textures: (mood) => ({ face: face(mood), board: board(), checkmate: banner('CHECKMATE'), resigns: banner('I RESIGN') }),
    };
  })();

  // =====================================================================================================
  // THE ROOKIE: enthusiastic beginner. A small bot in an oversized propeller cap, rulebook in hand.
  // =====================================================================================================
  const Rookie = (() => {
    const C = { jersey: [1.0, 0.72, 0.1], trim: [0.95, 0.35, 0.1], white: [0.97, 0.97, 0.95], cap: [0.15, 0.4, 0.95], capDark: [0.1, 0.28, 0.7], shorts: [0.2, 0.25, 0.4], red: [0.95, 0.2, 0.2], pack: [0.2, 0.7, 0.55], yellow: [1, 0.9, 0.35], foam: [1.0, 0.45, 0.1], blue: [0.5, 0.8, 1.0], grey: [0.6, 0.62, 0.68] };
    function face(mood) {
      return screen('#fff6dd', '#ffe6a8', (p) => {
        const INK = '#3a2408', c = p.c;
        const cheeks = () => { p.fill('rgba(255,120,110,0.55)', () => c.ellipse(9, 26, 5, 3, 0, 0, 7)); p.fill('rgba(255,120,110,0.55)', () => c.ellipse(55, 26, 5, 3, 0, 0, 7)); };
        if (mood === 'neutral') {
          for (const x of [20, 44]) { p.dot(x, 15, 7, INK); p.dot(x - 2, 12.5, 2.4, '#fff'); p.dot(x + 2.5, 17.5, 1.2, '#fff'); }   // big, eager eyes
          cheeks(); p.fill(INK, () => c.ellipse(32, 31, 4, 3.5, 0, 0, 7)); p.fill('#ff8a8a', () => c.ellipse(32, 32.5, 2.4, 1.6, 0, 0, 7));   // a little "oh!"
        } else if (mood === 'win') {
          p.spark(20, 15, 9, '#ff9d00'); p.spark(44, 15, 9, '#ff9d00'); p.dot(20, 15, 2, '#fff'); p.dot(44, 15, 2, '#fff');          // star-struck
          cheeks(); p.fill(INK, () => { c.moveTo(20, 26); c.lineTo(44, 26); c.quadraticCurveTo(32, 44, 20, 26); }); p.fill('#ff8a8a', () => c.ellipse(32, 35, 5, 2.5, 0, 0, 7));
        } else {
          for (const x of [20, 44]) { p.dot(x, 16, 7, INK); p.dot(x - 2, 13, 2.8, '#fff'); p.dot(x + 2, 18.5, 2, '#fff'); p.fill('#7cc6ff', () => c.ellipse(x, 22, 6, 2.2, 0, 0, 7)); }   // watery eyes
          p.line(1.6, INK, [[12, 7], [26, 4]]); p.line(1.6, INK, [[52, 7], [38, 4]]);
          p.fill('#7cc6ff', () => { c.moveTo(50, 24); c.quadraticCurveTo(54, 31, 50, 32); c.quadraticCurveTo(46, 31, 50, 24); });      // one tear
          cheeks(); p.line(2, INK, [[23, 32], [27, 30, 30, 32], [33, 34, 36, 32], [39, 30, 42, 31]]);                                   // a brave, wobbly smile
        }
      }, 0.08);
    }
    function build() {
      const parts = {};
      let p = Part(); box(p, [0, -0.15, 0], [0.17, 0.3, 0.17], C.white); box(p, [0, -0.05, 0], [0.2, 0.14, 0.2], C.shorts); box(p, [0, -0.36, 0.07], [0.24, 0.14, 0.38], C.white); box(p, [0, -0.41, 0.07], [0.25, 0.05, 0.39], C.red); parts.leg = p;
      p = Part();
      box(p, [0, 0.3, 0], [0.62, 0.58, 0.44], C.jersey);
      box(p, [0, 0.04, 0], [0.64, 0.08, 0.46], C.trim); box(p, [0, 0.56, 0], [0.4, 0.06, 0.46], C.trim);
      plate(p, [0, 0.3, 0.222], [0.34, 0.3], { uv: UV });
      box(p, [0, 0.32, -0.32], [0.46, 0.5, 0.2], C.pack); box(p, [0, 0.42, -0.43], [0.3, 0.16, 0.03], C.white);                    // backpack
      box(p, [0, 0.64, 0], [0.14, 0.1, 0.14], C.white);
      parts.torso = p;
      p = Part();
      box(p, [0, 0.4, 0], [1.0, 0.74, 0.7], C.white);
      plate(p, [0, 0.38, 0.352], [0.84, 0.56]);
      for (const sx of [-1, 1]) ball(p, [0.52 * sx, 0.36, 0], 0.1, C.jersey, 3, 6);                                               // ear bolts
      parts.head = p;
      p = Part();                                                                                                                 // the cap: too big, sits on the head, moves on its own
      frustum(p, 0, 0.1, 0.62, 0.6, 8, C.capDark, { caps: false, twist: Math.PI / 8 });
      frustum(p, 0.1, 0.36, 0.6, 0.3, 8, C.cap, { stripes: C.capDark, twist: Math.PI / 8 });
      {                                                                                                                         // brim: a thin slab, so top and underside never overlap
        const T = 0.04, top = [[-0.42, 0.05, 0.4], [0.42, 0.05, 0.4], [0.32, 0.02, 0.84], [-0.32, 0.02, 0.84]], bot = top.map(([x, y, z]) => [x, y - T, z]);
        quad(p, top[0], top[1], top[2], top[3], C.red);
        quad(p, bot[1], bot[0], bot[3], bot[2], C.trim);
        quad(p, bot[3], bot[2], top[2], top[3], C.red);                                                                          // front edge
        quad(p, bot[0], bot[3], top[3], top[0], C.red); quad(p, bot[2], bot[1], top[1], top[2], C.red);                           // side edges
      }
      box(p, [0, 0.42, 0], [0.04, 0.14, 0.04], C.grey);
      parts.cap = p;
      p = Part(); for (const [sx, col] of [[1, C.red], [-1, C.yellow]]) quad(p, [0, 0, -0.05], [0.4 * sx, 0.02, -0.08], [0.4 * sx, 0.02, 0.08], [0, 0, 0.05], col, {}); for (const [sx, col] of [[1, C.red], [-1, C.yellow]]) quad(p, [0, -0.02, 0.05], [0.4 * sx, 0.0, 0.08], [0.4 * sx, 0.0, -0.08], [0, -0.02, -0.05], col.map((c) => c * 0.7), {}); /* underside, a hair lower */ ball(p, [0, 0.02, 0], 0.05, C.grey, 2, 4); parts.propeller = p;
      p = Part(); box(p, [0, -0.11, 0], [0.13, 0.22, 0.13], C.jersey); parts.upper = p;
      p = Part(); box(p, [0, -0.1, 0], [0.12, 0.2, 0.12], C.white); ball(p, [0, -0.27, 0], 0.11, C.trim, 3, 6); parts.fore = p;
      p = Part();                                                                                                                 // rulebook, open
      for (const sx of [-1, 1]) { quad(p, [0, -0.16, 0], [0.26 * sx, -0.16, 0.06], [0.26 * sx, 0.16, 0.06], [0, 0.16, 0], C.cap); }
      for (const sx of [-1, 1]) { quad(p, [0.26 * sx, -0.16, 0.06], [0, -0.16, 0], [0, 0.16, 0], [0.26 * sx, 0.16, 0.06], C.cap); }
      quad(p, [-0.24, -0.14, 0.062], [-0.01, -0.14, 0.012], [-0.01, 0.14, 0.012], [-0.24, 0.14, 0.062], [1, 1, 1], { tex: true, uv: UV });
      quad(p, [0.01, -0.14, 0.012], [0.24, -0.14, 0.062], [0.24, 0.14, 0.062], [0.01, 0.14, 0.012], [1, 1, 1], { tex: true, uv: UV });
      parts.book = p;
      p = Part(); box(p, [0, 0.16, 0], [0.34, 0.36, 0.14], C.foam); box(p, [0.08, 0.5, 0], [0.12, 0.4, 0.13], C.foam); plate(p, [-0.02, 0.16, 0.072], [0.26, 0.26]); parts.foam = p;
      p = Part(); star(p, 0.13, C.yellow); parts.star = p;
      p = Part(); plate(p, [0, 0, 0], [0.62, 0.44]); tri(p, [-0.1, -0.22, 0], [0.05, -0.22, 0], [-0.14, -0.36, 0], [1, 1, 1], { glow: 1 }); parts.bubble = p;
      return parts;
    }
    function pose(mood, t, turn) {
      const out = [];
      let rootY = 0, yaw = 0, lean = 0, headNod = 0, headTilt = 0, headYaw = 0, R, L, legs, capTilt = [-0.12, -0.14], propSpin = t * 3, capLift = 0;
      if (mood === 'neutral') {
        rootY = Math.abs(Math.sin(t * 4)) * 0.07;                                               // bouncing on his toes
        const lookUp = clamp01(Math.sin(t * 1.1) * 3 - 0.8);                                     // nose in the rulebook, then a quick look around
        headNod = lerp(0.42, -0.1, lookUp); headYaw = lookUp * Math.sin(t * 5) * 0.6; yaw = Math.sin(t * 0.6) * 0.3;
        R = { up: [-0.75, 0, 0.1], fore: [-1.0, 0, -0.35] }; L = { up: [-0.75, 0, -0.1], fore: [-1.0, 0, 0.35] };
        legs = [[0, 0.03], [0, -0.03]]; capLift = Math.abs(Math.sin(t * 4)) * -0.03 + 0.03;
      } else if (mood === 'win') {
        const j = Math.abs(Math.sin(t * 3.6)); rootY = j * 0.75;                                 // jumping as high as he can
        yaw = Math.sin(t * 1.8) * 0.5; headNod = -0.25; lean = -0.08;
        R = { up: [0, 0, 2.7 + Math.sin(t * 7.2) * 0.15], fore: [0, 0, 0.2] }; L = { up: [0, 0, -2.5 - Math.sin(t * 7.2) * 0.2], fore: [0, 0, -0.3] };
        legs = [[-0.5 * j, 0.5 * j], [0.4 * j, -0.5 * j]]; propSpin = t * 22; capLift = j * 0.12; capTilt = [-0.12 - j * 0.2, -0.14];
      } else {
        rootY = -0.34; lean = 0.12; headNod = 0.06 + Math.sin(t * 1.3) * 0.03; headTilt = -0.12; yaw = 0.35;   // plopped down on the floor
        R = { up: [-0.4, 0, 1.75 + Math.sin(t * 3) * 0.06], fore: [0, 0, 0.5] };                 // still manages a thumbs up
        L = { up: [0.3, 0, -0.5], fore: [0, 0, -0.2] };
        legs = [[-1.45, 0.3], [-1.45, -0.3]]; propSpin = 0.6; capTilt = [0.1, -0.3]; capLift = -0.02;        // cap slid down, propeller still
      }
      const root = M.chain(M.t(0, rootY + 0.42, 0), M.ry(yaw + turn));
      legs.forEach(([lx, lz], i) => out.push(['leg', M.chain(root, M.t(i ? -0.17 : 0.17, 0, 0), M.rx(lx), M.rz(lz))]));
      const torso = M.chain(root, M.rx(lean));
      out.push(['torso', torso, { tex: 'number' }]);
      const head = M.chain(torso, M.t(0, 0.68, 0), M.ry(headYaw), M.rz(headTilt), M.rx(headNod));
      out.push(['head', head]);
      const cap = M.chain(head, M.t(0, 0.76 + capLift, -0.04), M.rx(capTilt[0]), M.rz(capTilt[1]), M.ry(0.3));
      out.push(['cap', cap], ['propeller', M.chain(cap, M.t(0, 0.5, 0), M.ry(propSpin), mood === 'lose' ? M.rz(0.35) : M.id())]);
      const handR = arm(out, torso, [0.38, 0.52], R, ['upper', 'fore'], [0.22, 0.24]); arm(out, torso, [-0.38, 0.52], L, ['upper', 'fore'], [0.22, 0.24]);
      const world = M.ry(turn);
      if (mood === 'neutral') out.push(['book', M.chain(torso, M.t(0, 0.42, 0.5), M.rx(-0.75)), { tex: 'page' }]);
      if (mood === 'win') {
        out.push(['foam', M.chain(handR, M.rz(Math.PI), M.t(0, -0.1, 0)), { tex: 'one' }]);
        for (let k = 0; k < 8; k++) { const a = t * 1.5 + k * 0.785, life = (t * 0.8 + k * 0.21) % 1; out.push(['star', M.chain(M.t(Math.sin(a) * (0.9 + life * 0.6), 0.6 + life * 2.4, Math.cos(a) * 0.7), M.rz(t * 3 + k), M.s(1 - life * 0.6))]); }
      }
      if (mood === 'lose') {
        out.push(['book', M.chain(world, M.t(0.85, 0.03, 0.75), M.rx(-Math.PI / 2 + 0.05), M.rz(0.5)), { tex: 'page' }]);
        out.push(['bubble', M.chain(M.t(1.0, 1.75 + Math.sin(t * 1.5) * 0.04, 0.4)), { tex: 'gg' }]);
      }
      return out;
    }
    function page() { const cv = document.createElement('canvas'); cv.width = 24; cv.height = 28; const c = cv.getContext('2d'); c.fillStyle = '#fffdf5'; c.fillRect(0, 0, 24, 28); c.fillStyle = '#b9b3a6'; for (let y = 5; y < 26; y += 4) c.fillRect(3, y, y % 8 === 1 ? 12 : 18, 1.5); return cv; }
    return {
      id: 'rookie', name: 'The Rookie', accent: '#ffb81a', grey: 0, noReflect: ['bubble', 'star'],
      tagline: 'An enthusiastic beginner, still figuring things out. A small bot in a cap that\'s too big for him, rulebook always within reach.',
      captions: { neutral: 'Bounces on his toes with his nose in the rulebook, popping up for a quick look around.', win: 'Jumps as high as he can, foam finger up, propeller whirring. He can\'t believe it.', lose: 'Plops down on the floor, teary-eyed with his cap knocked sideways, and still gives a thumbs up. Good game!' },
      backdrops: { neutral: [[0.3, 0.2, 0.04], [0.08, 0.14, 0.3], [0.03, 0.05, 0.12], [0.16, 0.1, 0.04]], win: [[0.5, 0.34, 0.04], [0.12, 0.26, 0.5], [0.05, 0.08, 0.2], [0.3, 0.14, 0.03]], lose: [[0.1, 0.12, 0.2], [0.08, 0.1, 0.18], [0.03, 0.04, 0.08], [0.07, 0.08, 0.12]] },
      build, pose, textures: (mood) => ({ face: face(mood), number: sign('01', { w: 34, h: 30, bg: '#ffb81a', fg: '#f2591a', size: 24, border: false }), page: page(), one: sign('#1', { w: 26, h: 26, bg: '#ff7a1a', fg: '#fff', size: 17, border: false }), gg: sign('GG!', { w: 62, h: 44, bg: '#ffffff', fg: '#3a2408', size: 24 }) }),
    };
  })();

  const DITHER = `
    float bayer4(vec2 p) { ivec2 i = ivec2(mod(p, 4.0)); int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return float(m[i.y * 4 + i.x]) / 16.0 - 0.5; }
    vec3 ps(vec3 c) { c = clamp(c + bayer4(gl_FragCoord.xy) / 31.0, 0.0, 1.0); return floor(c * 31.0 + 0.5) / 31.0; }`;
  const VS = `#version 300 es
    in vec3 aPos; in vec3 aNor; in vec3 aCol; in vec2 aUv; in float aTex; in float aGlow;
    uniform mat4 uProj, uView, uModel;
    out vec3 vNor; out vec3 vCol; out vec2 vUv; out float vTex; out float vGlow;
    void main() {
      vNor = mat3(uModel) * aNor; vCol = aCol; vUv = aUv; vTex = aTex; vGlow = aGlow;
      gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
    }`;
  const FS = `#version 300 es
    precision highp float; ${DITHER}
    uniform sampler2D uFace; uniform float uAlpha, uGrey, uFlip;
    in vec3 vNor; in vec3 vCol; in vec2 vUv; in float vTex; in float vGlow; out vec4 o;
    void main() {
      vec3 n = normalize(vNor) * uFlip;
      // three coloured lights and an ambient, the way PS2 memory card icons were lit
      vec3 light = vec3(0.30, 0.26, 0.36)
        + vec3(1.0, 0.96, 0.92) * max(dot(n, normalize(vec3(0.3, 0.6, 1.0))), 0.0) * 0.75
        + vec3(1.0, 0.45, 0.85) * max(dot(n, normalize(vec3(-1.0, 0.2, 0.3))), 0.0) * 0.4
        + vec3(0.6, 0.75, 1.0) * max(dot(n, normalize(vec3(1.0, 0.1, -0.6))), 0.0) * 0.45;
      vec3 c = vCol * mix(light, vec3(1.0), vGlow);
      if (vTex > 0.5) c = texture(uFace, vUv).rgb * 1.08;   // screens and signs light themselves
      c = mix(c, vec3(dot(c, vec3(0.3, 0.55, 0.15))) * vec3(0.85, 0.88, 1.0), uGrey);
      o = vec4(ps(c), uAlpha);
    }`;


  // ================= The shared renderer =================
  const AGENT_BY_ID = { diva: Diva, analyst: Analyst, chaos: Chaos, strategist: Strategist, rookie: Rookie };
  let gl = null, glCanvas = null, prog = null, failed = false, shadowMesh = null;
  const meshCache = new Map(), textureCache = new Map(), views = new Set();
  let running = false, last = 0;

  function initGL() {
    if (gl || failed) return !!gl;
    try {
      glCanvas = document.createElement('canvas');
      gl = glCanvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: true });
      if (!gl) throw new Error('WebGL2 is not available');
      const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
      prog = { p, u, a: (n) => gl.getAttribLocation(p, n) };
      // a soft round shadow under every model
      const disc = Part(); for (let k = 0; k < 16; k++) { const a0 = (k / 16) * Math.PI * 2, a1 = ((k + 1) / 16) * Math.PI * 2; tri(disc, [0, 0, 0], [Math.sin(a1) * 0.8, 0, Math.cos(a1) * 0.8], [Math.sin(a0) * 0.8, 0, Math.cos(a0) * 0.8], [0, 0, 0], { glow: 1 }); }
      shadowMesh = upload(disc);
      return true;
    } catch (err) {
      console.warn('Agent models are off:', err);
      failed = true; gl = null; return false;
    }
  }
  function upload(part) {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const put = (data, attr, size) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); const loc = prog.a(attr); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
    put(part.pos, 'aPos', 3); put(part.nor, 'aNor', 3); put(part.col, 'aCol', 3); put(part.uv, 'aUv', 2); put(part.tex, 'aTex', 1); put(part.glow, 'aGlow', 1);
    return { vao, count: part.pos.length / 3 };
  }
  function meshesFor(agent) {
    if (!meshCache.has(agent.id)) { const m = {}; for (const [name, part] of Object.entries(agent.build())) m[name] = upload(part); meshCache.set(agent.id, m); }
    return meshCache.get(agent.id);
  }
  function texturesFor(agent, mood) {
    const key = agent.id + ':' + mood;
    if (!textureCache.has(key)) {
      const t = {};
      for (const [name, cv] of Object.entries(agent.textures(mood))) {
        const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        t[name] = tx;
      }
      textureCache.set(key, t);
    }
    return textureCache.get(key);
  }

  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function drawView(v, dt) {
    const cssW = v.canvas.clientWidth, cssH = v.canvas.clientHeight;
    if (!cssW || !cssH) return;
    const r = v.canvas.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;   // off screen: skip
    if (!reduceMotion || v.firstFrame) v.clock += dt;
    v.firstFrame = false;
    const px = pixelFor(cssW), w = Math.max(16, Math.round(cssW / px)), h = Math.max(16, Math.round(cssH / px));
    if (glCanvas.width < w || glCanvas.height < h) { glCanvas.width = Math.max(glCanvas.width, w); glCanvas.height = Math.max(glCanvas.height, h); }
    if (v.canvas.width !== w || v.canvas.height !== h) { v.canvas.width = w; v.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    const agent = v.agent, mood = v.mood, meshes = meshesFor(agent), textures = texturesFor(agent, mood);
    gl.useProgram(prog.p);
    gl.uniformMatrix4fv(prog.u.uProj, false, M.persp(0.62, w / h, 0.1, 50));
    gl.uniformMatrix4fv(prog.u.uView, false, M.look([0, 1.75, 7.0 * v.zoom], [0, 1.25, 0]));   // zoom < 1 brings the camera closer
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(prog.u.uFace, 0);
    gl.uniform1f(prog.u.uGrey, mood === 'lose' ? agent.grey : 0);
    gl.uniform1f(prog.u.uFlip, 1);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // shadow on the floor
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(shadowMesh.vao); gl.uniformMatrix4fv(prog.u.uModel, false, M.chain(M.t(0, 0.002, 0), M.s(1.1, 1, 0.75)));
    gl.uniform1f(prog.u.uAlpha, 0.35); gl.drawArrays(gl.TRIANGLES, 0, shadowMesh.count);
    gl.enable(gl.DEPTH_TEST);
    for (const [name, m, extra = {}] of agent.pose(mood, v.clock, v.turn)) {
      const mesh = meshes[name]; if (!mesh) continue;
      gl.bindVertexArray(mesh.vao);
      gl.bindTexture(gl.TEXTURE_2D, textures[extra.tex || 'face']);
      gl.uniformMatrix4fv(prog.u.uModel, false, m);
      gl.uniform1f(prog.u.uAlpha, extra.fade ?? 1);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    // copy the finished picture into this model's own canvas (the viewport sits at the bottom-left of the shared canvas)
    const ctx = v.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(glCanvas, 0, glCanvas.height - h, w, h, 0, 0, w, h);
  }
  function loop(now) {
    if (!views.size) { running = false; return; }
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (!document.hidden) for (const v of views) { try { drawView(v, dt); } catch (err) { console.warn('Agent model failed to draw:', err); views.delete(v); } }
    requestAnimationFrame(loop);
  }

  // Shows an agent in a mood inside a canvas. Returns a function that stops it, or null without WebGL2.
  function mountAgentModel(canvas, agentId, mood = 'neutral', options = {}) {
    const agent = AGENT_BY_ID[agentId];
    if (!agent || !canvas || !initGL()) return null;
    const ctx = canvas.getContext('2d'); if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    const v = { canvas, ctx, agent, mood: ['neutral', 'win', 'lose'].includes(mood) ? mood : 'neutral', clock: 1.3, turn: options.turn || 0, firstFrame: true, zoom: options.zoom || 1 };
    // drag to turn the model
    let dragX = null;
    const down = (e) => { dragX = e.clientX; try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ } };
    const move = (e) => { if (dragX === null) return; v.turn += (e.clientX - dragX) * 0.012; dragX = e.clientX; };
    const up = () => { dragX = null; };
    if (options.draggable !== false) { canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); }
    views.add(v);
    if (!running) { running = true; last = 0; requestAnimationFrame(loop); }
    return () => {
      views.delete(v);
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
    };
  }
  return { mountAgentModel, AGENT_MODEL_IDS: Object.keys(AGENT_BY_ID) };
})();

export { mountAgentModel, AGENT_MODEL_IDS };
