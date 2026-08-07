/* ============================================================
   completion.js — Early completion and admin-end.

   A member can hit their goal before the round ends. That is a win, not an
   unfinished round. The coach confirms completion (the authority mechanic);
   the member then decides what to do with the leftover days: start a new
   short round, or end here.

   THE RULE THAT MATTERS MOST: after an early completion the leftover day
   tiles are WON, rendered closed and neutral, never red. A member who
   finished early must never see a missed day.

   Round lifecycle (challengers.round_status): active, completed_early, ended.
   completed_on is the day the goal was confirmed. Day-tile states gain
   "completed" (the medal day) and "closed" (neutral days after it).

   Every string here is hardcoded copy. No em dashes.
   ============================================================ */

/* ---------- round state ---------- */
function roundStatus(){ return (S.user && S.user.roundStatus) || "active"; }
function completedOn(){
  const v = S.user && S.user.completedOn;
  return (typeof v === "number" && v > 0) ? v : 0;
}
function isRoundClosed(){ const s = roundStatus(); return s === "completed_early" || s === "ended"; }
function _remainingDays(){ return Math.max(0, getDur() - completedOn()); }
function _compFirstName(){ return ((S.user && S.user.name || "").trim().split(/\s+/)[0]) || ""; }

/* Day-tile state for BOTH grids. "completed" is the medal day, "closed" is a
   neutral inactive day after it. null means the normal rules apply (uploaded,
   reviewed, missed, today, future). Misses BEFORE the completion day are left
   untouched, so an active round's history stays honest. */
function completionDayState(d){
  const c = completedOn();
  if(!c) return null;
  if(d === c) return "completed";
  if(d > c) return "closed";
  return null;
}

