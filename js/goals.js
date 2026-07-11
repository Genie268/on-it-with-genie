/* ── MULTI-GOAL SUPPORT (30-day Intensive tier) ──
   Design: S.uploads always points at the ACTIVE goal's upload array —
   every existing renderer (renderGrid, streak math, subUp, openViewMod,
   etc.) keeps working completely unchanged because they only ever read
   S.uploads/S.day. Per-goal arrays live in S.uploadsBySlot={1:[],2:[]}.
   switchGoal() stashes the outgoing slot's array back into
   S.uploadsBySlot and swaps S.uploads to point at the new slot's array.

   Everything here is defensive: loadGoals() never throws, and every
   function no-ops safely for 7/15-day users who will never have a
   second goal. */

/* ── QUERIES ── */
function goalsList(){ return Array.isArray(S.goals)?S.goals:[]; }
function goalBySlot(slot){ return goalsList().find(g=>g.slot===slot)||null; }
function hasSecondGoal(){ return !!goalBySlot(2); }
function isIntensive(){ return getDur()===30; }

/* Which slot is currently active. Slot 2 only if explicitly selected AND
   a slot-2 goal actually exists — otherwise always fall back to slot 1. */
function activeSlot(){
  return (S.activeGoal===2 && hasSecondGoal()) ? 2 : 1;
}
function activeGoalRow(){ return goalBySlot(activeSlot()); }

/* ── SLOT STORAGE ── */
/* Lazily builds S.uploadsBySlot, seeding slot 1 from whatever S.uploads
   currently holds (covers the case where uploads were loaded/restored
   before goals.js ever ran). */
function _slotMap(){
  if(!S.uploadsBySlot||typeof S.uploadsBySlot!=="object") S.uploadsBySlot={};
  if(!Array.isArray(S.uploadsBySlot[1])){
    S.uploadsBySlot[1]=Array.isArray(S.uploads)?S.uploads.slice():Array(getDur()).fill(null);
  }
  if(!Array.isArray(S.uploadsBySlot[2])){
    S.uploadsBySlot[2]=Array(getDur()).fill(null);
  }
  return S.uploadsBySlot;
}

/* Stash whatever S.uploads currently is back into its slot before swapping. */
function _stashActive(){
  const slot=activeSlot();
  const map=_slotMap();
  map[slot]=Array.isArray(S.uploads)?S.uploads:map[slot];
}

/* Pad a slot's array to getDur() with nulls, point S.uploads at it. */
function _loadSlot(slot){
  const map=_slotMap();
  const dur=getDur();
  if(!Array.isArray(map[slot])) map[slot]=Array(dur).fill(null);
  while(map[slot].length<dur) map[slot].push(null);
  S.uploads=map[slot];
}

/* ── STREAK / PROGRESS PER SLOT ── */
function streakFor(slot){
  const map=_slotMap();
  const arr=map[slot]||[];
  const d=S.day||1;
  let sk=0;
  for(let i=d-1;i>=0;i--){ if(arr[i]) sk++; else break; }
  return sk;
}
function uploadCountFor(slot){
  const map=_slotMap();
  return (map[slot]||[]).filter(v=>!!v).length;
}
function startDayFor(slot){
  const row=goalBySlot(slot);
  return row&&typeof row.start_day==="number"&&row.start_day>0 ? row.start_day : 1;
}
function expectedDaysFor(slot){
  return Math.max(1, getDur() - (startDayFor(slot) - 1));
}
function goalComplete(slot){
  const expected=expectedDaysFor(slot);
  const need=Math.ceil(expected*0.8);
  return uploadCountFor(slot) >= need;
}
function bothGoalsComplete(){
  if(!hasSecondGoal()) return goalComplete(1);
  return goalComplete(1) && goalComplete(2);
}

/* Slot 2 stays closed in sequential mode until goal 1 is complete. In
   concurrent mode both are always open. */
function goalOpenToday(slot){
  if(slot===1) return true;
  if(!hasSecondGoal()) return false;
  if(S.goalMode==="sequential") return goalComplete(1);
  return true;
}

