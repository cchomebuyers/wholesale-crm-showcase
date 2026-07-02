// hyper.js — hyperdimensional backdrop for the CRM.
//
// A genuine 4D tesseract (8-cell): 16 vertices at (±1,±1,±1,±1), 32 edges
// (vertex pairs differing in exactly one coordinate). Each frame it is rotated
// in TWO independent planes at once (XW and YZ — a "double rotation" that only
// exists in 4 dimensions), then perspective-projected 4D→3D (w-divide) and
// rendered by three.js with a normal 3D camera. Two nested cells counter-rotate:
// outer graphite, inner emerald — matching the technical light theme.
//
// Deliberately quiet: fixed canvas behind the app, pointer-events:none, low
// opacity, pauses when the tab is hidden, and renders a single static frame if
// the user prefers reduced motion. Zero interaction with CRM logic.

(function () {
  if (!window.THREE) return; // CDN failed — the app must never depend on this.

  const mount = document.getElementById("hyperdim");
  if (!mount) return;

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 7.5);

  // ---- 4D geometry ----------------------------------------------------
  // 16 vertices of the 8-cell.
  const verts4 = [];
  for (let i = 0; i < 16; i++) {
    verts4.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1, (i & 8) ? 1 : -1]);
  }
  // 32 edges: pairs differing in exactly one coordinate (Hamming distance 1).
  const edges = [];
  for (let a = 0; a < 16; a++) for (let b = a + 1; b < 16; b++) {
    const x = a ^ b;
    if ((x & (x - 1)) === 0) edges.push([a, b]);
  }

  // Rotate v in the plane of axes (i,j) by angle t.
  function rot(v, i, j, t) {
    const c = Math.cos(t), s = Math.sin(t);
    const a = v[i] * c - v[j] * s, b = v[i] * s + v[j] * c;
    v[i] = a; v[j] = b;
  }

  // Perspective 4D→3D: scale xyz by pd/(pd − w).
  const PD = 3.2;
  function project(v) {
    const k = PD / (PD - v[3] * 0.9);
    return [v[0] * k, v[1] * k, v[2] * k];
  }

  // ---- three.js objects ------------------------------------------------
  function makeCell(color, opacity) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(edges.length * 2 * 3), 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const lines = new THREE.LineSegments(geo, mat);
    scene.add(lines);

    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    const pmat = new THREE.PointsMaterial({ color, size: 0.045, transparent: true, opacity: Math.min(1, opacity * 1.8) });
    const points = new THREE.Points(pgeo, pmat);
    scene.add(points);
    return { lines, points };
  }

  const outer = makeCell(0x14171a, 0.34); // graphite — matches --border
  const inner = makeCell(0x0f9d6b, 0.48); // emerald  — matches --primary

  function updateCell(cell, t, scale, dir) {
    const vs = verts4.map((v) => v.slice());
    for (const v of vs) {
      rot(v, 0, 3, t * 0.62 * dir);        // XW — the hyperdimensional turn
      rot(v, 1, 2, t * 0.41 * dir);        // YZ — second plane of the double rotation
      rot(v, 0, 1, t * 0.13);              // slow 3D drift so it never looks static
    }
    const p3 = vs.map((v) => project(v).map((c) => c * scale));

    const lp = cell.lines.geometry.attributes.position.array;
    let k = 0;
    for (const [a, b] of edges) {
      lp[k++] = p3[a][0]; lp[k++] = p3[a][1]; lp[k++] = p3[a][2];
      lp[k++] = p3[b][0]; lp[k++] = p3[b][1]; lp[k++] = p3[b][2];
    }
    cell.lines.geometry.attributes.position.needsUpdate = true;

    const pp = cell.points.geometry.attributes.position.array;
    k = 0;
    for (const p of p3) { pp[k++] = p[0]; pp[k++] = p[1]; pp[k++] = p[2]; }
    cell.points.geometry.attributes.position.needsUpdate = true;
  }

  // Gentle parallax — the lattice leans a few degrees toward the cursor.
  let tiltX = 0, tiltY = 0, targX = 0, targY = 0;
  window.addEventListener("mousemove", (e) => {
    targY = (e.clientX / window.innerWidth - 0.5) * 0.35;
    targX = (e.clientY / window.innerHeight - 0.5) * 0.25;
  }, { passive: true });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let t = 0.7; // start mid-rotation so the first paint is already interesting
  function frame() {
    updateCell(outer, t, 2.15, 1);
    updateCell(inner, t, 1.2, -1);
    tiltX += (targX - tiltX) * 0.04;
    tiltY += (targY - tiltY) * 0.04;
    scene.rotation.set(tiltX, tiltY, 0);
    renderer.render(scene, camera);
  }

  if (reduceMotion) { frame(); return; } // one calm static frame

  (function loop() {
    if (!document.hidden) { t += 0.0035; frame(); }
    requestAnimationFrame(loop);
  })();
})();
