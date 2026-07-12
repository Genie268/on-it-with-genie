/* ============================================================
   goals.js — multi-goal support (The Intensive, 30 days)

   CORE IDEA (why this is low-risk):
   S.uploads always points at the ACTIVE goal's upload array.
   Per-goal arrays live in S.uploadsBySlot = {1:[...], 2:[...]}.
   Switching goals swaps S.uploads. Every existing function
   (renderGrid, streak math, subUp, updateUpBtn) therefore keeps
   working with ZERO changes — it just operates on the goal in focus.

   Single-goal users: the map holds only slot 1, S.uploads is that
   array, behaviour is exactly what it was before.

   Slot 2 is gated in the DATABASE (RLS: duration must be 30).
   The UI checks below are convenience, never the real lock.
   ============================================================ */

function goalsList(){ return Array.isArray(S.goals) ? S.goals : []; }
function goalBySlot(slot){ return goalsList().find(g => g.slot === slot) || null; }
function hasSecondGoal(){ return !!goalBySlot(2); }
function _dur(){ return (typeof getDur === "function") ? getDur() : (S.user?.duration || 15); }
function isIntensive(){ return _dur() === 30; }
function canAddSecondGoal(){ return isIntensive() && !hasSecondGoal(); }
function activeSlot(){ return (S.activeGoal === 2 && hasSecondGoal()) ? 2 : 1; }
function activeGoalRow(){ return goalBySlot(activeSlot()); }

/* ---------- slot map ---------- */
function _slotMap(){
  if(!S.uploadsBySlot || typeof S.uploadsBySlot !== "object") S.uploadsBySlot = {};
  if(!Array.isArray(S.uploadsBySlot[1])) S.uploadsBySlot[1] = Array.isArray(S.uploads) ? S.uploads : [];
  if(!Array.isArray(S.uploadsBySlot[2])) S.uploadsBySlot[2] = [];
  return S.uploadsBySlot;
}
function _stashActive(){
  const m = _slotMap();
  m[activeSlot()] = Array.isArray(S.uploads) ? S.uploads : [];
}
function _loadSlot(slot){
  const m = _slotMap();
  if(!Array.isArray(m[slot])) m[slot] = [];
  while(m[slot].length < _dur()) m[slot].push(null);
  S.uploads = m[slot];
}

/* ---------- per-goal progress ---------- */
function startDayFor(slot){
  const g = goalBySlot(slot);
  return (g && g.start_day) ? g.start_day : 1;
}
function uploadsForSlot(slot){ return _slotMap()[slot] || []; }
function uploadCountFor(slot){ return uploadsForSlot(slot).filter(Boolean).length; }
function expectedDaysFor(slot){ return Math.max(1, _dur() - (startDayFor(slot) - 1)); }
function streakFor(slot){
  const ups = uploadsForSlot(slot);
  let n = 0;
  for(let i = S.day - 1; i >= 0; i--){ if(ups[i]) n++; else break; }
  return n;
}
function goalComplete(slot){
  if(!goalBySlot(slot)) return true;                        // no such goal, not blocking
  const needed = Math.ceil(expectedDaysFor(slot) * 0.8);    // same 80% bar as before
  return uploadCountFor(slot) >= needed;
}
/* BOTH goals must clear the bar. One goal is never enough. */
function bothGoalsComplete(){
  if(!hasSecondGoal()) return goalComplete(1);
  return goalComplete(1) && goalComplete(2);
}
/* Sequential goal 2 stays dormant until goal 1 lands. */
function goalOpenToday(slot){
  if(slot === 1) return true;
  if(!hasSecondGoal()) return false;
  if(S.goalMode === "sequential") return goalComplete(1);
  return S.day >= startDayFor(2);
}

/* ---------- load from server ---------- */
/* Hydrates BOTH slots with file_url / note / reviewed so the grid can show
   the actual proof behind each cell. */
