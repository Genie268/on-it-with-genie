/* ============================================================
   miss.js — Miss handling (miss-gate, frozen lock, coach re-entry)

   A "miss" is a challenge day whose midnight deadline passed with no
   upload. Because uploads are gated, the only unexplained gap that can
   exist is the TRAILING RUN: the consecutive missed days immediately
   before today. N is its length.

   State on load, in this order:
     1. coach clearance set (cleared_at) -> welcome banner, consume once
     2. N is 0                           -> normal dashboard
     3. N below GATE_THRESHOLD (noise)   -> normal, tile stays red
     4. N in [GATE_THRESHOLD, 2]         -> inline GATE above the upload
     5. N is 3 or more                   -> full-screen FROZEN LOCK

   Two invariants:
     - The miss costs something small and permanent: missed days stay red
       forever. Nothing here repaints a missed day.
     - The return never costs shame: no recap, no day count, no chasing.

   Coach identity (name, first name, phone, initial) is read from the
   member's assigned coach record, never hardcoded. Every string here is
   hardcoded copy. No AI generates any of it. No em dashes.
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

/* ---------- assigned coach (data-driven identity) ---------- */
function loadCoachLocal(){
  try{ const c = JSON.parse(localStorage.getItem("oiwg_coach") || "null"); return (c && typeof c === "object") ? c : null; }
  catch(e){ return null; }
}
function saveCoachLocal(c){ try{ localStorage.setItem("oiwg_coach", JSON.stringify(c || {})); }catch(e){} }
function _coach(){
  const c = S.coach || loadCoachLocal() || {};
  const name = c.name || "";
  return {
    name,
    first_name: c.first_name || (name ? name.split(/\s+/)[0] : ""),
    phone: c.phone || "",
    initial: (name.trim().charAt(0) || "").toUpperCase()
  };
}
function _coachPhone(){
  const p = _coach().phone;
  if(p) return p;
  return (typeof GENIE_PHONE !== "undefined") ? GENIE_PHONE : "";
}

/* ---------- trailing-run math (on the ACTIVE goal's upload array) ---------- */
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
/* The one run sitting immediately before today, or null if yesterday was
   uploaded. This is the only gap the system ever acts on. */
function trailingGap(gaps){
  const t = gaps[gaps.length - 1];
  return (t && t.end === S.day - 1) ? t : null;
}
/* A run is resolved when a gap_note covers it (named or messaged), or when the
   return has been opened this session (a call, a sent message, or a coach
   clearance). S._runResolved also rehydrates from a contact_made logged today,
   so a call survives a same-day reload. Resolution never repaints a tile; it
   only opens forward motion. */
function _gapNoteCovers(g){
  return (S.gapNotes || []).some(n => n.start_day <= g.start && n.end_day >= g.end);
}
function _trailingResolved(g){
  return _gapNoteCovers(g) || !!S._runResolved;
}
function _noteForDay(day){
  const notes = (S.gapNotes || []).filter(n => n.start_day <= day && n.end_day >= day && n.note);
  return notes.length ? notes[notes.length - 1] : null;
}
function _gapLabel(g){ return g.start === g.end ? `Day ${g.start}` : `Days ${g.start} to ${g.end}`; }

/* ---------- write a gap_note (server + local mirror) ---------- */
/* Only two sources ever reach here: user_gate (named at the gate) and
   messaged (the text the member sent). Call-resolved and clearance-resolved
   runs are deliberately left with no note. */
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
  /* QA preview mode owns the miss screens and never touches the DB. Delete
     this line when removing js/miss-preview.js. */
  if(typeof MISS_PREVIEW !== "undefined" && MISS_PREVIEW.active()){ MISS_PREVIEW.render(); return; }
  const cont = el("miss-gate");
  S.uploadBlocked = false;
  _clearLockOverlay();
  if(!S.user || !Array.isArray(S.uploads)){ if(cont) cont.innerHTML = ""; return; }
  if(!Array.isArray(S.gapNotes)) S.gapNotes = loadGapNotesLocal();
  if(!S.coach){ const c = loadCoachLocal(); if(c) S.coach = c; }

  const t = trailingGap(computeGaps());
  /* On the first evaluation of a session we do not yet know whether the coach
     has cleared this member, or whether they already reached out today. Hold
     the lock until the server answers, so we never flash a lock at someone who
     is already back. The gentle gate can paint from cache immediately. */
  if(t && t.length >= 3 && !_trailingResolved(t) && !_missServerLoaded && !S._cleared){
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

  /* 1. Coach clearance wins over everything. */
  if(S._cleared){ _renderWelcomeBanner(); return; }

  const t = trailingGap(computeGaps());
  const N = t ? t.length : 0;

  /* 2/3. No run, resolved run, or a run below the gate threshold (noise) ->
     normal dashboard. The missed tile stays red and unexplained. */
  if(!t || _trailingResolved(t) || N < GATE_THRESHOLD){
    if(typeof updateUpBtn === "function") updateUpBtn();
    return;
  }

  if(N >= 3){ _renderLock(t); }        /* 5. frozen lock */
  else { _renderGate(t); }             /* 4. inline gate, N in [threshold,2] */
  if(typeof updateUpBtn === "function") updateUpBtn();
}

