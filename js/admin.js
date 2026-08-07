/* ── ADMIN SESSION & API HELPERS ── */
function getAdminToken(){return sessionStorage.getItem("admin_token")||"";}
function setAdminToken(t){if(t)sessionStorage.setItem("admin_token",t);else sessionStorage.removeItem("admin_token");}

async function adminFetch(action,params){
  const token=getAdminToken();
  if(!token)throw new Error("not_authenticated");
  const res=await fetch(ADMIN_API_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action,token,...(params||{})})
  });
  const data=await res.json();
  if(!res.ok||!data.ok){
    if(data.error==="invalid_or_expired_token"){setAdminToken("");S._adminAuth=false;renderAdmin();throw new Error("Session expired");}
    throw new Error(data.error||"admin_api_error");
  }
  return data;
}

/* ── LIVE ADMIN DATA FROM SUPABASE ── */
let liveChallengers=[];
let adminDataLoaded=false;

/* Missed days for a challenger, honouring early completion: days on or after
   the completed_on day are WON (closed), never misses. So an early-completed
   member never reads as "at risk" or failing anywhere in the admin. */
function _missedDays(u){
  if(!u||!Array.isArray(u.up)) return 0;
  const comp=(typeof u.completedOn==="number"&&u.completedOn>0)?u.completedOn:0;
  const cap=comp?Math.min(u.day-1,comp-1):(u.day-1);
  if(cap<=0) return 0;
  return u.up.slice(0,cap).filter(v=>!v).length;
}

async function loadAdminData(){
  if(!getAdminToken()){liveChallengers=[];adminDataLoaded=true;return;}
  try{
    const res=await adminFetch("load_data");
    const challengers=res.challengers||[];
    if(!challengers.length){liveChallengers=[];adminDataLoaded=true;return;}
    const allUploads=res.uploads||[];
    const allEnergy=res.energy_logs||[];
    const allPlans=res.daily_plans||[];
    const allPushSubs=res.push_subs||[];
    const allReminderLogs=res.reminder_logs||[];
    const allGoals=res.goals||[];
    window._adminReminderLogs=allReminderLogs;

    /* Gap notes power the miss readback: Genie sees why a day was missed
       before opening a call. gap_notes RLS is permissive, so we read it
       straight from the client like the rest of the readback data. */
    let allGapNotes=[];
    try{
      if(typeof sb!=="undefined"&&sb){
        const {data:gn}=await sb.from("gap_notes").select("*");
        if(Array.isArray(gn)) allGapNotes=gn;
      }
    }catch(e){ allGapNotes=[]; }

    /* Round lifecycle (round_status / completed_on / completion_requested_at)
       may not be in the admin-api payload, so read it straight from the
       (world-readable) challengers table and merge by id. */
    const roundById={};
    try{
      if(typeof sb!=="undefined"&&sb){
        const {data:rd}=await sb.from("challengers").select("id,round_status,completed_on,completion_requested_at,cleared_at");
        if(Array.isArray(rd)) rd.forEach(r=>{ roundById[r.id]=r; });
      }
    }catch(e){}

    liveChallengers=challengers.map(c=>{
      const _rc=roundById[c.id]||{};
      if(_rc.round_status!==undefined) c.round_status=_rc.round_status;
      if(_rc.completed_on!==undefined) c.completed_on=_rc.completed_on;
      if(_rc.completion_requested_at!==undefined) c.completion_requested_at=_rc.completion_requested_at;
      if(_rc.cleared_at!==undefined) c.cleared_at=_rc.cleared_at;
      const uploads=(allUploads||[]).filter(u=>u.challenger_id===c.id);
      const energy=(allEnergy||[]).filter(e=>e.challenger_id===c.id);
      const plans=(allPlans||[]).filter(p=>p.challenger_id===c.id);
      const dur=c.duration||15;

      /* ── Multi-goal (30-day Intensive) support ──
         A challenger can have up to two goal rows; each day-number can then
         hold one upload PER GOAL. We build a separate set of per-day arrays
         for each goal, keyed by goal id, so the admin can view/review each
         goal independently instead of one silently overwriting the other. */
      const goalRows=(allGoals||[]).filter(g=>g.challenger_id===c.id)
        .sort((a,b)=>(a.slot||1)-(b.slot||1));
      /* Uniform goal list even for legacy/single-goal challengers with no
         goals row — synthesize one from the challenger's own fields. */
      const goals=goalRows.length?goalRows.map(g=>({
        id:g.id,slot:g.slot||1,goalRaw:g.goal_raw,goalSummary:g.goal_summary||g.goal_raw,
        proofType:g.proof_type||"output",coverUrl:g.cover_url||null,coverMode:g.cover_mode||null,
        startDay:g.start_day||1
      })):[{
        id:"_primary",slot:1,goalRaw:c.goal_raw,goalSummary:c.goal_summary||c.goal_raw,
        proofType:c.proof_type||"output",coverUrl:null,coverMode:null,startDay:1
      }];
      const primaryGoalId=goals[0].id;

      const _blankArrays=()=>({
        up:Array(dur).fill(0),notes:Array(dur).fill("-"),rv:Array(dur).fill(0),
        hasVoice:Array(dur).fill(0),voiceUrls:Array(dur).fill(null),fileUrls:Array(dur).fill(null),
        links:Array(dur).fill(null),fileNames:Array(dur).fill(null),behaviors:Array(dur).fill(null),
        uploadTimes:Array(dur).fill(null),reviewNotes:Array(dur).fill(null),rvCount:0
      });
      const byGoal={};
      goals.forEach(g=>{ byGoal[g.id]=_blankArrays(); });
      const knownGoalIds=new Set(goals.map(g=>g.id));

      uploads.forEach(u=>{
        if(u.day_number<1||u.day_number>dur)return;
        /* Route to the upload's own goal when known; otherwise (null goal_id
           on legacy rows, or a stray id) fall back to the primary goal —
           this matches the DB trigger that defaults goal_id to slot 1. */
        const gid=(u.goal_id&&knownGoalIds.has(u.goal_id))?u.goal_id:primaryGoalId;
        const a=byGoal[gid];
        const i=u.day_number-1;
        a.up[i]=1;
        a.notes[i]=u.note||"No note";
        a.rv[i]=u.reviewed?1:0;
        a.hasVoice[i]=u.voice_url?1:0;
        a.voiceUrls[i]=u.voice_url||null;
        a.fileUrls[i]=u.file_url||null;
        a.links[i]=u.link_url||null;
        a.fileNames[i]=u.file_name||null;
        a.behaviors[i]=u.behavior_answer||null;
        a.uploadTimes[i]=u.created_at||null;
        a.reviewNotes[i]=u.review_note||null;
      });
      Object.keys(byGoal).forEach(gid=>{ byGoal[gid].rvCount=byGoal[gid].rv.filter(Boolean).length; });

      const elog={};
      energy.forEach(e=>{elog[e.day_number]={type:e.log_type,value:e.value};});
      const startDate=new Date(c.start_date);
      const now=new Date();
      const curDay=Math.min(Math.max(Math.floor((now-startDate)/(1000*60*60*24))+1,1),dur);
      /* Uncapped day count — curDay is clamped to dur, so it can't tell the
         final active day apart from a finished challenge. rawDay > dur is the
         real "the window has closed" signal. */
      const rawDay=Math.max(1,Math.floor((now-startDate)/(1000*60*60*24))+1);
      const prim=byGoal[primaryGoalId];
      /* Early completion: days on or after completed_on are won, not missed. */
      const _comp=(c.round_status==="completed_early"||c.round_status==="ended")&&c.completed_on?c.completed_on:0;
      const _missCap=_comp?Math.min(curDay-1,_comp-1):(curDay-1);
      const missed=_missCap>0?prim.up.slice(0,_missCap).filter(v=>!v).length:0;
      /* Top-level arrays mirror the PRIMARY goal, so every existing
         single-goal view keeps working unchanged. Multi-goal views read
         byGoal[activeGoalId] and can re-point these via _adminSelectGoal(). */
      return {
        id:c.id,name:c.name,photo:c.photo_url||null,
        ini:(c.name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2),
        goal:c.goal_summary||c.goal_raw,pt:c.proof_type||"output",
        day:curDay,rawDay,dur,
        up:prim.up,notes:prim.notes,rv:prim.rv,rvCount:prim.rvCount,
        energyLog:elog,hasVoice:prim.hasVoice,voiceUrls:prim.voiceUrls,fileUrls:prim.fileUrls,
        links:prim.links,fileNames:prim.fileNames,behaviors:prim.behaviors,uploadTimes:prim.uploadTimes,reviewNotes:prim.reviewNotes,
        flag:missed>=4?`${missed} missed days`:null,
        email:c.email,phone:c.phone,
        paymentStatus:c.payment_status,supabaseId:c.id,status:c.status,
        goalRaw:c.goal_raw,goalSummary:c.goal_summary,
        proofDescription:c.proof_description,proofType:c.proof_type||"output",
        threat:c.threat,startDate:c.start_date,lastSeen:c.last_seen,
        createdAt:c.created_at,
        lastAttentionClearedAt:c.last_attention_cleared_at||null,
        clearedAt:c.cleared_at||null,
        roundStatus:c.round_status||"active",
        completedOn:c.completed_on||null,
        completionRequestedAt:c.completion_requested_at||null,
        gapNotes:allGapNotes.filter(n=>n.user_id===c.id).sort((a,b)=>a.start_day-b.start_day),
        hasPush:allPushSubs.some(s=>s.challenger_id===c.id&&s.is_active),
        plans:plans.sort((a,b)=>a.day_number-b.day_number),
        witnessesEnabled:c.witnesses_enabled===true,
        goals,byGoal,primaryGoalId,activeGoalId:primaryGoalId,isMultiGoal:goals.length>1
      };
    });
    adminDataLoaded=true;
  }catch(e){console.error("Admin load error:",e);liveChallengers=[];adminDataLoaded=true;}
}

/* ── Multi-goal helpers (admin side) ──────────────────────────────────
   The top-level u.up/u.notes/etc arrays mirror ONE goal at a time. These
   let callers read a specific goal's arrays, or re-point the top-level
   arrays at a chosen goal before re-rendering the detail view. */
function _adminGoalArrays(u,goalId){
  if(u&&u.byGoal){
    if(goalId&&u.byGoal[goalId]) return u.byGoal[goalId];
    if(u.byGoal[u.primaryGoalId]) return u.byGoal[u.primaryGoalId];
  }
  return u; /* legacy shape: arrays live directly on u */
}
function _adminGoalMeta(u,goalId){
  if(!u||!u.goals) return null;
  return u.goals.find(g=>g.id===goalId)||u.goals[0]||null;
}
/* Re-point u.up/u.notes/... at the chosen goal so every existing renderer
   (which reads the top-level arrays) shows that goal. */
function _adminSelectGoal(u,goalId){
  const a=_adminGoalArrays(u,goalId);
  u.up=a.up;u.notes=a.notes;u.rv=a.rv;u.rvCount=a.rvCount;
  u.hasVoice=a.hasVoice;u.voiceUrls=a.voiceUrls;u.fileUrls=a.fileUrls;
  u.links=a.links;u.fileNames=a.fileNames;u.behaviors=a.behaviors;
  u.uploadTimes=a.uploadTimes;u.reviewNotes=a.reviewNotes;
  u.activeGoalId=(u.byGoal&&u.byGoal[goalId])?goalId:u.primaryGoalId;
  const meta=_adminGoalMeta(u,u.activeGoalId);
  if(meta) u.goal=meta.goalSummary||meta.goalRaw||u.goal;
  return u;
}
/* Switch the visible goal in an expanded challenger detail and re-render
   just that detail body (keeps the card expanded). */
function adminSwitchChallengerGoal(uid,goalId){
  const u=liveChallengers.find(x=>x.id===uid);
  if(!u)return;
  _adminSelectGoal(u,goalId);
  const det=el("ch-det-"+uid);
  if(det) det.innerHTML=renderChallengerDetail(u);
}
/* Total uploads / pending across ALL of a challenger's goals — so the
   overview counts and review queue don't silently ignore goal 2. */
function _adminTotalUploads(u){
  if(!u||!u.byGoal) return (u.up||[]).filter(Boolean).length;
  return Object.values(u.byGoal).reduce((s,a)=>s+a.up.filter(Boolean).length,0);
}
function _adminTotalReviewed(u){
  if(!u||!u.byGoal) return u.rvCount||0;
  return Object.values(u.byGoal).reduce((s,a)=>s+(a.rvCount||0),0);
}
/* Short DOM-safe token for a goal id, shared by the inbox renderer and its
   reply handlers so they build the same textarea id. */
function _inbTok(goalId){
  return goalId?String(goalId).replace(/[^a-zA-Z0-9]/g,"").slice(-8):"p";
}

/* Complete only once the window has fully closed (rawDay > dur) or the row is
   explicitly marked completed — NOT on the final active day, so a day-`dur`
   upload still surfaces in the review queue. */
function _isComplete(u){return u.status==="completed"||(u.rawDay||u.day)>u.dur;}
function _isPaid(u){return u.paymentStatus==="paid"||u.paymentStatus==="free"||u.paymentStatus==="completed";}
function getAM(){return liveChallengers.filter(_isPaid);}
function getActiveAM(){return liveChallengers.filter(u=>_isPaid(u)&&!_isComplete(u));}
function getAllAM(){return liveChallengers;}

function _isOnline(lastSeen){
  if(!lastSeen)return false;
  return (Date.now()-new Date(lastSeen).getTime())<120000;
}
function _onlineDot(lastSeen,size){
  size=size||10;
  if(!_isOnline(lastSeen))return "";
  return `<span style="position:absolute;bottom:-1px;right:-1px;width:${size}px;height:${size}px;border-radius:50%;background:#4dc98a;border:2px solid #0a0a0a"></span>`;
}
function _avatarWithStatus(u,sz,radius){
  sz=sz||36;radius=radius||"50%";
  const img=u.photo?`<img src="${u.photo}" style="width:${sz}px;height:${sz}px;object-fit:cover;border-radius:${radius}">`:`<div style="width:${sz}px;height:${sz}px;border-radius:${radius};background:rgba(196,154,28,.1);border:1.5px solid rgba(196,154,28,.25);display:flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.3)}px;font-weight:800;color:#c49a1c">${u.ini}</div>`;
  return `<div style="position:relative;flex-shrink:0;width:${sz}px;height:${sz}px">${img}${_onlineDot(u.lastSeen,Math.max(8,Math.round(sz*0.25)))}</div>`;
}
function _formatLastSeen(lastSeen){
  if(!lastSeen)return "Never seen";
  if(_isOnline(lastSeen))return '<span style="color:#4dc98a">Online</span>';
  const d=new Date(lastSeen),now=new Date();
  const timeStr=d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  if(d.toDateString()===now.toDateString())return "last seen today at "+timeStr;
  const yest=new Date(now-86400000);
  if(d.toDateString()===yest.toDateString())return "last seen yesterday at "+timeStr;
  return "last seen "+d.toLocaleDateString([],{month:"short",day:"numeric"})+" at "+timeStr;
}

/* ── ADMIN NOTIFICATION TRACKING ── */
let _adminNewSignups=[];
let _adminLastKnownIds=new Set();

function _trackNewSignups(){
  const all=getAM();
  if(_adminLastKnownIds.size===0){
    _adminLastKnownIds=new Set(all.map(u=>u.id));
    return;
  }
  all.forEach(u=>{
    if(!_adminLastKnownIds.has(u.id)){
      _adminNewSignups.push({id:u.id,name:u.name,time:Date.now()});
      _adminLastKnownIds.add(u.id);
    }
  });
}
function _getNewSignupCount(){
  _adminNewSignups=_adminNewSignups.filter(s=>Date.now()-s.time<86400000);
  return _adminNewSignups.length;
}
function _clearNewSignups(){_adminNewSignups=[];}

/* ── ADMIN UNREAD MESSAGE TRACKING ── */
let adminUnreadMessages=[];
let adminRecentMessages=[];

async function loadAdminMessages(){
  if(!getAdminToken())return;
  try{
    const res=await adminFetch("load_messages");
    const msgs=res.messages||[];
    const seen=new Set();
    const latest=[];
    for(const m of msgs){
      if(!seen.has(m.challenger_id)){
        seen.add(m.challenger_id);
        latest.push(m);
      }
    }
    adminRecentMessages=latest;
    adminUnreadMessages=res.unread||[];
  }catch(e){console.error("loadAdminMessages error:",e);adminRecentMessages=[];adminUnreadMessages=[];}
}

function getUnreadCountForChallenger(uid){
  return adminUnreadMessages.filter(m=>m.challenger_id===uid).length;
}

function getTotalUnreadCount(){
  return adminUnreadMessages.length;
}

function timeAgo(dateStr){
  const now=Date.now(),then=new Date(dateStr).getTime();
  const diff=Math.floor((now-then)/1000);
  if(diff<5) return "just now";
  if(diff<60) return diff+"s ago";
  if(diff<3600) return Math.floor(diff/60)+"m ago";
  if(diff<86400) return Math.floor(diff/3600)+"h ago";
  return Math.floor(diff/86400)+"d ago";
}

/* ── ADMIN (PIN-gated) ── */
let adminCurrentTab = "overview";

async function renderAdmin(){
  if(!S._adminAuth&&getAdminToken()) S._adminAuth=true;
  if(!S._adminAuth){
    /* PIN form is in the static HTML — just ensure it's visible and focused */
    const c=document.getElementById("admin-content");
    if(c){
      const ps=document.getElementById("admin-pin-static");
      if(!ps){
        /* Static HTML was replaced (e.g. after auth then exit) — re-inject */
        c.innerHTML=`<div id="admin-pin-static" style="max-width:300px;margin:60px auto;text-align:center">
          <span class="lbl lbl-a" style="display:block;margin-bottom:12px">ADMIN ACCESS</span>
          <h3 style="font-size:18px;font-weight:800;margin-bottom:16px;color:#ebebeb">Enter PIN</h3>
          <input id="admin-pin-input" type="tel" inputmode="numeric" pattern="[0-9]*" placeholder="····" maxlength="6" autocomplete="off" style="text-align:center;font-size:28px;letter-spacing:8px;padding:14px;width:100%;max-width:200px;display:block;margin:0 auto 14px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;color:#ebebeb" onkeydown="if(event.key==='Enter')checkAdminPin()">
          <button class="bp" style="width:100%;max-width:200px;padding:12px;font-size:15px" onclick="checkAdminPin()">Enter →</button>
          <p id="admin-pin-msg" style="font-size:12px;margin-top:12px;min-height:18px"></p>
        </div>`;
      }
    }
    setTimeout(()=>document.getElementById("admin-pin-input")?.focus(),200);
    return;
  }
  const c=el("admin-content");
  adminDataLoaded=false;
  if(!adminDataLoaded){
    c.innerHTML=`<div style="text-align:center;padding:60px 20px"><div class="spinner" style="margin:0 auto 12px"></div><p class="muted">Loading challengers...</p></div>`;
    try{
      await loadAdminData();
      _trackNewSignups();
      await loadAdminMessages();
    }catch(e){
      c.innerHTML=`<div style="text-align:center;padding:60px 20px">
        <p style="color:#d9503a;font-size:14px;margin-bottom:16px">Failed to load data</p>
        <p class="muted" style="font-size:12px;margin-bottom:20px">${e?.message||"Check your connection"}</p>
        <button class="bp" style="padding:10px 24px" onclick="adminDataLoaded=false;renderAdmin()">Retry</button>
      </div>`;
      return;
    }
  }
  adminCurrentTab="overview";
  adminTab("overview");
}

