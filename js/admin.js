/* ── LIVE ADMIN DATA FROM SUPABASE ── */
let liveChallengers=[];
let adminDataLoaded=false;

async function loadAdminData(){
  if(!sb){liveChallengers=[];adminDataLoaded=true;return;}
  try{
    const {data:challengers}=await sb.from("challengers").select("*").order("created_at",{ascending:false});
    if(!challengers||!challengers.length){liveChallengers=[];adminDataLoaded=true;return;}
    const ids=challengers.map(c=>c.id);
    const {data:allUploads}=await sb.from("uploads").select("*").in("challenger_id",ids);
    const {data:allEnergy}=await sb.from("energy_logs").select("*").in("challenger_id",ids);
    
    liveChallengers=challengers.map(c=>{
      const uploads=(allUploads||[]).filter(u=>u.challenger_id===c.id);
      const energy=(allEnergy||[]).filter(e=>e.challenger_id===c.id);
      const dur=c.duration||15;
      const upArr=Array(dur).fill(0);
      const noteArr=Array(dur).fill("—");
      const rvArr=Array(dur).fill(0);
      const voiceArr=Array(dur).fill(0);
      const voiceUrlArr=Array(dur).fill(null);
      const fileUrlArr=Array(dur).fill(null);
      const linkArr=Array(dur).fill(null);
      const fileNameArr=Array(dur).fill(null);
      const behaviorArr=Array(dur).fill(null);
      uploads.forEach(u=>{
        if(u.day_number>=1&&u.day_number<=dur){
          const i=u.day_number-1;
          upArr[i]=1;
          noteArr[i]=u.note||"No note";
          rvArr[i]=u.reviewed?1:0;
          voiceArr[i]=u.voice_url?1:0;
          voiceUrlArr[i]=u.voice_url||null;
          fileUrlArr[i]=u.file_url||null;
          linkArr[i]=u.link_url||null;
          fileNameArr[i]=u.file_name||null;
          behaviorArr[i]=u.behavior_answer||null;
        }
      });
      const elog={};
      energy.forEach(e=>{elog[e.day_number]={type:e.log_type,value:e.value};});
      const startDate=new Date(c.start_date);
      const now=new Date();
      const curDay=Math.min(Math.max(Math.floor((now-startDate)/(1000*60*60*24))+1,1),dur);
      const missed=upArr.slice(0,curDay-1).filter(v=>!v).length;
      return {
        id:c.id,name:c.name,photo:c.photo_url||null,
        ini:(c.name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2),
        goal:c.goal_summary||c.goal_raw,pt:c.proof_type||"output",
        day:curDay,dur,up:upArr,notes:noteArr,rv:rvArr,rvCount:(rvArr||[]).filter(Boolean).length,
        energyLog:elog,hasVoice:voiceArr,voiceUrls:voiceUrlArr,fileUrls:fileUrlArr,
        links:linkArr,fileNames:fileNameArr,behaviors:behaviorArr,
        flag:missed>=4?"Multiple consecutive missed days":null,
        email:c.email,phone:c.phone,
        paymentStatus:c.payment_status,supabaseId:c.id,status:c.status,
        goalRaw:c.goal_raw,goalSummary:c.goal_summary,
        proofDescription:c.proof_description,proofType:c.proof_type||"output",
        threat:c.threat,startDate:c.start_date
      };
    });
    adminDataLoaded=true;
  }catch(e){console.error("Admin load error:",e);liveChallengers=[];adminDataLoaded=true;}
}

function getAM(){return liveChallengers;}

/* Set Genie photo on all avatar elements */

/* ── ADMIN UNREAD MESSAGE TRACKING ── */
let adminUnreadMessages=[];
let adminRecentMessages=[];

