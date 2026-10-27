"use strict";
const REPO = "i-inose/english-notebook";
const LS_KEY = "en-notebook-v1";
const SET_KEY = "en-notebook-settings";
const GRAMMAR_PER_SESSION = 10;

let W, G, D; // words.json, grammar.json, data.json
let tab = "today";

// ---------- 小さな道具 ----------
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
const today = () => new Date().toLocaleDateString("sv-SE");
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function readLS(key, dflt) { try { return JSON.parse(localStorage.getItem(key)) ?? dflt; } catch { return dflt; } }
function writeLS(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

// ---------- 端末に残す記録（Mac で取り込むまで） ----------
let local = readLS(LS_KEY, { batches: [] });
function saveLocal() { writeLS(LS_KEY, local); }
function curBatch() {
  let b = local.batches.find((x) => !x.sent);
  if (!b) { b = { batch: "b" + Date.now(), reviews: [], grammar: [], addWords: [], sent: false }; local.batches.push(b); }
  return b;
}
function pendingIds() {
  const s = new Set();
  for (const b of local.batches) { b.reviews.forEach((x) => s.add(x.id)); b.grammar.forEach((x) => s.add(x.id)); }
  return s;
}
function pendingAddWords() { return new Set(local.batches.flatMap((b) => b.addWords)); }

// ---------- 音声 ----------
const settings = readLS(SET_KEY, { rate: 0.9 });
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").startsWith("en-US"));
  voice = vs.find((v) => /premium|enhanced/i.test(v.name)) || vs.find((v) => /Samantha|Ava|Allison|Zoe/.test(v.name)) || vs[0] || null;
}
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text, rate) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US"; if (voice) u.voice = voice; u.rate = rate || settings.rate;
    speechSynthesis.speak(u);
  } catch {}
}
const speakBtn = (text, label = "🔊", cls = "speak") => el("button", { class: cls, type: "button", text: label, on: { click: () => speak(text) } });

// 英文の各語をタップできるようにする（音声＋単語帳の候補に追加）
function tappable(sentence) {
  const known = new Set(W.words.map((w) => w.word.toLowerCase()));
  const box = el("div", { class: "q" });
  for (const part of sentence.split(/(\s+)/)) {
    const word = part.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "").toLowerCase();
    if (!word) { box.append(part); continue; }
    const span = el("span", { class: "tw", text: part });
    if (pendingAddWords().has(word)) span.classList.add("added");
    span.addEventListener("click", () => {
      speak(word, 0.8);
      if (known.has(word)) return;
      const b = curBatch();
      const i = b.addWords.indexOf(word);
      if (i >= 0) { b.addWords.splice(i, 1); span.classList.remove("added"); }
      else { b.addWords.push(word); span.classList.add("added"); }
      saveLocal();
    });
    box.append(span);
  }
  return el("div", {}, box, el("p", { class: "muted", text: "語をタップすると発音が流れ、単語帳の候補に入ります（もう一度タップで外す）" }));
}

// ---------- 今日やること ----------
function wordQueues() {
  const t = today(), pend = pendingIds();
  const due = W.words.filter((w) => D.cards[w.id] && D.cards[w.id].due <= t && !pend.has(w.id));
  const doneNewToday = Object.values(D.cards).filter((c) => c.first === t).length +
    local.batches.flatMap((b) => b.reviews).filter((x) => x.isNew && x.date === t).length;
  const allDue = Object.values(D.cards).filter((c) => c.due <= t).length;
  const room = allDue > D.plan.reviewCap ? 0 : Math.max(0, D.plan.newPerDay - doneNewToday);
  const fresh = W.words.filter((w) => !D.cards[w.id] && !pend.has(w.id)).slice(0, room);
  return { due: shuffle(due), fresh };
}
function currentUnit() {
  for (const u of G.units) {
    const days = (D.units[u.id] || {}).days || {};
    const passed = Object.values(days).filter((v) => v.n >= 5 && v.ok / v.n >= 0.8).length;
    if (passed < 2) return u;
  }
  return null;
}
function grammarQueue() {
  const t = today(), pend = pendingIds();
  const all = G.units.flatMap((u) => u.questions.map((q) => ({ ...q, unit: u })));
  const due = shuffle(all.filter((q) => D.cards[q.id] && D.cards[q.id].due <= t && !pend.has(q.id)));
  const u = currentUnit();
  const fresh = u ? u.questions.filter((q) => !D.cards[q.id] && !pend.has(q.id)).map((q) => ({ ...q, unit: u })) : [];
  const list = due.slice(0, 4).concat(fresh).concat(due.slice(4)).slice(0, GRAMMAR_PER_SESSION);
  const firstTime = u && !u.questions.some((q) => D.cards[q.id] || pend.has(q.id));
  return { list: shuffle(list), unit: u, firstTime };
}