async function checkAdminPin(){
  const pin=(el("admin-pin-input")?.value||"").trim();
  if(!pin){const msg=el("admin-pin-msg");if(msg){msg.textContent="Enter a PIN";msg.style.color="#d9503a";}return;}
  const btn=document.querySelector("#admin-pin-static .bp");
  if(btn){btn.disabled=true;btn.textContent="Verifying...";}
  try{
    const res=await fetch(ADMIN_LOGIN_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({pin})
    });
    const data=await res.json();
    if(!data.ok){
      const msg=el("admin-pin-msg");
      if(msg){msg.textContent=data.error==="invalid_pin"?"Incorrect PIN, try again":"Login failed";msg.style.color="#d9503a";}
      const input=el("admin-pin-input");
      if(input){input.value="";input.focus();}
      if(btn){btn.disabled=false;btn.textContent="Enter →";}
      return;
    }
    setAdminToken(data.token);
    trackEvent("admin_login");
    S._adminAuth=true;
    const msg=el("admin-pin-msg");
    if(msg){msg.textContent="";msg.style.color="";}
    renderAdmin();
  }catch(e){
    const msg=el("admin-pin-msg");
    if(msg){msg.textContent="Connection error. Try again.";msg.style.color="#d9503a";}
    if(btn){btn.disabled=false;btn.textContent="Enter →";}
  }
}

/* ── ADMIN PIN MANAGEMENT ── */
async function changeAdminPin(){
  const newPin=prompt("Enter new admin PIN:");
  if(!newPin||!newPin.trim())return;
  if(newPin.trim().length<4){showToast("PIN must be at least 4 characters","error");return;}
  try{
    await adminFetch("change_pin",{new_pin:newPin.trim()});
    showToast("Admin PIN updated","success");
  }catch(e){showToast("Failed to update PIN","error");}
}

/* ── ACCESS CODE MANAGEMENT ── */
async function loadAccessCodes(){
  try{
    const res=await adminFetch("load_codes");
    return res.codes||[];
  }catch(e){return[];}
}

async function createAccessCode(){
  const code=prompt("Enter code (e.g. GENIE100):");
  if(!code||!code.trim())return;
  const discount=prompt("Discount percentage (0-100, 100=free):");
  if(discount===null)return;
  const pct=parseInt(discount);
  if(isNaN(pct)||pct<0||pct>100){showToast("Invalid discount percentage","error");return;}
  const maxUses=prompt("Max uses (0=unlimited):")||"0";
  /* On a 100% code, ask whether this is a paid customer being comped
     (counts as revenue in analytics / paid list) vs a genuinely free
     seat. Paid comps can optionally record a specific amount in kobo. */
  let grantStatus="free";
  let compAmount=null;
  if(pct===100){
    const isPaid=confirm("Is this a PAID customer being comped?\n\nOK = Paid access (counts as a paying customer, will appear in paid analytics)\nCancel = Free access (giveaway / partner / press)");
    if(isPaid){
      grantStatus="paid";
      const raw=prompt("Amount they effectively paid in ₦ (leave blank to use the tier price):");
      if(raw!==null&&raw.trim()!==""){
        const naira=parseFloat(raw);
        if(!isNaN(naira)&&naira>0) compAmount=Math.round(naira*100); /* store as kobo */
      }
    }
  }
  try{
    await adminFetch("create_code",{
      code:code.trim().toUpperCase(),
      discount_percent:pct,
      max_uses:parseInt(maxUses)||0,
      grant_status:grantStatus,
      comp_amount:compAmount,
    });
    showToast(`Code ${code.trim().toUpperCase()} created${grantStatus==="paid"?" (paid comp)":""}`,"success");
    renderAdminSettings();
  }catch(e){showToast("Failed to create code","error");}
}

async function toggleAccessCode(id,active){
  try{
    await adminFetch("toggle_code",{id,active});
    showToast(active?"Code deactivated":"Code activated",active?"error":"success");
    renderAdminSettings();
  }catch(e){showToast("Failed to update code","error");}
}

async function deleteAccessCode(id){
  if(!confirm("Delete this access code permanently?"))return;
  try{
    await adminFetch("delete_code",{id});
    showToast("Code deleted","info");
    renderAdminSettings();
  }catch(e){showToast("Failed to delete code","error");}
}

/* ── Admin notification preferences (localStorage) ── */
function _getAdminNotifPrefs(){
  try{return JSON.parse(localStorage.getItem("oiwg_admin_notif")||"{}");}catch(e){return {};}
}
function _setAdminNotifPref(key,val){
  const p=_getAdminNotifPrefs();p[key]=val;
  localStorage.setItem("oiwg_admin_notif",JSON.stringify(p));
}
function _adminNotifOn(key){
  const p=_getAdminNotifPrefs();
  return p[key]!==false;
}
function _toggleAdminNotif(key){
  const on=!_adminNotifOn(key);
  _setAdminNotifPref(key,on);
  renderAdminSettings();
}