async function loadAdminMessages(){
  if(!sb)return;
  try{
    /* Load recent messages, enough to cover all challengers */
    const {data:recent}=await sb.from("chat_messages").select("*").order("created_at",{ascending:false}).limit(200);
    /* Group by challenger_id, keep only the latest message per challenger */
    const byChallenger={};
    (recent||[]).forEach(m=>{
      if(!byChallenger[m.challenger_id]) byChallenger[m.challenger_id]=m;
    });
    adminRecentMessages=Object.values(byChallenger).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    /* Load unread challenger messages (sender=challenger, read_at is null) */
    const {data:unread}=await sb.from("chat_messages").select("id,challenger_id").eq("sender","challenger").is("read_at",null);
    adminUnreadMessages=unread||[];
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
  if(diff<60) return "just now";
  if(diff<3600) return Math.floor(diff/60)+"m ago";
  if(diff<86400) return Math.floor(diff/3600)+"h ago";
  return Math.floor(diff/86400)+"d ago";
}

/* ── ADMIN (PIN-gated) ── */
let adminCurrentTab = "overview";

async function renderAdmin(){
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

function checkAdminPin(){
  const pin=(el("admin-pin-input")?.value||"").trim();
  if(pin===ADMIN_PIN){
    S._adminAuth=true;
    const msg=el("admin-pin-msg");
    if(msg){msg.textContent="";msg.style.color="";}
    renderAdmin();
  }else{
    const msg=el("admin-pin-msg");
    if(msg){msg.textContent="Incorrect PIN — try again";msg.style.color="#d9503a";}
    const input=el("admin-pin-input");
    if(input){input.value="";input.focus();}
  }
}

function adminTab(tab){
  adminCurrentTab = tab;
  ["overview","challengers","flagged","inbox"].forEach(t=>{
    const btn = el("tab-"+t);
    if(!btn) return;
    btn.style.borderBottomColor = t===tab ? "#c49a1c" : "transparent";
    btn.style.color = t===tab ? "#c49a1c" : "#5a5a5a";
  });
  const c = el("admin-content");
  if(!c) return;
  if(tab==="overview")    renderAdminOverview(c);
  if(tab==="challengers") renderAdminChallengers(c);
  if(tab==="flagged")     renderAdminFlagged(c);
  if(tab==="inbox")       renderAdminInbox(c);
}

function renderAdminOverview(c){
  const total = getAM().length + (S.user?1:0);
  const active = getAM().filter(u => u.up.filter(Boolean).length > 0).length + (S.user&&S.uploads.some(v=>v!==null)?1:0);
  const toReview = getAM().reduce((acc,u) => acc + Math.max(0, u.up.filter(Boolean).length - (u.rvCount||0)), 0);
  const liveUp = S.user?S.uploads.filter(v=>v!==null).length:0;
  const liveRv = S.user?(S.uploads.map(()=>0)).filter(Boolean).length:0;
  const livePending = liveUp-liveRv;
  const totalReview = toReview + Math.max(0,livePending);
  const atRisk = getAM().filter(u => u.up.slice(0,u.day-1).filter(v=>!v).length >= 3).length;
  const liveMissed = S.user?S.uploads.slice(0,S.day-1).filter(v=>v===null).length:0;
  const totalAtRisk = atRisk + (liveMissed>=3?1:0);

  /* Build live user card */
  let liveCard="";
  if(S.user){
    const ini=(S.user.name||"?")[0].toUpperCase();
    const liveDur=S.user?.duration||15;
    const pct=Math.round((liveUp/liveDur)*100);
    const isAtRisk=liveMissed>=3;
    liveCard=`<div class="card mb10" style="border-color:rgba(196,154,28,.4)">
      <div class="row mb10" style="justify-content:space-between">
        <div class="row" style="gap:10px">
          <div style="width:36px;height:36px;border-radius:9px;background:rgba(196,154,28,.15);border:2px solid #c49a1c;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#c49a1c;flex-shrink:0">${S.user.photo?`<img src="${S.user.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:7px">`:ini}</div>
          <div><p style="font-size:13px;font-weight:700">${S.user.name} <span class="ac" style="font-size:10px">LIVE</span></p><p class="muted" style="font-size:11px">Day ${S.day}/${liveDur} · ${liveUp} uploads</p></div>
        </div>
        <div class="col" style="align-items:flex-end;gap:5px">
          ${isAtRisk?`<span style="font-size:10px;font-weight:700;color:#d9503a">At Risk</span>`:`<span style="font-size:10px;font-weight:700;color:#4dc98a">Active</span>`}
          ${livePending>0?`<span class="bdg bdg-a" style="font-size:9px">${livePending} to review</span>`:""}
        </div>
      </div>
      <div style="height:3px;background:#1b1b1b;border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${isAtRisk?"#d9503a":"#c49a1c"};border-radius:2px"></div>
      </div>
      ${S.user.recovery?`<div style="margin-top:10px;padding:8px 10px;background:rgba(196,154,28,.05);border:1px solid rgba(196,154,28,.15);border-radius:6px"><p style="font-size:10px;font-weight:700;color:#c49a1c;margin-bottom:4px">RECOVERY COMPLETED</p><p class="muted" style="font-size:11px;line-height:1.5">${S.user.recovery.length} reflections on file</p></div>`:""}
    </div>`;
  }

  /* Build messages section */
  const totalUnread=getTotalUnreadCount();
  const unreadBadge=totalUnread>0?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:9px;background:#d9503a;color:#fff;font-size:10px;font-weight:800;padding:0 5px;margin-left:6px">${totalUnread}</span>`:"";
  let messagesSection=`<p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:12px">MESSAGES${unreadBadge}</p>`;
  if(adminRecentMessages.length>0){
    messagesSection+=`<div style="max-height:320px;overflow-y:auto;margin-bottom:20px;border:1px solid #1f1f1f;border-radius:10px">`;
    adminRecentMessages.forEach(m=>{
      const challenger=getAM().find(u=>u.id===m.challenger_id);
      const name=challenger?challenger.name:"Unknown";
      const ini=challenger?challenger.ini:"?";
      const rawPreview=m.message||"";
      const preview=rawPreview.slice(0,60)+(rawPreview.length>60?"...":"");
      const isVoice=!!m.voice_url;
      const ta=timeAgo(m.created_at);
      const unreadCt=getUnreadCountForChallenger(m.challenger_id);
      const hasUnread=unreadCt>0;
      const senderPrefix=m.sender==="genie"?"You: ":"";
      messagesSection+=`<div style="padding:10px 14px;border-bottom:1px solid #1a1a1a;cursor:pointer;display:flex;gap:10px;align-items:center${hasUnread?";background:rgba(217,80,58,.04)":""}" onclick="${challenger?`openProfilePanel('${m.challenger_id}')`:""}">`
        +`<div style="width:28px;height:28px;border-radius:7px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.22);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#c49a1c;flex-shrink:0">${ini}</div>`
        +`<div style="flex:1;min-width:0"><p style="font-size:12px;font-weight:${hasUnread?"800":"600"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}${hasUnread?' <span style="color:#d9503a;font-size:9px">● '+unreadCt+'</span>':""}</p>`
        +`<p class="muted" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${senderPrefix}${isVoice&&!preview?"🎙 Voice note":preview||"🎙 Voice note"}</p></div>`
        +`<span class="muted" style="font-size:10px;flex-shrink:0">${ta}</span></div>`;
    });
    messagesSection+=`</div>`;
  }else{
    messagesSection+=`<p class="muted" style="font-size:12px;margin-bottom:20px">No messages yet.</p>`;
  }

  c.innerHTML = `
    ${messagesSection}
    <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:12px">ACTIVE CHALLENGERS</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
      <div class="card" style="text-align:center;padding:16px"><div style="font-size:32px;font-weight:900;color:#c49a1c">${total}</div><div class="muted" style="font-size:11px;margin-top:4px">Challengers</div></div>
      <div class="card" style="text-align:center;padding:16px"><div style="font-size:32px;font-weight:900;color:#4dc98a">${active}</div><div class="muted" style="font-size:11px;margin-top:4px">Active</div></div>
      <div class="card" style="text-align:center;padding:16px;${totalReview>0?"background:rgba(196,154,28,.07);border-color:rgba(196,154,28,.22)":""}"><div style="font-size:32px;font-weight:900;color:${totalReview>0?"#c49a1c":"#5a5a5a"}">${totalReview}</div><div class="muted" style="font-size:11px;margin-top:4px">Pending Reviews</div></div>
      <div class="card" style="text-align:center;padding:16px;${totalAtRisk>0?"background:rgba(217,80,58,.07);border-color:rgba(217,80,58,.22)":""}"><div style="font-size:32px;font-weight:900;color:${totalAtRisk>0?"#d9503a":"#5a5a5a"}">${totalAtRisk}</div><div class="muted" style="font-size:11px;margin-top:4px">At Risk</div></div>
    </div>
    <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:12px">CHALLENGERS</p>
    ${liveCard}
    ${getAM().map(u => {
      const up = u.up.filter(Boolean).length;
      const rv = u.rvCount||0;
      const missed = u.up.slice(0,u.day-1).filter(v=>!v).length;
      const pct = Math.round((up/(u.dur||15))*100);
      const isAtRisk = missed>=3;
      const pending = up-rv;
      const unreadCt=getUnreadCountForChallenger(u.id);
      const unreadBdg=unreadCt>0?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;border-radius:8px;background:#d9503a;color:#fff;font-size:9px;font-weight:800;padding:0 4px;margin-left:4px">${unreadCt}</span>`:"";
      return `<div class="card mb10" style="cursor:pointer" onclick="adminTab('challengers');setTimeout(()=>openChallenger('${u.id}'),60)">
        <div class="row mb10" style="justify-content:space-between">
          <div class="row" style="gap:10px">
            <div style="width:36px;height:36px;border-radius:9px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.22);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#c49a1c;flex-shrink:0">${u.ini}</div>
            <div><p style="font-size:13px;font-weight:700">${u.name}${unreadBdg}</p><p class="muted" style="font-size:11px">Day ${u.day}/${u.dur||15} · ${up} uploads</p></div>
          </div>
          <div class="col" style="align-items:flex-end;gap:5px">
            ${isAtRisk?`<span style="font-size:10px;font-weight:700;color:#d9503a">At Risk</span>`:`<span style="font-size:10px;font-weight:700;color:#4dc98a">Active</span>`}
            ${pending>0?`<span class="bdg bdg-a" style="font-size:9px">${pending} to review</span>`:""}
          </div>
        </div>
        <div style="height:3px;background:#1b1b1b;border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${isAtRisk?"#d9503a":"#c49a1c"};border-radius:2px"></div>
        </div>
      </div>`;
    }).join("")}
    ${totalReview>0?`<div class="card ca mt12"><p style="font-size:13px;font-weight:600;margin-bottom:8px"><span class="ac">${totalReview} uploads</span> waiting for your review.</p><button class="bp" style="font-size:12px;padding:8px 16px" onclick="adminTab('inbox')">Review Now →</button></div>`:""}
    <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:12px;margin-top:20px">UPCOMING CALLS</p>
    ${getAM().map(u=>{
      const callDays=CALL_DAYS[u.dur||15]||[];
      const upcoming=callDays.filter(cd=>cd>=u.day);
      if(!upcoming.length)return "";
      return `<div class="card mb8" style="padding:12px 14px"><div class="row" style="justify-content:space-between"><span style="font-size:12px;font-weight:600">${u.name}</span><span class="bdg bdg-a" style="font-size:9px">📞 Day ${upcoming[0]}</span></div></div>`;
    }).join("")}
    <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:12px;margin-top:20px">ENERGY & MOOD INSIGHTS</p>
    ${getAM().filter(u=>u.energyLog&&Object.keys(u.energyLog).length>0).map(u=>{
      const entries=Object.entries(u.energyLog).filter(([k,v])=>v.type!=="skip");
      const lowDays=entries.filter(([k,v])=>v.type==="energy"&&v.value<=2);
      return `<div class="card mb8" style="padding:12px 14px">
        <p style="font-size:12px;font-weight:600;margin-bottom:4px">${u.name}</p>
        <p class="muted" style="font-size:11px">${entries.length} check-ins logged${lowDays.length>0?` · <span class="er">${lowDays.length} low energy day${lowDays.length>1?"s":""}</span>`:""}</p>
      </div>`;
    }).join("")||`<p class="muted" style="font-size:12px">No check-in data yet.</p>`}
    
    <div style="display:flex;gap:8px;margin-bottom:20px">
      <button class="bs" style="font-size:12px;padding:8px 16px" onclick="adminDataLoaded=false;renderAdmin()">↻ Refresh Data</button>
      <button style="padding:8px 16px;border-radius:9px;background:transparent;border:1px solid rgba(217,80,58,.3);color:#d9503a;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit" onclick="deleteAllFreeAccounts()">Delete Free Accounts</button>
    </div>
    <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:12px;margin-top:20px">BROADCAST MESSAGE</p>
    <div class="card mb10">
      <p class="muted mb8" style="font-size:12px">Send a message to all active challengers at once.</p>
      <textarea id="broadcast-ta" rows="3" placeholder="Write your message to all challengers..." style="font-size:13px;margin-bottom:8px"></textarea>
      <button id="broadcast-btn" class="bp" style="font-size:12px;padding:8px 16px" onclick="broadcastMessage()">Broadcast to All</button>
      <div id="broadcast-status"></div>
    </div>
    ${getAM().length===0?`<div class="card" style="text-align:center;padding:32px 16px;margin-top:16px"><p class="muted" style="font-size:14px;margin-bottom:6px">No challengers yet.</p><p class="muted" style="font-size:12px">When someone completes payment, they'll appear here.</p></div>`:""}
  `;
}

function renderAdminChallengers(c){
  c.innerHTML = `
    <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:12px">ALL CHALLENGERS</p>
    ${getAM().map(u=>{
      const unreadCt=getUnreadCountForChallenger(u.id);
      const unreadBdg=unreadCt>0?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;border-radius:8px;background:#d9503a;color:#fff;font-size:9px;font-weight:800;padding:0 4px;margin-left:4px">${unreadCt}</span>`:"";
      return `
      <div class="card mb10" id="ch-card-${u.id}">
        <div class="row" style="justify-content:space-between;cursor:pointer;padding-bottom:12px" onclick="toggleCh('${u.id}')">
          <div class="row" style="gap:10px">
            <div style="width:38px;height:38px;border-radius:9px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.22);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#c49a1c;flex-shrink:0">${u.ini}</div>
            <div><p style="font-size:14px;font-weight:700">${u.name}${unreadBdg}</p><p class="muted" style="font-size:11px;margin-top:2px">${u.goal}</p></div>
          </div>
          <span id="chev-${u.id}" style="font-size:20px;color:#5a5a5a">›</span>
        </div>
        <div id="ch-det-${u.id}" style="display:none;border-top:1px solid #1b1b1b;padding-top:14px">${renderChallengerDetail(u)}</div>
      </div>
    `;}).join("")}
  `;
}

function toggleCh(uid){
  const det=el("ch-det-"+uid),chev=el("chev-"+uid);
  const open=det.style.display!=="none";
  det.style.display=open?"none":"block";
  chev.textContent=open?"›":"˅";
}

function openChallenger(uid){
  const det=el("ch-det-"+uid),chev=el("chev-"+uid);
  if(det){det.style.display="block";if(chev)chev.textContent="˅";}
  el("ch-card-"+uid)?.scrollIntoView({behavior:"smooth",block:"start"});
}

function renderChallengerDetail(u){
  const dur=u.dur||15;
  const callDays=CALL_DAYS[dur]||[];
  /* Build compact grid (same visual language as user dashboard) */
  let gridCells="";
  for(let i=0;i<dur;i++){
    const d=i+1,isUp=u.up[i],isRv=u.rv&&u.rv[i],fut=d>u.day,isMiss=d<u.day&&!isUp;
    const isCall=callDays.includes(d);
    const hasVoice=u.hasVoice&&u.hasVoice[i],hasLink=u.links&&u.links[i];
    let cls="dc";
    let ds="";
    if(isUp){cls+=isRv?" up":" up";ds=isRv?"✓✓":"✓";}
    else if(d===u.day){cls+=" tod";ds="NOW";}
    else if(isMiss){cls+=" ms";ds="—";}
    else{cls+=" ft";}
    if(isCall)cls+=" call-day";
    const indicators=(hasVoice?"🎙":"")+(hasLink?"🔗":"");
    const onclick=isUp?`onclick="openUploadDetail('${u.id}',${i})" style="cursor:pointer"`:"";
    gridCells+=`<div class="${cls}" ${onclick} title="Day ${d}${isUp?": tap to view":fut?" · upcoming":""}">
      <span class="dn">D${d}</span>
      ${ds?`<span class="ds">${ds}</span>`:""}
      ${indicators?`<span style="font-size:7px;line-height:1;margin-top:1px">${indicators}</span>`:""}
      ${isCall?`<span style="position:absolute;top:-2px;right:-2px;width:9px;height:9px;border-radius:50%;background:#c49a1c;display:flex;align-items:center;justify-content:center;font-size:5px">C</span>`:""}
    </div>`;
  }
  const up=u.up.filter(Boolean).length,rv=u.rvCount||0;
  /* Energy summary */
  let energySummary="";
  if(u.energyLog){
    const entries=Object.entries(u.energyLog).filter(([k,v])=>v.type!=="skip");
    if(entries.length>0){
      energySummary=`<div style="margin-bottom:14px;padding:10px 12px;background:rgba(196,154,28,.04);border:1px solid rgba(196,154,28,.12);border-radius:8px">
        <p style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#c49a1c;margin-bottom:6px">ENERGY & MOOD LOG</p>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${entries.map(([day,v])=>{
          if(v.type==="energy") return `<span class="tag" style="font-size:10px">D${day}: ${"🔥".repeat(v.value)}</span>`;
          if(v.type==="mood") return `<span class="tag" style="font-size:10px">D${day}: ${v.value}</span>`;
          return `<span class="tag" style="font-size:10px" title="${v.value}">D${day}: 💭</span>`;
        }).join("")}</div>
      </div>`;
    }
  }
  const contactSection=`<div style="margin-bottom:14px;padding:10px 12px;background:rgba(255,255,255,.02);border:1px solid #1f1f1f;border-radius:8px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;flex-shrink:0">CONTACT</span>
      ${u.email?`<a href="mailto:${u.email}" style="font-size:12px;color:#4dc98a;text-decoration:none">✉ ${u.email}</a>`:"<span class='muted' style='font-size:12px'>No email</span>"}
      ${u.phone?`<a href="https://wa.me/${u.phone.replace(/\D/g,'')}" target="_blank" style="font-size:12px;color:#4dc98a;text-decoration:none">📱 ${u.phone}</a>`:""}
    </div>
    <button onclick="openProfilePanel('${u.id}')" style="padding:4px 12px;border-radius:100px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.2);color:#c49a1c;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0">View / Edit Profile →</button>
  </div>`;
  return `${u.flag?`<div style="padding:10px 12px;background:rgba(217,80,58,.07);border:1px solid rgba(217,80,58,.22);border-radius:8px;margin-bottom:14px;display:flex;gap:8px"><span class="er">⚑</span><p style="font-size:12px;line-height:1.5">${u.flag}</p></div>`:""}
    ${contactSection}
    ${energySummary}
    <p style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;margin-bottom:10px">UPLOADS · ${up}/${dur} · ${rv} reviewed <span style="color:#444;font-weight:400">· tap a cell to view proof</span></p>
    <div class="g15" style="margin-bottom:14px">${gridCells}</div>
    <div style="margin-top:14px;border-top:1px solid #1b1b1b;padding-top:14px" id="fb-area-${u.id}">
      <p style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;margin-bottom:10px">SEND FEEDBACK</p>
      <textarea id="fb-ta-${u.id}" rows="3" placeholder="Personal message to ${u.name}..." class="mb10" style="font-size:13px"></textarea>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="bp" style="font-size:12px;padding:8px 14px" onclick="sendFBLive('${u.id}')">Send Message →</button>
        <button class="bs" style="font-size:12px;padding:8px 14px" onclick="sendInApp('${u.id}')">Send In-App</button>
        <button class="bs" style="font-size:12px;padding:8px 14px" onclick="openCallSchedule('${u.id}')">📞 Schedule Call</button>
        <button class="bs" style="font-size:12px;padding:8px 14px" onclick="sendLilDraft('${u.id}')">✦ Lil Draft</button>
      </div>
    </div>
    <div style="margin-top:16px;border-top:1px solid rgba(217,80,58,.15);padding-top:14px">
      <p style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#d9503a;margin-bottom:8px">DANGER ZONE</p>
      <button onclick="deleteChallenger('${u.id}','${(u.name||'').replace(/'/g,"\\\\'")}')" style="padding:8px 14px;border-radius:8px;background:transparent;border:1px solid rgba(217,80,58,.3);color:#d9503a;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Delete ${u.name}'s Account</button>
    </div>`;
}

function renderAdminFlagged(c){
  const atRisk=getAM().filter(u=>u.up.slice(0,u.day-1).filter(v=>!v).length>=3||u.flag);
  if(!atRisk.length){c.innerHTML=`<div style="text-align:center;padding:60px 20px"><p class="muted">No challengers need attention right now.</p></div>`;return;}
  c.innerHTML=`<p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#d9503a;margin-bottom:12px">NEEDS YOUR ATTENTION · ${atRisk.length}</p>
    ${atRisk.map(u=>{
      const missed=u.up.slice(0,u.day-1).filter(v=>!v).length;
      const reasons=[];
      if(missed>=3)reasons.push(missed+" missed days");
      if(u.flag)reasons.push("upload flagged");
      return `<div class="card ce mb10">
        <div class="row mb10"><div style="width:36px;height:36px;border-radius:9px;background:rgba(217,80,58,.1);border:1px solid rgba(217,80,58,.3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#d9503a;flex-shrink:0">${u.ini}</div><div style="margin-left:10px"><p style="font-size:13px;font-weight:700">${u.name}</p><p style="font-size:11px;color:#d9503a;margin-top:2px">${reasons.join(" · ")}</p></div></div>
        ${u.flag?`<p style="font-size:12px;background:rgba(0,0,0,.3);padding:8px 10px;border-radius:6px;margin-bottom:10px;line-height:1.5">${u.flag}</p>`:""}
        <div id="intv-${u.id}">
          <textarea id="int-ta-${u.id}" rows="2" placeholder="Send ${u.name} a message..." style="font-size:13px;margin-bottom:8px"></textarea>
          <div class="row" style="gap:8px">
            <button class="bd" style="font-size:12px;padding:7px 14px" onclick="sendIntervention('${u.id}')">Send Now →</button>
            <button class="bs" style="font-size:12px;padding:7px 14px" onclick="draftIntervention('${u.id}')">✦ Lil Draft</button>
          </div>
        </div>
      </div>`;
    }).join("")}`;
}

function renderAdminInbox(c){
  const pending=getAM().flatMap(u=>{
    const items=[];
    for(let i=0;i<u.day-1;i++){
      if(u.up[i]&&!u.rv[i])items.push({u,day:i+1,note:u.notes[i],i,
        hasVoice:u.hasVoice&&u.hasVoice[i],voiceUrl:u.voiceUrls&&u.voiceUrls[i],
        link:u.links&&u.links[i],fileName:u.fileNames&&u.fileNames[i],
        behavior:u.behaviors&&u.behaviors[i]});
    }
    return items;
  });
  c.innerHTML=`<p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:12px">UPLOADS TO REVIEW · ${pending.length}</p>
    ${pending.map(({u,day,note,i,hasVoice,voiceUrl,link,fileName,behavior})=>`
      <div class="card mb10">
        <div class="row mb8" style="justify-content:space-between;align-items:flex-start">
          <div class="row" style="gap:8px;flex:1;min-width:0">
            <div style="width:30px;height:30px;border-radius:7px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.22);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#c49a1c;flex-shrink:0">${u.ini}</div>
            <div style="min-width:0">
              <p style="font-size:12px;font-weight:700">${u.name} <span class="muted">Day ${day}</span></p>
              ${note&&note!=="—"?`<p style="font-size:12px;margin-top:3px;line-height:1.5">${note}</p>`:""}
              ${behavior?`<p style="font-size:11px;margin-top:3px;color:#c49a1c">Behavior: ${behavior==="yes"?"✓ Did it":"✗ Did not do it"}</p>`:""}
              ${link?`<a href="${link}" target="_blank" style="font-size:11px;color:#4dc98a;margin-top:3px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🔗 ${link}</a>`:""}
              ${fileName?`<p style="font-size:11px;color:#888;margin-top:2px">📎 ${fileName}</p>`:""}
              ${voiceUrl?`<audio controls src="${voiceUrl}" style="width:100%;margin-top:6px;height:32px"></audio>`:(hasVoice?`<p style="font-size:11px;color:#888;margin-top:2px">🎙 Voice note (link unavailable)</p>`:"")}
            </div>
          </div>
          <button onclick="togRv('${u.id}',${i});renderAdminInbox(el('admin-content'))" style="padding:5px 12px;border-radius:100px;background:#1b1b1b;border:1px solid #333;color:#888;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0;margin-left:8px">Mark Done</button>
        </div>
        <textarea id="inb-${u.id}-${i}" rows="2" placeholder="Reply to ${u.name}..." style="font-size:12px;margin-top:4px"></textarea>
        <div class="row mt8" style="gap:7px">
          <button class="bp" style="font-size:11px;padding:6px 12px" onclick="sendInboxReply('${u.id}',${i})">Send →</button>
          <button class="bs" style="font-size:11px;padding:6px 12px" onclick="lilInboxDraft('${u.id}',${i},'${(note||"").replace(/'/g,"\\'")}')">✦ Lil Draft</button>
        </div>
      </div>
    `).join("")||`<div style="text-align:center;padding:48px 20px"><p class="muted">All caught up. No pending reviews.</p></div>`}`;
}