/* ── LOAD FROM SUPABASE ── */
async function loadGoals(){
  try{
    if(!sb||!S.user?.supabaseId) return;
    const {data,error}=await sb.from("goals").select("*").eq("challenger_id",S.user.supabaseId).order("slot",{ascending:true});
    if(error||!data) return;
    S.goals=data;
    const slot2=data.find(g=>g.slot===2);
    if(slot2){
      const {data:ups,error:upErr}=await sb.from("uploads").select("*").eq("challenger_id",S.user.supabaseId).eq("goal_id",slot2.id);
      if(!upErr&&ups){
        const dur=getDur();
        const arr=Array(dur).fill(null);
        ups.forEach(u=>{
          if(u.day_number>=1&&u.day_number<=dur){
            arr[u.day_number-1]={note:u.note,hasFile:!!u.file_url,fileName:u.file_name,fileUrl:u.file_url||null,proofType:u.proof_type,link:u.link_url,behavior:u.behavior_answer,hasVoice:!!u.voice_url,voiceUrl:u.voice_url||null,reviewNote:u.review_note||null,time:u.created_at||null};
          }
        });
        _slotMap();
        S.uploadsBySlot[2]=arr;
      }
    }
  }catch(e){
    console.warn("loadGoals failed:",e);
  }
}

/* ── SWITCH ACTIVE GOAL ── */
function switchGoal(slot){
  if(slot===2&&!hasSecondGoal())return;
  _stashActive();
  S.activeGoal=slot;
  _loadSlot(slot);
  const row=goalBySlot(slot);
  if(row&&S.user){
    if(!S.user.answers||typeof S.user.answers!=="object") S.user.answers={};
    S.user.answers.goal=row.goal_raw;
    S.user.answers.goalSummary=row.goal_summary||row.goal_raw;
    S.user.answers.proof=row.proof_description||null;
    S.user.answers.proofType=row.proof_type||"output";
    S.user.answers.proofMethods=row.proof_methods||[];
  }
  saveState();
  renderDash();
}

/* ── GOAL BAR (renders into #goal-bar) ── */
function renderGoalBar(){
  const bar=el("goal-bar");
  if(!bar)return;
  if(!hasSecondGoal()){
    /* Only offer a second goal to 30-day Intensive users. */
    if(!isIntensive()){ bar.innerHTML=""; return; }
    bar.innerHTML=`<div onclick="openAddGoal()" style="margin-bottom:10px;padding:14px;border:1.5px dashed rgba(196,154,28,.35);border-radius:12px;text-align:center;cursor:pointer;background:rgba(196,154,28,.03);transition:background .15s" onmouseenter="this.style.background='rgba(196,154,28,.07)'" onmouseleave="this.style.background='rgba(196,154,28,.03)'">
      <p style="font-size:13px;font-weight:700;color:#c49a1c;margin:0">+ Add your second goal</p>
      <p style="font-size:11px;color:#888;margin:3px 0 0">The Intensive gives you two goals. Set the second one whenever you're ready.</p>
    </div>`;
    return;
  }
  const active=activeSlot();
  const g1=goalBySlot(1), g2=goalBySlot(2);
  const trunc=s=>{ s=(s||"").trim(); return s.length>22?s.slice(0,22).trim()+"…":s; };
  const tabHtml=(slot,row,color)=>{
    const isActive=slot===active;
    const open=goalOpenToday(slot);
    const label=trunc(row?.goal_summary||row?.goal_raw||`Goal ${slot}`);
    const sk=streakFor(slot);
    const d=S.day||1;
    if(!open){
      return `<div style="flex:1;padding:10px 12px;border-radius:10px;border:1px solid ${color}33;background:${color}0a;opacity:.55;cursor:default">
        <p style="font-size:12px;font-weight:700;color:${color};margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</p>
        <p style="font-size:10px;color:#888;margin:2px 0 0">Opens after goal 1</p>
      </div>`;
    }
    return `<div onclick="switchGoal(${slot})" style="flex:1;padding:10px 12px;border-radius:10px;border:1.5px solid ${isActive?color:color+"33"};background:${isActive?color+"14":"transparent"};cursor:pointer;transition:all .15s">
      <p style="font-size:12px;font-weight:700;color:${color};margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</p>
      <p style="font-size:10px;color:#888;margin:2px 0 0">Day ${d} · ${sk===0?"no streak":sk+"-day streak"}</p>
    </div>`;
  };
  bar.innerHTML=`<div style="display:flex;gap:8px;margin-bottom:10px">${tabHtml(1,g1,"#c49a1c")}${tabHtml(2,g2,"#4dc98a")}</div>`;
}