function _notifToggleHtml(key,label,desc){
  const on=_adminNotifOn(key);
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a1a1a">
    <div style="flex:1"><div style="font-size:13px;color:#ccc;font-weight:600">${label}</div><div style="font-size:11px;color:#666;margin-top:2px">${desc}</div></div>
    <button onclick="_toggleAdminNotif('${key}')" style="width:44px;height:24px;border-radius:12px;border:none;cursor:pointer;position:relative;background:${on?"#4dc98a":"#333"};transition:background .2s">
      <span style="position:absolute;top:2px;${on?"right:2px":"left:2px"};width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s"></span>
    </button>
  </div>`;
}

/* ── Online presence sound ── */
let _adminOnlineSet=new Set();
function _playOnlineSound(){
  if(!_adminNotifOn("sound_online"))return;
  try{
    const ac=new (window.AudioContext||window.webkitAudioContext)();
    const g=ac.createGain();g.gain.value=0.15;g.connect(ac.destination);
    const o1=ac.createOscillator();o1.type="sine";o1.frequency.value=880;o1.connect(g);o1.start();o1.stop(ac.currentTime+0.08);
    const o2=ac.createOscillator();o2.type="sine";o2.frequency.value=1174;o2.connect(g);o2.start(ac.currentTime+0.1);o2.stop(ac.currentTime+0.18);
    setTimeout(()=>ac.close(),500);
  }catch(e){}
}
function _checkOnlineChanges(){
  const all=typeof getAM==="function"?getAM():[];
  const nowOnline=new Set();
  all.forEach(u=>{if(_isOnline(u.lastSeen))nowOnline.add(u.id);});
  nowOnline.forEach(id=>{
    if(!_adminOnlineSet.has(id)){
      const u=all.find(x=>x.id===id);
      if(u&&_adminNotifOn("sound_online"))_playOnlineSound();
    }
  });
  _adminOnlineSet=nowOnline;
}

async function renderAdminSettings(c){
  if(!c)c=el("admin-content");if(!c)return;
  const codes=await loadAccessCodes();
  const all=getAllAM();

  /* Coach's phone for the frozen lock screen (Call button + tel: link). The
     lock reads it from the coach record, so we edit the coach here. */
  let geniePhone="", coachId="";
  try{
    if(typeof sb!=="undefined"&&sb){
      const {data}=await sb.from("coaches").select("id,phone").order("created_at").limit(1).maybeSingle();
      geniePhone=(data&&data.phone)||"";
      coachId=(data&&data.id)||"";
    }
  }catch(e){}

  const pushStatus=typeof Notification!=="undefined"?Notification.permission:"unsupported";
  const pushLabel=pushStatus==="granted"?'<span style="color:#4dc98a">Enabled</span>':pushStatus==="denied"?'<span style="color:#d9503a">Blocked</span>':pushStatus==="default"?'<span style="color:#c49a1c">Not yet allowed</span>':'<span style="color:#888">Not supported</span>';

  c.innerHTML=`
    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('set-contact')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">GENIE CONTACT</span>
        <span id="set-contact-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="set-contact" style="display:none" class="admin-section-bd">
        <p style="font-size:12px;color:#888;margin-bottom:10px">The number a challenger reaches on the frozen lock screen. Use full international form, for example +2348012345678.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input id="set-genie-phone" type="tel" data-coach-id="${(coachId||"").replace(/"/g,"&quot;")}" value="${(geniePhone||"").replace(/"/g,"&quot;")}" placeholder="+234..." style="flex:1;min-width:160px;font-size:14px;padding:10px 12px">
          <button class="bp" style="font-size:12px;padding:9px 18px" onclick="saveGeniePhone()">Save</button>
        </div>
        ${geniePhone?"":`<p style="font-size:11px;color:#d9503a;margin-top:8px">No number set yet. The lock screen uses a placeholder until you add one.</p>`}
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('set-notif')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">NOTIFICATIONS</span>
        <span id="set-notif-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="set-notif" style="display:none" class="admin-section-bd">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:10px 12px;background:#0e0e0e;border:1px solid #1a1a1a;border-radius:8px">
          <span style="font-size:12px;color:#888">Push notifications:</span>
          ${pushLabel}
          ${pushStatus==="default"?`<button class="bs" style="padding:4px 12px;font-size:11px;margin-left:auto" onclick="_enableAdminPush()">Enable</button>`:""}
          ${pushStatus==="denied"?`<span style="font-size:10px;color:#666;margin-left:auto">Unblock in browser settings</span>`:""}
        </div>
        ${_notifToggleHtml("push_messages","New Messages","Push notification when a challenger sends you a message")}
        ${_notifToggleHtml("push_uploads","New Uploads","Push notification when a challenger uploads proof")}
        ${_notifToggleHtml("sound_online","Online Alert Sound","Play a sound when a challenger comes online")}
        ${_notifToggleHtml("push_signups","New Signups","Push notification when someone joins the challenge")}
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('set-security')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">SECURITY</span>
        <span id="set-security-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="set-security" style="display:none" class="admin-section-bd">
        <p style="font-size:12px;color:#888;margin-bottom:10px">Change the PIN required to access this admin dashboard.</p>
        <button class="bs" style="padding:8px 16px;font-size:12px" onclick="changeAdminPin()">Change PIN</button>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #1a1a1a">
          <p style="font-size:12px;color:#888;margin-bottom:8px">End your admin session. You'll need the PIN to log in again.</p>
          <button onclick="setAdminToken('');S._adminAuth=false;renderAdmin()" style="padding:8px 16px;border-radius:8px;background:transparent;border:1px solid rgba(217,80,58,.3);color:#d9503a;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Log Out</button>
        </div>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('set-codes')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">ACCESS CODES${codes.length?` · ${codes.length}`:""}</span>
        <span id="set-codes-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="set-codes" style="display:none" class="admin-section-bd">
        <p style="font-size:12px;color:#888;margin-bottom:10px">Manage discount and free-access codes for challengers.</p>
        <button class="bs" style="padding:8px 16px;font-size:12px;margin-bottom:12px" onclick="createAccessCode()">+ Create Code</button>
        ${codes.length===0?`<p class="muted" style="font-size:12px">No access codes yet.</p>`:`
        <div style="display:flex;flex-direction:column;gap:6px">
          ${codes.map(cd=>{
            const isPaidGrant=cd.grant_status==="paid";
            const grantLbl=cd.discount_percent===100
              ? (isPaidGrant?`<span style="color:#4dc98a;font-weight:700">PAID access</span>${cd.comp_amount?` · ₦${(cd.comp_amount/100).toLocaleString()}`:""}`:`<span style="color:#c49a1c">FREE</span>`)
              : cd.discount_percent+"% off";
            return `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0e0e0e;border:1px solid ${cd.active?(isPaidGrant?"rgba(77,201,138,.25)":"#1a1a1a"):"rgba(217,80,58,.2)"};border-radius:8px">
              <span style="font-weight:700;font-size:12px;color:${cd.active?"#c49a1c":"#555"};min-width:80px;font-family:monospace">${cd.code}</span>
              <span style="font-size:10px;color:#888;flex:1">${grantLbl} · ${cd.max_uses===0?"∞":cd.times_used+"/"+cd.max_uses} uses</span>
              <button onclick="toggleAccessCode('${cd.id}',${cd.active})" style="background:none;border:1px solid ${cd.active?"rgba(217,80,58,.3)":"rgba(77,201,138,.3)"};color:${cd.active?"#d9503a":"#4dc98a"};font-size:10px;padding:4px 8px;border-radius:4px;cursor:pointer">${cd.active?"Off":"On"}</button>
              <button onclick="deleteAccessCode('${cd.id}')" style="background:none;border:none;color:#555;font-size:12px;cursor:pointer;padding:4px 6px">✕</button>
            </div>`;
          }).join("")}
        </div>`}
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('set-data')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">DATA & ACCOUNTS</span>
        <span id="set-data-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="set-data" style="display:none" class="admin-section-bd">
        <p style="font-size:12px;color:#888;margin-bottom:10px">${all.length} total accounts · ${all.filter(u=>u.paymentStatus==="paid"||u.paymentStatus==="completed").length} paid · ${all.filter(u=>!u.paymentStatus||u.paymentStatus==="free"||u.paymentStatus==="pending").length} free/pending</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="bs" style="font-size:12px;padding:8px 16px" onclick="adminDataLoaded=false;renderAdmin()">↻ Refresh Data</button>
          <button onclick="deleteAllFreeAccounts()" style="padding:8px 16px;border-radius:8px;background:transparent;border:1px solid rgba(217,80,58,.3);color:#d9503a;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Delete Free Accounts</button>
        </div>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('set-about')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">ABOUT</span>
        <span id="set-about-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="set-about" style="display:none" class="admin-section-bd">
        <div style="font-size:12px;color:#888;line-height:1.8">
          <p><strong style="color:#ccc">On It With Genie</strong> - Accountability Platform</p>
          <p>Admin Dashboard v2.0</p>
          <p style="margin-top:8px;font-size:11px;color:#555">Supabase · Vercel · Groq AI · Paystack</p>
        </div>
      </div>
    </div>
  `;
}

function getPendingInbox(){
  return getActiveAM().flatMap(u=>{
    const items=[];
    /* Walk every goal so a 30-day Intensive challenger's second goal shows
       up in the review queue too — not just the primary goal. goalId/goalSlot
       ride along so the review action targets the correct upload row. */
    const goals=(u.goals&&u.goals.length)?u.goals:[{id:u.primaryGoalId||null,slot:1}];
    goals.forEach(g=>{
      const a=_adminGoalArrays(u,g.id);
      /* Only pass a goal_id to review actions for genuinely multi-goal
         challengers. Single-goal (esp. legacy) upload rows may have a NULL
         goal_id, so filtering by it would miss them — day-only match is
         the safe, original behaviour there. */
      const reviewGid=u.isMultiGoal?g.id:null;
      for(let i=0;i<u.day;i++){
        if(a.up[i]&&!a.rv[i])items.push({u,day:i+1,note:a.notes[i],i,
          goalId:reviewGid,goalSlot:g.slot,multiGoal:u.isMultiGoal,
          hasVoice:a.hasVoice&&a.hasVoice[i],voiceUrl:a.voiceUrls&&a.voiceUrls[i],
          fileUrl:a.fileUrls&&a.fileUrls[i],
          link:a.links&&a.links[i],fileName:a.fileNames&&a.fileNames[i],
          behavior:a.behaviors&&a.behaviors[i]});
      }
    });
    return items;
  });
}

const _bdg=(n)=>n>0?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;border-radius:8px;background:#d9503a;color:#fff;font-size:9px;font-weight:800;padding:0 4px;margin-left:5px;vertical-align:middle">${n}</span>`:"";
const _dot=(show)=>show?`<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#d9503a;margin-left:4px;vertical-align:middle"></span>`:"";

function adminTab(tab){
  adminCurrentTab = tab;
  try{
    /* Reviews badge = NEW (unseen this session) pending uploads — informational,
       clears on view. Attention badge = visible action items only. */
    const reviewCount=_unseenReviewCount();
    const flaggedCount=getActionItems().length;
    const unreadCount=typeof getTotalUnreadCount==="function"?getTotalUnreadCount():0;
    const newSignups=_getNewSignupCount();
    ["overview","messages","challengers","flagged","inbox","notifications","analytics","settings","design"].forEach(t=>{
      const btn=el("tab-"+t);if(!btn)return;
      btn.className="admin-tab"+(t===tab?" active":"");
      const labels={overview:`Overview${_dot(newSignups>0)}`,messages:`Messages${_bdg(unreadCount)}`,challengers:"Challengers",flagged:`Attention${_bdg(flaggedCount)}`,inbox:`Reviews${_bdg(reviewCount)}`,notifications:"Notifications",analytics:"Analytics",settings:"Settings",design:"Design"};
      btn.innerHTML=labels[t]||t;
    });
  }catch(e){console.warn("adminTab: tab-bar render failed:",e);}
  const c=el("admin-content");if(!c)return;
  const renderers={overview:renderAdminOverview,messages:renderAdminMessages,challengers:renderAdminChallengers,flagged:renderAdminFlagged,inbox:renderAdminInbox,notifications:renderAdminNotifications,analytics:renderAdminAnalytics,settings:renderAdminSettings,design:(typeof renderDesignTab==="function"?renderDesignTab:function(c){c.innerHTML="<p style='padding:20px;color:#888'>Design editor unavailable.</p>";})};
  /* Never let a single tab's render bug strand the admin on a blank screen
     (which reads as "can't log in"). Catch and show a recoverable error. */
  try{
    if(renderers[tab])renderers[tab](c);
    /* Restore any admin accordion sections that were open before the re-render */
    if(typeof _restoreOpenSections==="function") _restoreOpenSections();
  }catch(e){
    console.error("adminTab:",tab,"render failed:",e);
    c.innerHTML=`<div style="text-align:center;padding:50px 20px">
      <p style="color:#d9503a;font-size:14px;margin-bottom:8px">This tab hit an error.</p>
      <p class="muted" style="font-size:12px;margin-bottom:18px">${(e&&e.message)||"Render error"}</p>
      <button class="bp" style="padding:9px 20px;font-size:13px" onclick="adminTab('overview')">Back to Overview</button>
    </div>`;
  }
}

/* ── QUICK REPLY TEMPLATES ──
   Short, voice-y starter lines that the admin can one-tap into any message
   composer (Messages tab, Flagged tab, Reviews tab). Click sets the textarea
   value and focuses, so the admin can edit before sending instead of
   typing from scratch every time. */
const _QUICK_REPLIES=[
  "Saw it. Strong work.",
  "Tell me what got in the way today.",
  "Show me what changed since yesterday.",
  "Day done. Rest up.",
  "You're slipping. What's going on?",
  "Let's hop on a quick call.",
];
function _quickReplyChips(targetId){
  return `<div style="display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:6px 0;margin-bottom:6px">
    ${_QUICK_REPLIES.map(t=>`<button onclick="_fillQuickReply('${targetId}',${JSON.stringify(t).replace(/"/g,"&quot;")})" style="flex-shrink:0;padding:5px 11px;border-radius:100px;background:rgba(196,154,28,.06);border:1px solid rgba(196,154,28,.18);color:#c49a1c;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .15s" onmouseenter="this.style.background='rgba(196,154,28,.14)'" onmouseleave="this.style.background='rgba(196,154,28,.06)'">${t}</button>`).join("")}
  </div>`;
}
function _fillQuickReply(targetId,text){
  const ta=document.getElementById(targetId);
  if(!ta)return;
  ta.value=text+" ";
  ta.focus();
  /* Place cursor at end */
  try{ta.selectionStart=ta.selectionEnd=ta.value.length;}catch(e){}
}

/* ── TYPING INDICATOR (admin → challenger) ──
   Broadcasts a 'typing' event on the per-challenger Realtime channel each
   time the admin types in their message thread. Debounced to once per 2s
   so we don't flood the channel. Subscribes lazily per challenger and
   reuses the channel across keystrokes. */
const _typingChannelsByUid={};
let _lastTypingSentAt=0;
function _ensureTypingChannel(uid){
  if(!sb||!uid)return null;
  if(_typingChannelsByUid[uid])return _typingChannelsByUid[uid];
  try{
    const ch=sb.channel("typing-"+uid);
    ch.subscribe();
    _typingChannelsByUid[uid]=ch;
    return ch;
  }catch(e){return null;}
}
function _sendTyping(uid){
  if(!sb||!uid)return;
  const now=Date.now();
  if(now-_lastTypingSentAt<2000)return;
  _lastTypingSentAt=now;
  const ch=_ensureTypingChannel(uid);
  if(ch){try{ch.send({type:"broadcast",event:"typing",payload:{}});}catch(e){}}
}

/* ── MESSAGES TAB ── */
let _msgActiveChallengerId=null;
let _msgChatOpen=false;

function renderAdminMessages(c){
  if(!c)c=el("admin-content");
  if(!c)return;
  const challengers=getAM();
  if(!challengers.length&&!adminRecentMessages.length){
    c.innerHTML=`<div style="text-align:center;padding:60px 20px"><p class="muted">No conversations yet. Messages will appear here when challengers write to you.</p></div>`;
    return;
  }

  const convos=_buildConvoList(challengers);

  const convoListHtml=convos.map(cv=>{
    const isActive=_msgChatOpen&&cv.id===_msgActiveChallengerId;
    const preview=cv.lastMsg?(cv.lastMsg.voice_url&&!cv.lastMsg.message?"🎙 Voice note":(cv.lastMsg.sender==="genie"?"You: ":"")+(cv.lastMsg.message||"").slice(0,40)):"No messages yet";
    const ta=cv.lastMsg?timeAgo(cv.lastMsg.created_at):"";
    const avatar=_avatarWithStatus(cv,36,"50%");
    const doneTag=cv.done&&!cv.unread?`<span style="font-size:9px;color:#c49a1c;font-weight:700;margin-left:4px">Done</span>`:"";
    return `<div onclick="_openMsgConvo('${cv.id}')" style="padding:10px 12px;cursor:pointer;display:flex;gap:10px;align-items:center;border-left:3px solid ${isActive?"#c49a1c":"transparent"};background:${isActive?"rgba(196,154,28,.06)":cv.unread?"rgba(217,80,58,.04)":"transparent"};${cv.done&&!cv.unread?"opacity:.6;":""}transition:background .15s" onmouseenter="this.style.background='rgba(255,255,255,.03)'" onmouseleave="this.style.background='${isActive?"rgba(196,154,28,.06)":cv.unread?"rgba(217,80,58,.04)":"transparent"}'">
      ${avatar}
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <p style="font-size:13px;font-weight:${cv.unread?"800":"600"};margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cv.name}${doneTag}</p>
          <span class="muted" data-live-ts="${cv.lastMsg?cv.lastMsg.created_at:""}" style="font-size:10px;flex-shrink:0">${ta}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
          <p class="muted" style="font-size:11px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${cv.unread?"color:#ccc":""}">${preview}</p>
          ${cv.unread?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:9px;background:#d9503a;color:#fff;font-size:9px;font-weight:800;padding:0 5px;flex-shrink:0;margin-left:6px">${cv.unread}</span>`:""}
        </div>
      </div>
    </div>`;
  }).join("");

  const activeConvo=_msgChatOpen?convos.find(x=>x.id===_msgActiveChallengerId):null;

  c.innerHTML=`
    <div style="display:flex;height:calc(100vh - 120px);margin:-18px;border-radius:0">
      <div id="msg-sidebar" style="${_msgChatOpen?"width:280px;min-width:220px;flex-shrink:0;":"width:100%;"}border-right:${_msgChatOpen?"1px solid #1f1f1f":"none"};display:flex;flex-direction:column;overflow:hidden">
        <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;padding:14px 12px 10px">CONVERSATIONS · ${convos.length}</p>
        <div style="flex:1;overflow-y:auto">${convoListHtml}</div>
      </div>
      ${_msgChatOpen&&activeConvo?`
      <div id="msg-chat-pane" style="flex:1;display:flex;flex-direction:column;min-width:0">
        <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #1f1f1f;background:#0a0a0a">
          <button onclick="_closeMsgConvo()" style="background:none;border:none;color:#888;cursor:pointer;font-size:18px;padding:0 8px 0 0">←</button>
          ${_avatarWithStatus(activeConvo,32,"50%")}
          <div style="flex:1;min-width:0">
            <p style="font-size:14px;font-weight:700;margin:0">${activeConvo.name}</p>
            <p class="muted" style="font-size:10px;margin:0">${_formatLastSeen(activeConvo.lastSeen)}</p>
          </div>
          <button onclick="openProfilePanel('${activeConvo.id}')" style="padding:5px 12px;border-radius:100px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.2);color:#c49a1c;font-size:10px;font-weight:700;cursor:pointer">Profile</button>
        </div>
        <div id="msg-tab-thread" style="flex:1;overflow-y:auto;padding:12px 14px">
          <div style="text-align:center;padding:20px"><span class="muted" style="font-size:11px">Loading...</span></div>
        </div>
        <div id="msg-tab-voice-status" style="display:none;padding:4px 14px"></div>
        <div id="msg-tab-reply-indicator" style="display:none"></div>
        <div style="padding:0 14px;background:#0a0a0a;border-top:1px solid #1f1f1f">${_quickReplyChips("msg-tab-input")}</div>
        <div id="msg-input-bar" style="padding:6px 14px 10px;background:#0a0a0a;display:flex;gap:8px;align-items:flex-end">
          <div class="chat-input-pill" style="flex:1;display:flex;align-items:center;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;padding:0 4px 0 14px">
            <textarea id="msg-tab-input" class="chat-ta" rows="1" placeholder="Message ${activeConvo.name}..." oninput="_sendTyping('${activeConvo.id}')" style="flex:1;background:transparent;border:none;color:#ebebeb;font-size:14px;padding:10px 0;resize:none;outline:none;font-family:inherit;line-height:1.4;min-height:20px"></textarea>
            <button id="msg-tab-mic" onclick="toggleMsgTabRecording()" style="background:none;border:none;color:#888;cursor:pointer;padding:6px 8px;font-size:14px" title="Voice note">🎙</button>
          </div>
          <button onclick="sendMsgTabMsg('${activeConvo.id}')" style="width:36px;height:36px;border-radius:50%;background:#c49a1c;border:none;color:#000;font-size:16px;font-weight:900;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">↑</button>
        </div>
      </div>`:(!_msgChatOpen?"":`
      <div id="msg-chat-pane" style="flex:1;display:flex;align-items:center;justify-content:center">
        <p class="muted" style="font-size:12px">Select a conversation</p>
      </div>`)}
    </div>`;

  if(_msgChatOpen&&activeConvo){
    setTimeout(()=>{
      _loadMsgTabChat(_msgActiveChallengerId);
      _markMsgTabRead(_msgActiveChallengerId);
      const ta=document.getElementById("msg-tab-input");
      if(ta) ta.focus();
    },80);
  }
}

function _buildConvoList(challengers){
  const convos=[];
  const seen=new Set();
  adminRecentMessages.forEach(m=>{
    if(seen.has(m.challenger_id))return;
    seen.add(m.challenger_id);
    const u=challengers.find(x=>x.id===m.challenger_id);
    const done=u?_isComplete(u):false;
    convos.push({id:m.challenger_id,name:u?u.name:"Unknown",ini:u?u.ini:"?",photo:u?u.photo:null,lastSeen:u?u.lastSeen:null,lastMsg:m,unread:getUnreadCountForChallenger(m.challenger_id),done});
  });
  challengers.forEach(u=>{
    if(!seen.has(u.id)) convos.push({id:u.id,name:u.name,ini:u.ini,photo:u.photo,lastSeen:u.lastSeen,lastMsg:null,unread:0,done:_isComplete(u)});
  });
  convos.sort((a,b)=>{
    if(a.unread&&!b.unread)return -1;
    if(!a.unread&&b.unread)return 1;
    if(!a.done&&b.done)return -1;
    if(a.done&&!b.done)return 1;
    if(a.lastMsg&&b.lastMsg) return new Date(b.lastMsg.created_at)-new Date(a.lastMsg.created_at);
    if(a.lastMsg)return -1;
    return 1;
  });
  return convos;
}

function _openMsgConvo(uid){
  _msgActiveChallengerId=uid;
  _msgChatOpen=true;
  _msgTabLastHash="";
  _ensureTypingChannel(uid);
  renderAdminMessages(el("admin-content"));
}

function _closeMsgConvo(){
  _msgChatOpen=false;
  _msgActiveChallengerId=null;
  _msgTabLastHash="";
  renderAdminMessages(el("admin-content"));
}

let _msgTabLastHash="";
async function _loadMsgTabChat(uid){
  const thread=document.getElementById("msg-tab-thread");
  if(!thread||!getAdminToken())return;
  try{
    const res=await adminFetch("get_thread",{challenger_id:uid});
    const msgs=res.messages||[];
    if(!msgs||!msgs.length){_msgTabLastHash="";thread.innerHTML=`<p style="text-align:center;color:#3a3a3a;font-size:12px;padding:28px 0">No messages yet. Start the conversation.</p>`;return;}
    /* Skip re-render if messages haven't changed (prevents scroll jump & audio interruption) */
    const hash=msgs.map(m=>m.id+":"+(m.read_at||"")+(m.updated_at||"")).join("|");
    if(hash===_msgTabLastHash)return;
    _msgTabLastHash=hash;
    const msgMap={};msgs.forEach(m=>{msgMap[m.id]=m;});
    let lastDateStr="";
    thread.innerHTML=msgs.map((m,i)=>{
      const isMe=m.sender==="genie";
      const t=new Date(m.created_at);
      const timeStr=t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      const dateStr=t.toLocaleDateString([],{month:"short",day:"numeric"});
      const aId=`mt-${i}-${t.getTime()}`;
      let dateSep="";
      if(dateStr!==lastDateStr){
        lastDateStr=dateStr;
        const today=new Date().toLocaleDateString([],{month:"short",day:"numeric"});
        const yesterday=new Date(Date.now()-86400000).toLocaleDateString([],{month:"short",day:"numeric"});
        const label=dateStr===today?"Today":dateStr===yesterday?"Yesterday":dateStr;
        dateSep=`<div style="text-align:center;padding:8px 0 4px"><span style="font-size:10px;color:#444;background:#111;padding:2px 10px;border-radius:10px;font-weight:600">${label}</span></div>`;
      }
      let replyQuote="";
      if(m.reply_to_id&&msgMap[m.reply_to_id]){
        const orig=msgMap[m.reply_to_id];
        const origPreview=(orig.message||"").slice(0,50)+(orig.message&&orig.message.length>50?"…":"");
        replyQuote=`<div style="font-size:11px;color:${isMe?"rgba(0,0,0,.7)":"#999"};border-left:2px solid ${isMe?"rgba(0,0,0,.4)":"#555"};padding:3px 8px;margin-bottom:5px;border-radius:0 4px 4px 0;background:${isMe?"rgba(0,0,0,.12)":"rgba(255,255,255,.04)"}">${origPreview||"🎙 Voice note"}</div>`;
      }
      let body=replyQuote;
      if(m.message&&m.message.trim()) body+=`<p style="margin:0">${m.message}</p>`;
      if(m.voice_url) body+=buildAudioBubble(m.voice_url,aId);
      if(!body) return "";
      const readCheck=isMe&&m.read_at?`<span style="color:rgba(0,0,0,.35);font-size:9px;margin-left:4px" title="Read">✓✓</span>`:(isMe?`<span style="color:rgba(0,0,0,.2);font-size:9px;margin-left:4px">✓</span>`:"");
      const msgPreview=(m.message||"").slice(0,40).replace(/"/g,"&quot;").replace(/'/g,"\\'");
      const menuId=`mtmenu-${m.id}`;
      const wasRead=m.read_at?"true":"false";
      const dotMenu=`<span style="position:relative;margin-left:4px"><span onclick="event.stopPropagation();toggleChatMenu('${menuId}')" style="cursor:pointer;font-size:14px;color:${isMe?"rgba(0,0,0,.25)":"#444"};line-height:1;vertical-align:middle;padding:2px" onmouseenter="this.style.color='${isMe?"rgba(0,0,0,.5)":"#888"}'" onmouseleave="this.style.color='${isMe?"rgba(0,0,0,.25)":"#444"}'">⋮</span><div id="${menuId}" style="display:none;position:absolute;bottom:20px;${isMe?"right:0":"left:0"};background:#181818;border:1px solid #2a2a2a;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.6);z-index:100;overflow:hidden;min-width:140px"><button onclick="event.stopPropagation();_msgTabSetReply('${m.id}','${msgPreview}','${uid}');closeChatMenus()" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:11px 16px;background:none;border:none;border-bottom:1px solid #222;color:#ccc;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left">Reply<span style="font-size:14px;color:#555">↩</span></button><button onclick="event.stopPropagation();_msgTabCopyMsg('${m.id}');closeChatMenus()" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:11px 16px;background:none;border:none;${isMe?"border-bottom:1px solid #222;":""}color:#ccc;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left">Copy<span style="font-size:14px;color:#555">⊡</span></button>${isMe?`<button onclick="event.stopPropagation();_msgTabDeleteMsg('${m.id}','${uid}',${wasRead});closeChatMenus()" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:11px 16px;background:none;border:none;color:#d9503a;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left">Unsend<span style="font-size:14px">⊘</span></button>`:""}</div></span>`;
      return `${dateSep}<div id="msg-${m.id}" class="cmsg ${isMe?"cmsg-me":"cmsg-them"}">
        <div class="cmsg-body">${body}</div>
        <div class="cmsg-time" style="position:relative">${isMe?"You":"Challenger"} · ${timeStr}${readCheck}${dotMenu}</div>
      </div>`;
    }).join("");
    thread.scrollTop=thread.scrollHeight;
  }catch(e){
    console.error("_loadMsgTabChat error:",e);
    thread.innerHTML=`<p style="text-align:center;color:#3a3a3a;font-size:12px;padding:20px 0">Could not load messages</p>
      <div style="text-align:center"><button class="bs" style="font-size:11px;padding:6px 14px" onclick="_msgTabLastHash='';_loadMsgTabChat('${uid}')">Retry</button></div>`;
  }
}

function _markMsgTabRead(uid){
  if(!uid)return;
  /* Optimistic: remove from local unread cache immediately */
  if(typeof adminUnreadMessages!=="undefined"){
    const had=adminUnreadMessages.some(m=>m.challenger_id===uid);
    adminUnreadMessages=adminUnreadMessages.filter(m=>m.challenger_id!==uid);
    if(had){
      if(typeof updateTabTitle==="function") updateTabTitle();
      /* Update just the tab badges, not re-render content */
      const unreadCount=typeof getTotalUnreadCount==="function"?getTotalUnreadCount():0;
      const bdg=(n)=>n>0?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;border-radius:8px;background:#d9503a;color:#fff;font-size:9px;font-weight:800;padding:0 4px;margin-left:5px;vertical-align:middle">${n}</span>`:"";
      const msgBtn=el("tab-messages");
      if(msgBtn) msgBtn.innerHTML=`Messages${bdg(unreadCount)}`;
    }
  }
  /* DB update in background */
  if(getAdminToken()){
    adminFetch("mark_read",{challenger_id:uid}).catch(()=>{});
  }
}

/* Reply system for Messages tab */
let _msgTabReplyToId=null;
function _msgTabSetReply(msgId,preview,uid){
  _msgTabReplyToId=msgId;
  const indicator=document.getElementById("msg-tab-reply-indicator");
  if(indicator){
    indicator.style.display="flex";
    indicator.style.cssText="display:flex;font-size:11px;color:#888;padding:4px 14px;background:#0f0f0f;border-left:2px solid #c49a1c;justify-content:space-between;align-items:center";
    indicator.innerHTML=`<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">↩ Replying to: <em>${preview||"voice note"}</em></span><span onclick="_msgTabReplyToId=null;document.getElementById('msg-tab-reply-indicator').style.display='none'" style="cursor:pointer;color:#555;margin-left:8px;font-size:14px">×</span>`;
  }
  const ta=document.getElementById("msg-tab-input");
  if(ta)ta.focus();
}

/* Voice recording for Messages tab */
let _msgTabVoiceBlob=null;
let _msgTabRecorder=null;
let _msgTabRecChunks=[];
let _msgTabRecTimer=null;

