/* Shared behaviour: navigation, reveal, and the Flow engine that animates every diagram on the site.
   Vanilla JS. Respects prefers-reduced-motion. Adapted from the Agent Studio GitOps site. */
(function () {
  "use strict";
  const REPO = "https://github.com/paimonsoror/ps-claude-sandbox-agent-runtime";
  const PAGES = [
    ["index.html", "Overview"],
    ["architecture.html", "Architecture"],
    ["walkthrough.html", "Walkthrough"],
    ["evidence.html", "Evidence"],
    ["decisions.html", "Decisions"],
    ["controls.html", "Controls"],
    ["north-star.html", "North star"],
    ["plan.html", "Plan & runbook"],
    ["research.html", "Research"],
  ];
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function current() { const p = location.pathname.split("/").pop() || "index.html"; return p === "" ? "index.html" : p; }

  function header() {
    const el = document.getElementById("site-header"); if (!el) return;
    const here = current();
    el.className = "site-header";
    el.innerHTML = `<div class="wrap">
      <a class="brand" href="index.html"><span class="mark" aria-hidden="true"></span><span>Claude Sandbox Runtime</span><span class="tagline">· sandboxed execution for Claude agents on the homelab</span></a>
      <button class="nav-toggle" aria-expanded="false" aria-controls="site-nav">Menu</button>
      <nav class="nav" id="site-nav" aria-label="Site">
        ${PAGES.map(([href, label]) => `<a href="${href}" class="${href === here ? "active" : ""}">${label}</a>`).join("")}
      </nav></div>`;
    const t = el.querySelector(".nav-toggle"), nav = el.querySelector(".nav");
    t.addEventListener("click", () => { const open = nav.classList.toggle("open"); t.setAttribute("aria-expanded", String(open)); });
  }
  function footer() {
    const el = document.getElementById("site-footer"); if (!el) return;
    el.className = "site-footer";
    el.innerHTML = `<div class="wrap">
      <span>Design baseline 2026-10-26. Every claim on these pages cites a primary source in <a href="research.html">Research</a> or a measurement in <a href="evidence.html">Evidence</a>.</span>
      <span><a href="${REPO}" rel="noopener">Repository</a> · <a href="decisions.html">ADRs</a> · <a href="controls.html">Controls</a></span>
    </div>`;
  }
  function reveal() {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || REDUCED) return;
    els.forEach(e => e.classList.add("pending"));
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.remove("pending"); en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -6% 0px", threshold: .06 });
    els.forEach(e => io.observe(e));
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, REDUCED ? Math.min(ms, 40) : ms)); }

  /* ---------- Flow engine ----------
     spec = { w, h, nodes:[{id,label,sub,x,y,w,h,kind}], edges:[{id,from,to,kind:'h'|'v'|'c'|'back',dashed,bend}], lanes:[[label,x]] }
     Returns api: setNode(id, cls|null), setEdge(id, cls|null), packet(edgeId, {cls,label,reverse,ms}), caption(text), reset() */
  const NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent) { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; }
  const COLORS = { "": "var(--accent)", sn: "var(--accent-2)", key: "var(--key)", idp: "var(--idp)", maestro: "var(--maestro)", ok: "var(--ok)", bad: "var(--bad)" };

  function mount(container, spec) {
    const NW = spec.nw || 140, NH = spec.nh || 58, PAD = 30;
    const byId = Object.fromEntries(spec.nodes.map(n => [n.id, n]));
    const size = {};
    const dim = n => size[n.id] || { w: n.w || NW, h: n.h || NH };
    function pathFor(e) {
      const a = byId[e.from], b = byId[e.to], da = dim(a), db = dim(b);
      if (e.kind === "v") {
        const up = b.y < a.y;
        const y1 = a.y + (up ? -da.h / 2 : da.h / 2), y2 = b.y + (up ? db.h / 2 : -db.h / 2);
        return `M${a.x},${y1} C${a.x},${(y1 + y2) / 2} ${b.x},${(y1 + y2) / 2} ${b.x},${y2}`;
      }
      if (e.kind === "c") {
        const x1 = a.x + da.w / 2, y1 = a.y, x2 = b.x - db.w / 2, y2 = b.y, bend = e.bend || 0;
        return `M${x1},${y1} C${x1 + 60},${y1 + bend} ${x2 - 60},${y2 - bend} ${x2},${y2}`;
      }
      if (e.kind === "back") {
        const x1 = a.x - da.w / 2, y1 = a.y, x2 = b.x + db.w / 2, y2 = b.y;
        const mx = (x1 + x2) / 2;
        return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      }
      const left = b.x < a.x;
      const x1 = a.x + (left ? -da.w / 2 : da.w / 2), y1 = a.y, x2 = b.x + (left ? db.w / 2 : -db.w / 2), y2 = b.y;
      const mx = (x1 + x2) / 2;
      return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    }
    // The caption sits under the drawing, never on top of it.
    const keptCaption = container.querySelector(":scope > .caption");
    container.innerHTML = "";
    const scroll = document.createElement("div"); scroll.className = "flow-scroll"; container.appendChild(scroll);
    const svg = el("svg", { viewBox: `0 0 ${spec.w} ${spec.h}`, class: "flow", role: "img", "aria-label": spec.label || "Animated diagram" }, scroll);
    svg.style.minWidth = (spec.minWidth || 760) + "px";
    const captionEl = keptCaption || document.createElement("div");
    captionEl.className = "caption"; captionEl.setAttribute("aria-live", "polite");
    container.appendChild(captionEl);
    (spec.lanes || []).forEach(([label, x]) => {
      el("text", { x, y: 16, "text-anchor": "middle", class: "lane" }, svg).textContent = label;
      el("line", { x1: x, y1: 26, x2: x, y2: spec.h - 6, class: "lane-line" }, svg);
    });
    const gE = el("g", {}, svg), gN = el("g", {}, svg), gP = el("g", {}, svg);
    // Nodes first, so each box can grow to fit its own text before the edges are routed.
    const nodes = {};
    spec.nodes.forEach(n => {
      const g = el("g", { class: "node kind-" + (n.kind || "default"), "data-id": n.id }, gN);
      const rect = el("rect", { rx: 12 }, g);
      const hasSub = !!n.sub;
      const t = el("text", { x: n.x, y: n.y + (hasSub ? -3 : 5), "text-anchor": "middle" }, g); t.textContent = n.label;
      let ts = null;
      if (hasSub) { ts = el("text", { x: n.x, y: n.y + 16, "text-anchor": "middle", class: "sub" }, g); ts.textContent = n.sub; }
      let need = 0;
      try { need = Math.max(t.getComputedTextLength(), ts ? ts.getComputedTextLength() : 0); } catch (e) { need = 0; }
      if (!need) need = Math.max(n.label.length * 8.6, (n.sub || "").length * 6.8);
      const w = Math.max(n.w || NW, Math.ceil(need + PAD)), h = n.h || NH;
      size[n.id] = { w, h };
      rect.setAttribute("x", n.x - w / 2); rect.setAttribute("y", n.y - h / 2);
      rect.setAttribute("width", w); rect.setAttribute("height", h);
      nodes[n.id] = g;
    });
    const edges = {};
    spec.edges.forEach(e => { edges[e.id] = el("path", { d: pathFor(e), class: "edge" + (e.dashed ? " dashed" : ""), "data-id": e.id }, gE); });
    function setClass(node, cls, keep) {
      node.setAttribute("class", node.getAttribute("class").split(" ").filter(c => keep.includes(c) || c.startsWith("kind-") || c === "node" || c === "edge" || c === "dashed").join(" ") + (cls ? " " + cls : ""));
    }
    const api = {
      svg,
      setNode(id, cls) { const n = nodes[id]; if (n) setClass(n, cls, []); },
      setEdge(id, cls) { const e = edges[id]; if (e) setClass(e, cls, []); },
      caption(text) { captionEl.textContent = text; },
      reset() { Object.values(nodes).forEach(n => setClass(n, null, [])); Object.values(edges).forEach(e => setClass(e, null, [])); gP.innerHTML = ""; },
      packet(edgeId, opts = {}) {
        const path = edges[edgeId]; if (!path) return Promise.resolve();
        const ms = REDUCED ? 30 : (opts.ms || 1200);
        const color = COLORS[opts.cls || ""] || COLORS[""];
        const g = el("g", { class: "packet", style: `color:${color}` }, gP);
        el("circle", { r: 7, fill: color }, g);
        if (opts.label) {
          const t = el("text", { x: 0, y: -16, "text-anchor": "middle", class: "plabel" }, g); t.textContent = opts.label;
          let lw = 0; try { lw = t.getComputedTextLength(); } catch (e) { lw = 0; }
          if (!lw) lw = opts.label.length * 6.8;
          const bg = el("rect", { x: -(lw + 16) / 2, y: -30, width: lw + 16, height: 20, rx: 10, class: "plabel-bg", fill: color }, g);
          g.insertBefore(bg, t);
        }
        const len = path.getTotalLength();
        path.setAttribute("class", path.getAttribute("class").replace(/ hot[^ ]*/g, "") + " hot" + (opts.cls ? "-" + opts.cls : ""));
        return new Promise(res => {
          const t0 = performance.now();
          function frame(now) {
            let k = Math.min(1, (now - t0) / ms); if (opts.reverse) k = 1 - k;
            const p = path.getPointAtLength(k * len);
            g.setAttribute("transform", `translate(${p.x},${p.y})`);
            if ((opts.reverse ? k > 0 : k < 1)) requestAnimationFrame(frame); else { g.remove(); res(); }
          }
          requestAnimationFrame(frame);
        });
      },
    };
    return api;
  }

  /* Script runner: steps = [{caption, nodes:{id:cls}, edges:{id:cls}, packets:[{edge,cls,label,reverse,ms}], parallel:true, hold, after:{id:cls}}] */
  function player(flow, steps, opts = {}) {
    let i = 0, playing = false, token = 0, loop = !!opts.loop;
    const stepBtns = opts.stepsEl ? Array.from(opts.stepsEl.querySelectorAll("button")) : [];
    const prog = opts.progressEl ? opts.progressEl.querySelector("i") : null;
    async function runStep(n) {
      const s = steps[n]; if (!s) return;
      flow.caption(s.caption || "");
      stepBtns.forEach((b, j) => { b.classList.toggle("current", j === n); b.classList.toggle("done", j < n); });
      if (prog) prog.style.width = `${((n + 1) / steps.length) * 100}%`;
      if (opts.onStep) opts.onStep(n, s);
      if (s.reset) flow.reset();
      if (s.nodes) for (const id in s.nodes) flow.setNode(id, s.nodes[id]);
      if (s.edges) for (const id in s.edges) flow.setEdge(id, s.edges[id]);
      if (s.packets) {
        if (s.parallel) await Promise.all(s.packets.map(p => flow.packet(p.edge, p)));
        else for (const p of s.packets) await flow.packet(p.edge, p);
      }
      if (s.after) for (const id in s.after) flow.setNode(id, s.after[id]);
      await sleep(s.hold == null ? 3200 : s.hold + 1600);
    }
    async function play(from) {
      const my = ++token; playing = true; i = from == null ? i : from;
      while (playing && my === token) {
        if (i === 0) flow.reset();
        await runStep(i);
        if (my !== token) return;
        i++;
        if (i >= steps.length) { if (loop) { await sleep(3500); i = 0; } else { playing = false; break; } }
      }
    }
    function goto(n) { token++; playing = false; i = n; flow.reset(); for (let k = 0; k < n; k++) { const s = steps[k]; if (s.nodes) for (const id in s.nodes) flow.setNode(id, s.nodes[id]); if (s.edges) for (const id in s.edges) flow.setEdge(id, s.edges[id]); if (s.after) for (const id in s.after) flow.setNode(id, s.after[id]); } runStep(n); }
    stepBtns.forEach((b, j) => b.addEventListener("click", () => goto(j)));
    if (opts.replayEl) opts.replayEl.addEventListener("click", () => { token++; playing = false; play(0); });
    if (opts.nextEl) opts.nextEl.addEventListener("click", () => goto(Math.min(steps.length - 1, i + 1)));
    if (opts.prevEl) opts.prevEl.addEventListener("click", () => goto(Math.max(0, i - 1)));
    return { play, goto, stop() { token++; playing = false; } };
  }

  function log(el, lines) { el.innerHTML = ""; lines.forEach((l, k) => { const d = document.createElement("div"); d.style.animationDelay = `${k * .12}s`; d.innerHTML = l; el.appendChild(d); }); }

  document.addEventListener("DOMContentLoaded", () => { header(); footer(); reveal(); });
  window.Site = { REPO, REDUCED, sleep, Flow: { mount, player }, log };
})();
