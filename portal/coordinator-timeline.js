// portal/coordinator-timeline.js
// The coordinator's timeline: every task of one job on a calendar, with the
// links between them. The engine (Python, in sixarrows-coordinator) is the
// authority on dates. This file repeats its forward pass so a drag can be
// previewed before it is saved, and so saved edits show at once, before the
// engine's next run picks them up. Keep `plan()` in step with
// coordinator/schedule.py: the page checks itself against the engine's own
// dates and says so if they ever disagree.
(function () {
  "use strict";

  // ------------------------------------------------------------- days
  // Dates are whole days since 1970-01-01 (UTC), so arithmetic is plain integers.
  const DAY = 86400000;
  const dn = (iso) => { if (!iso) return null; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d) / DAY; };
  const iso = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const weekday = (n) => (n + 4) % 7;                       // 0 = Sunday; 1970-01-01 was a Thursday

  function calendar(holidays) {
    const off = new Set(holidays.map(dn));
    const isWork = (d) => { const w = weekday(d); return w !== 0 && w !== 6 && !off.has(d); };
    const nextWork = (d) => { while (!isWork(d)) d++; return d; };
    const addWork = (d, n) => { d = nextWork(d); while (n > 0) { d++; if (isWork(d)) n--; } return d; };
    // Python's round() rounds halves to even; durations of 2.5 days must agree
    const roundEven = (x) => { const f = Math.floor(x), r = x - f; return r > 0.5 ? f + 1 : r < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
    const finish = (start, dur) => { const days = Math.max(roundEven(dur || 0), 0); return days >= 1 ? addWork(start, days - 1) : nextWork(start); };
    const dayAfter = (d) => nextWork(d + 1);
    const workdaysBetween = (a, b) => { let n = 0, s = Math.min(a, b), e = Math.max(a, b); for (let d = s + 1; d <= e; d++) if (isWork(d)) n++; return a <= b ? n : -n; };
    return { isWork, nextWork, addWork, finish, dayAfter, workdaysBetween };
  }

  // ---------------------------------------------------------- engine
  // ov (overrides): pinned{id: day}, dur{id: n}, booked{id: [s, e]}, started{id: day},
  // done{id: day}, handoff{id: day|null}, link{"p>s": {strength, lag}}
  function plan(T, ov) {
    ov = ov || {};
    const cal = calendar(T.holidays);
    const today = dn(T.today), floor = cal.nextWork(today), start0 = cal.nextWork(dn(T.project_start));
    const byId = {}; T.tasks.forEach((t) => { byId[t.id] = t; });
    const preds = {}, succs = {};
    T.links.forEach((l) => { if (!byId[l.p] || !byId[l.s]) return; (preds[l.s] = preds[l.s] || []).push(l); (succs[l.p] = succs[l.p] || []).push(l); });
    const strengthOf = (l) => {
      const v = ov.link && ov.link[l.p + ">" + l.s];
      if (v === "default") return { strength: l.default, lag: l.default_lag };
      return v || { strength: l.strength, lag: l.lag };
    };

    // dependency order (Kahn), ties by sequence
    const indeg = {}; T.tasks.forEach((t) => { indeg[t.id] = (preds[t.id] || []).length; });
    const ready = T.tasks.filter((t) => !indeg[t.id]).sort((a, b) => a.seq - b.seq);
    const order = [];
    while (ready.length) {
      const t = ready.shift(); order.push(t);
      (succs[t.id] || []).forEach((l) => { if (--indeg[l.s] === 0) { ready.push(byId[l.s]); ready.sort((a, b) => a.seq - b.seq); } });
    }

    const res = {};
    order.forEach((t) => {
      const pinned = ov.pinned && t.id in ov.pinned ? ov.pinned[t.id] : dn(t.pinned);
      const dur = ov.dur && t.id in ov.dur ? ov.dur[t.id] : t.dur;
      let c = start0, driver = null, held = null;
      (preds[t.id] || []).forEach((l) => {
        const { strength, lag } = strengthOf(l);
        if (strength === "soft" && pinned != null) return;      // moved over a soft link on purpose
        const pd = res[l.p], pt = byId[l.p];
        const handoff = ov.handoff && l.p in ov.handoff ? ov.handoff[l.p] : dn(pt.handoff);
        const pdone = isDone(pt, ov);
        let cand;
        if (handoff != null && !pdone) cand = cal.dayAfter(handoff);
        else if (strength === "partial") cand = cal.addWork(pd.es, lag);
        else if (l.type === "SS") cand = pd.es;
        else cand = cal.dayAfter(pd.ef);
        if (pd.arrival != null) cand = Math.max(cand, cal.nextWork(pd.arrival));
        if (cand > c) { c = cand; driver = l.p; held = strength; }
      });
      const done = ov.done && t.id in ov.done ? ov.done[t.id] : null;
      const started = ov.started && t.id in ov.started ? ov.started[t.id] : dn(t.started);
      const booked = ov.booked && t.id in ov.booked ? ov.booked[t.id] : (t.booked ? [dn(t.booked), dn(t.booked_end)] : null);
      let es, ef, issue = null;
      if (done != null) { es = started != null ? started : done; ef = done; }
      else if (t.done) { es = dn(t.es); ef = dn(t.ef); }                       // finished: the engine's actual dates
      else if (started != null) { es = started; ef = Math.max(cal.finish(started, dur), floor); }
      else if (booked) {
        es = booked[0]; ef = booked[1] != null ? booked[1] : cal.finish(booked[0], dur);
        if (es < c) issue = "booked before what it waits on is done";
      } else {
        es = Math.max(c, floor);
        if (es > c) driver = "today";
        if (pinned != null && cal.nextWork(pinned) > es) { es = cal.nextWork(pinned); driver = "pinned"; }
        if (t.type === "material_order") es = Math.max(es, dn(t.es));          // the engine's order window
        ef = cal.finish(es, dur);
      }
      let arrival = null;
      if (t.arrival) arrival = dn(t.arrival) + Math.max(0, es - dn(t.es));
      res[t.id] = { es, ef, arrival, driver, held, issue, pinned, booked: !!booked, started: started != null && done == null && !t.done, done: done != null || t.done };
    });

    // soft overlaps, and the chain that sets the finish date
    order.forEach((t) => {
      const r = res[t.id]; r.overlaps = [];
      if (r.done) return;
      (preds[t.id] || []).forEach((l) => {
        if (strengthOf(l).strength === "soft" && !res[l.p].done && res[l.p].ef >= r.es) r.overlaps.push(l.p);
      });
    });
    let last = null;
    T.tasks.forEach((t) => { if (!t.active) return; const r = res[t.id]; if (!r.done && (!last || r.ef > res[last.id].ef || (r.ef === res[last.id].ef && t.seq > last.seq))) last = t; });
    const critical = new Set();
    for (let id = last && last.id; id && byId[id] && !critical.has(id); id = res[id].driver) {
      if (res[id].done) break;
      critical.add(id);
    }
    const finish = Math.max(...T.tasks.filter((t) => t.active).map((t) => res[t.id].ef));
    return { res, critical, finish, cal, preds, succs, byId, strengthOf };
  }

  function isDone(t, ov) { return t.done || !!(ov.done && t.id in ov.done); }

  // Saved edits the engine has not run on yet become overrides, so the page shows them now.
  function overridesFromEdits(edits) {
    const ov = { pinned: {}, dur: {}, booked: {}, started: {}, done: {}, handoff: {}, link: {} };
    (edits || []).forEach((e) => {
      const b = e.payload && e.payload.input; if (!b) return;
      switch (b.action) {
        case "move_task":
          if (b.end) ov.booked[b.task_id] = [dn(b.start), dn(b.end)]; else ov.pinned[b.task_id] = dn(b.start);
          (b.pins || []).forEach((p) => { ov.pinned[p.task_id] = dn(p.start); });
          break;
        case "clear_pin": ov.pinned[b.task_id] = null; break;
        case "set_duration": ov.dur[b.task_id] = Number(b.days); break;
        case "mark_booked": ov.booked[b.task_id] = [dn(b.start), dn(b.end || b.start)]; break;
        case "mark_started": ov.started[b.task_id] = dn(b.date); break;
        case "mark_done": ov.done[b.task_id] = dn(b.date); break;
        case "handoff": ov.handoff[b.task_id] = b.date ? dn(b.date) : null; break;
        case "set_link": ov.link[b.pred_id + ">" + b.succ_id] = b.strength ? { strength: b.strength, lag: Number(b.lag) || 0 } : "default"; break;
        case "set_link_default": ov.link[b.pred_id + ">" + b.succ_id] = { strength: b.strength, lag: Number(b.lag) || 0 }; break;
      }
    });
    return ov;
  }

  window.CoordPlan = { plan, overridesFromEdits, dn, iso, calendar };
})();