async function toggleMsgTabRecording(){
  const btn=document.getElementById("msg-tab-mic");
  const ta=document.getElementById("msg-tab-input");
  const status=document.getElementById("msg-tab-voice-status");
  if(_msgTabRecorder){
    try{if(_msgTabRecorder.state==="recording"){_msgTabRecorder.stop();clearInterval(_msgTabRecTimer);return;}}catch(e){_msgTabRecorder=null;}
  }
  _msgTabVoiceBlob=null;
  if(typeof _createRecorder!=="function"){if(ta)ta.placeholder="Voice recording not supported";return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    _msgTabRecChunks=[];
    _msgTabRecorder=_createRecorder(stream);
    _msgTabRecorder.ondataavailable=e=>{if(e.data&&e.data.size>0)_msgTabRecChunks.push(e.data);};
    _msgTabRecorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      clearInterval(_msgTabRecTimer);
      if(_msgTabRecChunks.length===0||new Blob(_msgTabRecChunks).size<100){
        _msgTabVoiceBlob=null;
        if(ta)ta.placeholder="Recording failed, try again";
        setTimeout(()=>{if(ta)ta.placeholder="Message...";},2500);
        return;
      }
      _msgTabVoiceBlob=new Blob(_msgTabRecChunks,{type:_msgTabRecorder.mimeType||"audio/webm"});
      if(btn){btn.textContent="🎙";btn.style.color="#4dc98a";}
      if(ta)ta.placeholder="✓ Voice note ready, tap ↑ to send";
      if(status){
        const previewUrl=URL.createObjectURL(_msgTabVoiceBlob);
        status.style.display="flex";status.style.alignItems="center";status.style.gap="8px";status.style.padding="6px 14px";
        status.innerHTML=`<audio controls src="${previewUrl}" style="height:32px;flex:1"></audio><button onclick="discardMsgTabVoice()" style="background:none;border:none;color:#d9503a;font-size:16px;cursor:pointer;padding:4px 8px">✕</button>`;
      }
    };
    _msgTabRecorder.start();
    if(btn){btn.textContent="⏹";btn.style.color="#d9503a";}
    let secs=0;
    _msgTabRecTimer=setInterval(()=>{secs++;const m=Math.floor(secs/60),s=String(secs%60).padStart(2,"0");if(ta)ta.placeholder=`● Recording ${m}:${s}, tap to stop`;},1000);
    if(ta)ta.placeholder="● Recording 0:00, tap to stop";
  }catch(e){if(ta)ta.placeholder="Microphone access denied";setTimeout(()=>{if(ta&&ta.placeholder.includes("denied"))ta.placeholder="Message...";},2500);}
}

function _msgTabCopyMsg(msgId){
  const bubble=document.getElementById("msg-"+msgId);
  if(!bubble)return;
  const p=bubble.querySelector(".cmsg-body p");
  if(p&&p.textContent){
    navigator.clipboard.writeText(p.textContent).then(()=>showToast("Copied","info")).catch(()=>{});
  }
}

async function _msgTabDeleteMsg(msgId,uid,wasRead){
  const msg=wasRead?"This message was already read. Unsend anyway?":"Unsend this message?";
  if(!confirm(msg))return;
  try{
    await adminFetch("delete_message",{message_id:msgId});
    showToast(wasRead?"Unsent, but they already saw it":"Message unsent",wasRead?"error":"info");
  }catch(e){showToast("Failed to unsend","error");}
  _msgTabLastHash="";
  _loadMsgTabChat(uid);
}

function discardMsgTabVoice(){
  _msgTabVoiceBlob=null;
  const btn=document.getElementById("msg-tab-mic");
  const ta=document.getElementById("msg-tab-input");
  const status=document.getElementById("msg-tab-voice-status");
  if(btn){btn.textContent="🎙";btn.style.color="#888";}
  if(ta)ta.placeholder="Message...";
  if(status){status.style.display="none";status.innerHTML="";}
}

async function sendMsgTabMsg(uid){
  if(!uid||!getAdminToken())return;
  const ta=document.getElementById("msg-tab-input");
  const hasText=ta&&ta.value.trim();
  if(!hasText&&!_msgTabVoiceBlob)return;
  if(typeof trackEvent==="function") trackEvent("admin_msg_sent",{to:uid,has_voice:!!_msgTabVoiceBlob,has_text:!!hasText});
  const msg=hasText?ta.value.trim():"";
  if(ta){ta.value="";ta.disabled=true;}
  let voiceUrl=null;
  if(_msgTabVoiceBlob){
    const vMime=_msgTabVoiceBlob.type||"audio/webm";
    const vExt=vMime.includes("mp4")?"mp4":vMime.includes("ogg")?"ogg":"webm";
    const path=`admin/genie-${uid}-${Date.now()}.${vExt}`;
    voiceUrl=await uploadToStorage("chat-voice",path,_msgTabVoiceBlob,vMime);
    _msgTabVoiceBlob=null;
    discardMsgTabVoice();
  }
  try{
    await adminFetch("send_message",{challenger_id:uid,message:msg||"",voice_url:voiceUrl||null,reply_to_id:_msgTabReplyToId||null});
    _msgTabReplyToId=null;
    const indicator=document.getElementById("msg-tab-reply-indicator");
    if(indicator)indicator.style.display="none";
    adminFetch("send_push",{push_type:"personal",challenger_id:uid,title:"Message from Genie",body:msg?msg.slice(0,120):"🎙 Voice note"}).catch(()=>{});
    showToast("Message sent","success");
  }catch(e){showToast("Failed to send","error");}
  if(ta){ta.disabled=false;ta.placeholder=`Message ${getAM().find(x=>x.id===uid)?.name||""}...`;}
  _msgTabLastHash="";
  _loadMsgTabChat(uid);
  /* Don't call loadAdminMessages() here — the Realtime INSERT event
     on chat_messages will trigger _adminSoftRefresh automatically,
     which handles the sidebar update without destroying the chat pane. */
}

async function loadSystemHealth(){
  const hc=document.getElementById("health-content");
  if(!hc||!getAdminToken())return;
  hc.innerHTML=`<p class="muted" style="font-size:11px">Checking...</p>`;
  try{
    const hRes=await adminFetch("health_check");
    const counts=hRes.counts||{};
    let storageFiles=hRes.storageFiles||0;
    let storageWarning=storageFiles>900;
    /* Groq API check */
    let groqStatus="unknown",groqColor="#888";
    try{
      const res=await fetch(GROQ_PROXY_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+SUPABASE_ANON_KEY},body:JSON.stringify({messages:[{role:"user",content:"ping"}],max_tokens:1})});
      if(res.ok){groqStatus="connected";groqColor="#4dc98a";}
      else if(res.status===429){groqStatus="rate limited";groqColor="#c49a1c";}
      else{groqStatus="error ("+res.status+")";groqColor="#d9503a";}
    }catch(e){groqStatus="unreachable";groqColor="#d9503a";}

    const dbRows=Object.values(counts).reduce((a,b)=>a+b,0);
    const dbPct=Math.min(100,Math.round(dbRows/50000*100));
    const storagePct=Math.min(100,Math.round(storageFiles/1000*100));

    const statusDot=(color)=>`<span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>`;
    const bar=(pct,color)=>`<div style="height:4px;background:#1b1b1b;border-radius:2px;overflow:hidden;flex:1"><div style="height:100%;width:${pct}%;background:${pct>80?"#d9503a":pct>50?"#c49a1c":color};border-radius:2px"></div></div>`;

    hc.innerHTML=`
      <div style="display:flex;flex-direction:column;gap:10px;text-align:left">
        <div style="display:flex;align-items:center;gap:8px">
          ${statusDot("#4dc98a")}
          <span style="font-size:12px;font-weight:600;flex:1">Supabase DB</span>
          <span style="font-size:11px;color:#888">${dbRows.toLocaleString()} rows</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${statusDot(storagePct>80?"#d9503a":storagePct>50?"#c49a1c":"#4dc98a")}
          <span style="font-size:12px;font-weight:600;flex:1">Storage</span>
          <span style="font-size:11px;color:#888">${storageFiles} files</span>
          ${bar(storagePct,"#4dc98a")}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${statusDot(groqColor)}
          <span style="font-size:12px;font-weight:600;flex:1">Lil AI (Groq)</span>
          <span style="font-size:11px;color:${groqColor}">${groqStatus}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${statusDot("#4dc98a")}
          <span style="font-size:12px;font-weight:600;flex:1">Vercel</span>
          <span style="font-size:11px;color:#4dc98a">deployed</span>
        </div>
        ${counts.challengers>0?`<div style="margin-top:4px;padding:8px;background:#0a0a0a;border-radius:6px;font-size:11px;color:#666;line-height:1.6">
          ${counts.challengers} challengers · ${counts.uploads} uploads · ${counts.chat_messages} messages · ${counts.analytics_events} events
        </div>`:""}
        ${storageWarning?`<div style="padding:6px 8px;background:rgba(217,80,58,.06);border:1px solid rgba(217,80,58,.2);border-radius:6px;font-size:11px;color:#d9503a">⚠ Storage approaching limit. Consider upgrading Supabase plan.</div>`:""}
        ${groqStatus==="rate limited"?`<div style="padding:6px 8px;background:rgba(196,154,28,.06);border:1px solid rgba(196,154,28,.2);border-radius:6px;font-size:11px;color:#c49a1c">⚠ Groq API rate limited. Lil AI responses may be delayed.</div>`:""}
      </div>`;
  }catch(e){
    hc.innerHTML=`<p style="font-size:11px;color:#d9503a">Health check failed: ${e.message}</p>`;
  }
}

/* Track which admin accordion sections are open */
let _openAdminSections=new Set();

function toggleAdminSection(id){
  const div=document.getElementById(id);
  const chev=document.getElementById(id+"-chev");
  if(!div)return;
  const open=div.style.display!=="none";
  div.style.display=open?"none":"block";
  if(chev)chev.style.transform=open?"rotate(0deg)":"rotate(90deg)";
  if(open) _openAdminSections.delete(id);
  else _openAdminSections.add(id);
}

/* Called after any tab render to restore previously-open sections */
function _restoreOpenSections(){
  _openAdminSections.forEach(id=>{
    const div=document.getElementById(id);
    const chev=document.getElementById(id+"-chev");
    if(div){div.style.display="block";if(chev)chev.style.transform="rotate(90deg)";}
  });
}

function _renderNotifLog(active,completed){
  const logs=window._adminReminderLogs||[];
  const allUsers=[...active,...completed];
  const slotNames={1:"Morning",2:"Afternoon",3:"Evening",99:"Ghost Nudge"};
  const slotColors={1:"#c49a1c",2:"#4dc98a",3:"#888",99:"#d9503a"};
  const enabledCount=allUsers.filter(u=>u.hasPush).length;

  let html=`<div style="display:flex;gap:12px;margin-bottom:14px">
    <div style="flex:1;padding:10px 12px;background:#0a0a0a;border:1px solid #1a1a1a;border-radius:8px;text-align:center">
      <p style="font-size:18px;font-weight:800;color:${enabledCount>0?"#4dc98a":"#d9503a"};margin:0">${enabledCount}</p>
      <p style="font-size:9px;font-weight:700;color:#555;margin:2px 0 0;letter-spacing:.05em">PUSH ON</p>
    </div>
    <div style="flex:1;padding:10px 12px;background:#0a0a0a;border:1px solid #1a1a1a;border-radius:8px;text-align:center">
      <p style="font-size:18px;font-weight:800;color:${allUsers.length-enabledCount>0?"#d9503a":"#4dc98a"};margin:0">${allUsers.length-enabledCount}</p>
      <p style="font-size:9px;font-weight:700;color:#555;margin:2px 0 0;letter-spacing:.05em">NO PUSH</p>
    </div>
    <div style="flex:1;padding:10px 12px;background:#0a0a0a;border:1px solid #1a1a1a;border-radius:8px;text-align:center">
      <p style="font-size:18px;font-weight:800;color:#c49a1c;margin:0">${logs.length}</p>
      <p style="font-size:9px;font-weight:700;color:#555;margin:2px 0 0;letter-spacing:.05em">SENT (3D)</p>
    </div>
  </div>`;

  if(!logs.length){
    html+=`<p class="muted" style="font-size:12px;text-align:center;padding:8px 0">No notifications sent in the last 3 days.</p>`;
    return html;
  }

  const byDate={};
  logs.forEach(l=>{
    const key=l.sent_date;
    if(!byDate[key])byDate[key]=[];
    const name=allUsers.find(u=>u.id===l.challenger_id)?.name||"Unknown";
    byDate[key].push({name,slot:l.slot,slotName:slotNames[l.slot]||`Slot ${l.slot}`,color:slotColors[l.slot]||"#888"});
  });

  Object.keys(byDate).sort().reverse().forEach(date=>{
    const d=new Date(date+"T12:00:00");
    const today=new Date().toISOString().split("T")[0];
    const yest=new Date(Date.now()-86400000).toISOString().split("T")[0];
    const label=date===today?"Today":date===yest?"Yesterday":d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});
    html+=`<p style="font-size:10px;font-weight:700;color:#666;margin:10px 0 4px">${label}</p>`;
    byDate[date].forEach(e=>{
      html+=`<div style="display:flex;align-items:center;gap:6px;padding:4px 0">
        <span style="width:6px;height:6px;border-radius:50%;background:${e.color};flex-shrink:0"></span>
        <span style="font-size:11px;color:#ccc;flex:1">${e.name}</span>
        <span style="font-size:10px;color:${e.color};font-weight:600">${e.slotName}</span>
      </div>`;
    });
  });

  return html;
}

