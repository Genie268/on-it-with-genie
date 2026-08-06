/* ============================================================
   miss.js — Miss handling (miss-gate, 3-day lock, re-entry)

   A "miss" is a challenge day whose midnight deadline passed with
   no upload. A "gap" is one unbroken run of consecutive missed days
   (an upload breaks a run).

   On dashboard load we find the trailing run of missed days sitting
   immediately before today and decide, in this exact order:
     1. admin clearance set  -> welcome back, consume once
     2. trailing run  >= 3   -> LOCK (blocks all upload + dashboard)
     3. trailing run  1 or 2 -> GATE (name it, then upload opens)
     4. otherwise            -> normal dashboard

   Every string here is Genie's voice, hardcoded. Lil says nothing.
   No AI generates any of this copy. No em dashes anywhere.
   ============================================================ */

/* ---------- local mirror of gap_notes (instant readback) ---------- */
function _gapNotesKey(){ return "oiwg_gap_notes_" + (S.user?.supabaseId || "anon"); }
function loadGapNotesLocal(){
  try{ const v = JSON.parse(localStorage.getItem(_gapNotesKey()) || "[]"); return Array.isArray(v) ? v : []; }
  catch(e){ return []; }
}
function saveGapNotesLocal(notes){
  try{ localStorage.setItem(_gapNotesKey(), JSON.stringify(notes || [])); }catch(e){}
}
function _missEsc(s){ return (typeof _esc === "function") ? _esc(s) : String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function _fmtGapDate(iso){
  try{ const d = iso ? new Date(iso) : new Date(); return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); }
  catch(e){ return ""; }
}
function _firstName(){ return ((S.user?.name || "").trim().split(/\s+/)[0]) || ""; }

/* Genie's phone for the lock screen. Set from the admin Settings tab and
   stored in app_settings; the config constant is only the last-resort
   fallback so the button is never dead. Mirrored to localStorage for an
   instant paint before the server responds. */
function _geniePhone(){
  const fromSettings = (S.appSettings && S.appSettings.genie_phone) ? String(S.appSettings.genie_phone).trim() : "";
  if(fromSettings) return fromSettings;
  let cached = "";
  try{ cached = (localStorage.getItem("oiwg_genie_phone") || "").trim(); }catch(e){}
  if(cached) return cached;
  return (typeof GENIE_PHONE !== "undefined") ? GENIE_PHONE : "";
}

/* ---------- gap math (works on the ACTIVE goal's upload array) ---------- */
function _activeStartDay(){
  return (typeof startDayFor === "function" && typeof activeSlot === "function")
    ? Math.max(1, startDayFor(activeSlot())) : 1;
}
/* Every unbroken run of missed days in [startDay, today-1]. A missed day is a
   past challenge day (deadline elapsed) with no upload. Today and future never
   count as missed. */
function computeGaps(){
  const start = _activeStartDay();
  const ups = S.uploads || [];
  const gaps = [];
  let cur = null;
  for(let d = start; d <= S.day - 1; d++){
    const missed = !ups[d - 1];
    if(missed){ if(!cur) cur = {start:d,end:d}; else cur.end = d; }
    else if(cur){ gaps.push(cur); cur = null; }
  }
  if(cur) gaps.push(cur);
  return gaps.map(g => ({start:g.start,end:g.end,length:g.end - g.start + 1}));
}
/* The run sitting immediately before today, or null if yesterday was uploaded. */
function trailingGap(gaps){
  const t = gaps[gaps.length - 1];
  return (t && t.end === S.day - 1) ? t : null;
}
/* A gap is resolved when a gap_note fully covers it (named, called, messaged,
   or admin cleared). Any source counts as forward motion; the tiles stay red. */
function _gapResolved(g){
  return (S.gapNotes || []).some(n => n.start_day <= g.start && n.end_day >= g.end);
}
function _noteForDay(day){
  const notes = (S.gapNotes || []).filter(n => n.start_day <= day && n.end_day >= day);
  return notes.length ? notes[notes.length - 1] : null;
}
function _gapLabel(g){ return g.start === g.end ? `Day ${g.start}` : `Days ${g.start} to ${g.end}`; }