/* Pull coach + clearance + gap_notes + today's contact, then re-evaluate. */
async function _refreshMissStateFromServer(){
  const uid = S.user?.supabaseId;
  if(typeof sb === "undefined" || !sb || !uid){ _missServerLoaded = true; _evaluateMissState(); return; }
  try{
    const midnight = new Date(); midnight.setHours(0,0,0,0);
    const [chRes, notesRes, contactRes] = await Promise.all([
      sb.from("challengers").select("cleared_at, coach:coaches(name,first_name,phone)").eq("id", uid).single(),
      sb.from("gap_notes").select("*").eq("user_id", uid),
      sb.from("analytics_events").select("created_at").eq("event_type","contact_made")
        .eq("event_data->>challenger_id", uid).order("created_at",{ascending:false}).limit(1)
    ]);
    const ch = chRes.data, notes = notesRes.data, contact = contactRes.data;

    if(ch && ch.coach){
      S.coach = { name:ch.coach.name || "", first_name:ch.coach.first_name || "", phone:ch.coach.phone || "" };
      saveCoachLocal(S.coach);
    }
    if(Array.isArray(notes)){
      const server = notes.map(n => ({
        start_day:n.start_day, end_day:n.end_day, note:n.note,
        source:n.source, goal_id:n.goal_id, created_at:n.created_at
      }));
      /* Merge, not overwrite: a note we just wrote optimistically may not have
         committed before this read returns. Keep any local extra. */
      const key = n => `${n.start_day}|${n.end_day}|${n.source}|${n.note || ""}`;
      const have = new Set(server.map(key));
      const localExtras = (S.gapNotes || []).filter(n => !have.has(key(n)));
      S.gapNotes = server.concat(localExtras);
      saveGapNotesLocal(S.gapNotes);
    }
    /* A contact_made logged today means the member already reached out; the
       trailing run is resolved for this return even with no note (a call). */
    if(Array.isArray(contact) && contact[0] && contact[0].created_at){
      if(new Date(contact[0].created_at) >= midnight) S._runResolved = true;
    }
    /* Once we've welcomed and consumed a clearance this session, never let a
       lagging read (before the null-write commits) re-trigger the banner. */
    S._cleared = !!(ch && ch.cleared_at) && !S._reentryConsumed;
  }catch(e){ /* keep cached state */ }
  _missServerLoaded = true;
  _evaluateMissState();
}

/* ============================================================
   THE GATE (trailing run inside the gate band, one field)
   ============================================================ */
function _renderGate(g){
  const cont = el("miss-gate");
  if(!cont) return;
  S.uploadBlocked = true;
  if(_gapNoteCovers(g)){ cont.innerHTML = ""; S.uploadBlocked = false; return; }

  cont.innerHTML = `
    <div class="card mb10 miss-gate-card" style="border:1px solid rgba(196,154,28,.22);background:rgba(196,154,28,.04);padding:16px;text-align:left">
      <p style="font-size:14px;line-height:1.6;color:#e8e8e8;margin:0 0 16px">You'll forget why you missed these. Name them now while it's fresh, so the pattern is still readable when you come back.</p>
      <p style="font-size:12px;font-weight:700;color:#c49a1c;letter-spacing:.03em;margin:0 0 6px">${_gapLabel(g)}</p>
      <p style="font-size:13px;color:#cfcfcf;margin:0 0 8px">What got in the way?</p>
      <input id="miss-gate-input" type="text" maxlength="70" placeholder="just a line"
        oninput="_gateCheck()" style="width:100%;font-size:14px;padding:11px 12px;margin-bottom:14px">
      <button id="miss-gate-btn" class="bp" style="width:100%;font-size:14px;padding:12px" disabled onclick="_submitGate()">Continue to today's upload</button>
    </div>`;
  S._gateGap = g;
  _gateCheck();
}

function _gateCheck(){
  const inp = el("miss-gate-input");
  const btn = el("miss-gate-btn");
  if(btn) btn.disabled = !(inp && inp.value.trim().length > 0);
}

function _submitGate(){
  const inp = el("miss-gate-input");
  const g = S._gateGap;
  if(!inp || !inp.value.trim() || !g) return;
  writeGapNote(g, inp.value.trim().slice(0, 70), "user_gate");
  S._gateGap = null;
  S.uploadBlocked = false;
  const cont = el("miss-gate"); if(cont) cont.innerHTML = "";
  if(typeof updateUpBtn === "function") updateUpBtn();
  /* Naming never marks a missed day complete. It only opens forward motion. */
  if(typeof openMod === "function") openMod();
}