async function togRv(uid,i){
  /* Toggle review in Supabase */
  if(sb){
    try{
      const dayNum=i+1;
      const {data:existing}=await sb.from("uploads").select("id,reviewed").eq("challenger_id",uid).eq("day_number",dayNum).single();
      if(existing){
        await sb.from("uploads").update({reviewed:!existing.reviewed,reviewed_at:new Date().toISOString()}).eq("id",existing.id);
      }
      /* Reload data */
      await loadAdminData();
    }catch(e){console.error("Review toggle error:",e);}
  }
  if(adminCurrentTab==="challengers")renderAdminChallengers(el("admin-content"));
  if(adminCurrentTab==="inbox")renderAdminInbox(el("admin-content"));
  if(adminCurrentTab==="overview")renderAdminOverview(el("admin-content"));
}

async function deleteChallenger(uid, name){
  /* Step 1: confirm with name */
  const typed=prompt(`Type "${name}" to permanently delete this account and all their data:`);
  if(!typed||typed.trim()!==name){alert("Deletion cancelled. Name did not match.");return;}
  /* Step 2: second confirm */
  if(!confirm(`FINAL CHECK: Delete ${name} and ALL their uploads, messages, and data? This cannot be undone.`))return;
  if(!sb)return;
  try{
    /* Delete from all child tables first */
    await sb.from("uploads").delete().eq("challenger_id",uid);
    await sb.from("energy_logs").delete().eq("challenger_id",uid);
    await sb.from("chat_messages").delete().eq("challenger_id",uid);
    await sb.from("push_subscriptions").delete().eq("challenger_id",uid);
    await sb.from("genie_messages").delete().eq("challenger_id",uid);
    /* Delete the challenger record */
    await sb.from("challengers").delete().eq("id",uid);
    /* Refresh admin */
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
  if(!sb)return;
  const freeUsers=getAM().filter(u=>u.paymentStatus==="free"||u.paymentStatus===null||u.paymentStatus==="pending");
  if(!freeUsers.length){alert("No free or unpaid accounts found.");return;}
  const names=freeUsers.map(u=>u.name).join(", ");
  if(!confirm(`Delete ${freeUsers.length} free/unpaid account(s)?\n\n${names}\n\nThis cannot be undone.`))return;
  const typed=prompt(`Type "DELETE ALL FREE" to confirm:`);
  if(typed!=="DELETE ALL FREE"){alert("Cancelled.");return;}
  let deleted=0;
  for(const u of freeUsers){
    try{
      await sb.from("uploads").delete().eq("challenger_id",u.id);
      await sb.from("energy_logs").delete().eq("challenger_id",u.id);
      await sb.from("chat_messages").delete().eq("challenger_id",u.id);
      await sb.from("push_subscriptions").delete().eq("challenger_id",u.id);
      await sb.from("genie_messages").delete().eq("challenger_id",u.id);
      await sb.from("challengers").delete().eq("id",u.id);
      deleted++;
    }catch(e){console.error("Delete failed for",u.name,e);}
  }
  adminDataLoaded=false;
  await loadAdminData();
  adminTab(adminCurrentTab);
  alert(`Deleted ${deleted} of ${freeUsers.length} free accounts.`);
}

/* Send message to a challenger via Supabase */
async function sendMessageToDB(challengerId,message){
  if(!sb)return false;
  try{
    const {error}=await sb.from("genie_messages").insert({challenger_id:challengerId,message,sent_via:"in_app"});
    return !error;
  }catch(e){return false;}
}


/* ── ADMIN CALL SCHEDULE ── */
function openCallSchedule(uid){
  const u=getAM().find(x=>x.id===uid);if(!u)return;
  window.open(CALENDLY_URL,"_blank");
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