/* ---------- write a gap_note (server + local mirror) ---------- */
function writeGapNote(g, note, source){
  const rec = {
    user_id: S.user?.supabaseId || null,
    goal_id: (typeof activeGoalRow === "function" && activeGoalRow()) ? activeGoalRow().id : null,
    start_day: g.start, end_day: g.end,
    note: note || null, source: source || "user_gate",
    created_at: new Date().toISOString()
  };
  if(!Array.isArray(S.gapNotes)) S.gapNotes = loadGapNotesLocal();
  S.gapNotes.push(rec);
  saveGapNotesLocal(S.gapNotes);
  if(typeof sb !== "undefined" && sb && rec.user_id){
    try{ sb.from("gap_notes").insert({
      user_id: rec.user_id, goal_id: rec.goal_id, start_day: rec.start_day,
      end_day: rec.end_day, note: rec.note, source: rec.source
    }).then(()=>{}).catch(()=>{}); }catch(e){}
  }
  return rec;
}

/* ============================================================
   ENTRY — called from renderDash() after calcDay()
   ============================================================ */
let _missServerLoaded = false;
function renderMissState(){
  const cont = el("miss-gate");
  S.uploadBlocked = false;
  _clearLockOverlay();
  if(!S.user || !Array.isArray(S.uploads)){ if(cont) cont.innerHTML = ""; return; }
  if(!Array.isArray(S.gapNotes)) S.gapNotes = loadGapNotesLocal();

  const gaps = computeGaps();
  const t = trailingGap(gaps);
  /* On the very first evaluation of a session we may not yet know whether Genie
     has cleared this person. To avoid flashing a LOCK over someone who was just
     cleared, hold the lock until the server answers. The gentle GATE can paint
     from cache immediately. */
  if(t && t.length >= 3 && !_gapResolved(t) && !_missServerLoaded && !S._adminCleared){
    S.uploadBlocked = true;
    if(cont) cont.innerHTML = "";
  }else{
    _evaluateMissState();
  }
  _refreshMissStateFromServer();
}

function _evaluateMissState(){
  const cont = el("miss-gate");
  if(cont) cont.innerHTML = "";
  _clearLockOverlay();
  S.uploadBlocked = false;

  /* 1. Admin clearance wins over everything. */
  if(S._adminCleared){ _renderWelcomeBack(); return; }

  const gaps = computeGaps();
  const t = trailingGap(gaps);

  /* 4. No trailing run, or it's already resolved -> normal dashboard. */
  if(!t || _gapResolved(t)){ if(typeof updateUpBtn === "function") updateUpBtn(); return; }

  if(t.length >= 3){ _renderLock(t); }
  else { _renderGate(gaps); }
  if(typeof updateUpBtn === "function") updateUpBtn();
}

/* Pull admin_cleared_at + gap_notes from the server, then re-evaluate. */
async function _refreshMissStateFromServer(){
  if(typeof sb === "undefined" || !sb || !S.user?.supabaseId){ _missServerLoaded = true; _evaluateMissState(); return; }
  try{
    const [{data: ch}, {data: notes}, {data: setting}] = await Promise.all([
      sb.from("challengers").select("admin_cleared_at").eq("id", S.user.supabaseId).single(),
      sb.from("gap_notes").select("*").eq("user_id", S.user.supabaseId),
      sb.from("app_settings").select("value").eq("key", "genie_phone").maybeSingle()
    ]);
    if(setting && typeof setting.value === "string"){
      if(!S.appSettings) S.appSettings = {};
      S.appSettings.genie_phone = setting.value;
      try{ localStorage.setItem("oiwg_genie_phone", setting.value); }catch(e){}
    }
    if(Array.isArray(notes)){
      const server = notes.map(n => ({
        start_day:n.start_day, end_day:n.end_day, note:n.note,
        source:n.source, goal_id:n.goal_id, created_at:n.created_at
      }));
      /* Merge, not overwrite: an optimistic note we just wrote (called /
         messaged / named) may not have committed before this read returns.
         Dropping it here would re-lock the person the instant they reached out.
         Keep any local note the server hasn't echoed yet. */
      const key = n => `${n.start_day}|${n.end_day}|${n.source}|${n.note || ""}`;
      const have = new Set(server.map(key));
      const localExtras = (S.gapNotes || []).filter(n => !have.has(key(n)));
      S.gapNotes = server.concat(localExtras);
      saveGapNotesLocal(S.gapNotes);
    }
    /* Once we've welcomed and consumed a clearance this session, never let a
       lagging read of admin_cleared_at (before the null-write commits) re-trigger
       the welcome-back. */
    S._adminCleared = !!(ch && ch.admin_cleared_at) && !S._reentryConsumed;
  }catch(e){ /* keep cached state */ }
  _missServerLoaded = true;
  _evaluateMissState();
}