// ================================================================ drawing
(function () {
  "use strict";
  const { plan, overridesFromEdits, dn, iso } = window.CoordPlan;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (n) => { const d = new Date(n * 86400000); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const FIXED = ["external_gate", "milestone", "decision", "material_order"];
  const KIND = { work: "work", external_gate: "insp", external_request: "req", material_order: "order", decision: "choice", milestone: "mile",
                 admin_task: "office", client_meeting: "office", pm_walk: "office" };
  const TYPE_NAME = { work: "Crew", external_gate: "Inspection", external_request: "Request", material_order: "Order", decision: "Client choice",
                      milestone: "Milestone", admin_task: "Office", client_meeting: "Meeting", pm_walk: "PM walk" };
  const ZOOM = { days: 26, weeks: 9, months: 3.2 };
  const ROW = 30;

  function mount(root, o) {
    const T = o.T;
    const view = Object.assign({ zoom: "weeks", showDone: false, filter: "all", collapsed: {} }, o.view || {});
    const base = overridesFromEdits(o.edits);
    const editedIds = new Set((o.edits || []).map((e) => e.task_id).filter(Boolean));
    let P = plan(T, base), drag = null, pending = null, selected = o.selected || null;
    const px = () => ZOOM[view.zoom];

    // ------------------------------------------------------------ shell
    root.replaceChildren();
    root.classList.add("tl");
    const tools = el("div", "tl-tools");
    const banner = el("div", "tl-banner"); banner.hidden = true; banner.setAttribute("role", "status");
    const scroll = el("div", "tl-scroll"); scroll.tabIndex = 0; scroll.setAttribute("aria-label", "Timeline");
    root.append(tools, banner, scroll);

    function toolbar() {
      tools.replaceChildren();
      const seg = el("div", "tl-seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Zoom");
      [["days", "Days"], ["weeks", "Weeks"], ["months", "Months"]].forEach(([k, t]) => {
        const b = el("button", null, t); b.type = "button"; b.setAttribute("aria-pressed", String(view.zoom === k));
        b.addEventListener("click", () => { const mid = centerDay(); view.zoom = k; save(); draw(); centerOn(mid); });
        seg.append(b);
      });
      const filt = el("div", "tl-seg"); filt.setAttribute("role", "group"); filt.setAttribute("aria-label", "Show");
      [["all", "Everything"], ["crew", "Crew & inspections"], ["orders", "Orders & choices"]].forEach(([k, t]) => {
        const b = el("button", null, t); b.type = "button"; b.setAttribute("aria-pressed", String(view.filter === k));
        b.addEventListener("click", () => { view.filter = k; save(); draw(); }); filt.append(b);
      });
      const done = el("label", "tl-check"); const cb = el("input"); cb.type = "checkbox"; cb.id = "tl-show-done"; cb.checked = view.showDone;
      cb.addEventListener("change", () => { view.showDone = cb.checked; save(); draw(); }); done.append(cb, document.createTextNode("Finished work"));
      const today = el("button", "tl-btn", "Today"); today.type = "button"; today.addEventListener("click", () => scrollToDay(dn(T.today) - 7, true));
      const fin = el("span", "tl-finish");
      fin.append(el("span", null, "Finish "), el("b", null, fmt(P.finish) + ", " + iso(P.finish).slice(0, 4)));
      if (P.critical.size) fin.append(el("span", "tl-muted", " · " + P.critical.size + " tasks set it"));
      tools.append(seg, filt, done, today, fin);
    }

    // ------------------------------------------------------------- rows
    function visibleRows() {
      const show = (t) => t.active && (view.showDone || !P.res[t.id].done) &&
        (view.filter === "all" || (view.filter === "crew" ? ["work", "external_gate", "external_request"].includes(t.type) : ["material_order", "decision"].includes(t.type)));
      const phases = [], by = {};
      // phases match regardless of capitals: Notion writes "Dry-in" and "Dry-In"
      const title = {};
      T.tasks.forEach((t) => { if (!show(t)) return; const k = (t.phase || "Other").toLowerCase(); if (!by[k]) { by[k] = []; phases.push(k); title[k] = t.phase || "Other"; } by[k].push(t); });
      const rows = [];
      phases.forEach((k) => {
        const ph = title[k];
        const list = by[k].slice().sort((a, b) => P.res[a.id].es - P.res[b.id].es || a.seq - b.seq);
        const allDone = list.every((t) => P.res[t.id].done);
        const closed = ph in view.collapsed ? view.collapsed[ph] : allDone;
        rows.push({ phase: ph, list, closed });
        if (!closed) list.forEach((t) => rows.push({ task: t }));
      });
      return rows;
    }

    let rows = [], range = [0, 0], canvas, layer, svg;
    function draw() {
      P = plan(T, Object.assign({}, base, dragOv()));
      toolbar();
      rows = visibleRows();
      const shown = rows.flatMap((r) => r.task ? [P.res[r.task.id]] : r.list.map((t) => P.res[t.id]));
      const today = dn(T.today);
      const lo = Math.min(today - 14, ...shown.map((r) => r.es)) - 3;
      const hi = Math.max(P.finish, today + 30) + 21;
      range = [lo, hi];
      const width = (hi - lo + 1) * px();
      const keep = scroll.scrollLeft, keepTop = scroll.scrollTop;
      scroll.replaceChildren();
      canvas = el("div", "tl-canvas"); canvas.style.setProperty("--tl-w", width + "px"); canvas.style.setProperty("--px", px() + "px");
      canvas.append(header(lo, hi));
      const body = el("div", "tl-body");
      layer = el("div", "tl-layer");                                   // today line and link lines, over the tracks
      const todayLine = el("div", "tl-today"); todayLine.style.left = ((today - lo) * px()) + "px"; layer.append(todayLine);
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "tl-links"); svg.setAttribute("width", width); svg.setAttribute("height", rows.length * ROW);
      layer.append(svg);
      const weekendShift = ((6 - weekdayOf(lo) + 7) % 7) * px();
      rows.forEach((r, i) => body.append(r.task ? taskRow(r.task, i, weekendShift) : phaseRow(r, weekendShift)));
      body.append(layer);
      canvas.append(body);
      scroll.append(canvas);
      if (drawn) { scroll.scrollLeft = keep; scroll.scrollTop = keepTop; }
      else if (o.scroll) { drawn = true; scroll.scrollLeft = o.scroll.left; scroll.scrollTop = o.scroll.top; }
      else { drawn = true; scrollToDay(today - 10); }
      drawLinks();
    }
    let drawn = false;
    const weekdayOf = (n) => (n + 4) % 7;

    function header(lo, hi) {
      const h = el("div", "tl-head");
      const corner = el("div", "tl-corner"); corner.append(el("span", null, "Task"), el("span", "tl-muted", T.tasks.filter((t) => t.active).length + " in this job"));
      const months = el("div", "tl-months"), ticks = el("div", "tl-ticks");
      for (let d = lo; d <= hi; d++) {
        const date = new Date(d * 86400000);
        if (date.getUTCDate() === 1 || d === lo) {
          const m = el("span", null, MON[date.getUTCMonth()] + (date.getUTCMonth() === 0 || d === lo ? " " + date.getUTCFullYear() : ""));
          m.style.left = ((d - lo) * px()) + "px"; months.append(m);
        }
        if (view.zoom === "days" || (view.zoom === "weeks" && weekdayOf(d) === 1)) {
          const t = el("span", weekdayOf(d) === 1 ? "mon" : null, view.zoom === "days" ? String(date.getUTCDate()) : String(date.getUTCDate()));
          t.style.left = ((d - lo) * px()) + "px"; t.style.width = (view.zoom === "days" ? px() : 7 * px()) + "px"; ticks.append(t);
        }
      }
      const right = el("div", "tl-scale"); right.append(months, ticks);
      h.append(corner, right);
      return h;
    }

    function phaseRow(r, shift) {
      const row = el("div", "tl-row tl-phase");
      const name = el("button", "tl-name"); name.type = "button"; name.setAttribute("aria-expanded", String(!r.closed));
      const done = r.list.filter((t) => P.res[t.id].done).length;
      name.append(el("span", "tl-caret", r.closed ? "▸" : "▾"), el("span", "tl-ph", r.phase), el("span", "tl-muted", done + "/" + r.list.length + " done"));
      name.addEventListener("click", () => { view.collapsed[r.phase] = !r.closed; save(); draw(); });
      const track = el("div", "tl-track"); track.style.backgroundPosition = shift + "px 0";
      const es = Math.min(...r.list.map((t) => P.res[t.id].es)), ef = Math.max(...r.list.map((t) => P.res[t.id].ef));
      const span = el("div", "tl-span" + (done === r.list.length ? " done" : ""));
      span.style.left = ((es - range[0]) * px()) + "px"; span.style.width = Math.max(4, (ef - es + 1) * px()) + "px";
      track.append(span); row.append(name, track);
      return row;
    }

    function taskRow(t, i, shift) {
      const r = P.res[t.id];
      const row = el("div", "tl-row" + (selected === t.id ? " sel" : "")); row.dataset.id = t.id;
      const name = el("button", "tl-name"); name.type = "button";
      const label = el("span", "tl-tn", t.name); label.title = t.name;
      const meta = [TYPE_NAME[t.type], t.type === "work" ? (t.sub || "no sub yet") : null].filter(Boolean).join(" · ");
      name.append(label, el("span", "tl-muted", meta));
      name.addEventListener("click", () => open(t.id));
      const track = el("div", "tl-track"); track.style.backgroundPosition = shift + "px 0";
      track.append(bar(t, r));
      row.append(name, track);
      return row;
    }

    function bar(t, r) {
      const kind = KIND[t.type] || "office";
      const zero = (t.type === "milestone" || t.type === "decision") && t.dur === 0;
      const cls = ["tl-bar", "k-" + kind, r.done ? "done" : r.started ? "prog" : r.booked ? "booked" : "fc"];
      if (P.critical.has(t.id)) cls.push("crit");
      if (zero) cls.push("pt");
      if (drag && drag.id === t.id) cls.push("dragging");
      if (pending && pending.moved && pending.moved.has(t.id)) cls.push("moved");
      const b = el("div", cls.join(" ")); b.dataset.id = t.id;
      const left = (r.es - range[0]) * px();
      b.style.left = left + "px";
      const right = t.type === "material_order" && r.arrival != null ? Math.max(r.ef, r.arrival) : r.ef;
      if (!zero) b.style.width = Math.max(px() * 0.8, (right - r.es + 1) * px()) + "px";
      const tip = [t.name, TYPE_NAME[t.type], fmt(r.es) + (r.ef !== r.es ? " – " + fmt(r.ef) : ""), t.sub, r.done ? "Finished" : r.started ? "Under way" : r.booked ? "Booked" : "Forecast"];
      if (r.pinned != null && !r.done && !r.started && !r.booked) tip.push("Moved: not before " + fmt(r.pinned));
      if (t.type === "material_order" && r.arrival != null) tip.push("Arrives " + fmt(r.arrival));
      if (P.critical.has(t.id)) tip.push("Sets the finish date");
      b.title = tip.filter(Boolean).join("\n");
      const red = !r.done && !r.started && Object.values(t.gates || {}).includes("red");
      const inner = el("span", "tl-lab", t.type === "work" ? (t.sub || "") : "");
      b.append(inner);
      if (t.type === "material_order" && r.arrival != null) { const a = el("i", "tl-arrive"); a.style.left = ((r.arrival - r.es) * px()) + "px"; b.append(a); }
      const marks = el("span", "tl-marks");
      if (red) { const m = el("i", "tl-red"); m.title = "A gate is not green yet"; marks.append(m); }
      if (r.pinned != null && !r.done && !r.started && !r.booked) marks.append(el("i", "tl-pin", "⌖"));
      if (r.overlaps.length) { const m = el("i", "tl-ovl", "≋"); m.title = "Overlaps " + r.overlaps.map((id) => P.byId[id].name).join(", "); marks.append(m); }
      if (editedIds.has(t.id)) { const m = el("i", "tl-edit", "•"); m.title = "Edited; the engine updates within 30 minutes"; marks.append(m); }
      b.append(marks);
      if (o.editable && movable(t, r)) {
        b.classList.add("movable");
        b.addEventListener("pointerdown", (e) => startDrag(e, t, "move"));
        if (!zero) { const h = el("span", "tl-grip"); h.title = "Drag to change how long it takes"; h.addEventListener("pointerdown", (e) => { e.stopPropagation(); startDrag(e, t, "size"); }); b.append(h); }
      } else b.addEventListener("click", () => open(t.id));
      return b;
    }
    const movable = (t, r) => !FIXED.includes(t.type) && !r.done && !r.started;

    // -------------------------------------------------------------- links
    function drawLinks() {
      svg.replaceChildren();
      const focus = drag ? drag.id : selected;
      if (!focus) return;
      const idx = {}; rows.forEach((r, i) => { if (r.task) idx[r.task.id] = i; });
      if (!(focus in idx)) return;
      const lines = [];
      (P.preds[focus] || []).forEach((l) => lines.push(l));
      (P.succs[focus] || []).forEach((l) => lines.push(l));
      lines.forEach((l) => {
        if (!(l.p in idx) || !(l.s in idx)) return;
        const st = P.strengthOf(l).strength, lag = P.strengthOf(l).lag;
        const pr = P.res[l.p], sr = P.res[l.s];
        const x1 = (st === "partial" ? P.cal.addWork(pr.es, lag) - range[0] : (l.type === "SS" ? pr.es - range[0] : pr.ef + 1 - range[0])) * px();
        const x2 = (sr.es - range[0]) * px();
        const y1 = idx[l.p] * ROW + ROW / 2, y2 = idx[l.s] * ROW + ROW / 2;
        const mid = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 12));
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M${x1},${y1} H${mid} V${y2} H${x2}`);
        path.setAttribute("class", "ln ln-" + st);
        svg.append(path);
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", x2); dot.setAttribute("cy", y2); dot.setAttribute("r", 3); dot.setAttribute("class", "lnd ln-" + st);
        svg.append(dot);
      });
    }

    // --------------------------------------------------------------- drag
    function dragOv() {
      if (!drag && !pending) return {};
      const d = drag || pending;
      const ov = { pinned: Object.assign({}, base.pinned), booked: Object.assign({}, base.booked), dur: Object.assign({}, base.dur) };
      if (d.mode === "size") ov.dur[d.id] = d.dur;
      else if (d.booked) ov.booked[d.id] = [d.start, d.end];
      else ov.pinned[d.id] = d.start;
      (d.pins || []).forEach((p) => { ov.pinned[p.id] = p.start; });
      return ov;
    }

    function startDrag(e, t, mode) {
      if (e.button !== 0) return;
      e.preventDefault();
      const r0 = P.res[t.id], cal = P.cal;
      const span = r0.booked ? cal.workdaysBetween(r0.es, r0.ef) : null;
      const startP = plan(T, base);
      drag = { id: t.id, mode, x0: e.clientX, es0: r0.es, ef0: r0.ef, start: r0.es, booked: r0.booked, end: r0.ef, dur: t.dur, moved: null, finish0: startP.finish, base: startP };
      pending = null;
      const target = e.currentTarget; target.setPointerCapture(e.pointerId);
      let changed = false;
      const move = (ev) => {
        const days = Math.round((ev.clientX - drag.x0) / px());
        if (mode === "size") {
          const ef = Math.max(drag.es0, drag.ef0 + days);
          const n = Math.max(1, cal.workdaysBetween(drag.es0, cal.nextWork(ef)) + 1);
          if (n === drag.dur) return; drag.dur = n;
        } else {
          const s = cal.nextWork(drag.es0 + days);
          if (s === drag.start) return;
          drag.start = s; if (drag.booked) drag.end = cal.addWork(s, span);
          // soft followers stay where they are when this task moves later
          drag.pins = (P.succs[t.id] || []).filter((l) => P.strengthOf(l).strength === "soft").map((l) => l.s)
            .filter((id) => { const r = drag.base.res[id]; return r && !r.done && !r.started && !r.booked && r.pinned == null && !FIXED.includes(P.byId[id].type); })
            .map((id) => ({ id, start: drag.base.res[id].es }));
        }
        changed = true; reposition(); showPreview();
      };
      const up = () => {
        target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up);
        const d = drag; drag = null;
        if (!changed) { draw(); open(t.id); return; }
        pending = d;
        pending.moved = new Set(Object.keys(P.res).filter((id) => { const a = d.base.res[id], b = P.res[id]; return a && (a.es !== b.es || a.ef !== b.ef); }));
        draw(); showPreview();
      };
      target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); target.addEventListener("pointercancel", up);
    }

    function showPreview() {
      const d = drag || pending; if (!d) { banner.hidden = true; return; }
      const t = P.byId[d.id], r = P.res[t.id];
      banner.replaceChildren(); banner.hidden = false;
      const text = el("div", "tl-btext");
      if (d.mode === "size") text.append(el("b", null, t.name), document.createTextNode(": " + d.dur + " working day" + (d.dur === 1 ? "" : "s") + ", " + fmt(r.es) + " – " + fmt(r.ef) + ". "));
      else text.append(el("b", null, t.name), document.createTextNode(": " + fmt(d.es0) + " → " + fmt(r.es) + (d.booked ? " (moves the booking)" : "") + ". "));
      if (d.mode !== "size" && r.es > d.start) {
        const why = r.driver && P.byId[r.driver] ? "waits for " + P.byId[r.driver].name + (r.held ? " (" + r.held + ")" : "") : "can't start before today";
        text.append(el("span", "tl-held", "Can't go earlier than " + fmt(r.es) + ": " + why + ". "));
      }
      const delta = P.cal.workdaysBetween(d.finish0, P.finish);
      text.append(el("span", delta > 0 ? "tl-late" : delta < 0 ? "tl-early" : null,
        delta === 0 ? "No change to the finish (" + fmt(P.finish) + ")." : "Finish " + fmt(d.finish0) + " → " + fmt(P.finish) + " (" + (delta > 0 ? "+" : "") + delta + " working days)."));
      if (d.pins && d.pins.length) text.append(document.createTextNode(" " + d.pins.length + " soft follower" + (d.pins.length > 1 ? "s stay" : " stays") + " put."));
      banner.append(text);
      if (pending) {
        const ok = el("button", "tl-btn primary", "Save"); ok.type = "button";
        const no = el("button", "tl-btn", "Cancel"); no.type = "button";
        no.addEventListener("click", () => { pending = null; banner.hidden = true; draw(); });
        ok.addEventListener("click", async () => {
          ok.disabled = true; no.disabled = true;
          const payload = pending.mode === "size" ? { action: "set_duration", task_id: pending.id, days: pending.dur }
            : Object.assign({ action: "move_task", task_id: pending.id, start: iso(r.es), pins: (pending.pins || []).map((p) => ({ task_id: p.id, start: iso(p.start) })) },
                            pending.booked ? { end: iso(r.ef) } : {});
          const saved = await o.onSave(payload);
          if (!saved) { ok.disabled = false; no.disabled = false; }
        });
        banner.append(ok, no);
      }
    }

    // While dragging, the bar under the pointer must stay in the page, so only
    // positions change; the full redraw waits for the pointer to come up.
    function reposition() {
      P = plan(T, Object.assign({}, base, dragOv()));
      root.querySelectorAll(".tl-bar[data-id]").forEach((b) => {
        const t = P.byId[b.dataset.id], r = P.res[b.dataset.id]; if (!t || !r) return;
        b.style.left = ((r.es - range[0]) * px()) + "px";
        if (!b.classList.contains("pt")) {
          const right = t.type === "material_order" && r.arrival != null ? Math.max(r.ef, r.arrival) : r.ef;
          b.style.width = Math.max(px() * 0.8, (right - r.es + 1) * px()) + "px";
        }
        const a = b.querySelector(".tl-arrive"); if (a && r.arrival != null) a.style.left = ((r.arrival - r.es) * px()) + "px";
        const base0 = drag && drag.base.res[t.id];
        b.classList.toggle("moved", !!base0 && (base0.es !== r.es || base0.ef !== r.ef) && t.id !== drag.id);
        b.classList.toggle("dragging", !!drag && t.id === drag.id);
      });
      drawLinks();
    }

    // -------------------------------------------------------------- misc
    function open(id) { select(id); if (o.onOpen) o.onOpen(id); }
    function select(id) {
      selected = id;
      root.querySelectorAll(".tl-row.sel").forEach((r) => r.classList.remove("sel"));
      const row = root.querySelector('.tl-row[data-id="' + CSS.escape(id || "") + '"]'); if (row) row.classList.add("sel");
      drawLinks();
    }
    const nameW = () => { const n = root.querySelector(".tl-name"); return n ? n.offsetWidth : 0; };
    function scrollToDay(d, smooth) { scroll.scrollTo({ left: Math.max(0, (d - range[0]) * px()), behavior: smooth ? "smooth" : "auto" }); }
    function centerDay() { return range[0] + Math.round((scroll.scrollLeft + (scroll.clientWidth - nameW()) / 2) / px()); }
    function centerOn(d) { scroll.scrollLeft = Math.max(0, (d - range[0]) * px() - (scroll.clientWidth - nameW()) / 2); }
    function save() { if (o.onView) o.onView(view); }
    document.addEventListener("keydown", function esc(e) {
      if (!root.isConnected) { document.removeEventListener("keydown", esc); return; }
      if (e.key === "Escape" && pending) { pending = null; banner.hidden = true; draw(); }
    });

    draw();
    if (selected) { const row = root.querySelector('.tl-row[data-id="' + CSS.escape(selected) + '"]'); if (row) row.scrollIntoView({ block: "center" }); }
    return { select, plan: () => P, scrollToTask(id) { const r = P.res[id]; if (r) centerOn(r.es); } };
  }

  window.CoordTimeline = { mount };
})();