function renderToday() {
  const app = document.getElementById("app");
  const wq = wordQueues(), gq = grammarQueue();
  const b = local.batches.filter((x) => !D.imported.includes(x.batch));
  const unsent = b.filter((x) => !x.sent).reduce((n, x) => n + x.reviews.length + x.grammar.length, 0);
  app.replaceChildren(
    el("h1", { text: "今日の英語" }),
    el("div", { class: "card" },
      el("h2", { text: "単語" }),
      el("p", { text: `復習 ${wq.due.length} 枚・新しい語 ${wq.fresh.length} 語` }),
      el("p", { class: "muted", text: "音声を聞いて意味を思い出す練習です。" }),
      el("button", { class: "btn", disabled: !(wq.due.length + wq.fresh.length), text: "単語を始める", on: { click: () => startWords(wq) } })),
    el("div", { class: "card" },
      el("h2", { text: "文法" }),
      el("p", { text: gq.unit ? `今の単元: ${gq.unit.title}` : "6単元すべて合格しました" }),
      el("p", { class: "muted", text: `${gq.list.length} 問。${gq.firstTime ? "初めての単元なので、2問解いてから解説を読みます。" : "間違えた問題は日を空けて出し直します。"}` }),
      el("button", { class: "btn", disabled: !gq.list.length, text: "文法を始める", on: { click: () => startGrammar(gq) } }),
      gq.unit ? el("button", { class: "btn secondary", text: "この単元の解説を読む", on: { click: () => showLesson(gq.unit, renderToday) } }) : null),
    unsent ? el("div", { class: "card" },
      el("p", { text: `まだ送っていない記録が ${unsent} 件あります。` }),
      el("button", { class: "btn secondary", text: "結果を送る画面へ", on: { click: () => go("send") } })) : "",
  );
}

function showLesson(u, back) {
  document.getElementById("app").replaceChildren(
    el("h1", { text: u.title }),
    el("div", { class: "card pre", text: u.lesson }),
    el("button", { class: "btn", text: "戻る", on: { click: back } }));
  scrollTo(0, 0);
}

// ---------- 単語 ----------
function startWords(wq) {
  const items = wq.due.map((w) => ({ w, isNew: false })).concat(wq.fresh.map((w) => ({ w, isNew: true })));
  let i = 0, ok = 0;
  const next = () => {
    if (i >= items.length) return finish("単語", ok, items.length);
    const { w, isNew } = items[i];
    const app = document.getElementById("app");
    const head = el("div", {}, el("p", { class: "muted", text: `単語 ${i + 1}/${items.length}${isNew ? "・新しい語" : "・復習"}` }),
      el("div", { class: "bar" }, el("i", { style: `width:${(i / items.length) * 100}%` })));
    const record = (r) => {
      curBatch().reviews.push({ id: w.id, r, date: today(), isNew }); saveLocal();
      if (r >= 3) ok++;
    };
    const showBack = (afterRate) => {
      const back = el("div", { class: "card" },
        el("div", { class: "row" }, el("div", { class: "big", text: w.word }), el("div", { style: "flex:0" }, speakBtn(w.word))),
        el("p", { class: "muted", text: w.pos }), el("p", { text: w.ja }),
        ...w.ex.map((e) => el("div", { class: "ex" }, el("div", {}, e.en, " ", speakBtn(e.en)), el("div", { class: "muted", text: e.ja }))));
      const btns = afterRate
        ? el("button", { class: "btn", text: "次へ", on: { click: () => { i++; next(); } } })
        : el("div", { class: "row" },
          el("button", { class: "btn secondary", text: "忘れた", on: { click: () => { record(1); i++; next(); } } }),
          el("button", { class: "btn", text: "覚えてた", on: { click: () => { record(3); i++; next(); } } }));
      app.replaceChildren(head, back, btns);
    };
    const front = el("div", { class: "card" },
      el("p", { class: "muted", text: "音声を聞いて、意味を思い出してください。" }),
      speakBtn(w.word, "🔊 もう一度聞く", "speak large"));
    if (isNew) {
      const others = shuffle(W.words.filter((x) => x.id !== w.id && x.pos === w.pos)).slice(0, 3);
      const opts = shuffle([w, ...(others.length === 3 ? others : shuffle(W.words.filter((x) => x.id !== w.id)).slice(0, 3))]);
      const box = el("div", {});
      for (const o of opts) box.append(el("button", { class: "choice", text: o.ja, on: { click: () => { record(o.id === w.id ? 3 : 1); showBack(true); } } }));
      box.append(el("button", { class: "choice", text: "分からない", on: { click: () => { record(1); showBack(true); } } }));
      front.append(box);
      app.replaceChildren(head, front);
    } else {
      const spell = el("button", { class: "btn secondary", text: "つづりを見る" });
      spell.addEventListener("click", () => { spell.replaceWith(el("div", { class: "big", text: w.word })); });
      app.replaceChildren(head, front, spell, el("button", { class: "btn", text: "答えを見る", on: { click: () => showBack(false) } }));
    }
    speak(w.word);
    scrollTo(0, 0);
  };
  next();
}