function renderAdminOverview(c){
  const all=getAM();
  const active=all.filter(u=>!_isComplete(u));
  const completed=all.filter(u=>_isComplete(u));
  const total=active.length;
  const uploadsTotal=active.reduce((a,u)=>a+_adminTotalUploads(u),0);
  const atRiskUsers=active.filter(u=>_missedDays(u)>=3||u.flag);

  /* TODAY'S QUEUE — concrete, one-tap-action list of what needs Genie's
     attention right now. Replaces the abstract summary alerts that just
     navigated to other tabs. Items prioritised: unread > reviews > at-risk
     > ghosted > calls today > new signups. */
  const onlineNow=active.filter(u=>_isOnline(u.lastSeen));
  const newSignups=_getNewSignupCount();
  const ghosted=active.filter(u=>{
    if(!_isPaid(u))return false;
    const seenAgo=u.lastSeen?Date.now()-new Date(u.lastSeen).getTime():Infinity;
    if(seenAgo<3*86400000)return false;
    if(u.day<3)return false;
    const last2=u.up.slice(u.day-2,u.day);
    return last2.length>=2&&!last2[0]&&!last2[1];
  });

  const queue=[];
  /* Unread message conversations — distinct, top 5 */
  const seenUnread=new Set();
  (adminRecentMessages||[]).forEach(m=>{
    if(m.sender!=="challenger"||m.read_at)return;
    if(seenUnread.has(m.challenger_id)||seenUnread.size>=5)return;
    seenUnread.add(m.challenger_id);
    const u=all.find(x=>x.id===m.challenger_id);if(!u)return;
    const preview=m.voice_url&&!m.message?"🎙 voice note":(m.message||"").slice(0,50);
    queue.push({pri:1,icon:"💬",color:"#d9503a",label:"Reply needed",name:u.name,meta:preview,
      actionLabel:"Reply →",onClick:`adminTab('messages');setTimeout(()=>_openMsgConvo('${u.id}'),100)`});
  });
  /* Pending reviews — top 5 */
  getPendingInbox().slice(0,5).forEach(({u,day,note,i,goalId,goalSlot,multiGoal})=>{
    const previewText=(note&&note!=="-")?note:"Awaiting your review";
    const goalTag=multiGoal?` · Goal ${goalSlot}`:"";
    const gidArg=goalId?`'${goalId}'`:"null";
    queue.push({pri:2,icon:"↑",color:"#c49a1c",label:`Day ${day} upload${goalTag}`,name:u.name,meta:previewText.slice(0,55),
      actionLabel:"Review →",onClick:`openUploadDetail('${u.id}',${i},${gidArg})`});
  });
  /* At-risk users — only those NOT yet cleared, so the overview queue doesn't
     keep surfacing an item the admin already handled in the Attention tab.
     (The "At Risk" stat below still reflects the true count.) */
  getActionItems().forEach(u=>{
    const missed=_missedDays(u);
    queue.push({pri:3,icon:"⚑",color:"#d9503a",label:"At risk",name:u.name,meta:`${missed} missed · Day ${u.day}/${u.dur||15}`,
      actionLabel:"Message →",onClick:`adminTab('flagged');setTimeout(()=>{const t=document.getElementById('int-ta-${u.id}');if(t)t.focus()},150)`});
  });
  /* Ghosted */
  ghosted.forEach(u=>{
    const seenAgo=u.lastSeen?Math.floor((Date.now()-new Date(u.lastSeen).getTime())/86400000):99;
    queue.push({pri:4,icon:"👻",color:"#8c8c8c",label:"Ghosted",name:u.name,meta:`${seenAgo}d silent · Day ${u.day}/${u.dur||15}`,
      actionLabel:"Message →",onClick:`adminTab('messages');setTimeout(()=>_openMsgConvo('${u.id}'),100)`});
  });
  /* Calls today */
  active.forEach(u=>{
    const callDays=CALL_DAYS[u.dur||15]||[];
    if(callDays.includes(u.day)){
      queue.push({pri:5,icon:"📞",color:"#c49a1c",label:`Call day · D${u.day}`,name:u.name,meta:"Book a slot",
        actionLabel:"Book →",onClick:`openCallSchedule('${u.id}')`});
    }
  });
  /* New signups (informational) */
  if(newSignups>0){
    _adminNewSignups.slice(-3).forEach(s=>{
      queue.push({pri:6,icon:"🆕",color:"#4dc98a",label:"New signup",name:s.name,meta:"Welcome them",
        actionLabel:"View →",onClick:`_clearNewSignups();adminTab('challengers')`});
    });
  }
  queue.sort((a,b)=>a.pri-b.pri);

  const queueHtml=queue.length===0
    ? `<div class="card" style="text-align:center;padding:22px 14px;background:rgba(77,201,138,.04);border-color:rgba(77,201,138,.18)">
        <p style="font-size:14px;font-weight:700;color:#4dc98a;margin:0">All clear ✓</p>
        <p class="muted" style="font-size:11px;margin-top:4px">Nothing needs your attention right now. Take a breath.</p>
       </div>`
    : queue.map(q=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0a0a0a;border:1px solid #1a1a1a;border-radius:9px;margin-bottom:6px">
        <span style="font-size:14px;width:22px;text-align:center;flex-shrink:0">${q.icon}</span>
        <div style="flex:1;min-width:0">
          <p style="font-size:12px;font-weight:700;margin:0;color:${q.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${q.label} · ${q.name}</p>
          <p style="font-size:11px;color:#666;margin:1px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${q.meta}</p>
        </div>
        <button onclick="${q.onClick}" style="padding:5px 11px;border-radius:100px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.2);color:#c49a1c;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0;font-family:inherit">${q.actionLabel}</button>
      </div>`).join("");

  const alerts=`<div class="row mb10" style="justify-content:space-between;align-items:center">
      <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">TODAY'S QUEUE${queue.length?` · ${queue.length}`:""}</span>
      ${queue.length?`<span class="muted" style="font-size:10px">tap to action</span>`:""}
    </div>
    ${queueHtml}
    <div style="height:14px"></div>`;

  /* Stats grid */
  const avgProgress=total>0?Math.round(active.reduce((a,u)=>a+Math.round(u.up.filter(Boolean).length/(u.dur||15)*100),0)/total):0;
  const plannedToday=active.filter(u=>(u.plans||[]).some(p=>p.day_number===u.day&&!p.skipped&&p.main_step)).length;

  c.innerHTML=`
    ${alerts}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px">
      <div class="admin-stat"><div class="admin-stat-val" style="color:#c49a1c">${total}</div><div class="admin-stat-lbl">Challengers</div></div>
      <div class="admin-stat"><div class="admin-stat-val" style="color:#4dc98a">${onlineNow.length}</div><div class="admin-stat-lbl">Online</div></div>
      <div class="admin-stat"><div class="admin-stat-val" style="color:#4dc98a">${uploadsTotal}</div><div class="admin-stat-lbl">Uploads</div></div>
      <div class="admin-stat"><div class="admin-stat-val" style="color:${avgProgress>=50?"#4dc98a":"#c49a1c"}">${avgProgress}%</div><div class="admin-stat-lbl">Avg Progress</div></div>
      <div class="admin-stat"><div class="admin-stat-val" style="color:${plannedToday>0?"#4dc98a":"#5a5a5a"}">${plannedToday}/${total}</div><div class="admin-stat-lbl">Planned Today</div></div>
      <div class="admin-stat"><div class="admin-stat-val" style="color:${atRiskUsers.length?"#d9503a":"#5a5a5a"}">${atRiskUsers.length}</div><div class="admin-stat-lbl">At Risk</div></div>
    </div>

    <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:10px">ACTIVE CHALLENGERS</p>
    ${total===0?`<div class="card" style="text-align:center;padding:32px 16px"><p class="muted" style="font-size:14px;margin-bottom:6px">No active challengers.</p><p class="muted" style="font-size:12px">When someone completes payment, they'll appear here.</p></div>`:
    active.map(u=>{
      const up=u.up.filter(Boolean).length,missed=_missedDays(u);
      const pct=Math.round((up/(u.dur||15))*100);
      const isAtRisk=missed>=3;
      const pending=up-(u.rvCount||0);
      const unreadCt=getUnreadCountForChallenger(u.id);
      return `<div class="card mb10" style="cursor:pointer" onclick="adminTab('challengers');setTimeout(()=>openChallenger('${u.id}'),60)">
        <div class="row mb8" style="justify-content:space-between">
          <div class="row" style="gap:10px">
            ${_avatarWithStatus(u,34,"8px")}
            <div><p style="font-size:13px;font-weight:700">${u.name}${_bdg(unreadCt)}${u.hasPush?"":" <span style=\"font-size:9px;color:#d9503a;font-weight:600\">no push</span>"}</p><p class="muted" style="font-size:11px">Day ${u.day}/${u.dur||15} · ${up} uploads</p></div>
          </div>
          <div style="text-align:right">
            ${isAtRisk?`<span style="font-size:10px;font-weight:700;color:#d9503a">At Risk</span>`:`<span style="font-size:10px;font-weight:700;color:#4dc98a">Active</span>`}
            ${pending>0?`<br><span style="font-size:9px;color:#c49a1c;font-weight:600">${pending} to review</span>`:""}
          </div>
        </div>
        <div style="height:3px;background:#1b1b1b;border-radius:2px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${isAtRisk?"#d9503a":"#c49a1c"};border-radius:2px"></div></div>
      </div>`;
    }).join("")}
    ${completed.length?`
    <div class="admin-section" style="margin-top:16px">
      <div class="admin-section-hd" onclick="toggleAdminSection('ov-completed')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">COMPLETED · ${completed.length}</span>
        <span id="ov-completed-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="ov-completed" style="display:none" class="admin-section-bd">
        ${completed.map(u=>{
          const up=u.up.filter(Boolean).length;
          const pct=Math.round((up/(u.dur||15))*100);
          return `<div class="card mb10" style="cursor:pointer;opacity:.6" onclick="adminTab('challengers');setTimeout(()=>openChallenger('${u.id}'),60)">
            <div class="row" style="justify-content:space-between;align-items:center">
              <div class="row" style="gap:10px">
                <div style="width:34px;height:34px;border-radius:8px;background:rgba(196,154,28,.1);border:1.5px solid rgba(196,154,28,.25);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#c49a1c">${u.ini}</div>
                <div><p style="font-size:13px;font-weight:700">${u.name}</p><p class="muted" style="font-size:11px">${u.dur} days · ${up} uploads · ${pct}% hit rate</p></div>
              </div>
              <span style="font-size:10px;font-weight:700;color:#c49a1c">Done ★</span>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>`:""}

    <div class="admin-section" style="margin-top:16px">
      <div class="admin-section-hd" onclick="toggleAdminSection('ov-calls')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">UPCOMING CALLS</span>
        <span id="ov-calls-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="ov-calls" style="display:none" class="admin-section-bd">
        ${active.map(u=>{
          const callDays=CALL_DAYS[u.dur||15]||[];
          const upcoming=callDays.filter(cd=>cd>=u.day);
          if(!upcoming.length)return "";
          const startD=new Date(u.startDate);
          const nextCallDate=new Date(startD);
          nextCallDate.setDate(nextCallDate.getDate()+upcoming[0]-1);
          const dateLabel=nextCallDate.toLocaleDateString([],{month:"short",day:"numeric"});
          return `<div class="row mb8" style="justify-content:space-between;align-items:center">
            <div style="min-width:0;flex:1">
              <span style="font-size:12px;font-weight:600">${u.name}</span>
              <span class="muted" style="font-size:11px;margin-left:6px">Day ${upcoming[0]} · ${dateLabel}</span>
            </div>
            <button onclick="openCallSchedule('${u.id}')" style="padding:4px 10px;border-radius:100px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.2);color:#c49a1c;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0">Book</button>
          </div>`;
        }).join("")||`<p class="muted" style="font-size:12px">No upcoming calls.</p>`}
      </div>
    </div>

    <div class="admin-section" style="margin-top:16px">
      <div class="admin-section-hd" onclick="toggleAdminSection('ov-notif-log')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">NOTIFICATIONS <span style="color:#888;font-weight:400">· ${all.filter(u=>u.hasPush).length}/${all.length} push · ${(window._adminReminderLogs||[]).length} sent</span></span>
        <span id="ov-notif-log-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="ov-notif-log" style="display:none" class="admin-section-bd">
        ${_renderNotifLog(active,completed)}
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('ov-broadcast')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">BROADCAST MESSAGE</span>
        <span id="ov-broadcast-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="ov-broadcast" style="display:none" class="admin-section-bd">
        <textarea id="broadcast-ta" rows="3" placeholder="Write your message to all challengers..." style="font-size:13px;margin-bottom:8px"></textarea>
        <button id="broadcast-btn" class="bp" style="font-size:12px;padding:8px 16px" onclick="broadcastMessage()">Broadcast to All</button>
        <div id="broadcast-status"></div>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('ov-health');if(!document.getElementById('ov-health').querySelector('.admin-stat'))loadSystemHealth()">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">SYSTEM HEALTH</span>
        <span id="ov-health-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="ov-health" style="display:none" class="admin-section-bd">
        <div id="health-content" style="text-align:center;padding:8px 0"><div class="spinner" style="margin:0 auto"></div></div>
      </div>
    </div>

    <div style="margin-top:12px;margin-bottom:20px">
      <button class="bs" style="font-size:12px;padding:8px 16px" onclick="adminDataLoaded=false;renderAdmin()">↻ Refresh</button>
    </div>
  `;
}

function renderAdminChallengers(c){
  const all=getAM();
  const active=all.filter(u=>!_isComplete(u));
  const completed=all.filter(u=>_isComplete(u));
  if(!all.length){c.innerHTML=`<div style="text-align:center;padding:60px 20px"><p class="muted" style="font-size:14px;margin-bottom:6px">No challengers yet.</p><p class="muted" style="font-size:12px">People will appear here after completing payment.</p></div>`;return;}
  const _renderCard=(u,dim)=>{
    const unreadCt=getUnreadCountForChallenger(u.id);
    const up=u.up.filter(Boolean).length;
    const missed=_missedDays(u);
    const pct=Math.round((up/(u.dur||15))*100);
    const isDone=_isComplete(u);
    const isAtRisk=!isDone&&missed>=3;
    const statusLbl=isDone?"Done ★":isAtRisk?"At Risk":"Active";
    const statusColor=isDone?"#c49a1c":isAtRisk?"#d9503a":"#4dc98a";
    return `
    <div class="card mb10 ch-item" data-name="${(u.name||'').toLowerCase()}" id="ch-card-${u.id}"${dim?' style="opacity:.6"':""}>
      <div class="row" style="justify-content:space-between;cursor:pointer" onclick="toggleCh('${u.id}')">
        <div class="row" style="gap:10px">
          ${_avatarWithStatus(u,38,"9px")}
          <div style="min-width:0">
            <p style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.name}${_bdg(unreadCt)}</p>
            <p class="muted" style="font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.goal||"No goal set"}</p>
            <p style="font-size:10px;color:#555;margin-top:2px">${_formatLastSeen(u.lastSeen)}</p>
          </div>
        </div>
        <div class="row" style="gap:10px;flex-shrink:0">
          <div style="text-align:right">
            <span style="font-size:10px;font-weight:700;color:${statusColor}">${statusLbl}</span>
            <p class="muted" style="font-size:10px;margin-top:2px">${isDone?`${u.dur} days · ${up} uploads`:`Day ${u.day}/${u.dur}`}</p>
          </div>
          <span id="chev-${u.id}" style="font-size:18px;color:#5a5a5a;transition:transform .2s">›</span>
        </div>
      </div>
      <div style="margin-top:10px"><div style="height:3px;background:#1b1b1b;border-radius:2px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${isDone?"#c49a1c":isAtRisk?"#d9503a":"#c49a1c"};border-radius:2px;transition:width .3s"></div></div><p class="muted" style="font-size:9px;margin-top:4px;text-align:right">${up}/${u.dur} uploaded · ${pct}%</p></div>
      <div id="ch-det-${u.id}" style="display:none;border-top:1px solid #1b1b1b;padding-top:14px;margin-top:10px">${renderChallengerDetail(u)}</div>
    </div>`;
  };
  c.innerHTML = `
    <div class="row mb12" style="justify-content:space-between;align-items:center">
      <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">${active.length} ACTIVE${completed.length?` · ${completed.length} completed`:""}</p>
      <div style="position:relative">
        <input id="ch-search" type="text" placeholder="Search..." oninput="_filterChallengers(this.value)" style="font-size:12px;padding:6px 12px 6px 28px;border-radius:100px;background:#111;border:1px solid #222;color:#ebebeb;width:140px;font-family:inherit;outline:none;transition:border-color .15s" onfocus="this.style.borderColor='#c49a1c'" onblur="this.style.borderColor='#222'">
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:11px;color:#555">⌕</span>
      </div>
    </div>
    <div id="ch-list">
    ${active.map(u=>_renderCard(u,false)).join("")}
    ${completed.length?`<p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin:18px 0 10px">COMPLETED</p>
    ${completed.map(u=>_renderCard(u,true)).join("")}`:""}
    </div>
  `;
  /* Restore any previously-open detail sections */
  _openChallengerIds.forEach(uid=>{
    const det=el("ch-det-"+uid),chev=el("chev-"+uid);
    if(det){det.style.display="block";if(chev)chev.textContent="˅";}
  });
}

function _filterChallengers(q){
  const query=q.toLowerCase().trim();
  document.querySelectorAll(".ch-item").forEach(el=>{
    el.style.display=!query||el.dataset.name.includes(query)?"":"none";
  });
}

/* Track which challenger details are currently expanded */
let _openChallengerIds=new Set();

function toggleCh(uid){
  const det=el("ch-det-"+uid),chev=el("chev-"+uid);
  const open=det.style.display!=="none";
  det.style.display=open?"none":"block";
  chev.textContent=open?"›":"˅";
  if(open) _openChallengerIds.delete(uid);
  else _openChallengerIds.add(uid);
}

function openChallenger(uid){
  const det=el("ch-det-"+uid),chev=el("chev-"+uid);
  if(det){det.style.display="block";if(chev)chev.textContent="˅";}
  _openChallengerIds.add(uid);
  el("ch-card-"+uid)?.scrollIntoView({behavior:"smooth",block:"start"});
}

function renderChallengerDetail(u){
  const dur=u.dur||15;
  const callDays=CALL_DAYS[dur]||[];
  const activeGid=u.activeGoalId||u.primaryGoalId;
  /* Only thread goal_id into review actions for multi-goal challengers —
     single-goal (legacy) rows may have NULL goal_id (see getPendingInbox). */
  const gidArg=(u.isMultiGoal&&activeGid&&activeGid!=="_primary")?`,'${activeGid}'`:"";
  /* Goal switcher — only for multi-goal (30-day Intensive) challengers.
     Mirrors the user-side GOAL 1 / GOAL 2 tabs; selecting one re-points the
     grid/reviews at that goal's uploads. */
  let goalSwitcher="";
  if(u.isMultiGoal&&u.goals&&u.goals.length>1){
    const tabs=u.goals.map(g=>{
      const col=g.slot===2?"#4dc98a":"#c49a1c";
      const on=g.id===activeGid;
      const label=(g.goalSummary||g.goalRaw||("Goal "+g.slot));
      const short=label.length>26?label.slice(0,26).trim()+"…":label;
      return `<button onclick="adminSwitchChallengerGoal('${u.id}','${g.id}')"
        style="flex:1;min-width:0;text-align:left;padding:8px 11px;border-radius:9px;cursor:pointer;font-family:inherit;
        border:1.5px solid ${on?col:col+"33"};background:${on?col+"14":"transparent"};transition:all .15s">
        <span style="display:block;font-size:9px;font-weight:800;letter-spacing:.06em;color:${col}">GOAL ${g.slot}</span>
        <span style="display:block;font-size:11px;font-weight:600;color:${on?"#e8e8e8":"#888"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${short}</span>
      </button>`;
    }).join("");
    goalSwitcher=`<div class="ch-block"><span class="ch-block-lbl">GOALS</span>
      <div style="display:flex;gap:8px">${tabs}</div></div>`;
  }
  /* A missed day may carry a gap note (why they missed). Genie reads it
     before opening a call. */
  const gapNoteFor=(day)=>(u.gapNotes||[]).find(n=>n.start_day<=day&&n.end_day>=day)||null;
  /* Build compact grid (same visual language as user dashboard) */
  const compDay=(typeof u.completedOn==="number"&&u.completedOn>0)?u.completedOn:0;
  let gridCells="";
  for(let i=0;i<dur;i++){
    const d=i+1,isUp=u.up[i],isRv=u.rv&&u.rv[i],fut=d>u.day,isMiss=d<u.day&&!isUp;
    /* Early completion: medal on the completed day, neutral closed days after
       it, never a miss. Mirrors the member grid. */
    if(compDay){
      if(d===compDay){
        gridCells+=`<div class="dc" style="position:relative;background:rgba(196,154,28,.1);border:1px solid rgba(196,154,28,.45)" title="Goal completed on day ${d}">
          <span class="dn">D${d}</span>
          <span style="display:flex;align-items:center;justify-content:center;margin-top:1px">${typeof _trophySVG==="function"?_trophySVG(12):"★"}</span>
        </div>`;
        continue;
      }
      if(d>compDay){
        gridCells+=`<div class="dc" style="position:relative;background:#0e0e0e;border:1px solid #171717;opacity:.45" title="Day ${d} · closed">
          <span class="dn" style="color:#5a5a5a">D${d}</span>
        </div>`;
        continue;
      }
    }
    const isCall=callDays.includes(d);
    const hasVoice=u.hasVoice&&u.hasVoice[i],hasLink=u.links&&u.links[i];
    let cls="dc";
    let ds="";
    if(isUp){cls+=isRv?" up":" up";ds=isRv?"✓✓":"✓";}
    else if(d===u.day){cls+=" tod";ds="NOW";}
    else if(isMiss){cls+=" ms";ds="-";}
    else{cls+=" ft";}
    if(isCall)cls+=" call-day";
    const indicators=(hasVoice?"🎙":"")+(hasLink?"🔗":"");
    const upTime=u.uploadTimes&&u.uploadTimes[i];
    const timeStr=upTime?new Date(upTime).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",hour12:false}):"";
    const gn=isMiss?gapNoteFor(d):null;
    const titleText=isUp?`Day ${d} · Uploaded at ${timeStr}`:fut?`Day ${d} · upcoming`:gn?`Day ${d} · ${(gn.note||"").replace(/"/g,"&quot;")}`:`Day ${d}`;
    const onclick=isUp?`onclick="openUploadDetail('${u.id}',${i}${gidArg})" style="cursor:pointer"`:isMiss?`onclick="adminShowGapNote('${u.id}',${d})" style="cursor:pointer"`:"";
    gridCells+=`<div class="${cls}" ${onclick} title="${titleText}">
      <span class="dn">D${d}</span>
      ${ds?`<span class="ds">${ds}</span>`:""}
      ${isUp&&timeStr?`<span style="font-size:7px;color:#888;line-height:1">${timeStr}</span>`:""}
      ${indicators?`<span style="font-size:7px;line-height:1;margin-top:1px">${indicators}</span>`:""}
      ${gn?`<span style="position:absolute;bottom:-2px;left:-2px;width:9px;height:9px;border-radius:50%;background:#c49a1c;display:flex;align-items:center;justify-content:center;font-size:6px;color:#000;font-weight:900">i</span>`:""}
      ${isCall?`<span style="position:absolute;top:-2px;right:-2px;width:9px;height:9px;border-radius:50%;background:#c49a1c;display:flex;align-items:center;justify-content:center;font-size:5px">C</span>`:""}
    </div>`;
  }
  const up=u.up.filter(Boolean).length,rv=u.rvCount||0;
  const escName=(u.name||"").replace(/'/g,"\\\\'");

  /* Missed-days readback for Genie: why each gap happened, at a glance. */
  let gapNotesBlock="";
  if(u.gapNotes&&u.gapNotes.length){
    const srcLbl={user_gate:"named it",messaged:"messaged"};
    const rows=u.gapNotes.map(n=>{
      const label=n.start_day===n.end_day?`Day ${n.start_day}`:`Days ${n.start_day} to ${n.end_day}`;
      const when=n.created_at?new Date(n.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"";
      const noteTxt=(n.note||"").replace(/</g,"&lt;");
      return `<div style="padding:8px 0;border-bottom:1px solid #171717">
        <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:3px">
          <span style="font-size:11px;font-weight:700;color:#d9503a">${label}</span>
          <span style="font-size:10px;color:#5a5a5a">${srcLbl[n.source]||n.source} · ${when}</span>
        </div>
        <p style="font-size:13px;line-height:1.5;color:#ddd;margin:0">${noteTxt}</p>
      </div>`;
    }).join("");
    gapNotesBlock=`<div class="ch-block"><span class="ch-block-lbl">MISSED DAYS · WHY</span>${rows}</div>`;
  }

  /* Re-entry clearance: after a real conversation, Genie can open the platform
     for this person. It skips the lock/gate once and shows welcome back. */
  const clearPending=!!u.clearedAt;
  const startDateStr=u.startDate?new Date(u.startDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";

  /* Energy & mood entries (only built if there's anything to show) */
  let energyEntries=[];
  if(u.energyLog){
    energyEntries=Object.entries(u.energyLog).filter(([k,v])=>v.type!=="skip");
  }
  const energyTags=energyEntries.map(([day,v])=>{
    if(v.type==="energy") return `<span class="tag" style="font-size:10px">D${day}: ${"🔥".repeat(v.value)}</span>`;
    if(v.type==="mood") return `<span class="tag" style="font-size:10px">D${day}: ${v.value}</span>`;
    return `<span class="tag" style="font-size:10px" title="${(v.value||"").replace(/"/g,"&quot;")}">D${day}: 💭</span>`;
  }).join("");

  return `
    ${u.flag?`<div class="ch-flag-banner"><span class="ch-flag-icon">⚑</span><p style="margin:0;font-size:12px;line-height:1.5">${u.flag}</p></div>`:""}

    <div class="ch-block">
      <div class="ch-contact-row" style="justify-content:space-between">
        <div class="ch-contact-row">
          <span class="ch-block-lbl" style="margin:0">CONTACT</span>
          ${u.email?`<a href="mailto:${u.email}">✉ ${u.email}</a>`:`<span class="muted" style="font-size:12px">No email</span>`}
          ${u.phone?`<a href="https://wa.me/${u.phone.replace(/\D/g,'')}" target="_blank">📱 ${u.phone}</a>`:""}
        </div>
        <button onclick="openProfilePanel('${u.id}')" style="padding:4px 12px;border-radius:100px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.2);color:#c49a1c;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0;font-family:inherit">View / Edit Profile →</button>
      </div>
    </div>

    ${goalSwitcher}

    <div class="ch-block">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
        <span class="ch-block-lbl" style="margin:0">ACTIVITY${u.isMultiGoal?" · GOAL "+((_adminGoalMeta(u,activeGid)||{}).slot||1):""} · ${up}/${dur} uploaded · ${rv} reviewed</span>
        <span class="muted" style="font-size:10px">tap a cell</span>
      </div>
      <div class="g15">${gridCells}</div>
    </div>

    ${gapNotesBlock}

    <div class="ch-block ch-block-msg" id="fb-area-${u.id}">
      <span class="ch-block-lbl">MESSAGE ${(u.name||"").toUpperCase()}</span>
      ${_quickReplyChips("fb-ta-"+u.id)}
      <textarea id="fb-ta-${u.id}" rows="2" placeholder="Message ${u.name}..." class="mb8" style="font-size:13px"></textarea>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="bp" style="font-size:12px;padding:8px 14px" onclick="sendFBLive('${u.id}')">Send →</button>
        <button class="bs" style="font-size:12px;padding:8px 14px" onclick="sendLilDraft('${u.id}')">✦ Lil Draft</button>
        <button class="bs" style="font-size:12px;padding:8px 14px" onclick="openCallSchedule('${u.id}')">📞 Call</button>
      </div>
    </div>

    ${energyEntries.length?`
    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('chen-${u.id}')">
        <span class="ch-block-lbl" style="margin:0;color:#c49a1c">ENERGY & MOOD · ${energyEntries.length}</span>
        <span id="chen-${u.id}-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="chen-${u.id}" style="display:none" class="admin-section-bd">
        <div style="display:flex;flex-wrap:wrap;gap:4px">${energyTags}</div>
      </div>
    </div>`:""}

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('chmg-${u.id}')">
        <span class="ch-block-lbl" style="margin:0">MANAGE</span>
        <span id="chmg-${u.id}-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="chmg-${u.id}" style="display:none" class="admin-section-bd">
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">
          <span class="muted" style="font-size:11px">Started ${startDateStr}</span>
          <button onclick="promptAdjustStart('${u.id}','${escName}')" style="padding:4px 12px;border-radius:100px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.2);color:#c49a1c;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit">Adjust Start Date</button>
        </div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px;justify-content:space-between">
          <div style="min-width:0">
            <p style="font-size:12px;font-weight:700;margin:0">Witnesses</p>
            <p class="muted" style="font-size:10px;margin:2px 0 0">Lets ${u.name} invite people to watch their progress.</p>
          </div>
          <button id="wit-tog-${u.id}" onclick="toggleWitnessesForChallenger('${u.id}',${u.witnessesEnabled?"false":"true"})"
            style="padding:5px 14px;border-radius:100px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;flex-shrink:0;
            border:1px solid ${u.witnessesEnabled?"rgba(77,201,138,.35)":"#333"};
            background:${u.witnessesEnabled?"rgba(77,201,138,.1)":"transparent"};
            color:${u.witnessesEnabled?"#4dc98a":"#888"}">${u.witnessesEnabled?"✓ Enabled":"Enable"}</button>
        </div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px;justify-content:space-between">
          <div style="min-width:0">
            <p style="font-size:12px;font-weight:700;margin:0">Clear re-entry</p>
            <p class="muted" style="font-size:10px;margin:2px 0 0">After you speak, open the platform for ${u.name}. Skips the lock once and shows welcome back.</p>
          </div>
          <button id="clr-tog-${u.id}" onclick="adminToggleClearance('${u.id}',${clearPending?"false":"true"})"
            style="padding:5px 14px;border-radius:100px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;flex-shrink:0;
            border:1px solid ${clearPending?"rgba(77,201,138,.35)":"#333"};
            background:${clearPending?"rgba(77,201,138,.1)":"transparent"};
            color:${clearPending?"#4dc98a":"#888"}">${clearPending?"✓ Cleared (pending)":"Clear re-entry"}</button>
        </div>
      </div>
    </div>

    <div class="admin-section" style="border-color:rgba(217,80,58,.18)">
      <div class="admin-section-hd" onclick="toggleAdminSection('chdz-${u.id}')">
        <span class="ch-block-lbl" style="margin:0;color:#d9503a">DANGER ZONE</span>
        <span id="chdz-${u.id}-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="chdz-${u.id}" style="display:none" class="admin-section-bd">
        <button onclick="deleteChallenger('${u.id}','${escName}')" style="padding:8px 14px;border-radius:8px;background:transparent;border:1px solid rgba(217,80,58,.3);color:#d9503a;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Delete ${u.name}'s Account</button>
      </div>
    </div>`;
}

function _getMissStreak(u){
  let streak=0;
  for(let i=u.day-2;i>=0;i--){
    if(!u.up[i])streak++;else break;
  }
  return streak;
}

/* ── ATTENTION QUEUE — ACTION ITEMS ─────────────────────────────────────
   An action item = an active challenger with a real miss situation (the same
   at-risk criterion the queue has always used). It CLEARS only on a deliberate
   act — Dismiss, Clear All, or Send Now — persisted in
   challengers.last_attention_cleared_at. It RE-SURFACES automatically when a
   newer miss is registered after that timestamp, so clearing never permanently
   silences an active challenger. */
function _isAtRisk(u){ return _missedDays(u)>=3||!!u.flag; }
/* Timestamp (ms) at which the most-recent confirmed miss was registered — a
   missed day D is confirmed at the start of day D+1. 0 if no miss yet. */
function _lastMissMs(u){
  let lastMissedDay=0;
  for(let i=0;i<u.day-1;i++){ if(!u.up[i]) lastMissedDay=i+1; }
  if(!lastMissedDay||!u.startDate) return 0;
  return new Date(u.startDate).getTime()+lastMissedDay*86400000;
}
/* Most recent upload timestamp (ms) — an upload after the miss counts as the
   challenger handling it themselves. */
function _lastUploadMs(u){
  let m=0; const t=u.uploadTimes||[];
  for(let i=0;i<t.length;i++){ if(t[i]){ const ms=new Date(t[i]).getTime(); if(ms>m) m=ms; } }
  return m;
}
/* Handled = the admin cleared it, OR the challenger uploaded, at/after the most
   recent miss. A later miss makes _lastMissMs jump past both, so the card
   returns — nothing here ever permanently silences an active challenger. */
function _attentionCleared(u){
  const missMs=_lastMissMs(u);
  if(!missMs) return true;
  const clearedMs=u.lastAttentionClearedAt?new Date(u.lastAttentionClearedAt).getTime():0;
  return Math.max(clearedMs,_lastUploadMs(u)) >= missMs;
}
/* Visible action cards — drives both the queue and the Attention tab badge. */
function getActionItems(){
  return getActiveAM().filter(u=>_isAtRisk(u)&&!_attentionCleared(u));
}

/* Persist the clear (direct challenger write, like last_seen). Optimistic:
   callers update the local row first so the UI reacts with no reload. */
function _writeAttentionCleared(ids,iso){
  try{ if(sb&&ids.length) sb.from("challengers").update({last_attention_cleared_at:iso}).in("id",ids).then(()=>{}).catch(()=>{}); }catch(e){}
}
function _setLocalCleared(uid,iso){ const u=liveChallengers.find(x=>x.id===uid); if(u) u.lastAttentionClearedAt=iso; }

/* Informational (Reviews) auto-clear: viewing marks the current pending items
   "seen" for this session, so the badge drops even though the work list stays. */
const _seenReviewKeys=new Set();
function _reviewKey(it){ return it.u.id+"|"+it.day+"|"+(it.goalId||""); }
function _unseenReviewCount(){
  try{ return getPendingInbox().filter(it=>!_seenReviewKeys.has(_reviewKey(it))).length; }catch(e){ return 0; }
}
function _markReviewsSeen(){
  try{ getPendingInbox().forEach(it=>_seenReviewKeys.add(_reviewKey(it))); }catch(e){}
}

/* Update the two queue badges in place — no full re-render. Also refreshes the
   browser-tab "(N)" counter so it can't linger after view/dismiss. */
function _refreshQueueBadges(){
  try{
    const f=el("tab-flagged"); if(f) f.innerHTML=`Attention${_bdg(getActionItems().length)}`;
    const r=el("tab-inbox"); if(r) r.innerHTML=`Reviews${_bdg(_unseenReviewCount())}`;
    if(typeof updateTabTitle==="function") updateTabTitle();
  }catch(e){}
}

/* Dismiss one card: one tap, no confirm. */
function dismissAttention(uid){
  const iso=new Date().toISOString();
  _setLocalCleared(uid,iso);
  _writeAttentionCleared([uid],iso);
  const card=document.getElementById("att-card-"+uid);
  if(card) card.remove();
  const hd=el("att-count"); if(hd) hd.textContent=getActionItems().length;
  _refreshQueueBadges();
  if(getActionItems().length===0 && adminCurrentTab==="flagged") renderAdminFlagged(el("admin-content"));
}

/* Clear every visible card at once — single tap, undo toast (no confirm). */
let _undoToastTimer=null;
function _showUndoToast(msg,onUndo){
  document.getElementById("admin-undo-toast")?.remove();
  if(_undoToastTimer) clearTimeout(_undoToastTimer);
  const t=document.createElement("div");
  t.id="admin-undo-toast";
  t.style.cssText="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:9px 10px 9px 16px;display:flex;align-items:center;gap:14px;box-shadow:0 8px 30px #0009;font-size:13px;color:#e0e0e0;max-width:calc(100% - 32px)";
  const span=document.createElement("span"); span.textContent=msg; t.appendChild(span);
  const btn=document.createElement("button");
  btn.textContent="Undo";
  btn.style.cssText="background:none;border:none;color:#c49a1c;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;padding:4px 8px";
  btn.onclick=()=>{ if(_undoToastTimer) clearTimeout(_undoToastTimer); t.remove(); try{onUndo();}catch(e){} };
  t.appendChild(btn);
  document.body.appendChild(t);
  _undoToastTimer=setTimeout(()=>{ t.remove(); },6000);
}
function clearAllAttention(){
  const items=getActionItems();
  if(!items.length) return;
  const iso=new Date().toISOString();
  const prev=items.map(u=>({id:u.id,prev:u.lastAttentionClearedAt||null}));
  items.forEach(u=>_setLocalCleared(u.id,iso));
  _writeAttentionCleared(items.map(u=>u.id),iso);
  renderAdminFlagged(el("admin-content"));
  _refreshQueueBadges();
  _showUndoToast(`Cleared ${items.length} ${items.length===1?"card":"cards"}`,()=>{
    prev.forEach(p=>{
      _setLocalCleared(p.id,p.prev);
      try{ if(sb) sb.from("challengers").update({last_attention_cleared_at:p.prev}).eq("id",p.id).then(()=>{}).catch(()=>{}); }catch(e){}
    });
    renderAdminFlagged(el("admin-content"));
    _refreshQueueBadges();
  });
}

function renderAdminFlagged(c){
  const all=getActiveAM();
  const atRisk=getActionItems();
  if(!atRisk.length){
    c.innerHTML=`<div style="text-align:center;padding:60px 20px">
      <div style="font-size:32px;margin-bottom:12px;opacity:.5">✓</div>
      <p style="font-size:14px;font-weight:600;color:#4dc98a;margin-bottom:6px">All clear</p>
      <p class="muted" style="font-size:12px">No challengers need attention right now. Everyone's on track.</p>
    </div>`;
    return;
  }
  const sorted=[...atRisk].sort((a,b)=>{
    const aMissed=a.up.slice(0,a.day-1).filter(v=>!v).length;
    const bMissed=b.up.slice(0,b.day-1).filter(v=>!v).length;
    return bMissed-aMissed;
  });
  c.innerHTML=`
    <div class="row mb14" style="justify-content:space-between;align-items:center">
      <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#d9503a">NEEDS ATTENTION · <span id="att-count">${sorted.length}</span> of ${all.length}</p>
      ${sorted.length>1?`<button class="bs" style="font-size:10px;padding:5px 11px" onclick="clearAllAttention()">Clear All</button>`:`<span class="muted" style="font-size:10px">sorted by severity</span>`}
    </div>
    ${sorted.map(u=>{
      const missed=_missedDays(u);
      const streak=_getMissStreak(u);
      const reasons=[];
      if(missed>=5)reasons.push(`<span style="color:#d9503a;font-weight:700">${missed} missed days</span>`);
      else if(missed>=3)reasons.push(`${missed} missed days`);
      if(streak>=3)reasons.push(`${streak}-day cold streak`);
      if(u.flag)reasons.push("flagged");
      const unreadCt=getUnreadCountForChallenger(u.id);
      const lastUpload=u.up.lastIndexOf(1);
      const daysSinceUpload=lastUpload>=0?u.day-1-lastUpload:u.day-1;
      return `<div class="card mb10" id="att-card-${u.id}" style="border-left:3px solid ${missed>=5?"#d9503a":"rgba(217,80,58,.4)"}">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div class="row" style="gap:10px">
            ${_avatarWithStatus(u,36,"9px")}
            <div>
              <p style="font-size:13px;font-weight:700;margin:0">${u.name}${_bdg(unreadCt)}</p>
              <p style="font-size:11px;color:#d9503a;margin:2px 0 0">${reasons.join(" · ")}</p>
            </div>
          </div>
          <div style="text-align:right">
            <p style="font-size:10px;color:#888;margin:0">Day ${u.day}/${u.dur}</p>
            <p style="font-size:10px;color:#555;margin:2px 0 0">${daysSinceUpload>0?daysSinceUpload+"d since upload":"uploaded today"}</p>
          </div>
        </div>
        ${u.flag?`<div style="font-size:12px;background:rgba(217,80,58,.06);border:1px solid rgba(217,80,58,.15);padding:8px 10px;border-radius:6px;margin-top:10px;line-height:1.5;color:#ccc">${u.flag}</div>`:""}
        <div class="inbox-divider"></div>
        <div id="intv-${u.id}">
          ${_quickReplyChips("int-ta-"+u.id)}
          <textarea id="int-ta-${u.id}" rows="2" placeholder="Send ${u.name} a message..." style="font-size:13px;margin-bottom:8px"></textarea>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <button class="bd" style="font-size:12px;padding:7px 14px" onclick="sendIntervention('${u.id}')">Send Now →</button>
            <button class="bs" style="font-size:12px;padding:7px 14px" onclick="draftIntervention('${u.id}')">✦ Lil Draft</button>
            <button class="bs" style="font-size:12px;padding:7px 14px;margin-left:auto;color:#888" onclick="dismissAttention('${u.id}')">Dismiss</button>
          </div>
        </div>
      </div>`;
    }).join("")}`;
}

function renderAdminInbox(c){
  const pending=getPendingInbox();
  /* Informational: viewing the queue marks these items seen for the session,
     so the Reviews badge clears immediately (the list itself stays). */
  _markReviewsSeen();
  setTimeout(_refreshQueueBadges,0);
  if(!pending.length){
    c.innerHTML=`<div style="text-align:center;padding:60px 20px">
      <div style="font-size:32px;margin-bottom:12px;opacity:.5">✓</div>
      <p style="font-size:14px;font-weight:600;color:#4dc98a;margin-bottom:6px">All caught up</p>
      <p class="muted" style="font-size:12px">No pending uploads to review. Check back when challengers upload.</p>
    </div>`;
    return;
  }
  c.innerHTML=`<div class="row mb12" style="justify-content:space-between;align-items:center">
      <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">UPLOADS TO REVIEW · ${pending.length}</p>
      <div class="row" style="gap:6px">
        ${pending.length>=2?`<button class="bs" style="font-size:10px;padding:5px 10px" onclick="batchMarkAllReviewed()">✓ All Done (${pending.length})</button>`:""}
      </div>
    </div>
    ${pending.map(({u,day,note,i,goalId,goalSlot,multiGoal,hasVoice,voiceUrl,fileUrl,link,fileName,behavior})=>{
      const ga=_adminGoalArrays(u,goalId);
      const existingNote=ga.reviewNotes&&ga.reviewNotes[i];
      const hasProofContent=(note&&note!=="-")||behavior||link||fileUrl||fileName||voiceUrl||hasVoice;
      /* Unique id per (challenger, day, goal) so two goals sharing a day
         don't collide on the same textarea. */
      const inbId=`inb-${u.id}-${i}-${_inbTok(goalId)}`;
      const gidArg=goalId?`'${goalId}'`:"null";
      const goalTag=multiGoal?`<span style="font-size:9px;font-weight:800;color:${goalSlot===2?"#4dc98a":"#c49a1c"};margin-left:6px">GOAL ${goalSlot}</span>`:"";
      return `
      <div class="card mb10"${multiGoal?` style="border-left:2px solid ${goalSlot===2?"#4dc98a":"#c49a1c"}"`:""}>
        <div class="row" style="justify-content:space-between;align-items:center">
          <div class="row" style="gap:8px;flex:1;min-width:0">
            ${_avatarWithStatus(u,30,"7px")}
            <div style="min-width:0">
              <p style="font-size:12px;font-weight:700;margin:0">${u.name} <span class="muted" style="font-weight:400">· Day ${day}</span>${goalTag}</p>
            </div>
          </div>
          <button onclick="togRv('${u.id}',${i},${gidArg});renderAdminInbox(el('admin-content'))" style="padding:5px 12px;border-radius:100px;background:rgba(77,201,138,.06);border:1px solid rgba(77,201,138,.25);color:#4dc98a;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0;margin-left:8px;transition:background .15s" onmouseenter="this.style.background='rgba(77,201,138,.12)'" onmouseleave="this.style.background='rgba(77,201,138,.06)'">✓ Done</button>
        </div>
        ${hasProofContent?`<div class="inbox-proof">
          ${note&&note!=="-"?`<p style="font-size:12px;line-height:1.5;color:#ccc;margin:0">${note}</p>`:""}
          ${behavior?`<p style="font-size:11px;color:#c49a1c;margin:0">Behavior: ${behavior==="yes"?"✓ Did it":"✗ Missed"}</p>`:""}
          ${link?`<a href="${link}" target="_blank" style="font-size:11px;color:#4dc98a;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🔗 ${link}</a>`:""}
          ${fileUrl?thumbHtml(fileUrl,fileName):fileName?`<p style="font-size:11px;color:#888;margin:0">📎 ${fileName}</p>`:""}
          ${voiceUrl?buildVoicePlayer(voiceUrl):(hasVoice?`<p style="font-size:11px;color:#888;margin:0">🎙 Voice note</p>`:"")}
        </div>`:""}
        ${existingNote?`<div style="padding:8px 10px;background:rgba(196,154,28,.06);border:1px solid rgba(196,154,28,.15);border-radius:8px;font-size:11px;color:#ccc;line-height:1.5;margin-bottom:8px"><span style="font-size:9px;font-weight:700;letter-spacing:.08em;color:#c49a1c">YOUR NOTE</span><p style="margin:3px 0 0">${existingNote}</p></div>`:""}
        <div class="inbox-divider"></div>
        ${_quickReplyChips(inbId)}
        <textarea id="${inbId}" rows="2" placeholder="${existingNote?"Update your note...":"Reply / leave a review note..."}" style="font-size:12px;margin-top:4px">${existingNote||""}</textarea>
        <div class="row mt8" style="gap:7px">
          <button class="bp" style="font-size:11px;padding:6px 12px" onclick="sendInboxReply('${u.id}',${i},${gidArg})">Save & send</button>
          <button class="bs" style="font-size:11px;padding:6px 12px" onclick="lilInboxDraft('${u.id}',${i},'${(note||"").replace(/'/g,"\\'")}',${gidArg})">✦ Draft</button>
        </div>
      </div>`;
    }).join("")}`;
  if(typeof _vpAttachAll==="function") _vpAttachAll(c);
}

/* ── NOTIFICATIONS TAB ── */
let _notifLoading=false;

async function renderAdminNotifications(c){
  if(!c)c=el("admin-content");if(!c)return;
  const all=getAM();
  const active=all.filter(u=>!_isComplete(u));
  const completed=all.filter(_isComplete);
  const allUsers=[...active,...completed];
  const withPush=allUsers.filter(u=>u.hasPush);
  const noPush=allUsers.filter(u=>!u.hasPush);
  const logs=window._adminReminderLogs||[];

  const slotNames={1:"Morning",2:"Afternoon",3:"Evening"};
  const slotDescriptions={1:"7-11 AM WAT",2:"12-3 PM WAT",3:"5-9 PM WAT"};
  const slotColors={1:"#c49a1c",2:"#4dc98a",3:"#888"};

  c.innerHTML=`
    <div style="margin-bottom:20px">
      <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:12px">QUICK ACTIONS</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button id="notif-trigger-auto" class="bp" style="font-size:12px;padding:10px 16px" onclick="_triggerRemindersNow(0)">
          Send Current Slot Now
        </button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${[1,2,3].map(s=>`<button id="notif-trigger-${s}" class="bs" style="font-size:11px;padding:8px 14px;border-color:${slotColors[s]}" onclick="_triggerRemindersNow(${s})">
          ${slotNames[s]} <span style="font-size:9px;color:#666">(${slotDescriptions[s]})</span>
        </button>`).join("")}
      </div>
      <div id="notif-trigger-result" style="margin-top:10px;font-size:12px;display:none"></div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('notif-people')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">PEOPLE · <span style="color:#4dc98a">${withPush.length} push</span> · <span style="color:#d9503a">${noPush.length} no push</span></span>
        <span id="notif-people-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="notif-people" style="display:none" class="admin-section-bd">
        <div style="display:flex;flex-direction:column;gap:3px">
          ${allUsers.map(u=>{
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#0e0e0e;border:1px solid #1a1a1a;border-radius:6px">
              <span style="width:7px;height:7px;border-radius:50%;background:${u.hasPush?"#4dc98a":"#d9503a"};flex-shrink:0"></span>
              <span style="font-size:12px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.name}</span>
              <span style="font-size:10px;color:#555;flex-shrink:0">${_isComplete(u)?"done":u.paymentStatus||"—"}</span>
              ${u.hasPush?`<button class="bs" style="font-size:10px;padding:3px 10px;flex-shrink:0" onclick="_pushToUser('${u.id}','${u.name.replace(/'/g,"\\'")}')">Push</button>`
              :`<span style="font-size:9px;color:#555;flex-shrink:0">no sub</span>`}
            </div>`;
          }).join("")}
        </div>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('notif-broadcast')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">CUSTOM BROADCAST</span>
        <span id="notif-broadcast-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="notif-broadcast" style="display:none" class="admin-section-bd">
        <div style="background:#0e0e0e;border:1px solid #1a1a1a;border-radius:10px;padding:12px">
          <input id="notif-bc-title" placeholder="Notification title" style="width:100%;padding:8px 10px;background:#141414;border:1px solid #222;border-radius:6px;color:#ebebeb;font-size:13px;margin-bottom:8px;box-sizing:border-box">
          <textarea id="notif-bc-body" placeholder="Notification message..." rows="2" style="width:100%;padding:8px 10px;background:#141414;border:1px solid #222;border-radius:6px;color:#ebebeb;font-size:13px;resize:vertical;margin-bottom:8px;box-sizing:border-box"></textarea>
          <button id="notif-bc-btn" class="bp" style="font-size:12px;padding:8px 16px" onclick="_sendBroadcast()">Broadcast to All</button>
          <span id="notif-bc-result" style="font-size:11px;margin-left:8px;color:#888"></span>
        </div>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('notif-delivery-log')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">DELIVERY LOG (LAST 3 DAYS)</span>
        <span id="notif-delivery-log-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="notif-delivery-log" style="display:none" class="admin-section-bd">
        ${_renderNotifLog(active,completed)}
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-hd" onclick="toggleAdminSection('notif-cron')">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">CRON SCHEDULE</span>
        <span id="notif-cron-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="notif-cron" style="display:none" class="admin-section-bd">
        <div style="font-size:12px;color:#888;line-height:1.8;padding:10px 12px;background:#0e0e0e;border:1px solid #1a1a1a;border-radius:8px">
          <p style="margin-bottom:8px">Reminders fire in each challenger's local timezone (auto-detected from their browser). The cron runs across UTC hours to cover every TZ.</p>
          <div style="display:flex;justify-content:space-between"><span style="color:#c49a1c;font-weight:600">Morning</span><span>7–11 AM local</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#4dc98a;font-weight:600">Afternoon</span><span>12–3 PM local</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#888;font-weight:600">Evening</span><span>5–9 PM local</span></div>
          <p style="margin-top:8px;font-size:11px;color:#666">Users without a timezone fall back to Africa/Lagos.</p>
        </div>
      </div>
    </div>
  `;
}

async function _triggerRemindersNow(forceSlot){
  const resultEl=el("notif-trigger-result");
  if(resultEl){resultEl.style.display="block";resultEl.style.color="#c49a1c";resultEl.textContent="Triggering...";}
  try{
    const params=forceSlot?{force_slot:forceSlot}:{};
    const res=await adminFetch("trigger_reminders",params);
    if(resultEl){
      if(res.skipped){
        resultEl.style.color="#888";
        resultEl.textContent="Skipped: "+(res.reason||"no eligible users");
      }else{
        resultEl.style.color="#4dc98a";
        resultEl.textContent=`Sent ${res.sent||0} notifications (slot ${res.slot||"auto"}, ${res.failed||0} failed, ${res.reminded||0} users)`;
      }
    }
    adminDataLoaded=false;
    await loadAdminData();
  }catch(e){
    if(resultEl){resultEl.style.color="#d9503a";resultEl.textContent="Error: "+(e.message||"failed");}
  }
}

async function _sendBroadcast(){
  const title=(el("notif-bc-title")?.value||"").trim();
  const body=(el("notif-bc-body")?.value||"").trim();
  const resultEl=el("notif-bc-result");
  if(!title&&!body){if(resultEl)resultEl.textContent="Type a title and message";return;}
  const btn=el("notif-bc-btn");if(btn)btn.disabled=true;
  if(resultEl){resultEl.style.color="#c49a1c";resultEl.textContent="Sending...";}
  try{
    const res=await adminFetch("send_push",{push_type:"broadcast",title:title||"On It With Genie",body:body||"Check in on your challenge."});
    if(resultEl){resultEl.style.color="#4dc98a";resultEl.textContent=`Sent to ${res.sent||0} devices (${res.failed||0} failed)`;}
    if(el("notif-bc-title"))el("notif-bc-title").value="";
    if(el("notif-bc-body"))el("notif-bc-body").value="";
  }catch(e){
    if(resultEl){resultEl.style.color="#d9503a";resultEl.textContent="Error: "+(e.message||"failed");}
  }
  if(btn)btn.disabled=false;
}

async function _pushToUser(uid,name){
  const msg=prompt(`Push notification to ${name}:\n\nEnter message (or cancel):`);
  if(!msg||!msg.trim())return;
  try{
    const res=await adminFetch("send_push",{push_type:"personal",challenger_id:uid,title:`Hey ${name.split(" ")[0]}`,body:msg.trim()});
    showToast(`Pushed to ${name}: ${res.sent||0} sent`,"success");
  }catch(e){showToast("Push failed: "+(e.message||""),"error");}
}

async function renderAdminAnalytics(c){
  c.innerHTML=`<div style="text-align:center;padding:40px 0"><p class="muted" style="font-size:12px">Loading analytics...</p></div>`;
  if(!getAdminToken())return;
  try{
    const aRes=await adminFetch("load_analytics");
    const events=aRes.events||[];
    if(!events.length){
      c.innerHTML=`<div style="text-align:center;padding:60px 20px"><p class="muted">No analytics data yet. Events will appear as people use the app.</p></div>`;
      return;
    }
    /* Aggregate counts */
    const counts={};
    events.forEach(e=>{counts[e.event_type]=(counts[e.event_type]||0)+1;});

    /* Funnel */
    const funnel=[
      {key:"screen_view",label:"Visits",icon:"👁"},
      {key:"onboarding_start",label:"Started Onboarding",icon:"✦"},
      {key:"duration_selected",label:"Picked Duration",icon:"📅"},
      {key:"checkout_started",label:"Clicked Pay",icon:"💳"},
      {key:"payment_completed",label:"Paid",icon:"✓"},
      {key:"upload_submitted",label:"Uploaded Proof",icon:"↑"},
      {key:"challenge_completed",label:"Completed Challenge",icon:"★"},
    ];
    const funnelHtml=funnel.map(f=>{
      const ct=counts[f.key]||0;
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1a1a1a">
        <span style="font-size:16px;width:24px;text-align:center">${f.icon}</span>
        <span style="flex:1;font-size:13px;font-weight:600">${f.label}</span>
        <span style="font-size:14px;font-weight:800;color:${ct>0?"#c49a1c":"#333"}">${ct}</span>
      </div>`;
    }).join("");

    /* Engagement events */
    const engagement=[
      {key:"chat_msg_sent",label:"Chat Messages (Challenger)",icon:"💬"},
      {key:"admin_msg_sent",label:"Your Messages (Admin)",icon:"📤"},
      {key:"energy_logged",label:"Energy Check-ins",icon:"🔥"},
      {key:"mood_logged",label:"Mood Check-ins",icon:"😌"},
      {key:"sign_in_attempt",label:"Return Sign-ins",icon:"🔑"},
      {key:"admin_login",label:"Admin Logins",icon:"🔒"},
    ];
    const engHtml=engagement.map(f=>{
      const ct=counts[f.key]||0;
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1a1a1a">
        <span style="font-size:16px;width:24px;text-align:center">${f.icon}</span>
        <span style="flex:1;font-size:13px;font-weight:600">${f.label}</span>
        <span style="font-size:14px;font-weight:800;color:${ct>0?"#4dc98a":"#333"}">${ct}</span>
      </div>`;
    }).join("");

    /* Screen popularity */
    const screens={};
    events.filter(e=>e.event_type==="screen_view"&&e.event_data?.screen).forEach(e=>{
      const s=e.event_data.screen;screens[s]=(screens[s]||0)+1;
    });
    const screenRows=Object.entries(screens).sort((a,b)=>b[1]-a[1]).map(([s,ct])=>`
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1a1a1a">
        <span style="font-size:12px;color:#ccc">${s}</span>
        <span style="font-size:12px;font-weight:700;color:#c49a1c">${ct}</span>
      </div>`).join("")||`<p class="muted" style="font-size:12px">No screen data yet</p>`;

    /* Recent activity feed — skip screen_view noise, show 5 with expand */
    const actionEvents=events.filter(e=>e.event_type!=="screen_view");
    const feedRow=e=>{
      const ago=timeAgo(e.created_at);
      const who=e.event_data?.challenger_id?e.event_data.challenger_id.slice(0,8)+"…":(e.event_data?.is_admin?"Admin":"Visitor");
      const detail=e.event_data?.day?` · Day ${e.event_data.day}`:"";
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #141414">
        <div style="min-width:0;flex:1">
          <span style="font-size:12px;font-weight:600;color:#ccc">${e.event_type.replace(/_/g," ")}</span>
          <span style="font-size:11px;color:#555">${detail}</span>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:10px">
          <span style="font-size:10px;color:#555">${who}</span>
          <span data-live-ts="${e.created_at}" style="font-size:10px;color:#444;margin-left:6px">${ago}</span>
        </div>
      </div>`;
    };
    const visibleFeed=actionEvents.slice(0,5).map(feedRow).join("");
    const hiddenFeed=actionEvents.length>5?actionEvents.slice(5,20).map(feedRow).join(""):"";
    const feedHtml=actionEvents.length===0?`<p class="muted" style="font-size:12px">No activity yet</p>`:
      visibleFeed+(hiddenFeed?`<div id="feed-more" style="display:none">${hiddenFeed}</div><button onclick="document.getElementById('feed-more').style.display='block';this.remove()" style="width:100%;padding:8px;margin-top:6px;background:none;border:1px solid #222;border-radius:6px;color:#5a5a5a;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Show ${Math.min(actionEvents.length-5,15)} more</button>`:"");

    /* Generate insights */
    const insights=[];
    const visits=counts["screen_view"]||0;
    const obStart=counts["onboarding_start"]||0;
    const durPick=counts["duration_selected"]||0;
    const payInit=(counts["checkout_started"]||0)+(counts["payment_initiated"]||0);
    const payDone=counts["payment_completed"]||0;
    const uploads=counts["upload_submitted"]||0;
    const chatChallenger=counts["chat_msg_sent"]||0;
    const chatAdmin=counts["admin_msg_sent"]||0;
    const energy=counts["energy_logged"]||0;
    const mood=counts["mood_logged"]||0;
    const signIns=counts["sign_in_attempt"]||0;

    /* Funnel drop-off insights */
    if(visits>5&&obStart===0) insights.push({type:"warning",text:"People are visiting but nobody starts onboarding. Your landing page might not be compelling enough. Try a stronger CTA or social proof."});
    if(obStart>3&&durPick===0) insights.push({type:"warning",text:"People start onboarding but never pick a duration. The onboarding questions might be causing friction. Consider simplifying."});
    if(durPick>2&&payInit===0) insights.push({type:"warning",text:"People pick a duration but never click Pay. The commitment screen or pricing might be scaring them off."});
    if(payInit>2&&payDone===0) insights.push({type:"error",text:"People click Pay but nobody completes payment. Check if Paystack is working, or consider the price point."});
    if(payDone>0&&uploads===0) insights.push({type:"warning",text:"People paid but haven't uploaded any proof yet. Consider a welcome message nudging them to upload Day 1."});
    if(visits>0&&obStart>0) insights.push({type:"success",text:`${Math.round(obStart/visits*100)}% of visitors start onboarding. ${obStart>visits*0.3?"That's solid.":"Try improving the landing page hook."}`});
    if(obStart>0&&payDone>0) insights.push({type:"success",text:`${Math.round(payDone/obStart*100)}% onboarding-to-paid conversion rate. ${payDone>obStart*0.5?"Excellent.":"There's room to improve."}`});

    /* Engagement insights */
    if(uploads>5&&energy===0&&mood===0) insights.push({type:"info",text:"Nobody is using energy or mood check-ins. Consider making them more prominent or removing them to reduce clutter."});
    if(uploads>3&&chatChallenger===0) insights.push({type:"info",text:"Challengers are uploading but not messaging you. They might not know the chat exists. Consider a prompt after their first upload."});
    if(chatChallenger>5&&chatAdmin===0) insights.push({type:"warning",text:"Challengers are messaging you but you haven't replied. Engagement drops when there's no response."});
    if(signIns>3) insights.push({type:"success",text:`${signIns} return sign-ins. People are coming back. That's a strong retention signal.`});
    if(uploads>10) insights.push({type:"success",text:`${uploads} proofs uploaded. Your challengers are showing up.`});
    const completions=counts["challenge_completed"]||0;
    if(completions>0) insights.push({type:"success",text:`${completions} challenge${completions>1?"s":""} completed. People are finishing what they started.`});
    if(payDone>2&&completions===0) insights.push({type:"info",text:"No completions yet. First batch of challengers is still in progress."});

    /* Not enough data yet */
    if(events.length<10) insights.push({type:"info",text:"Not enough data yet for strong recommendations. Keep using the app and insights will sharpen as events come in."});

    const insightIcons={success:"✓",warning:"⚠",error:"✕",info:"→"};
    const insightColors={success:"#4dc98a",warning:"#c49a1c",error:"#d9503a",info:"#888"};
    const insightsHtml=insights.map(ins=>`
      <div style="display:flex;gap:10px;padding:10px 12px;background:${ins.type==="error"?"rgba(217,80,58,.06)":ins.type==="warning"?"rgba(196,154,28,.06)":ins.type==="success"?"rgba(77,201,138,.06)":"rgba(255,255,255,.02)"};border:1px solid ${ins.type==="error"?"rgba(217,80,58,.2)":ins.type==="warning"?"rgba(196,154,28,.18)":ins.type==="success"?"rgba(77,201,138,.18)":"#1a1a1a"};border-radius:8px;margin-bottom:6px">
        <span style="color:${insightColors[ins.type]};font-weight:800;font-size:13px;flex-shrink:0;width:18px;text-align:center">${insightIcons[ins.type]}</span>
        <p style="font-size:12px;line-height:1.6;color:#ccc;margin:0">${ins.text}</p>
      </div>
    `).join("");

    c.innerHTML=`
      <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:14px">PRODUCT ANALYTICS · ${events.length} events</p>

      ${insights.length?`<div class="card mb10" style="padding:16px">
        <p style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;margin-bottom:10px">INSIGHTS & NEXT BUILD</p>
        ${insightsHtml}
      </div>`:""}

      <div class="card mb10" style="padding:16px">
        <p style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;margin-bottom:10px">CONVERSION FUNNEL</p>
        ${funnelHtml}
      </div>

      <div class="card mb10" style="padding:16px">
        <p style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;margin-bottom:10px">ENGAGEMENT</p>
        ${engHtml}
      </div>

      <div class="card mb10" style="padding:16px">
        <p style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;margin-bottom:10px">SCREENS VISITED</p>
        ${screenRows}
      </div>

      <div class="card mb10" style="padding:16px">
        <p style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;margin-bottom:10px">RECENT ACTIVITY</p>
        ${feedHtml}
      </div>
    `;
  }catch(e){
    c.innerHTML=`<div style="text-align:center;padding:40px 0"><p style="color:#d9503a;font-size:12px">Failed to load analytics: ${e.message}</p></div>`;
  }
}

async function toggleWitnessesForChallenger(uid,enable){
  const on=enable===true||enable==="true";
  const btn=el("wit-tog-"+uid);
  if(btn){ btn.disabled=true; btn.textContent="…"; }
  try{
    const res=await adminFetch("toggle_witnesses",{challenger_id:uid,enabled:on});
    if(!res||res.ok===false) throw new Error(res&&res.error||"failed");
    const u=liveChallengers.find(x=>x.id===uid);
    if(u) u.witnessesEnabled=on;
    showToast(on?"Witnesses enabled":"Witnesses disabled","success");
    /* Update the button in place so the open MANAGE section doesn't collapse. */
    if(btn){
      btn.disabled=false;
      btn.textContent=on?"✓ Enabled":"Enable";
      btn.style.border="1px solid "+(on?"rgba(77,201,138,.35)":"#333");
      btn.style.background=on?"rgba(77,201,138,.1)":"transparent";
      btn.style.color=on?"#4dc98a":"#888";
      btn.setAttribute("onclick",`toggleWitnessesForChallenger('${uid}',${on?"false":"true"})`);
    }
  }catch(e){
    showToast("Could not update witnesses","error");
    if(btn){ btn.disabled=false; btn.textContent=on?"Enable":"✓ Enabled"; }
  }
}

/* Flip re-entry clearance. Written straight to the challenger row (same
   client-trusted model as last_attention_cleared_at / last_seen). Setting it
   opens the platform for their next load; the user side consumes it once. */
async function adminToggleClearance(uid,set){
  const on=set===true||set==="true";
  const btn=el("clr-tog-"+uid);
  if(btn){ btn.disabled=true; btn.textContent="…"; }
  const iso=on?new Date().toISOString():null;
  try{
    if(typeof sb==="undefined"||!sb) throw new Error("no client");
    const {error}=await sb.from("challengers").update({cleared_at:iso}).eq("id",uid);
    if(error) throw error;
    const u=liveChallengers.find(x=>x.id===uid);
    if(u) u.clearedAt=iso;
    if(on&&typeof trackEvent==="function") trackEvent("coach_cleared",{challenger_id:uid});
    showToast(on?"Re-entry cleared":"Clearance cancelled","success");
    if(btn){
      btn.disabled=false;
      btn.textContent=on?"✓ Cleared (pending)":"Clear re-entry";
      btn.style.border="1px solid "+(on?"rgba(77,201,138,.35)":"#333");
      btn.style.background=on?"rgba(77,201,138,.1)":"transparent";
      btn.style.color=on?"#4dc98a":"#888";
      btn.setAttribute("onclick",`adminToggleClearance('${uid}',${on?"false":"true"})`);
    }
  }catch(e){
    showToast("Could not update clearance","error");
    if(btn){ btn.disabled=false; btn.textContent=on?"Clear re-entry":"✓ Cleared (pending)"; }
  }
}

/* Save the coach's contact number for the frozen lock screen. Written to the
   coach record, which is the single source the lock reads from. */
async function saveGeniePhone(){
  const inp=el("set-genie-phone");
  if(!inp) return;
  const coachId=inp.getAttribute("data-coach-id")||"";
  let val=(inp.value||"").trim();
  /* Keep a leading + and digits only, so the tel: link is always clean. */
  if(val){
    const plus=val.trim().startsWith("+");
    const digits=val.replace(/\D/g,"");
    if(digits.length<7){ showToast("That number looks too short","error"); return; }
    val=(plus?"+":"")+digits;
  }
  if(!coachId){ showToast("No coach on file to update","error"); return; }
  inp.disabled=true;
  try{
    if(typeof sb==="undefined"||!sb) throw new Error("no client");
    const {error}=await sb.from("coaches").update({phone:val}).eq("id",coachId);
    if(error) throw error;
    inp.value=val;
    showToast(val?"Coach number saved":"Number cleared","success");
  }catch(e){
    showToast("Could not save the number","error");
  }
  inp.disabled=false;
}

/* Read back a single missed day's gap note (why they missed). */
function adminShowGapNote(uid,day){
  const u=liveChallengers.find(x=>x.id===uid);
  const n=u&&(u.gapNotes||[]).find(g=>g.start_day<=day&&g.end_day>=day);
  const label=`Day ${day}`;
  const srcLbl={user_gate:"They named it",messaged:"They messaged"};
  const when=n&&n.created_at?new Date(n.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"";
  const body=n
    ? `<p style="font-size:11px;color:#c49a1c;font-weight:700;letter-spacing:.06em;margin-bottom:8px">${(srcLbl[n.source]||n.source)}${when?" · "+when:""}</p>
       <p style="font-size:15px;line-height:1.6;color:#eee">${(n.note||"").replace(/</g,"&lt;")}</p>`
    : `<p style="font-size:14px;color:#9a9a9a">This day is still unnamed.</p>`;
  let ov=document.getElementById("adm-gap-modal");
  if(ov) ov.remove();
  ov=document.createElement("div");
  ov.id="adm-gap-modal";
  ov.style.cssText="position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:24px";
  ov.onclick=()=>ov.remove();
  ov.innerHTML=`<div onclick="event.stopPropagation()" style="max-width:360px;width:100%;background:#111;border:1px solid #262626;border-radius:14px;padding:20px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-size:11px;font-weight:800;letter-spacing:.06em;color:#d9503a">${label} · MISSED</span>
      <button onclick="document.getElementById('adm-gap-modal').remove()" style="background:none;border:none;color:#666;font-size:18px;cursor:pointer;font-family:inherit">×</button>
    </div>
    ${body}
  </div>`;
  document.body.appendChild(ov);
}

async function togRv(uid,i,goalId){
  const _keepGoal=(goalId&&goalId!=="_primary")?goalId:null;
  try{
    const dayNum=i+1;
    const params={challenger_id:uid,day_number:dayNum};
    if(_keepGoal) params.goal_id=_keepGoal;
    const res=await adminFetch("toggle_reviewed",params);
    showToast(res.reviewed?"Marked as reviewed":"Unmarked review","success");
    await loadAdminData();
  }catch(e){console.error("Review toggle error:",e);showToast("Review toggle failed","error");}
  /* Preserve the goal the admin was viewing after the data reload. */
  if(_keepGoal){ const u=liveChallengers.find(x=>x.id===uid); if(u) _adminSelectGoal(u,_keepGoal); }
  if(adminCurrentTab==="challengers")renderAdminChallengers(el("admin-content"));
  if(adminCurrentTab==="inbox")renderAdminInbox(el("admin-content"));
  if(adminCurrentTab==="overview")renderAdminOverview(el("admin-content"));
}

async function batchMarkAllReviewed(){
  if(!confirm("Mark all pending uploads as reviewed?"))return;
  /* Source from the goal-aware queue so goal-2 pending days are included,
     then dedupe by challenger+day (the edge function marks every upload row
     for a given day, so one entry per day covers both goals). */
  const seen=new Set();
  const pending=[];
  getPendingInbox().forEach(({u,day})=>{
    const key=u.id+"|"+day;
    if(seen.has(key))return;
    seen.add(key);
    pending.push({challenger_id:u.id,day_number:day});
  });
  try{
    const res=await adminFetch("mark_all_reviewed",{items:pending});
    await loadAdminData();
    showToast(`${res.count||0} uploads marked as reviewed`,"success");
  }catch(e){showToast("Batch review failed","error");}
  renderAdminInbox(el("admin-content"));
}

async function promptAdjustStart(uid, name){
  const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
  const tmrStr=tomorrow.toISOString().split("T")[0];
  const input=prompt(`Set new start date for ${name}.\nFormat: YYYY-MM-DD\n\nTomorrow would be: ${tmrStr}`,tmrStr);
  if(!input)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.trim())){alert("Invalid date format. Use YYYY-MM-DD.");return;}
  const newDate=input.trim()+"T06:00:00+00:00";
  try{
    await adminFetch("adjust_start_date",{challenger_id:uid,start_date:newDate});
    adminDataLoaded=false;
    await loadAdminData();
    adminTab(adminCurrentTab);
    alert(`${name}'s start date changed to ${input.trim()}.`);
  }catch(e){
    alert("Failed: "+(e.message||"Unknown error"));
  }
}

async function deleteChallenger(uid, name){
  const typed=prompt(`Type "${name}" to permanently delete this account and all their data:`);
  if(!typed||typed.trim()!==name){alert("Deletion cancelled. Name did not match.");return;}
  if(!confirm(`FINAL CHECK: Delete ${name} and ALL their uploads, messages, and data? This cannot be undone.`))return;
  try{
    await adminFetch("delete_challenger",{challenger_id:uid});
    adminDataLoaded=false;
    await loadAdminData();
    adminTab(adminCurrentTab);
    alert(`${name} has been permanently deleted.`);
  }catch(e){
    console.error("Delete error:",e);
    alert("Deletion failed: "+(e.message||"Unknown error"));
  }
}

async function deleteAllFreeAccounts(){
  const freeUsers=getAllAM().filter(u=>u.paymentStatus==="free"||u.paymentStatus===null||u.paymentStatus==="pending");
  if(!freeUsers.length){alert("No free or unpaid accounts found.");return;}
  const names=freeUsers.map(u=>u.name).join(", ");
  if(!confirm(`Delete ${freeUsers.length} free/unpaid account(s)?\n\n${names}\n\nThis cannot be undone.`))return;
  const typed=prompt(`Type "DELETE ALL FREE" to confirm:`);
  if(typed!=="DELETE ALL FREE"){alert("Cancelled.");return;}
  try{
    const res=await adminFetch("delete_free");
    adminDataLoaded=false;
    await loadAdminData();
    adminTab(adminCurrentTab);
    alert(`Deleted ${res.deleted||0} of ${freeUsers.length} free accounts.`);
  }catch(e){
    console.error("Delete free error:",e);
    alert("Deletion failed: "+(e.message||"Unknown error"));
  }
}

/* ── ADMIN CALL SCHEDULE ── */
function openCallSchedule(uid){
  const u=getAM().find(x=>x.id===uid);if(!u)return;
  const callDays=CALL_DAYS[u.dur||15]||[];
  const upcoming=callDays.filter(cd=>cd>=u.day);
  const startDate=new Date(u.startDate);

  document.getElementById("call-schedule-panel")?.remove();
  const overlay=document.createElement("div");
  overlay.id="call-schedule-panel";
  overlay.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:16px;animation:popIn .2s ease";
  overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};

  const callRows=upcoming.map(cd=>{
    const d=new Date(startDate);d.setDate(d.getDate()+cd-1);
    const lbl=d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});
    return `<div class="row" style="justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #1a1a1a">
      <div><span style="font-size:13px;font-weight:700;color:#ebebeb">Day ${cd}</span><span class="muted" style="font-size:12px;margin-left:8px">${lbl}</span></div>
      <button onclick="_openCalendlyForCall('${u.id}',${cd},'${lbl}')" style="padding:5px 14px;border-radius:100px;background:rgba(196,154,28,.08);border:1px solid rgba(196,154,28,.25);color:#c49a1c;font-size:11px;font-weight:700;cursor:pointer;transition:background .15s" onmouseenter="this.style.background='rgba(196,154,28,.15)'" onmouseleave="this.style.background='rgba(196,154,28,.08)'">Book</button>
    </div>`;
  }).join("");

  overlay.innerHTML=`<div style="background:#111;border:1px solid #222;border-radius:14px;max-width:400px;width:100%;max-height:90vh;overflow-y:auto" onclick="event.stopPropagation()">
    <div style="padding:20px 20px 0">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:4px">
        <p style="font-size:15px;font-weight:800">${u.name}</p>
        <button onclick="document.getElementById('call-schedule-panel').remove()" style="background:none;border:none;color:#666;font-size:18px;cursor:pointer;padding:2px 6px;line-height:1">×</button>
      </div>
      <p class="muted" style="font-size:11px;margin-bottom:16px">Day ${u.day}/${u.dur} · ${upcoming.length} call${upcoming.length!==1?"s":""} remaining</p>
    </div>
    <div style="padding:0 20px 20px">
      ${upcoming.length?callRows:`<p class="muted" style="font-size:13px;text-align:center;padding:16px 0">All calls completed.</p>`}
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid #1a1a1a;display:flex;gap:8px">
        <button class="bs" style="flex:1;font-size:12px;padding:9px" onclick="window.open('${CALENDLY_URL}','_blank')">Open Calendly</button>
        <button class="bs" style="flex:1;font-size:12px;padding:9px" onclick="_quickSendCallLink('${u.id}')">Send Link Only</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
}

function _openCalendlyForCall(uid,callDay,dateLabel){
  const u=getAM().find(x=>x.id===uid);if(!u)return;
  const params=new URLSearchParams();
  if(u.name) params.set("name",u.name);
  if(u.email) params.set("email",u.email);
  if(u.phone) params.set("a1",u.phone);
  const url=CALENDLY_URL+"?"+params.toString();

  document.getElementById("call-schedule-panel")?.remove();
  const overlay=document.createElement("div");
  overlay.id="call-schedule-panel";
  overlay.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;flex-direction:column;animation:popIn .15s ease";
  const closeBar=`<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#111;border-bottom:1px solid #222;flex-shrink:0">
    <p style="font-size:13px;font-weight:700;color:#ebebeb">Book Day ${callDay} call: ${u.name} <span class="muted" style="font-weight:400;font-size:11px;margin-left:6px">${dateLabel}</span></p>
    <button onclick="document.getElementById('call-schedule-panel').remove()" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer;padding:2px 8px">×</button>
  </div>`;
  overlay.innerHTML=`${closeBar}
    <iframe src="${url}" style="flex:1;width:100%;border:none;background:#fff"></iframe>
    <div style="padding:10px 16px;background:#111;border-top:1px solid #222;display:flex;gap:8px;flex-shrink:0">
      <button class="bp" style="flex:1;font-size:12px;padding:9px" onclick="_notifyCallBooked('${uid}',${callDay},'${dateLabel}')">Notify ${u.name}</button>
      <button onclick="document.getElementById('call-schedule-panel').remove()" class="bs" style="font-size:12px;padding:9px">Done</button>
    </div>`;
  document.body.appendChild(overlay);
}

async function _notifyCallBooked(uid,callDay,dateLabel){
  const u=getAM().find(x=>x.id===uid);if(!u)return;
  const msg=`Hey ${u.name}, your Day ${callDay} call (${dateLabel}) has been booked. Check your email for the calendar invite, or join here: ${CALENDLY_URL}`;
  const btn=document.querySelector("#call-schedule-panel .bp");
  if(btn){btn.disabled=true;btn.textContent="Sending...";}
  try{
    await adminFetch("send_message",{challenger_id:uid,message:msg});
    adminFetch("send_push",{push_type:"personal",challenger_id:uid,title:"Call Booked",body:`Day ${callDay} call: ${dateLabel}`}).catch(()=>{});
    showToast(`${u.name} notified`,"success");
    if(btn){btn.textContent="Sent";btn.style.background="#4dc98a";}
  }catch(e){
    showToast("Failed to notify","error");
    if(btn){btn.disabled=false;btn.textContent=`Notify ${u.name}`;}
  }
}

async function _quickSendCallLink(uid){
  const u=getAM().find(x=>x.id===uid);if(!u)return;
  const msg=`Here's the link to book your call: ${CALENDLY_URL}`;
  try{
    await adminFetch("send_message",{challenger_id:uid,message:msg});
    adminFetch("send_push",{push_type:"personal",challenger_id:uid,title:"Book Your Call",body:"Tap to schedule your call with Genie"}).catch(()=>{});
    showToast(`Call link sent to ${u.name}`,"success");
    document.getElementById("call-schedule-panel")?.remove();
  }catch(e){showToast("Failed to send","error");}
}

function playUploadSound(){
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const t = ctx.currentTime;
    /* Two-tone success chime */
    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t + i * 0.12);
      gain.gain.setValueAtTime(0, t + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.18, t + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.35);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.36);
    });
  } catch(e){}
}