async function loadGoals(){
  if(!S.user?.supabaseId || typeof sb === "undefined" || !sb){ _slotMap(); return; }
  try{
    const { data } = await sb.from("goals").select("*")
      .eq("challenger_id", S.user.supabaseId).order("slot");
    if(Array.isArray(data) && data.length) S.goals = data;
  }catch(e){ _slotMap(); return; }

  try{
    const { data } = await sb.from("uploads").select("*")
      .eq("challenger_id", S.user.supabaseId);
    if(!Array.isArray(data)){ _slotMap(); return; }

    const m = _slotMap();
    const g1 = goalBySlot(1), g2 = goalBySlot(2);
    const build = (goal) => {
      if(!goal) return null;
      const arr = [];
      data.filter(u => u.goal_id === goal.id).forEach(u => {
        arr[u.day_number - 1] = {
          note: u.note, fileUrl: u.file_url, fileName: u.file_name,
          voiceUrl: u.voice_url, proofType: u.proof_type,
          behavior: u.behavior_answer, link: u.link_url,
          hasFile: !!u.file_url, hasVoice: !!u.voice_url,
          reviewed: !!u.reviewed, time: u.created_at
        };
      });
      return arr;
    };

    /* Only overwrite a slot if the server actually has rows for it, so an
       offline/local upload is never wiped out by an empty fetch. */
    const a1 = build(g1);
    if(a1 && a1.filter(Boolean).length) m[1] = a1;
    const a2 = build(g2);
    if(a2) m[2] = a2;

    _loadSlot(activeSlot());
    if(typeof saveState === "function") saveState();
  }catch(e){ _slotMap(); }
}

/* ---------- switching ---------- */
function switchGoal(slot){
  if(slot === activeSlot()) return;
  if(slot === 2 && !hasSecondGoal()) return;
  if(slot === 2 && !goalOpenToday(2)){
    showToast("Goal 2 opens once goal 1 is done", "info");
    return;
  }
  _stashActive();
  S.activeGoal = slot;
  _loadSlot(slot);

  /* Keep answers in step so the goal card, Lil and the upload modal
     all name the goal that's actually in focus. */
  const g = goalBySlot(slot);
  if(g && S.user){
    S.user.answers = S.user.answers || {};
    S.user.answers.goal = g.goal_raw;
    S.user.answers.goalSummary = g.goal_summary || g.goal_raw;
    S.user.answers.proof = g.proof_description;
    S.user.answers.proofType = g.proof_type || "output";
    S.user.answers.proofMethods = g.proof_methods || ["photo","note"];
  }
  if(typeof saveState === "function") saveState();
  if(typeof renderDash === "function") renderDash();
}

/* ---------- goal card: cover + sliding switcher ---------- */
/* Replaces the old ring hero. The cover sits BEHIND the goal text at low
   opacity; the switcher is a real track with a sliding thumb so it reads
   as a control, not as a status dot. */