// ---------- 文法 ----------
function startGrammar(gq) {
  const list = gq.list;
  let i = 0, ok = 0, lessonShown = !gq.firstTime;
  const next = () => {
    if (!lessonShown && i === 2) { lessonShown = true; return showLesson(gq.unit, next); }
    if (i >= list.length) return finish("文法", ok, list.length);
    const q = list[i];
    const app = document.getElementById("app");
    const choices = shuffle([q.a, ...q.d]);
    let picked = null;
    const box = el("div", {});
    const conf = el("div", { class: "row", hidden: true },
      el("button", { class: "btn secondary", text: "△ 勘", on: { click: () => answer("low") } }),
      el("button", { class: "btn", text: "◎ 自信あり", on: { click: () => answer("high") } }));
    const btns = choices.map((c) => el("button", { class: "choice", text: c, on: { click: () => {
      picked = c; btns.forEach((b) => b.classList.toggle("sel", b.textContent === c)); conf.hidden = false;
    } } }));
    btns.forEach((b) => box.append(b));
    const answer = (cf) => {
      const right = picked === q.a;
      if (right) ok++;
      curBatch().grammar.push({ id: q.id, ok: right, conf: cf, choice: picked, date: today() }); saveLocal();
      btns.forEach((b) => { b.disabled = true; if (b.textContent === q.a) b.classList.add("ok"); else if (b.textContent === picked) b.classList.add("ng"); });
      conf.remove();
      const full = q.q.replace("___", q.a);
      const fb = el("div", { class: "card" },
        el("p", { class: right ? "ok-t" : "ng-t", text: right ? (cf === "high" ? "正解です" : "正解です（勘なので、日を空けてもう一度出します）") : `不正解です。正解は「${q.a}」` }),
        !right && cf === "high" ? el("p", { text: "自信ありで間違えた問題は、訂正すると記憶に残りやすいです。理由をしっかり読んでおきましょう。" }) : null,
        tappable(full), speakBtn(full, "🔊 文を聞く"),
        el("p", { class: "muted", text: q.ja }),
        el("p", { text: q.why }),
        el("div", { class: "pre muted", text: q.contrast }));
      app.append(fb, el("button", { class: "btn", text: "次へ", on: { click: () => { i++; next(); } } }));
    };
    app.replaceChildren(
      el("p", { class: "muted", text: `文法 ${i + 1}/${list.length}・${q.unit.title}` }),
      el("div", { class: "bar" }, el("i", { style: `width:${(i / list.length) * 100}%` })),
      el("div", { class: "card" }, el("p", { class: "q", text: q.q }), box, conf));
    scrollTo(0, 0);
  };
  next();
}

function finish(kind, ok, n) {
  document.getElementById("app").replaceChildren(
    el("h1", { text: `${kind}おわり` }),
    el("div", { class: "card" }, el("p", { class: "big", text: `${ok} / ${n}` }),
      el("p", { class: "muted", text: "記録はこの端末に保存しました。区切りのよいところで「送る」から GitHub に送ってください。" })),
    el("button", { class: "btn", text: "今日の画面へ", on: { click: () => go("today") } }),
    el("button", { class: "btn secondary", text: "結果を送る", on: { click: () => go("send") } }));
  scrollTo(0, 0);
}