/* ============================================================
   FEATURE 2 — MISS-GATE (trailing run of 1 or 2 days)
   ============================================================ */
function _renderGate(gaps){
  const cont = el("miss-gate");
  if(!cont) return;
  S.uploadBlocked = true;
  const unresolved = gaps.filter(g => !_gapResolved(g));
  if(!unresolved.length){ cont.innerHTML = ""; S.uploadBlocked = false; return; }

  const fields = unresolved.map((g, i) => `
    <div style="margin-bottom:14px">
      <p style="font-size:12px;font-weight:700;color:#c49a1c;letter-spacing:.03em;margin-bottom:6px">${_gapLabel(g)}</p>
      <p style="font-size:13px;color:#cfcfcf;margin-bottom:8px">What got in the way?</p>
      <input class="miss-gate-input" data-gi="${i}" type="text" maxlength="70" placeholder="just a line"
        oninput="_gateCheck()" style="width:100%;font-size:14px;padding:11px 12px">
    </div>`).join("");

  cont.innerHTML = `
    <div class="card mb10" style="border:1px solid rgba(196,154,28,.22);background:rgba(196,154,28,.04);padding:16px">
      <p style="font-size:14px;line-height:1.6;color:#e8e8e8;margin-bottom:16px">You'll forget why you missed these. Name them now while it's fresh, so the pattern is still readable when you come back.</p>
      ${fields}
      <button id="miss-gate-btn" class="bp" style="width:100%;font-size:14px;padding:12px" disabled onclick="_submitGate()">Continue to today's upload</button>
    </div>`;
  /* Stash the gaps this gate is naming, in render order, for submit. */
  S._gateGaps = unresolved;
  _gateCheck();
}

function _gateCheck(){
  const inputs = Array.from(document.querySelectorAll(".miss-gate-input"));
  const allFilled = inputs.length > 0 && inputs.every(i => i.value.trim().length > 0);
  const btn = el("miss-gate-btn");
  if(btn) btn.disabled = !allFilled;
}

function _submitGate(){
  const inputs = Array.from(document.querySelectorAll(".miss-gate-input"));
  const gaps = S._gateGaps || [];
  if(!inputs.length || inputs.some(i => !i.value.trim())) return;
  inputs.forEach(inp => {
    const gi = parseInt(inp.getAttribute("data-gi"), 10);
    const g = gaps[gi];
    if(g){
      writeGapNote(g, inp.value.trim().slice(0, 70), "user_gate");
      if(typeof trackEvent === "function") trackEvent("gap_explained", {start_day:g.start, end_day:g.end, length:g.length, source:"user_gate"});
    }
  });
  S._gateGaps = null;
  S.uploadBlocked = false;
  const cont = el("miss-gate"); if(cont) cont.innerHTML = "";
  if(typeof updateUpBtn === "function") updateUpBtn();
  /* Naming never marks a missed day complete. It only opens forward motion. */
  if(typeof openMod === "function") openMod();
}

/* ============================================================
   FEATURE 3 — 3-DAY LOCK (trailing run >= 3). An invitation, not a punishment.
   ============================================================ */
