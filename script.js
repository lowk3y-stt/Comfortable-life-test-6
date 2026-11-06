(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var rRu = $("r-ru"), rEn = $("r-en"), menuCb = $("menu-toggle");

  function lang() { return rEn.checked ? "en" : "ru"; }

  /* ---------- language: the CSS already switches the text, this adds memory and labels ---------- */
  function applyLang(l, save) {
    rRu.checked = l === "ru";
    rEn.checked = l === "en";
    document.documentElement.lang = l;
    menuCb.setAttribute("aria-label", l === "en" ? "Menu" : "Меню");
    var x = $("ai-x"); if (x) x.setAttribute("aria-label", l === "en" ? "Close assistant" : "Закрыть ассистента");
    var inp = $("ai-input"); if (inp) inp.placeholder = l === "en" ? "Ask about the project" : "Спросите о проекте";
    var send = $("ai-send"); if (send) send.setAttribute("aria-label", l === "en" ? "Send" : "Отправить");
    renderChips();
    if (typeof pollTexts === "function") pollTexts();
    if (save) { try { localStorage.setItem("cl-lang", l); } catch (_) {} }
  }
  var saved = null;
  try { saved = localStorage.getItem("cl-lang"); } catch (_) {}
  var dev = String((navigator.languages && navigator.languages[0]) || navigator.language || "ru").toLowerCase();
  var start = (saved === "ru" || saved === "en") ? saved : (dev.indexOf("ru") === 0 ? "ru" : "en");

  /* ---------- title: two lines, never broken, size fitted to its column ---------- */
  var title = $("title");
  function fitTitle() {
    if (!title) return;
    var box = title.parentElement, l1 = title.querySelector(".l1");
    title.style.fontSize = "100px";
    var w = l1.getBoundingClientRect().width, avail = box.clientWidth;
    if (!w || !avail) return;
    var maxPx = 7.5 * 16;
    var size = Math.max(24, Math.min(maxPx, 100 * avail / w * 0.98));
    title.style.fontSize = size.toFixed(1) + "px";
  }

  /* ---------- menu ---------- */
  function closeMenu() { menuCb.checked = false; }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (menuCb.checked) { closeMenu(); }
      if (!$("ai").hidden) { closeAi(); }
    }
  });
  document.addEventListener("click", function (e) {
    if (menuCb.checked && !e.target.closest("header")) closeMenu();
  });
  window.addEventListener("resize", function () { if (window.innerWidth > 980) closeMenu(); fitTitle(); });

  /* anchor links: smooth scroll that behaves the same inside and outside a frame */
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function goTo(id) {
    var target = $(id);
    if (!target) return;
    closeMenu();
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    try { history.replaceState(null, "", "#" + id); } catch (_) {}
  }
  Array.prototype.forEach.call(document.querySelectorAll('a[href^="#"]'), function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href").slice(1);
      if (!$(id)) return;
      e.preventDefault();
      goTo(id);
    });
  });

  /* highlight the section being read */
  var links = Array.prototype.slice.call(document.querySelectorAll("nav a[href^='#']"));
  var secs = [];
  links.forEach(function (a) { var s = $(a.getAttribute("href").slice(1)); if (s && secs.indexOf(s) < 0) secs.push(s); });
  function markActive() {
    var y = window.scrollY + 120, current = null;
    secs.forEach(function (s) { if (s.offsetTop <= y) current = s.id; });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = secs[secs.length - 1].id;
    links.forEach(function (a) {
      if (a.getAttribute("href").slice(1) === current) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  }
  window.addEventListener("scroll", markActive, { passive: true });
  window.addEventListener("resize", markActive);

  /* ---------- assistant: understands questions by meaning, answers only from knowledge.js ---------- */
  var KBD = window.CL_KB || { concepts: {}, facts: [] };
  var FALLBACK = {
    ru: "Этого в материалах проекта нет, поэтому не буду придумывать. Я знаю про возможности, семейный режим, отличия, амбиции, основателя и защиту данных. Спросите об этом своими словами.",
    en: "That is not in the project materials, so I will not make it up. I know about the features, family mode, differences, ambitions, the founder and data protection. Ask about those in your own words."
  };
  var UNSURE = { ru: "Не уверен, что понял вопрос. Ближе всего к нему вот это: ", en: "I am not sure I understood. The closest thing to your question is this: " };
  var ALSO = { ru: "Рядом по смыслу: ", en: "Also related: " };
  var GO = { ru: "Открыть раздел", en: "Open section" };
  var CHIPS = {
    ru: ["Что это за проект?", "Какие возможности?", "Как работает семейный режим?", "Чем он отличается?", "Кто основатель?"],
    en: ["What is this project?", "What can it do?", "How does family mode work?", "How is it different?", "Who is the founder?"]
  };
  var ai = $("ai"), log = $("ai-log"), chips = $("ai-chips"), form = $("ai-form"), input = $("ai-input");
  var hints = $("ai-hints"), hintBtn = $("ai-hint-toggle");

  function norm(s) { return String(s).toLowerCase().replace(/ё/g, "е"); }
  function tokens(s) { return norm(s).split(/[^a-zа-я0-9]+/).filter(Boolean); }
  function lev(a, b) {
    var m = a.length, n = b.length, i, j, prev = [], cur;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  /* how well one word of the visitor matches one key word (a stem): 0 = no, up to about 2 */
  function wordScore(tok, kw) {
    if (kw.length <= 3) return (tok === kw || (tok.indexOf(kw) === 0 && tok.length <= kw.length + 3)) ? 1 : 0;
    if (tok.indexOf(kw) === 0) return 1 + Math.min(kw.length, 8) / 8;
    if (kw.length >= 5 && tok.length >= 4 && Math.abs(tok.length - kw.length) <= 3) {
      var head = tok.slice(0, kw.length), d = lev(head, kw);
      if (d <= (kw.length >= 8 ? 2 : 1)) return 0.8;
    }
    return 0;
  }
  function concepts(q) {
    var text = " " + norm(q).replace(/[^a-zа-я0-9]+/g, " ") + " ", toks = tokens(q), act = {};
    Object.keys(KBD.concepts).forEach(function (name) {
      var sum = 0;
      KBD.concepts[name].forEach(function (kw) {
        kw = norm(kw);
        if (kw.indexOf(" ") >= 0) { if (text.indexOf(" " + kw) >= 0) sum += 2.5; return; }
        var best = 0;
        toks.forEach(function (t) { var w = wordScore(t, kw); if (w > best) best = w; });
        sum += best;
      });
      if (sum > 0) act[name] = Math.min(sum, 4);
    });
    return act;
  }
  function rank(q) {
    var act = concepts(q), out = [];
    KBD.facts.forEach(function (f) {
      var sc = 0;
      Object.keys(f.tags).forEach(function (t) { if (act[t]) sc += act[t] * f.tags[t]; });
      if (sc > 0) out.push({ f: f, s: sc });
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out;
  }
  function scriptOf(q) {
    var cy = (q.match(/[а-яё]/gi) || []).length, la = (q.match(/[a-z]/gi) || []).length;
    if (cy > la) return "ru";
    if (la > cy) return "en";
    return lang();
  }
  function reply(q) {
    var l = scriptOf(q), r = rank(q), top = r[0];
    if (!top) return { text: FALLBACK[l], go: null, l: l };
    var text = top.f[l], go = top.f.go;
    if (top.s < 1.5) text = UNSURE[l] + text;
    else if (r[1] && r[1].s >= top.s * 0.6 && r[1].s >= 1.5 && r[1].f.id !== top.f.id &&
             ["greet", "thanks", "help", "who_you"].indexOf(r[1].f.id) < 0 && ["greet", "thanks", "help", "who_you"].indexOf(top.f.id) < 0) {
      text += "\n\n" + ALSO[l] + r[1].f[l];
    }
    return { text: text, go: go, l: l };
  }
  function addMsg(text, who, go, l) {
    var m = document.createElement("div");
    m.className = "msg " + who;
    m.style.whiteSpace = "pre-line";
    m.textContent = text;
    if (go) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "go"; b.textContent = GO[l || lang()];
      b.addEventListener("click", function () {
        if (window.innerWidth <= 560) closeAi();
        goTo(go);
      });
      m.appendChild(document.createElement("br"));
      m.appendChild(b);
    }
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
  }
  function setHints(open) {
    if (!hints) return;
    hints.classList.toggle("closed", !open);
    hintBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function ask(q) {
    q = q.replace(/^\s+|\s+$/g, "");
    if (!q) return;
    addMsg(q, "me");
    setHints(false);
    var r = reply(q);
    window.setTimeout(function () { addMsg(r.text, "bot", r.go, r.l); }, 280);
  }
  function renderChips() {
    if (!chips) return;
    chips.textContent = "";
    CHIPS[lang()].forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = c;
      b.addEventListener("click", function () { ask(c); });
      chips.appendChild(b);
    });
    if (hintBtn) hintBtn.setAttribute("aria-label", lang() === "en" ? "Show or hide suggestions" : "Показать или скрыть подсказки");
  }
  if (hintBtn) hintBtn.addEventListener("click", function () { setHints(hintBtn.getAttribute("aria-expanded") !== "true"); });
  var greeted = false;
  function openAi() {
    closeMenu();
    ai.hidden = false;
    if (!greeted) {
      greeted = true;
      addMsg(lang() === "en"
        ? "Hello! I am the project assistant. Ask me about Comfortable life in your own words."
        : "Здравствуйте! Я ассистент проекта. Спросите меня о Comfortable life своими словами.", "bot");
    }
    window.setTimeout(function () { input.focus(); }, 50);
  }
  function closeAi() { ai.hidden = true; }
  Array.prototype.forEach.call(document.querySelectorAll("[data-ai-open]"), function (b) {
    b.addEventListener("click", function (e) { e.stopPropagation(); if (ai.hidden) openAi(); else closeAi(); });
  });
  $("ai-x").addEventListener("click", closeAi);
  form.addEventListener("submit", function (e) { e.preventDefault(); var v = input.value; input.value = ""; ask(v); });

  /* ---------- survey: sends to the owner's private table, nothing is shown back ---------- */
  var CFG = window.CL_CONFIG || {}, pollVote = null;
  var pStatus = $("poll-status"), pForm = $("poll-form"), pYes = $("poll-yes"), pNo = $("poll-no");
  var MSG = {
    thanks: { ru: "Спасибо! Ваш ответ отправлен.", en: "Thank you! Your answer was sent." },
    done: { ru: "Вы уже ответили на опрос. Спасибо!", en: "You have already answered the poll. Thank you!" },
    pick: { ru: "Сначала выберите «Да» или «Нет».", en: "Please choose Yes or No first." },
    off: { ru: "Приём ответов ещё не подключён. Попробуйте позже.", en: "Collecting answers is not connected yet. Please try later." },
    fail: { ru: "Не удалось отправить. Ответ сохранён и уйдёт при следующем визите.", en: "Could not send. Your answer is saved and will go out on your next visit." },
    ph: { ru: "Например: хочу видеть в приложении…", en: "For example: I would like the app to…" }
  };
  function uid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
    return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function setStatus(key, err) {
    if (!pStatus) return;
    pStatus.className = "poll-status" + (err ? " err" : "");
    pStatus.setAttribute("data-key", key || "");
    pStatus.textContent = key ? MSG[key][lang()] : "";
  }
  function post(payload) {
    var url = CFG.feedbackUrl;
    if (!url) return Promise.reject(new Error("off"));
    var body = JSON.stringify(payload), h = { "Content-Type": "text/plain;charset=utf-8" };
    return fetch(url, { method: "POST", headers: h, body: body, redirect: "follow" }).then(function (r) {
      if (!r.ok) throw new Error("http");
    }).catch(function (e) {
      if (e && e.message === "http") throw e;
      return fetch(url, { method: "POST", headers: h, body: body, mode: "no-cors" });
    });
  }
  function outbox(add) {
    var q = [];
    try { q = JSON.parse(lsGet("cl-outbox") || "[]"); } catch (_) { q = []; }
    if (add) q.push(add);
    lsSet("cl-outbox", JSON.stringify(q.slice(-20)));
    return q;
  }
  function send(payload) {
    return post(payload).then(function () { return true; }, function (e) {
      if (!e || e.message !== "off") outbox(payload);
      throw e;
    });
  }
  function flush() {
    if (!CFG.feedbackUrl) return;
    var q = outbox(null);
    if (!q.length) return;
    lsSet("cl-outbox", "[]");
    q.forEach(function (p) { post(p).catch(function () { outbox(p); }); });
  }
  function markVote(v) {
    pollVote = v;
    if (pYes) pYes.setAttribute("aria-pressed", v === "yes" ? "true" : "false");
    if (pNo) pNo.setAttribute("aria-pressed", v === "no" ? "true" : "false");
  }
  function lockPoll(doneKey) {
    pYes.disabled = pNo.disabled = true;
    $("poll-text").disabled = true; $("poll-send").disabled = true;
    setStatus(doneKey);
  }
  if (pYes && pNo && pForm) {
    /* choosing Yes / No only marks the button, nothing leaves the page until Send */
    pYes.addEventListener("click", function () { markVote("yes"); setStatus(""); });
    pNo.addEventListener("click", function () { markVote("no"); setStatus(""); });
    var prev = lsGet("cl-voted");
    if (prev === "yes" || prev === "no") { markVote(prev); lockPoll("done"); }
    pForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (lsGet("cl-voted")) { lockPoll("done"); return; }
      if ($("poll-hp").value) return;
      if (!pollVote) { setStatus("pick", true); return; }
      var txt = $("poll-text").value.replace(/^\s+|\s+$/g, "").slice(0, 1000);
      var btn = $("poll-send"); btn.disabled = true; pYes.disabled = pNo.disabled = true;
      var voteId = uid(), v = pollVote, l = lang(), ts = new Date().toISOString();
      send({ type: "vote", id: voteId, vote: v, lang: l, ts: ts }).then(function () {
        lsSet("cl-voted", v);
        lockPoll("thanks");
        if (txt) {
          send({ type: "wish", id: uid(), vote: v, text: txt, lang: l, ts: ts }).catch(function () {});
        }
      }, function (err) {
        setStatus(err && err.message === "off" ? "off" : "fail", true);
        btn.disabled = false; pYes.disabled = pNo.disabled = false;
      });
    });
    flush();
  }
  function pollTexts() {
    var t = $("poll-text"); if (t) t.placeholder = MSG.ph[lang()];
    if (pStatus && pStatus.getAttribute("data-key")) pStatus.textContent = MSG[pStatus.getAttribute("data-key")][lang()];
  }

  /* ---------- ferns ---------- */
  function fern(id, bend, tipx, n) {
    var svg = $(id), ns = "http://www.w3.org/2000/svg";
    var P0 = [150, 515], P1 = [bend, 270], P2 = [tipx, 28];
    var stem = document.createElementNS(ns, "path");
    stem.setAttribute("d", "M" + P0 + " Q" + P1 + " " + P2);
    stem.setAttribute("fill", "none"); stem.setAttribute("stroke", "currentColor");
    stem.setAttribute("stroke-width", "3"); stem.setAttribute("stroke-linecap", "round");
    svg.appendChild(stem);
    for (var i = 1; i <= n; i++) {
      var t = 0.1 + 0.88 * i / n, u = 1 - t;
      var x = u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0];
      var y = u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1];
      var tx = 2 * u * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]);
      var ty = 2 * u * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
      var a = Math.atan2(ty, tx);
      var len = (78 * Math.pow(u, 0.75) + 9) * Math.min(1, t * 5 + 0.45);
      [-1, 1].forEach(function (s) {
        var d = a + s * 1.05;
        var cx = x + Math.cos(d) * len / 2, cy = y + Math.sin(d) * len / 2;
        var el = document.createElementNS(ns, "ellipse");
        el.setAttribute("cx", cx.toFixed(1)); el.setAttribute("cy", cy.toFixed(1));
        el.setAttribute("rx", (len / 2).toFixed(1)); el.setAttribute("ry", (len * 0.13).toFixed(1));
        el.setAttribute("transform", "rotate(" + (d * 180 / Math.PI).toFixed(1) + " " + cx.toFixed(1) + " " + cy.toFixed(1) + ")");
        el.setAttribute("fill", "currentColor"); el.setAttribute("opacity", "0.9");
        svg.appendChild(el);
      });
    }
  }
  fern("fern-h1", 70, 205, 24);
  fern("fern-h2", 230, 90, 18);
  fern("fern-w1", 60, 215, 26);
  fern("fern-w2", 235, 80, 20);

  /* ---------- start ---------- */
  rRu.addEventListener("change", function () { applyLang("ru", true); });
  rEn.addEventListener("change", function () { applyLang("en", true); });
  applyLang(start, false);
  markActive();
  fitTitle();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle);
  window.addEventListener("load", fitTitle);
})();