// ---------- 送る ----------
function renderSend() {
  const app = document.getElementById("app");
  const b = local.batches.find((x) => !x.sent);
  const waiting = local.batches.filter((x) => x.sent && !D.imported.includes(x.batch));
  const kids = [el("h1", { text: "結果を送る" })];
  if (b && (b.reviews.length || b.grammar.length || b.addWords.length)) {
    const ok = b.grammar.filter((x) => x.ok).length;
    const payload = { batch: b.batch, date: today(), reviews: b.reviews.map(({ id, r, date }) => ({ id, r, date })), grammar: b.grammar, addWords: b.addWords };
    const body = "スマホの学習結果です。Mac で Claude に「英語の結果を取り込んで」と頼むと反映されます。\n\n```json\n" + JSON.stringify(payload) + "\n```\n";
    const title = `[study-result] ${today()} 単語${b.reviews.length} 文法${ok}/${b.grammar.length}`;
    const url = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    const area = el("textarea", { readonly: true, hidden: true }); area.value = body;
    kids.push(el("div", { class: "card" },
      el("p", { text: `単語 ${b.reviews.length} 枚・文法 ${b.grammar.length} 問・単語帳の候補 ${b.addWords.length} 語` }),
      el("a", { class: "btn", href: url, target: "_blank", rel: "noopener", text: "GitHub に Issue として送る", on: { click: () => { b.sent = true; saveLocal(); setTimeout(renderSend, 300); } } }),
      el("button", { class: "btn secondary", text: "うまく開かないときは本文をコピー", on: { click: () => { area.hidden = false; area.select(); navigator.clipboard && navigator.clipboard.writeText(body); } } }),
      area));
  } else kids.push(el("p", { class: "muted", text: "まだ送っていない記録はありません。" }));
  if (waiting.length) kids.push(el("div", { class: "card" },
    el("p", { text: `送ったあと、Mac での取り込み待ちが ${waiting.length} 件あります。` }),
    el("p", { class: "muted", text: "取り込まれるまで、その問題はこの端末では出しません。" }),
    el("button", { class: "btn secondary", text: "送れていなかったので未送信に戻す", on: { click: () => { waiting.forEach((x) => (x.sent = false)); mergeUnsent(); saveLocal(); renderSend(); } } })));
  const rate = el("select", { on: { change: (e) => { settings.rate = Number(e.target.value); writeLS(SET_KEY, settings); speak("This is the reading speed.") } } },
    ...[0.75, 0.9, 1.0, 1.1, 1.25].map((r) => el("option", { value: r, selected: r === settings.rate, text: `${r} 倍` })));
  kids.push(el("h2", { text: "設定" }), el("div", { class: "card" }, el("p", {}, "読み上げの速さ ", rate),
    el("p", { class: "muted", text: `声: ${voice ? voice.name : "端末の既定"}` })));
  const s = D.sessions.slice(-5).reverse();
  if (s.length) kids.push(el("h2", { text: "最近の記録（取り込み済み）" }),
    el("div", { class: "card" }, ...s.map((x) => el("p", { text: `${x.date}  単語 ${x.wordsOk}/${x.words}  文法 ${x.grammarOk}/${x.grammar}` }))));
  app.replaceChildren(...kids);
}
function mergeUnsent() {
  const un = local.batches.filter((x) => !x.sent);
  if (un.length < 2) return;
  const [first, ...rest] = un;
  for (const r of rest) { first.reviews.push(...r.reviews); first.grammar.push(...r.grammar); first.addWords.push(...r.addWords); }
  local.batches = local.batches.filter((x) => !rest.includes(x));
}

// ---------- 画面の切り替え ----------
function go(t) {
  tab = t;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  (t === "today" ? renderToday : renderSend)();
  scrollTo(0, 0);
}

async function boot() {
  try {
    const bust = "?" + Date.now();
    [W, G, D] = await Promise.all(["words.json", "grammar.json", "data.json"].map((f) => fetch(f + bust).then((r) => { if (!r.ok) throw new Error(f); return r.json(); })));
  } catch (e) {
    document.getElementById("app").replaceChildren(el("p", { text: "データを読み込めませんでした: " + e.message }));
    return;
  }
  local.batches = local.batches.filter((x) => !D.imported.includes(x.batch));
  saveLocal();
  document.getElementById("nav").replaceChildren(
    el("button", { "data-t": "today", text: "今日", on: { click: () => go("today") } }),
    el("button", { "data-t": "send", text: "送る・設定", on: { click: () => go("send") } }));
  go("today");
}
boot();
