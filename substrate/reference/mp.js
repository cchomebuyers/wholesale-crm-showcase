// mp.js — in-world multiplayer client for dwrld. Talks to multiplayer-dwrld (the presence server).
//
// Netcode (see multiplayer-dwrld/README.md): render is DECOUPLED from the 30 Hz server tick.
//   - your own avatar: not drawn (first person) = client-side prediction, zero latency.
//   - remote avatars: SNAPSHOT INTERPOLATION with a ~100ms render-delay buffer — every frame we
//     render each remote at (now - delay), lerping position + slerping yaw between the two
//     snapshots that straddle that time. Smooth at 60-120fps; a dropped packet is invisible.
//   - position is sent ~30 Hz on its own timer (not tied to the render loop).
//
// Usage from index.html:
//   import { initMultiplayer } from "/mp.js";
//   const mp = initMultiplayer({ scene, camera, getYaw:()=>yaw, getPitch:()=>pitch, isTyping:typingInScreen });
//   ... in the render loop: mp.update();
//
// Server URL defaults to ws://<this-host>:7766 (same machine / LAN). Override with ?mp=ws://host:7766
// (and ?room=, ?name=, ?color=%23rrggbb), or localStorage dwrld_mp / dwrld_name / dwrld_color.

import * as THREE from "three";