/* ── ADD SECOND GOAL MODAL ── */
function openAddGoal(){
  if(!isIntensive()){ showToast("A second goal needs The Intensive.","error"); return; }
  document.getElementById("goal-mod")?.remove();
  const ov=document.createElement("div");
  ov.id="goal-mod";
  ov.className="mo show";
  ov.innerHTML=`<div class="mb" style="max-width:420px">
    <div class="row mb16" style="justify-content:space-between;align-items:flex-start">
      <div><span class="lbl lbl-a">SECOND GOAL</span><h3 style="font-size:18px;font-weight:800">Add your second goal</h3></div>
      <button onclick="document.getElementById('goal-mod').remove()" style="background:#232323;border:none;color:#888;width:28px;height:28px;border-radius:7px;font-size:12px;cursor:pointer">✕</button>
    </div>
    <span class="lbl">THE GOAL</span>
    <textarea id="ag-goal" rows="2" placeholder="What's the second thing you're committing to?" style="font-size:14px;width:100%;margin-bottom:12px"></textarea>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <span class="lbl m0">HOW YOU'LL PROVE IT</span>
      <span onclick="_ag_useSameProof()" style="font-size:11px;color:#c49a1c;cursor:pointer;font-weight:600">Use the same →</span>
    </div>
    <textarea id="ag-proof" rows="2" placeholder="What counts as daily proof for this goal?" style="font-size:14px;width:100%;margin-bottom:14px"></textarea>
    <span class="lbl">HOW SHOULD THE TWO GOALS WORK?</span>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button id="ag-mode-concurrent" class="bs" style="flex:1;font-size:12px;padding:10px 8px;border-color:rgba(196,154,28,.4)" onclick="_ag_setMode('concurrent')">Run together<br><span style="font-weight:400;color:#888;font-size:10px">Both open daily</span></button>
      <button id="ag-mode-sequential" class="bs" style="flex:1;font-size:12px;padding:10px 8px" onclick="_ag_setMode('sequential')">One at a time<br><span style="font-weight:400;color:#888;font-size:10px">Goal 2 opens after goal 1</span></button>
    </div>
    <button id="ag-submit" class="bp" style="width:100%;padding:13px;font-size:15px" onclick="submitSecondGoal()">Add Second Goal →</button>
  </div>`;
  document.body.appendChild(ov);
  S._agMode="concurrent";
  setTimeout(()=>el("ag-goal")?.focus(),50);
}

function _ag_useSameProof(){
  const row=goalBySlot(1);
  const ta=el("ag-proof");
  if(ta) ta.value=row?.proof_description||S.user?.answers?.proof||"";
}

function _ag_setMode(mode){
  S._agMode=mode;
  const c=el("ag-mode-concurrent"),s=el("ag-mode-sequential");
  if(c) c.style.borderColor=mode==="concurrent"?"rgba(196,154,28,.4)":"#222";
  if(s) s.style.borderColor=mode==="sequential"?"rgba(196,154,28,.4)":"#222";
}

async function submitSecondGoal(){
  const goalTa=el("ag-goal"),proofTa=el("ag-proof");
  const goalRaw=(goalTa?.value||"").trim();
  const proofDesc=(proofTa?.value||"").trim();
  if(goalRaw.length<5){ if(goalTa) goalTa.style.border="1px solid #d9503a"; return; }
  if(proofDesc.length<3){ if(proofTa) proofTa.style.border="1px solid #d9503a"; return; }
  const btn=el("ag-submit");
  if(btn){ btn.disabled=true; btn.textContent="Adding..."; }
  try{
    if(!sb||!S.user?.supabaseId) throw new Error("not_connected");
    const g1=goalBySlot(1);
    const mode=S._agMode||"concurrent";
    const startDay=Math.min(S.day||1,getDur());
    const {error}=await sb.from("goals").insert({
      challenger_id:S.user.supabaseId,
      slot:2,
      goal_raw:goalRaw,
      goal_summary:goalRaw,
      proof_description:proofDesc,
      proof_methods:g1?.proof_methods||S.user?.answers?.proofMethods||[],
      proof_type:g1?.proof_type||S.user?.answers?.proofType||"output",
      start_day:startDay,
      status:"active"
    });
    if(error) throw error;
    S.goalMode=mode;
    try{ await sb.from("challengers").update({goal_mode:mode}).eq("id",S.user.supabaseId); }catch(e){ /* column may not exist yet — client-side state still holds */ }
    saveState();
    document.getElementById("goal-mod")?.remove();
    showToast("Second goal added","success");
    await loadGoals();
    switchGoal(2);
  }catch(e){
    console.warn("submitSecondGoal failed:",e);
    showToast("Could not add it. A second goal needs The Intensive.","error");
    if(btn){ btn.disabled=false; btn.textContent="Add Second Goal →"; }
  }
}
