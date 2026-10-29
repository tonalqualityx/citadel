/* Design-preview overlay. Loaded ONLY by design preview builds (ELEVENTY_ENV=preview); never in
 * production. In-house, no dependencies. Talks to the Citadel designer workspace that frames this
 * page, via postMessage, under strict origin rules:
 *   - the configured origin list comes from the script tag's data-origins (space separated);
 *   - outbound messages go only to the one configured origin that matches the framing parent
 *     (never "*"); if the page is not framed by an allowed origin the overlay posts nothing;
 *   - inbound messages are ignored unless event.origin === that origin and event.source === window.parent.
 * Messages are plain JSON objects with a "dp:" type, each well under 16 KB. */
(function () {
  "use strict";

  var script = document.currentScript;
  var ORIGINS = ((script && script.getAttribute("data-origins")) || "")
    .split(/\s+/).filter(Boolean);
  var SHA = (function () {
    var m = document.querySelector('meta[name="design-preview-sha"]');
    return (m && m.content) || "unknown";
  })();
  var KEY = "dp:parent-origin";

  /* ---------- origin resolution ---------- */
  function originOf(url) {
    try { return new URL(url).origin; } catch (e) { return ""; }
  }
  function resolveParentOrigin() {
    if (window.parent === window) return "";
    var ref = originOf(document.referrer);
    if (ref && ORIGINS.indexOf(ref) !== -1) {
      try { sessionStorage.setItem(KEY, ref); } catch (e) { /* storage unavailable */ }
      return ref;
    }
    // In-frame navigation: the referrer is the previous preview page (our own origin), so fall
    // back to the origin remembered from the first load, but only if it is still configured.
    if (ref === location.origin) {
      try {
        var saved = sessionStorage.getItem(KEY);
        if (saved && ORIGINS.indexOf(saved) !== -1) return saved;
      } catch (e) { /* storage unavailable */ }
    }
    return "";
  }
  var PARENT_ORIGIN = resolveParentOrigin(); // "" = inert (post nothing, obey nothing)

  function post(msg) {
    if (!PARENT_ORIGIN) return;
    try { window.parent.postMessage(msg, PARENT_ORIGIN); } catch (e) { /* parent gone */ }
  }
  function viewport() { return { w: window.innerWidth, h: window.innerHeight }; }
  function path() { return location.pathname; }

  /* ---------- forms are off in design previews (always, framed or not) ---------- */
  var toastEl = null, toastTimer = 0;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.setAttribute("role", "status");
      toastEl.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
        "z-index:2147483647;background:#1b1b1b;color:#fff;padding:10px 16px;border-radius:6px;" +
        "font:14px/1.3 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4);pointer-events:none";
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.display = "none"; }, 3000);
  }
  window.addEventListener("submit", function (e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    toast("Forms are off in design previews");
    post({ type: "dp:blocked", what: "form" });
  }, true);

  /* ---------- selection helpers ---------- */
  function libOf(el) { return el && el.closest ? el.closest("[data-lib]") : null; }
  function libChain(el) { // innermost first
    var out = [], cur = libOf(el);
    while (cur) { out.push(cur); cur = cur.parentElement ? libOf(cur.parentElement) : null; }
    return out;
  }
  function nth(el) {
    var n = 1, s = el.previousElementSibling;
    while (s) { if (s.tagName === el.tagName) n++; s = s.previousElementSibling; }
    return n;
  }
  function tagStep(el) { return el.tagName.toLowerCase() + ":nth-of-type(" + nth(el) + ")"; }
  function cssStr(v) { return String(v).replace(/["\\]/g, "\\$&"); }
  function libStep(el) {
    return el.tagName.toLowerCase() + '[data-lib="' + cssStr(el.getAttribute("data-lib")) +
      '"]:nth-of-type(' + nth(el) + ")";
  }
  // Selector: the [data-lib] chain (outermost first, nth-of-type at each step), then a short tag
  // path from the innermost [data-lib] to the clicked atom (at most 4 steps).
  function buildSelector(libEl, target) {
    var chain = libChain(libEl).slice(0, 8).reverse();
    var parts = chain.map(libStep);
    var steps = [], cur = target;
    while (cur && cur !== libEl && cur !== document.body) {
      steps.unshift(tagStep(cur));
      cur = cur.parentElement;
    }
    var sel = parts.join(" ");
    if (steps.length && cur === libEl) {
      var tail = steps.slice(-4).join(" > ");
      var cand = sel + (steps.length > 4 ? " " : " > ") + tail;
      if (cand.length <= 500) sel = cand;
    }
    if (sel.length > 500) sel = libStep(libEl);
    return sel.slice(0, 500);
  }
  function textQuote(el) {
    var t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return t.slice(0, 200);
  }
  function classList(el) {
    var out = [];
    for (var i = 0; i < el.classList.length && out.length < 20; i++) out.push(el.classList[i].slice(0, 60));
    return out;
  }
  function packet(libEl, target) {
    var inner = target && libEl.contains(target) ? target : libEl;
    var r = libEl.getBoundingClientRect();
    return {
      type: "dp:packet",
      path: path(),
      sha: SHA,
      data_lib: libEl.getAttribute("data-lib"),
      lib_stack: libChain(libEl).slice(0, 8).map(function (e) { return e.getAttribute("data-lib"); }),
      data_shape: (libEl.getAttribute("data-shape") || "").slice(0, 60),
      selector: buildSelector(libEl, inner),
      tag: inner.tagName.toLowerCase(),
      classes: classList(inner),
      text_quote: textQuote(libEl),
      bbox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      viewport: viewport()
    };
  }

  /* ---------- outline box (single fixed element, pointer-events none) ---------- */
  var box = null, label = null, boxTarget = null, hideTimer = 0;
  function ensureBox() {
    if (box) return;
    box = document.createElement("div");
    box.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;display:none;" +
      "outline:2px solid #e8590c;outline-offset:-2px;background:rgba(232,89,12,.08)";
    label = document.createElement("span");
    label.style.cssText = "position:absolute;left:0;top:0;transform:translateY(-100%);" +
      "background:#e8590c;color:#fff;font:11px/1 system-ui,sans-serif;padding:3px 6px;white-space:nowrap";
    box.appendChild(label);
    document.documentElement.appendChild(box);
  }
  function drawBox(el) {
    ensureBox();
    boxTarget = el;
    if (!el) { box.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = r.left + "px"; box.style.top = r.top + "px";
    box.style.width = r.width + "px"; box.style.height = r.height + "px";
    label.textContent = el.getAttribute("data-lib") || "";
    // Keep the label on screen when the element starts above the viewport.
    label.style.transform = r.top < 18 ? "translateY(0)" : "translateY(-100%)";
  }
  function redraw() { if (boxTarget && boxTarget.isConnected) drawBox(boxTarget); }
  window.addEventListener("scroll", redraw, true);
  window.addEventListener("resize", redraw);

  /* ---------- select mode ---------- */
  var selectOn = false;
  var chain = [], idx = 0, clicked = null; // chain[idx] is the selected [data-lib]
  var hoverRaf = 0;

  function setSelect(on) {
    selectOn = !!on;
    if (!selectOn) { chain = []; idx = 0; clicked = null; drawBox(null); }
    document.documentElement.style.cursor = selectOn ? "crosshair" : "";
  }
  function emitSelected() {
    if (chain[idx]) { drawBox(chain[idx]); post(packet(chain[idx], idx === 0 ? clicked : chain[idx])); }
  }

  document.addEventListener("mousemove", function (e) {
    if (!selectOn || hoverRaf) return;
    var t = e.target;
    hoverRaf = requestAnimationFrame(function () {
      hoverRaf = 0;
      if (!selectOn || chain.length) return; // a selection is locked until Esc or a new click
      drawBox(libOf(t));
    });
  }, true);

  document.addEventListener("click", function (e) {
    if (!selectOn) return;
    e.preventDefault();
    e.stopPropagation();
    var target = e.target;
    chain = libChain(target);
    idx = 0;
    clicked = target;
    if (!chain.length) { drawBox(null); return; }
    emitSelected();
  }, true);

  document.addEventListener("keydown", function (e) {
    if (!selectOn) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setSelect(false);
      post({ type: "dp:select", on: false });
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && chain.length) {
      e.preventDefault();
      var next = idx + (e.key === "ArrowUp" ? 1 : -1);
      if (next < 0 || next >= chain.length) return;
      idx = next;
      emitSelected();
    }
  }, true);

  /* ---------- parent -> overlay ---------- */
  function resolve(sel) {
    if (typeof sel !== "string" || sel.length > 500) return null;
    try { return document.querySelector(sel); } catch (e) { return null; }
  }
  window.addEventListener("message", function (e) {
    if (!PARENT_ORIGIN || e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d !== "object" || typeof d.type !== "string") return;
    if (d.type === "dp:select") {
      setSelect(d.on === true);
    } else if (d.type === "dp:highlight") {
      var el = resolve(d.selector);
      if (!el) return;
      drawBox(el.closest("[data-lib]") || el);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { if (!selectOn || !chain.length) drawBox(null); }, 2500);
    } else if (d.type === "dp:scroll") {
      var t = resolve(d.selector);
      if (t && t.scrollIntoView) t.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });

  /* ---------- overlay -> parent: lifecycle ---------- */
  post({ type: "dp:ready", path: path(), sha: SHA, viewport: viewport() });

  window.addEventListener("popstate", function () { post({ type: "dp:navigate", path: path() }); });
  window.addEventListener("hashchange", function () { post({ type: "dp:navigate", path: path() }); });
  // Same-origin link clicks outside select mode: tell the parent where the frame is heading.
  document.addEventListener("click", function (e) {
    if (selectOn || e.defaultPrevented) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank") return;
    try {
      var u = new URL(a.href, location.href);
      if (u.origin === location.origin) post({ type: "dp:navigate", path: u.pathname });
    } catch (err) { /* ignore */ }
  });
})();