/* A Tabler-style trophy (ti-trophy) as inline SVG so no icon font is needed. */
function _trophySVG(size, color){
  const s = size || 14, col = color || "#c49a1c";
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21l8 0"/><path d="M12 17l0 4"/><path d="M7 4l10 0"/><path d="M17 4v8a5 5 0 0 1 -10 0v-8"/><path d="M5 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M19 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/></svg>`;
}

/* Apply the medal/closed look to a grid cell element (shared by both grids).
   Returns true if the day was a completion day and was fully handled. */
function paintCompletionCell(cell, d){
  const cs = completionDayState(d);
  if(!cs) return false;
  cell.className = "dc";
  cell.style.position = "relative";
  if(cs === "completed"){
    cell.style.background = "rgba(196,154,28,.1)";
    cell.style.border = "1px solid rgba(196,154,28,.45)";
    cell.innerHTML = `<span class="dn">D${d}</span><span style="display:flex;align-items:center;justify-content:center;margin-top:1px">${_trophySVG(14)}</span>`;
    cell.style.cursor = "pointer";
    cell.onclick = () => _showCompletedTileInfo(d);
  }else{
    /* closed: quiet and inactive, never a miss */
    cell.style.background = "#0e0e0e";
    cell.style.border = "1px solid #171717";
    cell.style.opacity = ".45";
    cell.innerHTML = `<span class="dn" style="color:#5a5a5a">D${d}</span>`;
    cell.onclick = null;
    cell.style.cursor = "default";
  }
  return true;
}

function _showCompletedTileInfo(day){
  const dl = el("view-mod-dl"), body = el("view-mod-body"), actions = el("view-mod-actions");
  if(!dl || !body || !actions) return;
  dl.textContent = `DAY ${day}`;
  body.innerHTML = `
    <div style="padding:10px 0;text-align:center">
      <div style="display:flex;justify-content:center;margin-bottom:10px">${_trophySVG(30)}</div>
      <p style="font-size:16px;font-weight:800;color:#f0f0f0">Goal completed on day ${day}</p>
    </div>`;
  actions.innerHTML = `<button class="bs" style="width:100%;padding:10px;font-size:13px" onclick="closeViewMod()">Close</button>`;
  el("view-mod").classList.add("show");
}

/* ============================================================
   ENTRY — called from renderDash() after calcDay()
   ============================================================ */
function renderCompletionState(){
  S.roundClosed = isRoundClosed();
  const slot = el("completion-slot");
  if(slot) slot.innerHTML = "";
  if(!S.user){ _clearCongratsModal(); return; }

  const s = roundStatus();
  if(isRoundClosed()){
    /* Miss handling is skipped for a finished member, so clear any miss UI
       it may have left behind. */
    const mg = el("miss-gate"); if(mg) mg.innerHTML = "";
    if(typeof _clearLockOverlay === "function") _clearLockOverlay();
    S.uploadBlocked = false;
  }
  if(s === "completed_early"){
    /* The grid renders the medal + closed days. The member must now choose. */
    _showCongratsModal();
  }else if(s === "ended"){
    /* Clean closed state. Grid shows the medal and the quiet closed days. */
    _clearCongratsModal();
  }else{
    /* Active round: offer to request completion. */
    _clearCongratsModal();
    _renderRequestCompletion(slot);
  }
  _refreshRoundFromServer();
}

/* Pick up a coach confirmation (or request clear) made since this load. */
async function _refreshRoundFromServer(){
  if(typeof sb === "undefined" || !sb || !S.user?.supabaseId) return;
  try{
    const { data } = await sb.from("challengers")
      .select("round_status,completed_on,completion_requested_at").eq("id", S.user.supabaseId).single();
    if(!data) return;
    const prevStatus = roundStatus();
    const prevReq = !!(S.user.completionRequestedAt);
    S.user.roundStatus = data.round_status || "active";
    S.user.completedOn = data.completed_on || null;
    S.user.completionRequestedAt = data.completion_requested_at || null;
    saveState();
    /* Only re-render when something the dashboard shows actually changed, so we
       never spin (renderDash -> renderCompletionState -> refresh -> renderDash). */
    if(prevStatus !== roundStatus() || prevReq !== !!S.user.completionRequestedAt){
      if(typeof renderDash === "function") renderDash();
    }
  }catch(e){}
}

/* ---------- request completion (member -> coach) ---------- */
function _renderRequestCompletion(slot){
  if(!slot) return;
  if(S.user.completionRequestedAt){
    slot.innerHTML = `
      <div class="card mb10" style="border:1px solid rgba(196,154,28,.2);background:rgba(196,154,28,.04);padding:12px 14px;display:flex;align-items:center;gap:10px">
        ${_trophySVG(16)}
        <p style="font-size:13px;color:#d9c48a;margin:0">Completion requested. Your coach will confirm your win.</p>
      </div>`;
    return;
  }
  slot.innerHTML = `
    <div class="card mb10" style="border:1px solid #1c1c1c;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <p style="font-size:13px;color:#9a9a9a;margin:0">Reached your goal already?</p>
      <button onclick="requestCompletion()" style="flex-shrink:0;display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:9px;background:rgba(196,154,28,.08);border:1px solid rgba(196,154,28,.25);color:#c49a1c;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">${_trophySVG(13)} I've reached my goal</button>
    </div>`;
}

async function requestCompletion(){
  if(!S.user) return;
  const now = new Date().toISOString();
  S.user.completionRequestedAt = now;
  saveState();
  if(typeof sb !== "undefined" && sb && S.user.supabaseId){
    /* Await so a following round refresh cannot read a stale null and flip the
       button back. */
    try{ await sb.from("challengers").update({completion_requested_at:now}).eq("id", S.user.supabaseId); }catch(e){}
    /* Nudge the coach through the existing message channel too. */
    try{ sb.from("chat_messages").insert({challenger_id:S.user.supabaseId, sender:"challenger", message:"I've reached my goal. Requesting completion."}).then(()=>{}).catch(()=>{}); }catch(e){}
  }
  if(typeof showToast === "function") showToast("Sent to your coach. They'll confirm your win.", "success", 4000);
  _renderRequestCompletion(el("completion-slot"));
}

/* ============================================================
   CONGRATULATIONS MODAL (after coach confirmation)
   ============================================================ */
function _showCongratsModal(){
  if(document.getElementById("congrats-overlay")) return;
  const fn = _compFirstName();
  const heading = fn ? `You did it, ${fn}.` : `You did it.`;
  const X = _remainingDays();
  const body = `You finished early, with ${X} days still on the clock. What do you want to do with them?`;
  const esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const startBtn = (X >= 2)
    ? `<button onclick="startNewGoalFromCongrats()" style="width:100%;padding:14px;border-radius:11px;background:#c49a1c;color:#0a0a0a;font-size:15px;font-weight:800;border:none;cursor:pointer;font-family:inherit;margin-bottom:10px">Start a new goal</button>`
    : "";

  const ov = document.createElement("div");
  ov.id = "congrats-overlay";
  ov.style.cssText = "position:fixed;inset:0;z-index:1300;background:rgba(6,6,6,.92);display:flex;align-items:center;justify-content:center;padding:24px";
  ov.innerHTML = `
    <div style="max-width:400px;width:100%;background:#111;border:1px solid rgba(196,154,28,.25);border-radius:16px;padding:26px;text-align:left">
      <div style="display:flex;margin-bottom:14px">${_trophySVG(38)}</div>
      <h2 style="font-size:24px;font-weight:800;color:#f4f4f4;margin:0 0 10px">${esc(heading)}</h2>
      <p style="font-size:15px;line-height:1.6;color:#b8b8b8;margin:0 0 22px">${esc(body)}</p>
      ${startBtn}
      <button onclick="endHereFromCongrats()" style="width:100%;padding:14px;border-radius:11px;background:transparent;color:#cfcfcf;font-size:15px;font-weight:700;border:1px solid #2a2a2a;cursor:pointer;font-family:inherit">End here, I'm done</button>
    </div>`;
  document.body.appendChild(ov);
}

function _clearCongratsModal(){
  const ov = document.getElementById("congrats-overlay");
  if(ov) ov.remove();
}

async function endHereFromCongrats(){
  if(!S.user) return;
  S.user.roundStatus = "ended";
  saveState();
  _clearCongratsModal();
  if(typeof sb !== "undefined" && sb && S.user.supabaseId){
    /* Await so the round refresh on the next render reads "ended" and does not
       re-open the congratulations modal. */
    try{ await sb.from("challengers").update({round_status:"ended"}).eq("id", S.user.supabaseId); }catch(e){}
  }
  if(typeof renderDash === "function") renderDash();
}

/* ============================================================
   START A NEW GOAL (a fresh short round of the leftover days)
   Not the 30-day Intensive two-goal flow. A separate, single-goal round.
   ============================================================ */
function startNewGoalFromCongrats(){
  const X = _remainingDays();
  if(X < 2) return;                 /* guard: a one-day new round is pointless */
  _clearCongratsModal();
  _openNewGoalForm(X);
}

function _openNewGoalForm(X){
  const esc = s => String(s||"").replace(/"/g,"&quot;");
  let ov = document.getElementById("newgoal-overlay");
  if(ov) ov.remove();
  ov = document.createElement("div");
  ov.id = "newgoal-overlay";
  ov.style.cssText = "position:fixed;inset:0;z-index:1300;background:#0a0a0a;overflow-y:auto;display:flex;flex-direction:column;padding:40px 22px";
  ov.innerHTML = `
    <div style="max-width:440px;width:100%;margin:auto 0;text-align:left">
      <span class="lbl lbl-a" style="color:#c49a1c">NEW ${X}-DAY ROUND</span>
      <h2 style="font-size:22px;font-weight:800;color:#f2f2f2;margin:6px 0 6px">What's the next goal?</h2>
      <p style="font-size:13px;color:#8a8a8a;margin:0 0 18px">A fresh round for the ${X} days you have left. Same rules: show up, upload daily.</p>

      <p style="font-size:12px;font-weight:700;color:#9a9a9a;margin:0 0 6px">YOUR GOAL</p>
      <textarea id="ng-goal" rows="2" placeholder="What will you do for the next ${X} days?" style="width:100%;font-size:14px;padding:11px 12px;margin-bottom:14px"></textarea>

      <p style="font-size:12px;font-weight:700;color:#9a9a9a;margin:0 0 6px">DAILY PROOF</p>
      <input id="ng-proof" type="text" placeholder="What will your daily upload show?" style="width:100%;font-size:14px;padding:11px 12px;margin-bottom:14px">

      <p style="font-size:12px;font-weight:700;color:#9a9a9a;margin:0 0 6px">BIGGEST THREAT</p>
      <input id="ng-threat" type="text" placeholder="What is most likely to stop you?" style="width:100%;font-size:14px;padding:11px 12px;margin-bottom:20px">

      <button id="ng-continue" class="bp" style="width:100%;font-size:14px;padding:13px" onclick="_submitNewGoal()">Continue to commitment</button>
      <button onclick="_cancelNewGoal()" style="width:100%;margin-top:10px;padding:11px;background:transparent;border:none;color:#7a7a7a;font-size:13px;cursor:pointer;font-family:inherit">Back</button>
    </div>`;
  document.body.appendChild(ov);
  const g = document.getElementById("ng-goal"); if(g) g.focus();
}

function _cancelNewGoal(){
  const ov = document.getElementById("newgoal-overlay");
  if(ov) ov.remove();
  S._newRoundDays = null;
  /* Return them to the choice modal. */
  _showCongratsModal();
}

function _submitNewGoal(){
  const goal = (el("ng-goal")?.value || "").trim();
  const proof = (el("ng-proof")?.value || "").trim();
  const threat = (el("ng-threat")?.value || "").trim();
  if(goal.length < 3){ const g = el("ng-goal"); if(g){ g.style.border = "1px solid #d9503a"; g.focus(); } return; }
  const X = _remainingDays();
  S._newRoundDays = X;
  const prev = (S.user && S.user.answers) || {};
  S.ans = {
    name: (S.user && S.user.name) || "",
    goal, goalSummary: goal,
    proof: proof || "direct proof of work done",
    proofMethods: Array.isArray(prev.proofMethods) && prev.proofMethods.length ? prev.proofMethods : ["photo","note"],
    proofType: prev.proofType || "output",
    threat: threat || "losing momentum",
    duration: X
  };
  const ov = document.getElementById("newgoal-overlay");
  if(ov) ov.remove();
  goTo("commit");
  if(typeof _prepareCommitScreen === "function") _prepareCommitScreen();
}

/* Called from doCommit() when S._newRoundDays is set: finalize the fresh round
   on the SAME account. The old round's proof is cleared so the new day
   numbering starts clean, and every completion flag is reset to active. */
async function finalizeNewRound(){
  const X = S._newRoundDays || getDur();
  S._newRoundDays = null;
  const now = new Date().toISOString();
  const a = S.ans || {};

  S.user.duration = X;
  S.user.startDate = now;
  S.user.answers = {
    goal: a.goal, goalSummary: a.goalSummary || a.goal,
    proof: a.proof, proofMethods: a.proofMethods || ["photo","note"],
    proofType: a.proofType || "output", threat: a.threat, sig: a.sig
  };
  S.user.roundStatus = "active";
  S.user.completedOn = null;
  S.user.completionRequestedAt = null;
  S.user.status = "active";
  S.uploads = Array(X).fill(null);
  S.uploadsBySlot = null; S.goals = null; S.activeGoal = 1;
  S.day = 1;
  /* Reset miss-handling caches for the fresh round. */
  S.gapNotes = null; S._runResolved = false; S._cleared = false; S._reentryConsumed = false;
  S.roundClosed = false;
  saveState();

  if(typeof sb !== "undefined" && sb && S.user.supabaseId){
    const uid = S.user.supabaseId;
    try{
      await sb.from("uploads").delete().eq("challenger_id", uid);
      await sb.from("goals").delete().eq("challenger_id", uid);
      await sb.from("gap_notes").delete().eq("user_id", uid);
      await sb.from("challengers").update({
        duration: X, start_date: now, round_status: "active",
        completed_on: null, completion_requested_at: null, status: "active",
        goal_raw: a.goal, goal_summary: a.goalSummary || a.goal,
        proof_description: a.proof, proof_type: a.proofType || "output",
        threat: a.threat, current_day: 1
      }).eq("id", uid);
    }catch(e){ console.warn("finalizeNewRound sync failed:", e); }
    try{ localStorage.removeItem("oiwg_gap_notes_" + uid); }catch(e){}
  }
  _clearCongratsModal();
  goTo("dash");
}