function _gEsc(t){ return String(t==null?"":t).replace(/[&<>"']/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

function _goalColour(slot){ return slot === 2 ? "#4dc98a" : "#c49a1c"; }

/* Deterministic art generated from the goal's own words. No two goals match. */
function _autoCover(text, hue){
  let h = 0; const t = String(text || "goal");
  for(let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  h = Math.abs(h);
  const a = (h % 70) + 10, b = ((h >> 3) % 34) + 20,
        c = ((h >> 7) % 40) + 28, d = ((h >> 11) % 26) + 30;
  return `radial-gradient(140% 110% at ${b}% ${100 - c}%, ${hue}3d 0%, transparent 62%),` +
         `radial-gradient(100% 80% at ${100 - b}% ${c}%, ${hue}26 0%, transparent 58%),` +
         `radial-gradient(70% 60% at ${d}% 20%, rgba(255,255,255,.05) 0%, transparent 55%),` +
         `repeating-linear-gradient(${a}deg, rgba(255,255,255,.035) 0 1px, transparent 1px ${8 + (h % 6)}px),` +
         `linear-gradient(155deg,#1a1710,#0b0b0b)`;
}

/* cover_mode holds either "auto", "photo" (centered), or "photo:X:Y" where
   X/Y are 0-100 background-position percentages set by dragging the cover
   in openCoverPicker(). Packed into the existing text column so repositioning
   doesn't need a new one. */
function _isPhotoMode(cm){ return !!cm && String(cm).indexOf("photo") === 0; }
function _coverPosFor(cm){
  const parts = String(cm || "").split(":");
  const px = parts.length >= 3 ? parseInt(parts[1], 10) : NaN;
  const py = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;
  return {
    x: isNaN(px) ? 50 : Math.max(0, Math.min(100, px)),
    y: isNaN(py) ? 50 : Math.max(0, Math.min(100, py))
  };
}

function _coverStyleFor(slot){
  const g = goalBySlot(slot);
  if(!g) return "";
  const hue = _goalColour(slot);
  if(_isPhotoMode(g.cover_mode) && g.cover_url){
    const pos = _coverPosFor(g.cover_mode);
    return `background-image:linear-gradient(180deg,rgba(10,10,10,.5),rgba(8,8,8,.93)),url('${g.cover_url}');` +
           `background-size:cover;background-position:${pos.x}% ${pos.y}%;`;
  }
  return `background-image:linear-gradient(180deg,rgba(10,10,10,.5),rgba(8,8,8,.93)),${_autoCover(g.goal_raw, hue)};` +
         `background-size:cover;background-position:center;`;
}

/* The whole goal card. Written into #goal-c, replacing the old flat card. */
function renderGoalCard(){
  const gc = document.getElementById("goal-c");
  if(!gc) return false;
  const slot = activeSlot();
  const g = goalBySlot(slot);
  if(!g) return false;                       // no goals loaded yet: let dashboard.js draw its own

  const col = _goalColour(slot);
  const two = hasSecondGoal();
  const sk = streakFor(slot);
  const skText = sk === 0 ? "No streak yet" : (sk === 1 ? "1 day streak" : sk + " day streak");
  const left = Math.max(0, _dur() - S.day + 1);
  const ptype = (typeof PT !== "undefined" && PT[g.proof_type]) || "Proof";
  const title = _gEsc(g.goal_summary || g.goal_raw || "Your goal");

  /* Switcher: a track with a sliding thumb. Only when a 2nd goal exists.
     Intensive users without one get a quiet "+ Add goal 2" instead. */
  let switcher = "";
  if(two){
    const locked = !goalOpenToday(2);
    switcher =
      `<div class="goal-track ${slot === 2 ? "s2" : "s1"}" id="goal-track" style="--gc:${col}">
         <div class="goal-thumb"></div>
         <button class="goal-tb goal-tb1" onclick="switchGoal(1)">GOAL 1</button>
         <button class="goal-tb goal-tb2" onclick="switchGoal(2)" ${locked ? 'style="opacity:.5"' : ""}>GOAL 2</button>
       </div>
       <span class="goal-hint" id="goal-hint">swipe ›</span>`;
  }else if(isIntensive()){
    switcher =
      `<button class="goal-add" onclick="openAddGoal()">+ ADD GOAL 2</button>`;
  }

  gc.className = "card mb10 goal-cover-card";
  gc.setAttribute("style", _coverStyleFor(slot));
  gc.innerHTML =
    `<div class="goal-inner">
       <div class="goal-topline">${switcher}
         <button class="goal-cover-btn" onclick="openCoverPicker()" aria-label="Change cover">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
             <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
             <path d="M21 15l-5-5L5 21"/></svg>
         </button>
       </div>
       <p class="goal-title">${title}</p>
       <div class="row mt8" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
         <div class="row" style="gap:6px">
           <span class="tag goal-chip">${_gEsc(ptype)}</span>
           <span class="goal-chip goal-chip-ok">${left} left</span>
         </div>
         <span style="font-size:11px;font-weight:800;color:${sk > 0 ? col : "#3a3a3a"}">🔥 ${skText}</span>
       </div>
     </div>`;

  _bindGoalSwipe(gc);
  return true;
}

/* Swipe the tile left/right to change goal. */
function _bindGoalSwipe(elm){
  if(!hasSecondGoal() || elm._swipeBound) return;
  elm._swipeBound = true;
  let sx = null;
  elm.addEventListener("touchstart", e => { sx = e.touches[0].clientX; }, {passive:true});
  elm.addEventListener("touchend", e => {
    if(sx === null) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if(dx < -40) switchGoal(2);
    else if(dx > 40) switchGoal(1);
  });
}

/* Legacy hook: the old ring hero is gone. Keep #goal-bar empty. */
function renderGoalBar(){
  const host = document.getElementById("goal-bar");
  if(host) host.innerHTML = "";
}

/* ---------- cover picker (menu + tile + reposition) ---------- */
function openCoverPicker(){
  const slot = activeSlot();
  const g = goalBySlot(slot);
  if(!g){ showToast("No goal to set a cover for", "info"); return; }
  const col = _goalColour(slot);
  const isPhoto = _isPhotoMode(g.cover_mode) && !!g.cover_url;
  const pos = _coverPosFor(g.cover_mode);
  _agOpen(`
    <div style="font-size:9px;letter-spacing:.14em;color:#7a7a7a;font-weight:800;margin-bottom:6px">GOAL ${slot} COVER</div>
    <h3 style="margin:0 0 4px;font-size:18px">Cover for this goal</h3>
    <p style="color:#7a7a7a;font-size:12px;line-height:1.55;margin:0 0 14px">
      Generated from your goal by default. Use your own photo if you'd rather.</p>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <div onclick="setCoverMode('auto')" style="flex:1;aspect-ratio:1.6;border-radius:10px;cursor:pointer;
        border:2px solid ${!isPhoto ? col : "#242424"};
        background-image:${_autoCover(g.goal_raw, col)};background-size:cover;
        display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#cfcfcf">GENERATED</div>
      <div onclick="pickCoverPhoto()" style="flex:1;aspect-ratio:1.6;border-radius:10px;cursor:pointer;
        border:2px solid ${isPhoto ? col : "#242424"};overflow:hidden;background:#141414;
        display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#8a8a8a;
        ${g.cover_url ? `background-image:url('${g.cover_url}');background-size:cover;background-position:${pos.x}% ${pos.y}%` : ""}">
        ${g.cover_url ? "" : "YOUR PHOTO"}</div>
    </div>
    ${isPhoto ? `
    <div id="cover-reframe" style="position:relative;width:100%;aspect-ratio:1.6;border-radius:10px;overflow:hidden;
      cursor:grab;touch-action:none;background-image:url('${g.cover_url}');background-size:cover;
      background-position:${pos.x}% ${pos.y}%;margin-bottom:6px;border:1px solid #242424;user-select:none">
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".65">
          <path d="M8 9l-4 4 4 4M16 9l4 4-4 4M12 3v18"/></svg>
      </div>
    </div>
    <p style="font-size:10px;color:#666;margin:0 0 14px;text-align:center">Drag the photo to choose what shows</p>
    <button class="bs" style="width:100%;padding:10px;margin-bottom:8px;font-size:12px" onclick="pickCoverPhoto()">Change photo</button>` : ""}
    <input type="file" id="cover-file" accept="image/*"
      style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;opacity:0"
      onchange="uploadCover(this)">
    <button class="bs" style="width:100%;padding:11px" onclick="closeGoalMod()">Done</button>`);
  if(isPhoto){
    const box = document.getElementById("cover-reframe");
    if(box) _bindCoverDrag(box, g, pos);
  }
}

function pickCoverPhoto(){ const f = document.getElementById("cover-file"); if(f) f.click(); }

/* Drag (mouse or touch) to slide background-position within the frame.
   Persists to goals.cover_mode as "photo:X:Y" once the drag ends. */
function _bindCoverDrag(box, g, startPos){
  let ox = startPos.x, oy = startPos.y;
  const clamp = v => Math.max(0, Math.min(100, v));
  const start = (x, y) => {
    box.style.cursor = "grabbing";
    let cur = {x: ox, y: oy};
    const onMove = (mx, my) => {
      const r = box.getBoundingClientRect();
      const dx = (mx - x) / r.width * 100, dy = (my - y) / r.height * 100;
      cur = {x: clamp(ox - dx), y: clamp(oy - dy)};
      box.style.backgroundPosition = `${cur.x}% ${cur.y}%`;
    };
    const mouseMoveH = e => onMove(e.clientX, e.clientY);
    const touchMoveH = e => { const t = e.touches[0]; if(t){ onMove(t.clientX, t.clientY); e.preventDefault(); } };
    const onUp = () => {
      box.style.cursor = "grab";
      ox = cur.x; oy = cur.y;
      window.removeEventListener("mousemove", mouseMoveH);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", touchMoveH);
      window.removeEventListener("touchend", onUp);
      _saveCoverPosition(g, cur.x, cur.y);
    };
    window.addEventListener("mousemove", mouseMoveH);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", touchMoveH, {passive: false});
    window.addEventListener("touchend", onUp);
  };
  box.addEventListener("mousedown", e => { start(e.clientX, e.clientY); e.preventDefault(); });
  box.addEventListener("touchstart", e => { const t = e.touches[0]; if(t) start(t.clientX, t.clientY); }, {passive: true});
}

async function _saveCoverPosition(g, x, y){
  const mode = `photo:${Math.round(x)}:${Math.round(y)}`;
  g.cover_mode = mode;
  try{ await sb.from("goals").update({ cover_mode: mode }).eq("id", g.id); }catch(e){}
  if(typeof saveState === "function") saveState();
  renderGoalCard();
}

async function setCoverMode(mode){
  const slot = activeSlot(), g = goalBySlot(slot);
  if(!g) return;
  if(mode === "photo" && !g.cover_url){ pickCoverPhoto(); return; }
  g.cover_mode = mode;
  try{ await sb.from("goals").update({ cover_mode: mode }).eq("id", g.id); }catch(e){}
  if(typeof saveState === "function") saveState();
  renderGoalCard();
  /* Switching TO photo reopens the picker so the reposition frame shows
     immediately; switching to auto has nothing further to configure. */
  if(mode === "photo") openCoverPicker(); else closeGoalMod();
}

async function uploadCover(input){
  const file = input?.files?.[0];
  if(!file) return;
  if(file.size > 5 * 1024 * 1024){ showToast("Image is too large (max 5MB)", "error"); return; }
  const slot = activeSlot(), g = goalBySlot(slot);
  if(!g) return;
  showToast("Uploading cover…", "info");
  try{
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${S.user.supabaseId}/cover-${g.id}-${Date.now()}.${ext}`;
    /* Use the app's own storage helper (raw fetch + anon key) — same path
       every other upload takes. */
    const url = await uploadToStorage("uploads", path, file, file.type || "image/jpeg");
    if(!url) throw new Error("upload failed");
    g.cover_url = url; g.cover_mode = "photo";
    await sb.from("goals").update({ cover_url: url, cover_mode: "photo" }).eq("id", g.id);
    if(typeof saveState === "function") saveState();
    renderGoalCard();
    showToast("Cover updated — drag to position it", "success");
    /* Reopen (rather than close) so the new photo's reposition frame shows
       right away — no separate step to discover. */
    openCoverPicker();
  }catch(e){
    showToast("Could not upload that image", "error");
  }
}

/* ---------- add second goal ---------- */
function openAddGoal(){
  if(!isIntensive()){
    showToast("A second goal is part of The Intensive (30 days)", "info");
    return;
  }
  if(hasSecondGoal()){ showToast("You already have a second goal", "info"); return; }

  const g1 = goalBySlot(1) || {};
  const methods = (g1.proof_methods || []).join(", ") || "photo, note";

  _agOpen(`
    <div style="font-size:9px;letter-spacing:.14em;color:#7a7a7a;font-weight:700;margin-bottom:6px">SECOND GOAL</div>
    <h3 style="margin:0 0 4px;font-size:19px">What else are you carrying?</h3>
    <p style="color:#7a7a7a;font-size:12px;line-height:1.55;margin:0 0 16px">
      This one gets its own daily proof. Same bar as the first.</p>

    <label style="font-size:11px;color:#888;font-weight:700">THE GOAL</label>
    <textarea id="ag-goal" rows="3" placeholder="Say it plainly. What are you finishing?" style="margin:6px 0 14px"></textarea>

    <label style="font-size:11px;color:#888;font-weight:700">HOW YOU'LL PROVE IT</label>
    <textarea id="ag-proof" rows="2" placeholder="What lands in the upload box each day?" style="margin:6px 0 6px"></textarea>
    <div style="font-size:11px;color:#666;margin-bottom:14px">Goal 1 proves with: ${methods}.
      <button onclick="_agSame()" style="background:none;border:none;color:#c49a1c;font-size:11px;font-weight:700;padding:0;cursor:pointer">Use the same</button>
    </div>

    <label style="font-size:11px;color:#888;font-weight:700">HOW DO THEY RUN?</label>
    <div style="display:flex;gap:8px;margin:8px 0 16px">
      <button id="ag-con" onclick="_agMode('concurrent')" class="yn-btn" style="padding:12px;font-size:13px">
        Side by side<br><span style="font-size:10px;color:#888;font-weight:600">Both run from today</span></button>
      <button id="ag-seq" onclick="_agMode('sequential')" class="yn-btn" style="padding:12px;font-size:13px">
        One then the other<br><span style="font-size:10px;color:#888;font-weight:600">Opens after goal 1</span></button>
    </div>

    <button id="ag-submit" class="bp" style="width:100%;padding:13px" onclick="submitSecondGoal()">Add this goal →</button>
    <button class="bs" style="width:100%;padding:11px;margin-top:8px" onclick="closeGoalMod()">Not yet</button>`);

  S._agMode = "concurrent";
  _agMode("concurrent");
}

function _agOpen(inner){
  let m = document.getElementById("goal-mod");
  if(!m){
    m = document.createElement("div");
    m.id = "goal-mod";
    m.style.cssText = "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.75);display:flex;" +
      "align-items:center;justify-content:center;padding:18px";
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="mb" style="max-width:420px;max-height:90vh;overflow-y:auto">${inner}</div>`;
  m.style.display = "flex";
}
function closeGoalMod(){
  const m = document.getElementById("goal-mod");
  if(m){ m.style.display = "none"; m.innerHTML = ""; }
}
function _agMode(m){
  S._agMode = m;
  const on = "border-color:#c49a1c;background:rgba(196,154,28,.07);";
  const con = document.getElementById("ag-con"), seq = document.getElementById("ag-seq");
  if(con) con.style.cssText = "padding:12px;font-size:13px;" + (m === "concurrent" ? on : "");
  if(seq) seq.style.cssText = "padding:12px;font-size:13px;" + (m === "sequential" ? on : "");
}
function _agSame(){
  const g1 = goalBySlot(1) || {};
  const t = document.getElementById("ag-proof");
  if(t) t.value = g1.proof_description || "";
}

async function submitSecondGoal(){
  const goal  = (document.getElementById("ag-goal")?.value  || "").trim();
  const proof = (document.getElementById("ag-proof")?.value || "").trim();
  if(goal.length  < 8){ showToast("Say the goal properly", "error"); return; }
  if(proof.length < 4){ showToast("How will you prove it?", "error"); return; }

  const g1  = goalBySlot(1) || {};
  const seq = S._agMode === "sequential";
  const btn = document.getElementById("ag-submit");
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  const row = {
    challenger_id: S.user.supabaseId,
    slot: 2,
    goal_raw: goal,
    goal_summary: goal,
    proof_description: proof,
    proof_methods: g1.proof_methods || ["photo", "note"],
    proof_type: g1.proof_type || "output",
    threat: g1.threat || null,
    start_day: Math.min(S.day, _dur()),
    status: "active"
  };

  try{
    const { data, error } = await sb.from("goals").insert(row).select().single();
    if(error) throw error;
    S.goals = goalsList().concat([data]);
    S.goalMode = seq ? "sequential" : "concurrent";
    try{ await sb.from("challengers").update({ goal_mode: S.goalMode }).eq("id", S.user.supabaseId); }catch(e){}
    _slotMap();
    if(typeof saveState === "function") saveState();
    closeGoalMod();
    showToast("Second goal added", "success");
    if(typeof trackEvent === "function") trackEvent("second_goal_added", { mode: S.goalMode, day: S.day });
    switchGoal(2);
  }catch(e){
    /* RLS rejects slot 2 for anyone not on the 30-day tier. */
    if(btn){ btn.disabled = false; btn.textContent = "Add this goal →"; }
    showToast("Could not add it. A second goal needs The Intensive.", "error");
  }
}


/* ---------- the grid, made of their proof ---------- */
/* Same grid, same rules. Each completed day shows the actual upload,
   dimmed, with the day number and check sitting on top. */
function renderGoalGrid(){
  const g = document.getElementById("d-grid");
  if(!g) return false;
  const slot = activeSlot();
  if(!goalBySlot(slot)) return false;      // fall back to the classic grid

  const dur = _dur();
  const col = _goalColour(slot);
  const callDays = (typeof CALL_DAYS !== "undefined" && CALL_DAYS[dur]) || [];
  const ups = S.uploads;
  g.innerHTML = "";

  for(let i = 0; i < dur; i++){
    const d = i + 1;
    const up = ups[i];
    const isT = d === S.day, isM = d < S.day && !up, isF = d > S.day;
    const isCall = callDays.includes(d);

    const c = document.createElement("div");
    c.className = "dc" + (up ? " up" : isT ? " tod" : isM ? " ms" : isF ? " ft" : "") + (isCall ? " call-day" : "");
    c.style.position = "relative";
    c.style.overflow = "hidden";

    if(up){
      /* their proof, sitting under the check */
      const pr = document.createElement("div");
      pr.className = "dc-proof";
      if(up.fileUrl){
        const im = document.createElement("img");
        im.src = up.fileUrl; im.alt = ""; im.loading = "lazy";
        pr.appendChild(im);
      }else if(up.note){
        const nt = document.createElement("div");
        nt.className = "dc-note";
        nt.style.background = col + "3a";
        nt.textContent = up.note;
        pr.appendChild(nt);
      }else{
        pr.style.background = col + "26";
      }
      c.appendChild(pr);

      const lay = document.createElement("div");
      lay.className = "dc-lay";
      lay.innerHTML = `<span class="dn">D${d}</span><span class="ds">${up.reviewed ? "✓✓" : "✓"}</span>`;
      c.appendChild(lay);
      c.onclick = () => openViewMod(i);
      c.style.cursor = "pointer";
    }else{
      const ds = isT ? "NOW" : isM ? "-" : "";
      c.innerHTML = `<span class="dn">D${d}</span>${ds ? `<span class="ds">${ds}</span>` : ""}`;
      if(isT) c.onclick = openMod;
    }

    if(isCall){
      const b = document.createElement("span");
      b.style.cssText = "position:absolute;top:2px;right:2px;font-size:8px;opacity:.8;z-index:3";
      b.textContent = "📞";
      c.appendChild(b);
      if(isF && typeof openCallModal === "function"){ c.onclick = () => openCallModal(d); c.style.cursor = "pointer"; }
    }
    g.appendChild(c);
  }
  return true;
}