/* ============================================================
   THE FROZEN LOCK (trailing run of 3 or more).
   Firm in state, warm in voice. One copy regardless of N. No day count.
   ============================================================ */
function _renderLock(g){
  S.uploadBlocked = true;
  _clearLockOverlay();

  const coach = _coach();
  const fn = _firstName();
  const heading = fn ? `${fn}, your coach wants to talk.` : `Your coach wants to talk.`;

  const padlock = `
    <div style="width:46px;height:46px;border-radius:12px;background:rgba(196,154,28,.08);border:1px solid rgba(196,154,28,.22);display:flex;align-items:center;justify-content:center">
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="10.5" width="16" height="10.5" rx="2"/>
        <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>
        <circle cx="12" cy="15" r="1.4"/>
        <path d="M12 16.4V18"/>
      </svg>
    </div>`;

  const phone = _coachPhone();
  const chipName = coach.name ? `${coach.name}, your coach` : "your coach";
  const chip = `
    <div style="display:flex;align-items:center;gap:11px;margin:12px 0 0">
      <div style="width:40px;height:40px;border-radius:50%;background:rgba(196,154,28,.12);border:1px solid rgba(196,154,28,.25);display:flex;align-items:center;justify-content:center;color:#c49a1c;font-weight:800;font-size:16px;flex-shrink:0">${_missEsc(coach.initial || "")}</div>
      <div style="min-width:0">
        <p style="font-size:14px;font-weight:700;color:#e8e8e8;margin:0">${_missEsc(phone)}</p>
        <p style="font-size:12px;color:#8a8a8a;margin:2px 0 0">${_missEsc(chipName)}</p>
      </div>
    </div>`;

  const starters = (typeof MISS_STARTERS !== "undefined") ? MISS_STARTERS : [];
  const starterBtns = starters.map((s, i) =>
    `<button class="miss-starter" onclick="_lockMessageStart(${i})" style="display:block;width:100%;text-align:left;background:#141414;border:1px solid #262626;color:#dcdcdc;font-size:13px;line-height:1.5;padding:12px 14px;border-radius:10px;margin-bottom:8px;cursor:pointer;font-family:inherit">${_missEsc(s)}</button>`
  ).join("");

  const ov = document.createElement("div");
  ov.id = "miss-lock-overlay";
  ov.style.cssText = "position:fixed;inset:0;z-index:1200;background:#0a0a0a;overflow-y:auto;display:flex;flex-direction:column;padding:44px 22px";
  ov.innerHTML = `
    <div style="max-width:440px;width:100%;margin:auto 0;text-align:left">
      ${padlock}
      <p style="font-size:11px;font-weight:800;letter-spacing:.16em;color:#c49a1c;margin:20px 0 10px">ACCOUNT FROZEN</p>
      <h2 style="font-size:22px;font-weight:800;line-height:1.3;color:#f2f2f2;margin:0 0 10px">${_missEsc(heading)}</h2>
      <p style="font-size:15px;line-height:1.65;color:#b8b8b8;margin:0 0 26px">You haven't lost your place. Reach out and you're back in.</p>

      <a id="miss-call-link" href="tel:${_missEsc(phone)}" onclick="_lockCall()" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#c49a1c;color:#0a0a0a;padding:14px;border-radius:11px;font-size:15px;font-weight:800;text-decoration:none">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="#0a0a0a" stroke="none"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
        Call your coach
      </a>
      ${chip}

      <div style="display:flex;align-items:center;gap:12px;margin:24px 0">
        <div style="flex:1;height:1px;background:#242424"></div>
        <span style="font-size:12px;color:#6a6a6a">or</span>
        <div style="flex:1;height:1px;background:#242424"></div>
      </div>

      <p style="font-size:14px;font-weight:700;color:#e0e0e0;margin:0 0 4px">Send a message instead</p>
      <p style="font-size:12px;color:#7a7a7a;margin:0 0 12px">Tap to send. Edit if you like.</p>
      <div id="miss-starters">${starterBtns}</div>
    </div>`;
  document.body.appendChild(ov);
  S._lockGap = g;
}

function _clearLockOverlay(){
  const ov = document.getElementById("miss-lock-overlay");
  if(ov) ov.remove();
}

/* Tapping Call opens the platform on trust. Log one contact_made, resolve the
   run for this return, and write NO synthetic note. The coach follows up. */
function _lockCall(){
  const g = S._lockGap;
  S._runResolved = true;
  if(typeof trackEvent === "function") trackEvent("contact_made", g ? {method:"call", start_day:g.start, end_day:g.end, length:g.length} : {method:"call"});
  _unlockAfterContact();
}