export function initMultiplayer({ scene, camera, getYaw, getPitch, isTyping }) {
  const qs = new URLSearchParams(location.search);
  // presence URL is same-origin + the page's base path by default, so the world is portable:
  //   served at /        → ws(s)://host/mp        (local dev / combined server)
  //   served at /play/   → wss://host/play/mp     (on dwrld.xyz behind nginx)
  // override with ?mp=wss://host/base/  or localStorage dwrld_mp (e.g. the dwrld-edge build points at the VPS)
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const BASE = location.pathname.replace(/[^/]*$/, "");
  if (qs.get("mp")) localStorage.setItem("dwrld_mp", qs.get("mp"));
  if (qs.get("token")) localStorage.setItem("dwrld_token", qs.get("token"));
  let HOST = qs.get("mp") || localStorage.getItem("dwrld_mp") || `${proto}//${location.host}${BASE}`;
  if (!HOST.endsWith("/")) HOST += "/";
  // desktop app: no browser gate cookie (sameSite=strict), so it authenticates with a join token →
  // the token-checked /play/mpt endpoint. Browsers (with the cookie) use the gated /play/mp.
  const TOKEN = qs.get("token") || localStorage.getItem("dwrld_token") || "";
  const ROOM = (qs.get("room") || localStorage.getItem("dwrld_room") || "lobby");
  let NAME = qs.get("name") || localStorage.getItem("dwrld_name") || ("guest" + Math.floor(Math.random() * 900 + 100));
  let COLOR = normHex(qs.get("color")) || localStorage.getItem("dwrld_color") || hslHex(Math.random() * 360, 70, 62);
  localStorage.setItem("dwrld_name", NAME); localStorage.setItem("dwrld_color", COLOR); localStorage.setItem("dwrld_room", ROOM);

  const SEND_MS = 33;        // ~30 Hz position send
  const INTERP_MS = 100;     // render-delay buffer (~3 ticks) — the smoothness knob
  const BUFFER_MS = 1500;    // keep ~1.5s of snapshots

  let ws = null, selfId = null, connected = false, retryT = null;
  let serverRtt = null, lastPingAt = 0;   // ws round-trip (server path latency)
  let health = 100, alive = true, kills = 0, deaths = 0; const MAXHP = 100, RESPAWN_MS = 2500, PLAYER_HIT_R = 1.0;
  const players = new Map(); // id -> avatar record (+ .p2p flag when a DataChannel is open)
  const buffers = new Map(); // id -> [{t:perfNow, p:[3], r:[2]}]  (per-peer interpolation buffer; fed by P2P or relay)
  const peers = new Map();   // id -> { pc:RTCPeerConnection, dc:RTCDataChannel|null }
  // ICE servers: STUN punches most NATs; the server adds TURN creds (in `welcome`) so P2P connects
  // even behind symmetric NATs (TURN relays when a direct path is impossible).
  let ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  function pushPeer(id, p, r) {
    if (!Array.isArray(p) || !Array.isArray(r)) return;
    let b = buffers.get(id); if (!b) { b = []; buffers.set(id, b); }
    b.push({ t: performance.now(), p, r });
    while (b.length > 3 && performance.now() - b[0].t > BUFFER_MS) b.shift();
  }

  // ---------- HUD ----------
  const hud = document.createElement("div");
  hud.style.cssText = "position:fixed;top:32px;left:12px;z-index:10;font:12px Consolas,monospace;color:#9b8cff;text-shadow:0 0 5px #000;pointer-events:none";
  document.body.appendChild(hud);
  function setHud() {
    hud.innerHTML = connected
      ? `◉ <b style="color:#c9a6ff">${players.size + 1}</b> in <b style="color:#c9a6ff">${ROOM}</b> · you: <b style="color:${COLOR}">${esc(NAME)}</b> · <b>1-5</b> emote`
      : `○ solo — start multiplayer-dwrld to play together`;
  }
  setHud();
  // combat HUD: health bar + K/D, bottom-center
  const chud = document.createElement("div");
  chud.style.cssText = "position:fixed;bottom:14px;right:14px;z-index:11;font:13px Consolas,monospace;color:#e9d5ff;text-shadow:0 0 5px #000;pointer-events:none;text-align:right";
  document.body.appendChild(chud);
  function setChud() {
    const frac = Math.max(0, health) / MAXHP, w = 160;
    const col = frac > 0.5 ? "#86efac" : frac > 0.25 ? "#fbbf24" : "#f87171";
    chud.innerHTML = `<div style="margin-bottom:4px">☠ <b>${kills}</b> · <span style="opacity:.7">deaths ${deaths}</span></div>` +
      `<div style="width:${w}px;height:14px;background:#2a1748;border:1px solid #6b46c1;border-radius:7px;overflow:hidden;display:inline-block">` +
      `<div style="width:${Math.round(frac * w)}px;height:100%;background:${col}"></div></div>` +
      `<div style="font-size:11px;margin-top:2px">${alive ? Math.max(0, Math.round(health)) + " HP" : "DEAD — respawning…"}</div>`;
  }
  setChud();

  // ---------- net HUD (bottom-left): per-peer P2P/relay + latency, and E2E status ----------
  // P2P (●) means a direct RTCDataChannel — DTLS-encrypted end-to-end, even when TURN relays it
  // (the server never sees plaintext). relay (○) means the WS fallback, which the server CAN read.
  const nhud = document.createElement("div");
  nhud.style.cssText = "position:fixed;bottom:12px;left:12px;z-index:11;font:11px Consolas,monospace;color:#9b8cff;text-shadow:0 0 4px #000;pointer-events:none;line-height:1.55;max-width:46vw";
  document.body.appendChild(nhud);
  function fmtMs(v) { return v == null ? "…" : Math.round(v) + "ms"; }
  function setNetHud() {
    if (!connected) { nhud.innerHTML = '<span style="color:#777">○ offline — solo</span>'; return; }
    let anyP2P = false;
    let rows = "";
    for (const [id, pl] of players) {
      const pr = peers.get(id);
      const p2p = !!(pl.p2p && pr && pr.dc && pr.dc.readyState === "open");
      if (p2p) anyP2P = true;
      const tag = p2p ? '<span style="color:#86efac">● P2P</span>' : '<span style="color:#fbbf24">○ relay</span>';
      const lat = p2p ? fmtMs(pr.rtt) : '<span style="opacity:.7">via server</span>';
      const enc = p2p ? '<span style="color:#86efac">🔒e2e</span>' : '<span style="color:#fbbf24">svr-visible</span>';
      rows += `<div>${tag} <b style="color:${normHex(pl.color) || '#c9a6ff'}">${esc(pl.name || ('p' + id))}</b> ${lat} ${enc}</div>`;
    }
    const srv = `<div style="opacity:.85">↔ server <b>${fmtMs(serverRtt)}</b>${players.size ? "" : ' · <span style="opacity:.7">no peers yet</span>'}</div>`;
    nhud.innerHTML = srv + rows;
  }
  setNetHud();

  function toast(msg) {
    const t = document.createElement("div");
    t.style.cssText = "position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:50;background:#1a1030;border:1px solid #a855f7;color:#e9d5ff;padding:8px 16px;border-radius:8px;font:13px Consolas;pointer-events:none";
    t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 5500);
  }

  // ---------- avatars ----------
  const EMOTE_GLYPH = { wave: "👋", point: "👉", talk: "💬", type: "⌨️", clap: "👏", heart: "💜" };
  // The 5DEngine hero (ported from 5DEngine/src/render/hero_mesh.js): torso + head + eyes + 2 arms
  // + 2-segment legs + shadow blob. Procedural, so no asset file. Shirt is tinted to the player color
  // so players are distinguishable; the limbs animate when they walk (driven by movement in update()).
  function makeAvatar(info) {
    const group = new THREE.Group();
    const tint = normHex(info.color) || "#c9a6ff";
    const skin  = new THREE.MeshStandardMaterial({ color: 0xffcc66 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x223377 });
    const shirt = new THREE.MeshStandardMaterial({ color: new THREE.Color(tint) });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.4), shirt); torso.position.y = 1.25; group.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), skin); head.position.y = 1.85; group.add(head);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.04), new THREE.MeshStandardMaterial({ color: 0x111111 })); eye.position.set(0, 1.92, 0.23); group.add(eye);

    const mkLimb = (mat, h) => { const piv = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.22), mat); m.position.y = -h / 2; piv.add(m); return piv; };
    const mkLeg = (mat) => { const thigh = new THREE.Group(); const tm = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.43, 0.21), mat); tm.position.y = -0.215; thigh.add(tm); const shin = new THREE.Group(); shin.position.y = -0.43; const sm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.18), mat); sm.position.y = -0.21; shin.add(sm); thigh.add(shin); return thigh; };
    const thighL = mkLeg(pants); thighL.position.set(-0.18, 0.85, 0); group.add(thighL);
    const thighR = mkLeg(pants); thighR.position.set(0.18, 0.85, 0); group.add(thighR);
    const armL = mkLimb(skin, 0.7); armL.position.set(-0.45, 1.6, 0); group.add(armL);
    const armR = mkLimb(skin, 0.7); armR.position.set(0.45, 1.6, 0); group.add(armR);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; group.add(shadow);

    const label = makeLabel(info.name || "guest", tint); label.position.y = 2.55; group.add(label);
    const hpbar = makeBar(); hpbar.position.y = 2.78; hpbar.visible = false; group.add(hpbar);
    const emo = makeEmote(); emo.position.y = 3.05; emo.visible = false; group.add(emo);
    scene.add(group);
    return { group, label, hpbar, emo, name: info.name, e: null, emoteUntil: 0, armL, armR, thighL, thighR, walkT: 0, px: 0, pz: 0, hasPrev: false };
  }
  function makeBar() {
    const c = document.createElement("canvas"); c.width = 128; c.height = 16; const ctx = c.getContext("2d");
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    s.scale.set(1.3, 0.16, 1); s.renderOrder = 1001; s.userData = { c, ctx, tex }; return s;
  }
  function setHpBar(pl, frac) {
    const { c, ctx, tex } = pl.hpbar.userData;
    ctx.clearRect(0, 0, 128, 16); ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, 128, 16);
    ctx.fillStyle = frac > 0.5 ? "#86efac" : frac > 0.25 ? "#fbbf24" : "#f87171"; ctx.fillRect(2, 2, Math.round(124 * frac), 12);
    tex.needsUpdate = true; pl.hpbar.visible = frac < 0.999;
  }
  function makeLabel(text, color) {
    const c = document.createElement("canvas"), ctx = c.getContext("2d"), f = 48;
    ctx.font = `bold ${f}px Consolas`; const w = Math.min(640, Math.ceil(ctx.measureText(text).width) + 44);
    c.width = w; c.height = 72; ctx.font = `bold ${f}px Consolas`;
    ctx.fillStyle = "rgba(12,7,32,0.8)"; roundRect(ctx, 1, 1, w - 2, 70, 14); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; roundRect(ctx, 1, 1, w - 2, 70, 14); ctx.stroke();
    ctx.fillStyle = "#f3eaff"; ctx.textBaseline = "middle"; ctx.fillText(text, 22, 38);
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    s.scale.set((w / 72) * 0.85, 0.85, 1); s.renderOrder = 999; return s;
  }
  function makeEmote() {
    const c = document.createElement("canvas"); c.width = c.height = 128; const ctx = c.getContext("2d");
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    s.scale.set(0.95, 0.95, 1); s.renderOrder = 1000; s.userData = { c, ctx, tex }; return s;
  }
  function setEmote(pl, e) {
    pl.e = e || null;
    const { c, ctx, tex } = pl.emo.userData;
    ctx.clearRect(0, 0, 128, 128);
    if (e) { ctx.font = "92px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(EMOTE_GLYPH[e] || "❔", 64, 70); }
    tex.needsUpdate = true; pl.emo.visible = !!e; pl.emoteUntil = e && e !== "type" ? performance.now() + 2600 : 0;
  }
  function ensure(id, info) { let pl = players.get(id); if (!pl) { pl = makeAvatar(info || {}); players.set(id, pl); setHud(); } return pl; }
  function remove(id) { const pl = players.get(id); if (pl) { scene.remove(pl.group); dispose(pl.group); players.delete(id); setHud(); } closePeer(id); buffers.delete(id); }
  function dispose(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }

  // ---------- connection (relay) ----------
  function connect() {
    const auth = TOKEN ? `mpt?token=${encodeURIComponent(TOKEN)}&` : "mp?";
    const u = `${HOST}${auth}room=${encodeURIComponent(ROOM)}&name=${encodeURIComponent(NAME)}&color=${encodeURIComponent(COLOR)}`;
    try { ws = new WebSocket(u); } catch (_) { return retry(); }
    ws.onopen = () => { connected = true; setHud(); setNetHud(); };
    ws.onclose = () => { connected = false; serverRtt = null; setHud(); setNetHud(); for (const id of [...players.keys()]) remove(id); buffers.clear(); retry(); };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; } onMsg(m); };
  }
  function retry() { if (retryT) return; retryT = setTimeout(() => { retryT = null; connect(); }, 1500); }

  function onMsg(m) {
    switch (m.t) {
      case "welcome": selfId = m.id; if (Array.isArray(m.ice) && m.ice.length) ICE = { iceServers: m.ice }; break;
      case "pong": serverRtt = performance.now() - lastPingAt; setNetHud(); break;
      case "roster": for (const p of m.players) if (p.id !== selfId) { ensure(p.id, p); tryConnectPeer(p.id); } break;
      case "join": if (m.player.id !== selfId) { ensure(m.player.id, m.player); toast(`${m.player.name || "someone"} joined`); tryConnectPeer(m.player.id); } break;
      case "leave": remove(m.id); break;
      case "state": onState(m); break;
      case "emote": { const pl = players.get(m.id); if (pl) setEmote(pl, m.e); break; }
      case "action": { const n = players.get(m.id)?.name || "someone"; toast(`${n} ${m.a === "spawn" ? "opened a " + (m.k || "screen") : m.a}`); break; }
      case "chat": { const n = players.get(m.id)?.name || "someone"; toast(`${n}: ${m.d}`); break; }
      case "shot": onShot(m.id, m); break;
      case "hit": onHit(m.id, m); break;
      case "dead": onDead(m.id, m); break;
      case "hp": onHp(m.id, m); break;
      case "obj-spawn": onObjSpawn(m); break;
      case "obj-remove": onObjRemove(m); break;
      case "obj-list": if (window.dwrldObjects) for (const o of (m.objects || [])) window.dwrldObjects.applyRemote("spawn", o); break;
      case "signal": handleSignal(m); break;
      case "update": toast("Update available — applying…"); if (window.dwrld && window.dwrld.update) window.dwrld.update(); break;
    }
  }
  // relay snapshot → per-peer buffer, but SKIP peers we're already getting over P2P (their pos arrives via DataChannel)
  function onState(m) {
    for (const p of m.players) {
      if (p.id === selfId) continue;
      ensure(p.id, {});
      if (players.get(p.id)?.p2p) continue;
      pushPeer(p.id, p.p, p.r);
    }
  }

  // ---------- P2P transport (WebRTC DataChannel, relay-signaled; relay is the fallback) ----------
  const seenShots = new Set(); let shotSeq = 0;
  function signal(to, data) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "signal", to, data })); }
  function getPeer(id) { let pr = peers.get(id); if (!pr) { pr = { pc: null, dc: null }; peers.set(id, pr); } return pr; }
  function markP2P(id, on) { const pl = players.get(id); if (pl) pl.p2p = on; const pr = peers.get(id); if (pr && !on) pr.rtt = null; setHud(); setNetHud(); }
  function newPC(id) {
    const pc = new RTCPeerConnection(ICE);
    pc.onicecandidate = (e) => { if (e.candidate) signal(id, { ice: e.candidate }); };
    pc.onconnectionstatechange = () => { if (["failed", "closed", "disconnected"].includes(pc.connectionState)) markP2P(id, false); };
    pc.ondatachannel = (e) => setupDC(id, e.channel);
    getPeer(id).pc = pc; return pc;
  }
  function setupDC(id, dc) {
    getPeer(id).dc = dc;
    dc.onopen = () => markP2P(id, true);
    dc.onclose = () => markP2P(id, false);
    dc.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; } onP2P(id, m); };
  }
  function onP2P(id, m) {
    if (m.t === "png") { const pr = peers.get(id); if (pr && pr.dc && pr.dc.readyState === "open") { try { pr.dc.send(JSON.stringify({ t: "pog", ts: m.ts })); } catch (_) {} } return; }
    if (m.t === "pog") { const pr = peers.get(id); if (pr) { pr.rtt = performance.now() - m.ts; setNetHud(); } return; }
    if (m.t === "pos") pushPeer(id, m.p, m.r);
    else if (m.t === "shot") onShot(id, m);
    else if (m.t === "hit") onHit(id, m);
    else if (m.t === "dead") onDead(id, m);
    else if (m.t === "hp") onHp(id, m);
    else if (m.t === "obj-spawn") onObjSpawn(m);
    else if (m.t === "obj-remove") onObjRemove(m);
    else if (m.t === "emote") { const pl = players.get(id); if (pl) setEmote(pl, m.e); }
  }
  async function tryConnectPeer(id) {
    if (peers.get(id)?.pc || selfId == null) return;
    if (!(selfId < id)) return;                 // lower id initiates (deterministic — avoids offer glare)
    try {
      const pc = newPC(id);
      setupDC(id, pc.createDataChannel("dwrld", { ordered: false, maxRetransmits: 0 })); // unreliable = fast-path
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      signal(id, { sdp: pc.localDescription });
    } catch (_) {}
  }
  async function handleSignal(m) {
    const from = m.from, data = m.data || {};
    let pc = peers.get(from)?.pc || newPC(from);
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === "offer") { await pc.setLocalDescription(await pc.createAnswer()); signal(from, { sdp: pc.localDescription }); }
      } else if (data.ice) { await pc.addIceCandidate(data.ice).catch(() => {}); }
    } catch (_) {}
  }
  function closePeer(id) { const pr = peers.get(id); if (pr) { try { pr.dc && pr.dc.close(); } catch (_) {} try { pr.pc && pr.pc.close(); } catch (_) {} peers.delete(id); } }

  // events may arrive over BOTH P2P and relay — dedup by event id
  function firstSee(eid) { if (!eid) return true; if (seenShots.has(eid)) return false; seenShots.add(eid); if (seenShots.size > 1024) seenShots.clear(); return true; }
  function bcastFast(obj) { const m = JSON.stringify(obj); for (const [, pr] of peers) { if (pr.dc && pr.dc.readyState === "open") { try { pr.dc.send(m); } catch (_) {} } } if (ws && ws.readyState === 1) ws.send(m); }
  function evid() { return `${selfId}-${++shotSeq}`; }
  function onShot(fromId, m) { if (!firstSee(m.eid)) return; if (fromId !== selfId && window.dwrldObjects) window.dwrldObjects.fireRemote(m.o, m.d, m.s); }
  function sendShot(o, d, s) { bcastFast({ t: "shot", eid: evid(), o, d, s }); }
  // object sync: a spawned/destroyed object is shared with the room (server stores it + sends to late joiners)
  function sendObject(op, payload) {
    if (op === "spawn") bcastFast({ t: "obj-spawn", eid: evid(), obj: payload });
    else if (op === "remove") bcastFast({ t: "obj-remove", eid: evid(), id: payload });
  }
  function onObjSpawn(m) { if (firstSee(m.eid) && window.dwrldObjects) window.dwrldObjects.applyRemote("spawn", m.obj); }
  function onObjRemove(m) { if (firstSee(m.eid) && window.dwrldObjects) window.dwrldObjects.applyRemote("remove", m.id); }

  // ---------- PvP (shooter-authoritative hit detection; victim applies its own damage; death + respawn) ----------
  // called by a local bullet (objects.js checkHit) each substep — does this bullet hit a remote player?
  function pvpHitTest(x, y, z, damage) {
    if (!alive) return false;
    for (const [id, pl] of players) {
      if (pl.downed) continue;                              // can't hit a downed/dead body
      const g = pl.group.position, dx = g.x - x, dz = g.z - z;
      // tight capsule hugging the mesh: radius ~0.5 horizontally, body from knees (0.2) to head-top (1.95)
      if (dx * dx + dz * dz < 0.5 * 0.5 && y > 0.2 && y < 1.95) {
        bcastFast({ t: "hit", eid: evid(), target: id, by: selfId, dmg: damage || 25 }); hitMarker(); return true;
      }
    }
    return false;
  }
  function applyDamage(dmg, by) {
    if (!alive) return;
    health -= dmg; setChud(); bcastFast({ t: "hp", eid: evid(), hp: Math.max(0, health) });
    const shooter = players.get(by); if (shooter) damageArrow(shooter.group.position);   // 3D holographic "shot came from here"
    flashHurt();
    if (health <= 0) die(by);
  }
  function die(by) {
    alive = false; deaths++; health = 0; setChud();
    bcastFast({ t: "dead", eid: evid(), by });
    toast(`You were killed by ${esc(players.get(by)?.name || (by === selfId ? "yourself" : "someone"))}`);
    setTimeout(respawn, RESPAWN_MS);
  }
  function respawn() {
    health = MAXHP; alive = true; setChud();
    const a = Math.random() * Math.PI * 2, rd = 6 + Math.random() * 14;
    camera.position.x = Math.cos(a) * rd; camera.position.z = Math.sin(a) * rd;   // respawn somewhere in the arena
    bcastFast({ t: "hp", eid: evid(), hp: health });
  }
  function onHit(fromId, m) { if (!firstSee(m.eid)) return; if (m.target === selfId) applyDamage(m.dmg || 25, m.by); }
  function onDead(fromId, m) {
    if (!firstSee(m.eid)) return;
    const pl = players.get(fromId); if (pl) { pl.downed = true; pl.downUntil = performance.now() + RESPAWN_MS; }   // their mesh falls over
    if (m.by === selfId && fromId !== selfId) { kills++; setChud(); toast(`You killed ${esc(pl?.name || "someone")}`); }
  }
  function onHp(fromId, m) { if (!firstSee(m.eid)) return; const pl = players.get(fromId); if (pl) { setHpBar(pl, Math.max(0, Math.min(1, (m.hp || 0) / MAXHP))); if ((m.hp || 0) >= MAXHP) pl.downed = false; } }   // respawn stands them back up
  function hitMarker() { const x = document.createElement("div"); x.textContent = "✕"; x.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:12;color:#ff5b5b;font:700 22px Consolas;pointer-events:none"; document.body.appendChild(x); setTimeout(() => x.remove(), 180); }

  // 3D holographic arrow that floats in front of you and points toward whoever shot you
  const dmgArrows = [];
  function damageArrow(shooterPos) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4455, transparent: true, opacity: 0.95, depthTest: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), mat); shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.3; g.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.36, 12), mat); head.rotation.x = Math.PI / 2; head.position.z = 0.78; g.add(head);
    g.renderOrder = 1002; g.userData = { until: performance.now() + 1600, from: shooterPos.clone(), mat };
    scene.add(g); dmgArrows.push(g);
  }
  function updateArrows(now) {
    const fwd = new THREE.Vector3();
    for (let i = dmgArrows.length - 1; i >= 0; i--) {
      const a = dmgArrows[i];
      if (now > a.userData.until) { scene.remove(a); a.traverse(o => { o.geometry && o.geometry.dispose(); }); a.userData.mat.dispose(); dmgArrows.splice(i, 1); continue; }
      camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      a.position.copy(camera.position).addScaledVector(fwd, 2.2); a.position.y = camera.position.y - 0.25;
      const dx = a.userData.from.x - camera.position.x, dz = a.userData.from.z - camera.position.z;
      if (dx * dx + dz * dz > 1e-4) a.rotation.set(0, Math.atan2(dx, dz), 0);   // point toward the shooter (horizontal)
      a.userData.mat.opacity = 0.95 * ((a.userData.until - now) / 1600);
    }
  }
  function flashHurt() {
    const f = document.createElement("div");
    f.style.cssText = "position:fixed;inset:0;z-index:9;pointer-events:none;background:radial-gradient(ellipse at center, transparent 45%, rgba(255,0,0,0.4) 100%);transition:opacity .5s;opacity:1";
    document.body.appendChild(f); requestAnimationFrame(() => { f.style.opacity = "0"; }); setTimeout(() => f.remove(), 550);
  }

  // ---------- send loop (own timer, ~30 Hz, independent of render fps) ----------
  let lastTypeEmote = "";
  setInterval(() => {
    if (!connected || !ws || ws.readyState !== 1) return;
    const c = camera.position;
    const j = JSON.stringify({ t: "pos", p: [r3(c.x), r3(c.y), r3(c.z)], r: [r3(getYaw()), r3(getPitch())] });
    for (const [, pr] of peers) { if (pr.dc && pr.dc.readyState === "open") { try { pr.dc.send(j); } catch (_) {} } } // P2P fast-path
    ws.send(j);                                                                                                       // relay (non-P2P peers + roster)
    const want = (isTyping && isTyping()) ? "type" : "";
    if (want !== lastTypeEmote) { lastTypeEmote = want; ws.send(JSON.stringify({ t: "emote", e: want })); }
  }, SEND_MS);

  // latency probes (2 Hz): server RTT via ws ping/pong; per-peer RTT via DataChannel png/pog.
  // Cheap (a few bytes), and refreshes the bottom-left net HUD with live P2P-vs-relay + latency.
  setInterval(() => {
    if (connected && ws && ws.readyState === 1) { lastPingAt = performance.now(); try { ws.send(JSON.stringify({ t: "ping" })); } catch (_) {} }
    const now = performance.now();
    for (const [, pr] of peers) { if (pr.dc && pr.dc.readyState === "open") { try { pr.dc.send(JSON.stringify({ t: "png", ts: now })); } catch (_) {} } }
    setNetHud();
  }, 2000);

  // emote hotkeys 1-5 (ignored while typing in a screen)
  const EK = { "1": "wave", "2": "point", "3": "talk", "4": "clap", "5": "heart" };
  addEventListener("keydown", (e) => {
    if (isTyping && isTyping()) return;
    const em = EK[e.key];
    if (em && connected && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "emote", e: em }));
  });

  // ---------- per-frame interpolation (called from the render loop) ----------
  function update() {
    const now = performance.now(), renderT = now - INTERP_MS;
    for (const [id, pl] of players) {
      const b = buffers.get(id); if (!b || !b.length) continue;
      // find a = latest sample at/before renderT, c = the next (straddle renderT, then lerp)
      let a = b[0], c = b[0];
      for (let i = b.length - 1; i >= 0; i--) { if (b[i].t <= renderT) { a = b[i]; c = b[i + 1] || b[i]; break; } }
      const alpha = (c.t > a.t) ? clamp((renderT - a.t) / (c.t - a.t)) : 0;
      const x = lerp(a.p[0], c.p[0], alpha), z = lerp(a.p[2], c.p[2], alpha), yaw = lerpAngle(a.r[0], c.r[0], alpha);
      pl.group.position.set(x, 0, z);
      pl.group.rotation.y = yaw;                // face look/movement direction (was +PI = eyes backwards)
      // death fall-over (data-driven emote): tip over while downed, stand back up on respawn
      if (pl.downed && now > pl.downUntil) pl.downed = false;
      pl.group.rotation.z += ((pl.downed ? Math.PI / 2 : 0) - pl.group.rotation.z) * 0.12;
      if (pl.downed) { pl.group.position.y = 0.25; }
      else {
        const moved = pl.hasPrev ? Math.hypot(x - pl.px, z - pl.pz) : 0;
        if (moved > 0.004) { pl.walkT += 0.35; const s = Math.sin(pl.walkT); pl.armL.rotation.x = s * 0.6; pl.armR.rotation.x = -s * 0.6; pl.thighL.rotation.x = -s * 0.5; pl.thighR.rotation.x = s * 0.5; }
        else { for (const lb of [pl.armL, pl.armR, pl.thighL, pl.thighR]) lb.rotation.x *= 0.8; }
      }
      pl.px = x; pl.pz = z; pl.hasPrev = true;
      if (pl.emoteUntil && now > pl.emoteUntil) setEmote(pl, "");
    }
    updateArrows(now);
  }

  connect();
  return {
    update, sendShot, pvpHitTest, sendObject,
    sendAction: (a, k) => { if (connected && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "action", a, k })); },
    setName: (n) => { NAME = n; localStorage.setItem("dwrld_name", n); setHud(); },
    get connected() { return connected; }, get count() { return players.size + 1; },
    get health() { return health; }, get alive() { return alive; }, get kills() { return kills; },
    // test hooks (used by the Electron end-to-end test; harmless in normal use)
    _test: {
      warp: (x, z) => { camera.position.x = x; camera.position.z = z; },
      remotes: () => [...players.values()].map(pl => ({ x: +pl.group.position.x.toFixed(2), z: +pl.group.position.z.toFixed(2), e: pl.e || null })),
      connected: () => connected, count: () => players.size + 1,
      p2pPeers: () => [...peers.values()].filter(pr => pr.dc && pr.dc.readyState === "open").length,
      hp: () => health, alive: () => alive, kills: () => kills,
    },
  };

  // ---------- helpers ----------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }
  function clamp(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function esc(s) { return String(s).replace(/[<>&]/g, ""); }
  function normHex(c) { return /^#[0-9a-fA-F]{6}$/.test(c || "") ? c : null; }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function hslHex(h, s, l) { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); const to = x => Math.round(255 * x).toString(16).padStart(2, "0"); return "#" + to(f(0)) + to(f(8)) + to(f(4)); }
}