function _renderLock(g){
  S.uploadBlocked = true;
  _clearLockOverlay();
  const N = g.length;
  const heart = `<svg width="34" height="34" viewBox="0 0 24 24" fill="#c49a1c" stroke="none" style="display:block;margin:0 auto"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;

  /* Tone band: 3 to 6 keeps the live number; 7+ drops it entirely. */
  const bodyTop = (N >= 7)
    ? `It's been a while. You haven't lost your place here. Let's just talk and pick it back up.`
    : `You've been away ${N} days. That's a conversation, not a form.`;
  const bodyBottom = `Reach me and the platform opens back up. Coming back never counts against you here.`;

  const phone = _geniePhone();
  const starters = (typeof MISS_STARTERS !== "undefined") ? MISS_STARTERS : [];
  const starterBtns = starters.map((s, i) =>
    `<button class="miss-starter" onclick="_lockMessageStart(${i})" style="display:block;width:100%;text-align:left;background:#141414;border:1px solid #262626;color:#dcdcdc;font-size:13px;line-height:1.5;padding:12px 14px;border-radius:10px;margin-bottom:8px;cursor:pointer;font-family:inherit">${_missEsc(s)}</button>`
  ).join("");

  const alreadySpoke = S._adminCleared
    ? `<p style="text-align:center;margin-top:8px"><a href="#" onclick="_lockAlreadySpoke();return false" style="font-size:12px;color:#6a6a6a;text-decoration:underline">Already spoke to Genie about it</a></p>`
    : "";

  const ov = document.createElement("div");
  ov.id = "miss-lock-overlay";
  ov.style.cssText = "position:fixed;inset:0;z-index:1200;background:#0a0a0a;overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:40px 20px";
  ov.innerHTML = `
    <div style="max-width:440px;width:100%;margin:auto 0">
      <div style="margin-bottom:14px">${heart}</div>
      <p style="text-align:center;font-size:11px;font-weight:800;letter-spacing:.14em;color:#c49a1c;margin-bottom:20px">LET'S TALK FIRST</p>
      <p style="font-size:16px;line-height:1.65;color:#f0f0f0;text-align:center;margin-bottom:12px">${_missEsc(bodyTop)}</p>
      <p style="font-size:14px;line-height:1.65;color:#b8b8b8;text-align:center;margin-bottom:26px">${_missEsc(bodyBottom)}</p>

      <a id="miss-call-link" href="tel:${_missEsc(phone)}" onclick="_lockCall()" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#c49a1c;color:#000;padding:14px;border-radius:11px;font-size:15px;font-weight:800;text-decoration:none;margin-bottom:10px">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="#000" stroke="none"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
        Call now
      </a>
      <p style="text-align:center;font-size:12px;color:#7a7a7a;margin-bottom:24px">${_missEsc(phone)}</p>

      <p style="font-size:14px;font-weight:700;color:#e0e0e0;margin-bottom:4px">Send a message</p>
      <p style="font-size:12px;color:#7a7a7a;margin-bottom:12px">Tap one to send. Edit it if you want.</p>
      <div id="miss-starters">${starterBtns}</div>
      ${alreadySpoke}
    </div>`;
  document.body.appendChild(ov);
  S._lockGap = g;
}

function _clearLockOverlay(){
  const ov = document.getElementById("miss-lock-overlay");
  if(ov) ov.remove();
}

/* Option A — tapping Call opens the platform for this return. The tel: link
   still fires; we log, resolve the run, and let the dashboard back in. */
function _lockCall(){
  const g = S._lockGap;
  if(g){
    if(typeof trackEvent === "function") trackEvent("lock_contact_called", {start_day:g.start, end_day:g.end, length:g.length});
    if(!_gapResolved(g)) writeGapNote(g, "Called Genie", "called");
  }
  _unlockAfterContact();
}