/* A starter becomes an editable message the member can send to the coach. */
function _lockMessageStart(i){
  const starters = (typeof MISS_STARTERS !== "undefined") ? MISS_STARTERS : [];
  const text = starters[i] || "";
  const box = document.getElementById("miss-starters");
  if(!box) return;
  box.innerHTML = `
    <textarea id="miss-msg-input" rows="3" style="width:100%;font-size:14px;padding:12px;line-height:1.5;margin-bottom:10px">${_missEsc(text)}</textarea>
    <div style="display:flex;gap:8px">
      <button class="bs" style="flex:1;font-size:13px;padding:11px" onclick="_lockMessageCancel()">Back</button>
      <button class="bp" style="flex:2;font-size:14px;padding:11px" onclick="_lockMessageSend()">Send to your coach</button>
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
  S._runResolved = true;
  /* Deliver to the coach (admin side) as a challenger chat message. */
  if(typeof sb !== "undefined" && sb && S.user?.supabaseId){
    try{ sb.from("chat_messages").insert({challenger_id:S.user.supabaseId, sender:"challenger", message:text}).then(()=>{}).catch(()=>{}); }catch(e){}
  }
  if(typeof trackEvent === "function") trackEvent("contact_made", g ? {method:"message", start_day:g.start, end_day:g.end, length:g.length} : {method:"message"});
  /* The message text becomes the run's readable note. */
  if(g && !_gapNoteCovers(g)) writeGapNote(g, text, "messaged");
  if(typeof showToast === "function") showToast("Sent. Welcome back.", "success");
  _unlockAfterContact();
}

function _unlockAfterContact(){
  S.uploadBlocked = false;
  S._lockGap = null;
  _clearLockOverlay();
  if(typeof renderDash === "function") renderDash();
}

/* ============================================================
   COACH-CLEARED RE-ENTRY (a slim banner, not a screen)
   ============================================================ */
function _renderWelcomeBanner(){
  const cont = el("miss-gate");
  S.uploadBlocked = false;
  const name = _firstName();
  const line = name ? `Good to have you back, ${name}.` : `Good to have you back.`;
  if(cont){
    cont.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:10px;background:rgba(77,201,138,.08);border:1px solid rgba(77,201,138,.22);margin-bottom:10px">
        <span style="width:16px;height:16px;border-radius:50%;background:rgba(77,201,138,.2);color:#4dc98a;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;flex-shrink:0">&#10003;</span>
        <p style="font-size:14px;font-weight:700;color:#e8f5ec;margin:0">${_missEsc(line)}</p>
      </div>`;
  }
  _consumeClearance();
  if(typeof updateUpBtn === "function") updateUpBtn();
}

/* Consume the clearance exactly once: flip cleared_at back to null. No note is
   written for a clearance-resolved run (the tile stays red, unexplained). Mark
   the run resolved for this session so a follow-up renderDash (after loadGoals)
   doesn't re-lock a member the coach just welcomed back. */
function _consumeClearance(){
  if(!S._cleared) return;
  S._cleared = false;
  S._reentryConsumed = true;
  S._runResolved = true;
  if(typeof sb !== "undefined" && sb && S.user?.supabaseId){
    try{ sb.from("challengers").update({cleared_at:null}).eq("id", S.user.supabaseId).then(()=>{}).catch(()=>{}); }catch(e){}
  }
}

/* ============================================================
   READBACK — tapping a red (missed) tile shows its note + date.
   Tiles with no note (noise, call-resolved, cleared) read back nothing.
   ============================================================ */
function _showGapNote(day){
  if(!Array.isArray(S.gapNotes)) S.gapNotes = loadGapNotesLocal();
  const n = _noteForDay(day);
  const dl = el("view-mod-dl"), body = el("view-mod-body"), actions = el("view-mod-actions");
  if(!dl || !body || !actions) return;
  dl.textContent = `DAY ${day} · MISSED`;
  if(n && n.note){
    const when = _fmtGapDate(n.created_at);
    body.innerHTML = `
      <div style="padding:6px 0">
        <span class="lbl lbl-e" style="display:block;margin-bottom:8px">WHAT GOT IN THE WAY</span>
        <p style="font-size:15px;line-height:1.6;color:#e8e8e8;margin-bottom:10px">${_missEsc(n.note)}</p>
        ${when ? `<p style="font-size:11px;color:#6a6a6a">${_missEsc(when)}</p>` : ""}
      </div>`;
  }else{
    body.innerHTML = `<div style="padding:6px 0"><p style="font-size:14px;line-height:1.6;color:#9a9a9a">This day is still unnamed.</p></div>`;
  }
  actions.innerHTML = `<button class="bs" style="width:100%;padding:10px;font-size:13px" onclick="closeViewMod()">Close</button>`;
  el("view-mod").classList.add("show");
}