/* Option B — a starter becomes an editable message the user can send. */
function _lockMessageStart(i){
  const starters = (typeof MISS_STARTERS !== "undefined") ? MISS_STARTERS : [];
  const text = starters[i] || "";
  const box = document.getElementById("miss-starters");
  if(!box) return;
  box.innerHTML = `
    <textarea id="miss-msg-input" rows="3" style="width:100%;font-size:14px;padding:12px;line-height:1.5;margin-bottom:10px">${_missEsc(text)}</textarea>
    <div style="display:flex;gap:8px">
      <button class="bs" style="flex:1;font-size:13px;padding:11px" onclick="_lockMessageCancel()">Back</button>
      <button class="bp" style="flex:2;font-size:14px;padding:11px" onclick="_lockMessageSend()">Send to Genie</button>
    </div>`;
  const ta = document.getElementById("miss-msg-input");
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function _lockMessageCancel(){
  const g = S._lockGap;
  if(g) _renderLock(g);
}

function _lockMessageSend(){
  const ta = document.getElementById("miss-msg-input");
  const text = (ta?.value || "").trim();
  if(!text) return;
  const g = S._lockGap;
  /* Deliver to Genie (admin side) as a challenger chat message. */
  if(typeof sb !== "undefined" && sb && S.user?.supabaseId){
    try{ sb.from("chat_messages").insert({challenger_id:S.user.supabaseId, sender:"challenger", message:text}).then(()=>{}).catch(()=>{}); }catch(e){}
  }
  if(g){
    if(typeof trackEvent === "function") trackEvent("lock_contact_messaged", {start_day:g.start, end_day:g.end, length:g.length});
    if(!_gapResolved(g)) writeGapNote(g, text, "messaged");
  }
  if(typeof showToast === "function") showToast("Sent to Genie. Welcome back.", "success");
  _unlockAfterContact();
}

/* Option C — only present when Genie has already cleared this person. */
function _lockAlreadySpoke(){
  const g = S._lockGap;
  if(g && !_gapResolved(g)) writeGapNote(g, "Cleared by Genie", "admin_cleared");
  _consumeAdminClearance();
  _unlockAfterContact();
}

function _unlockAfterContact(){
  S.uploadBlocked = false;
  S._lockGap = null;
  _clearLockOverlay();
  if(typeof renderDash === "function") renderDash();
}

/* ============================================================
   FEATURE 4 — ADMIN-CLEARED RE-ENTRY (welcome back, consumed once)
   ============================================================ */
function _renderWelcomeBack(){
  const cont = el("miss-gate");
  S.uploadBlocked = false;
  const name = _firstName();
  const line = name ? `Good to have you back, ${name}.` : `Good to have you back.`;
  if(cont){
    cont.innerHTML = `
      <div class="card mb10" style="border:1px solid rgba(77,201,138,.25);background:rgba(77,201,138,.05);padding:16px;text-align:center">
        <p style="font-size:16px;font-weight:800;color:#f0f0f0">${_missEsc(line)}</p>
      </div>`;
  }
  if(typeof trackEvent === "function") trackEvent("reentry_welcomed", {});
  _consumeAdminClearance();
  if(typeof updateUpBtn === "function") updateUpBtn();
}

/* Consume the clearance exactly once: flip admin_cleared_at back to null and,
   if a trailing run is still unnamed, auto-write a readable note for it. */
function _consumeAdminClearance(){
  if(!S._adminCleared) return;
  S._adminCleared = false;
  S._reentryConsumed = true;
  const gaps = computeGaps();
  const t = trailingGap(gaps);
  if(t && !_gapResolved(t)) writeGapNote(t, "Cleared by Genie", "admin_cleared");
  if(typeof sb !== "undefined" && sb && S.user?.supabaseId){
    try{ sb.from("challengers").update({admin_cleared_at:null}).eq("id", S.user.supabaseId).then(()=>{}).catch(()=>{}); }catch(e){}
  }
}

/* ============================================================
   READBACK — tapping a red (missed) tile shows its note + date
   ============================================================ */
function _showGapNote(day){
  if(!Array.isArray(S.gapNotes)) S.gapNotes = loadGapNotesLocal();
  const n = _noteForDay(day);
  const dl = el("view-mod-dl"), body = el("view-mod-body"), actions = el("view-mod-actions");
  if(!dl || !body || !actions) return;
  dl.textContent = `DAY ${day} · MISSED`;
  if(n && (n.note || n.source)){
    const when = _fmtGapDate(n.created_at);
    body.innerHTML = `
      <div style="padding:6px 0">
        <span class="lbl lbl-e" style="display:block;margin-bottom:8px">WHAT GOT IN THE WAY</span>
        <p style="font-size:15px;line-height:1.6;color:#e8e8e8;margin-bottom:10px">${_missEsc(n.note || "")}</p>
        ${when ? `<p style="font-size:11px;color:#6a6a6a">Named ${_missEsc(when)}</p>` : ""}
      </div>`;
  }else{
    body.innerHTML = `<div style="padding:6px 0"><p style="font-size:14px;line-height:1.6;color:#9a9a9a">This day is still unnamed.</p></div>`;
  }
  actions.innerHTML = `<button class="bs" style="width:100%;padding:10px;font-size:13px" onclick="closeViewMod()">Close</button>`;
  el("view-mod").classList.add("show");
}
