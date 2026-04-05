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
    const {data:msgs}=await sb.from("chat_messages").select("*").order("created_at",{ascending:false}).limit(50);
    /* Group: keep only the first occurrence of each challenger_id */
    const seen=new Set();
    const latest=[];
    for(const m of (msgs||[])){
      if(!seen.has(m.challenger_id)){
        seen.add(m.challenger_id);
        latest.push(m);
      }
    }
    adminRecentMessages=latest;
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
    trackEvent("admin_login");
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

function getPendingInbox(){
  return getAM().flatMap(u=>{
    const items=[];
    for(let i=0;i<u.day-1;i++){
      if(u.up[i]&&!u.rv[i])items.push({u,day:i+1,note:u.notes[i],i,
        hasVoice:u.hasVoice&&u.hasVoice[i],voiceUrl:u.voiceUrls&&u.voiceUrls[i],
        fileUrl:u.fileUrls&&u.fileUrls[i],
        link:u.links&&u.links[i],fileName:u.fileNames&&u.fileNames[i],
        behavior:u.behaviors&&u.behaviors[i]});
    }
    return items;
  });
}

function adminTab(tab){
  adminCurrentTab = tab;
  /* Compute badge counts */
  const inboxCount=getPendingInbox().length;
  const flaggedCount=getAM().filter(u=>u.up.slice(0,u.day-1).filter(v=>!v).length>=3||u.flag).length;
  ["overview","challengers","flagged","inbox","analytics"].forEach(t=>{
    const btn = el("tab-"+t);
    if(!btn) return;
    btn.style.borderBottomColor = t===tab ? "#c49a1c" : "transparent";
    btn.style.color = t===tab ? "#c49a1c" : "#5a5a5a";
    /* Update tab labels with badge counts */
    if(t==="inbox") btn.textContent=inboxCount>0?`Inbox · ${inboxCount}`:"Inbox";
    if(t==="flagged") btn.textContent=flaggedCount>0?`Attention · ${flaggedCount}`:"Needs Attention";
  });
  const c = el("admin-content");
  if(!c) return;
  if(tab==="overview")    renderAdminOverview(c);
  if(tab==="challengers") renderAdminChallengers(c);
  if(tab==="flagged")     renderAdminFlagged(c);
  if(tab==="inbox")       renderAdminInbox(c);
  if(tab==="analytics")   renderAdminAnalytics(c);
}

async function loadSystemHealth(){
  const hc=document.getElementById("health-content");
  if(!hc||!sb)return;
  hc.innerHTML=`<p class="muted" style="font-size:11px">Checking...</p>`;
  try{
    /* DB row counts */
    const tables=["challengers","uploads","chat_messages","analytics_events"];
    const counts={};
    for(const t of tables){
      const {count}=await sb.from(t).select("*",{count:"exact",head:true});
      counts[t]=count||0;
    }
    /* Storage: count files in uploads bucket */
    let storageFiles=0,storageWarning=false;
    try{
      const {data:folders}=await sb.storage.from("uploads").list("",{limit:100});
      if(folders){
        for(const f of folders){
          if(f.id){storageFiles++;continue;}
          const {data:files}=await sb.storage.from("uploads").list(f.name,{limit:500});
          storageFiles+=(files||[]).length;
        }
      }
      if(storageFiles>900)storageWarning=true; /* Supabase free tier: 1GB / ~1000 files warning */
    }catch(e){}
    /* Groq API check */
    let groqStatus="unknown",groqColor="#888";
    try{
      const res=await fetch(GROQ_PROXY_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+SUPABASE_ANON_KEY},body:JSON.stringify({messages:[{role:"user",content:"ping"}],max_tokens:1})});
      if(res.ok){groqStatus="connected";groqColor="#4dc98a";}
      else if(res.status===429){groqStatus="rate limited";groqColor="#c49a1c";}
      else{groqStatus="error ("+res.status+")";groqColor="#d9503a";}
    }catch(e){groqStatus="unreachable";groqColor="#d9503a";}

    /* Supabase free tier limits */
    const dbRows=Object.values(counts).reduce((a,b)=>a+b,0);
    const dbPct=Math.min(100,Math.round(dbRows/50000*100)); /* 500MB ≈ ~50k rows rough */
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

function toggleAdminSection(id){
  const div=document.getElementById(id);
  const chev=document.getElementById(id+"-chev");
  if(!div)return;
  const open=div.style.display!=="none";
  div.style.display=open?"none":"block";
  if(chev)chev.style.transform=open?"rotate(0deg)":"rotate(90deg)";
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

  /* Build messages section — Meta-style: one compact row per challenger */
  const totalUnread=getTotalUnreadCount();
  const unreadBadge=totalUnread>0?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:9px;background:#d9503a;color:#fff;font-size:10px;font-weight:800;padding:0 5px;margin-left:6px">${totalUnread}</span>`:"";
  let messagesSection=`<p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:8px">MESSAGES${unreadBadge}</p>`;
  if(adminRecentMessages.length>0){
    messagesSection+=`<div style="margin-bottom:16px;border:1px solid #1f1f1f;border-radius:10px;overflow:hidden">`;
    adminRecentMessages.forEach((m,i)=>{
      const challenger=getAM().find(u=>u.id===m.challenger_id);
      const name=challenger?challenger.name:"Unknown";
      const ini=challenger?challenger.ini:"?";
      const rawPreview=m.message||"";
      const preview=rawPreview.slice(0,50)+(rawPreview.length>50?"...":"");
      const isVoice=!!m.voice_url;
      const ta=timeAgo(m.created_at);
      const unreadCt=getUnreadCountForChallenger(m.challenger_id);
      const hasUnread=unreadCt>0;
      const senderPrefix=m.sender==="genie"?"You: ":"";
      const borderB=i<adminRecentMessages.length-1?"border-bottom:1px solid #1a1a1a;":"";
      messagesSection+=`<div style="padding:8px 12px;${borderB}cursor:pointer;display:flex;gap:8px;align-items:center${hasUnread?";background:rgba(217,80,58,.04)":""}" onclick="${challenger?`openProfilePanel('${m.challenger_id}')`:""}">`
        +`<div style="width:32px;height:32px;border-radius:50%;background:rgba(196,154,28,.1);border:1.5px solid rgba(196,154,28,.25);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#c49a1c;flex-shrink:0">${ini}</div>`
        +`<div style="flex:1;min-width:0">`
        +`<div style="display:flex;justify-content:space-between;align-items:center"><p style="font-size:12px;font-weight:${hasUnread?"800":"600"};margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</p><span class="muted" style="font-size:10px;flex-shrink:0">${ta}</span></div>`
        +`<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1px"><p class="muted" style="font-size:11px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${hasUnread?"color:#ccc":""}"><span style="opacity:.6">${senderPrefix}</span>${isVoice&&!preview?"🎙 Voice note":preview||"🎙 Voice note"}</p>${hasUnread?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;border-radius:8px;background:#d9503a;color:#fff;font-size:9px;font-weight:800;padding:0 4px;flex-shrink:0;margin-left:6px">${unreadCt}</span>`:""}</div>`
        +`</div></div>`;
    });
    messagesSection+=`</div>`;
  }else{
    messagesSection+=`<p class="muted" style="font-size:12px;margin-bottom:16px">No messages yet.</p>`;
  }

  /* Needs Attention banner */
  const atRiskUsers=getAM().filter(u=>u.up.slice(0,u.day-1).filter(v=>!v).length>=3||u.flag);
  let attentionBanner="";
  if(atRiskUsers.length>0){
    attentionBanner=`<div style="margin-bottom:16px;padding:12px 14px;background:rgba(217,80,58,.06);border:1px solid rgba(217,80,58,.25);border-radius:10px;cursor:pointer" onclick="adminTab('flagged')">
      <div class="row" style="justify-content:space-between">
        <div class="row" style="gap:8px"><span style="font-size:16px">⚑</span><div><p style="font-size:13px;font-weight:700;color:#d9503a">${atRiskUsers.length} challenger${atRiskUsers.length>1?"s":""} need${atRiskUsers.length===1?"s":""} attention</p><p class="muted" style="font-size:11px;margin-top:2px">${atRiskUsers.map(u=>u.name).join(", ")}</p></div></div>
        <span style="color:#d9503a;font-size:14px">→</span>
      </div>
    </div>`;
  }

  c.innerHTML = `
    ${attentionBanner}
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
            <div><p style="font-size:13px;font-weight:700">${u.name}${unreadBdg}</p><p class="muted" style="font-size:11px">Day ${u.day}/${u.dur||15} · ${up} uploads${up>0?` · last: Day ${u.up.lastIndexOf(1)+1}`:""}</p></div>
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

    <div style="margin-top:20px;border:1px solid #1f1f1f;border-radius:10px;overflow:hidden">
      <div onclick="toggleAdminSection('ov-calls')" style="padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#0e0e0e">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">UPCOMING CALLS</span>
        <span id="ov-calls-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="ov-calls" style="display:none;padding:10px 14px;border-top:1px solid #1a1a1a">
        ${getAM().map(u=>{
          const callDays=CALL_DAYS[u.dur||15]||[];
          const upcoming=callDays.filter(cd=>cd>=u.day);
          if(!upcoming.length)return "";
          return `<div class="row mb6" style="justify-content:space-between"><span style="font-size:12px;font-weight:600">${u.name}</span><span class="bdg bdg-a" style="font-size:9px">Day ${upcoming[0]}</span></div>`;
        }).join("")||`<p class="muted" style="font-size:12px">No upcoming calls.</p>`}
      </div>
    </div>

    <div style="margin-top:8px;border:1px solid #1f1f1f;border-radius:10px;overflow:hidden">
      <div onclick="toggleAdminSection('ov-energy')" style="padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#0e0e0e">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">ENERGY & MOOD</span>
        <span id="ov-energy-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="ov-energy" style="display:none;padding:10px 14px;border-top:1px solid #1a1a1a">
        ${getAM().filter(u=>u.energyLog&&Object.keys(u.energyLog).length>0).map(u=>{
          const entries=Object.entries(u.energyLog).filter(([k,v])=>v.type!=="skip");
          const lowDays=entries.filter(([k,v])=>v.type==="energy"&&v.value<=2);
          return `<div class="row mb6" style="justify-content:space-between"><span style="font-size:12px;font-weight:600">${u.name}</span><span class="muted" style="font-size:11px">${entries.length} check-ins${lowDays.length>0?` · <span class="er">${lowDays.length} low</span>`:""}</span></div>`;
        }).join("")||`<p class="muted" style="font-size:12px">No check-in data yet.</p>`}
      </div>
    </div>

    <div style="margin-top:8px;border:1px solid #1f1f1f;border-radius:10px;overflow:hidden">
      <div onclick="toggleAdminSection('ov-broadcast')" style="padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#0e0e0e">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">BROADCAST MESSAGE</span>
        <span id="ov-broadcast-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="ov-broadcast" style="display:none;padding:10px 14px;border-top:1px solid #1a1a1a">
        <textarea id="broadcast-ta" rows="3" placeholder="Write your message to all challengers..." style="font-size:13px;margin-bottom:8px"></textarea>
        <button id="broadcast-btn" class="bp" style="font-size:12px;padding:8px 16px" onclick="broadcastMessage()">Broadcast to All</button>
        <div id="broadcast-status"></div>
      </div>
    </div>

    <div style="margin-top:8px;border:1px solid #1f1f1f;border-radius:10px;overflow:hidden">
      <div onclick="toggleAdminSection('ov-health')" style="padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#0e0e0e">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">SYSTEM HEALTH</span>
        <span id="ov-health-chev" style="font-size:14px;color:#5a5a5a;transition:transform .2s">›</span>
      </div>
      <div id="ov-health" style="display:none;padding:10px 14px;border-top:1px solid #1a1a1a">
        <div id="health-content" style="text-align:center;padding:8px 0"><span class="muted" style="font-size:11px">Tap to load...</span></div>
        <button class="bs" style="font-size:11px;padding:6px 12px;margin-top:6px;width:100%" onclick="loadSystemHealth()">Check System Health</button>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-top:16px;margin-bottom:20px">
      <button class="bs" style="font-size:12px;padding:8px 16px" onclick="adminDataLoaded=false;renderAdmin()">↻ Refresh Data</button>
      <button style="padding:8px 16px;border-radius:9px;background:transparent;border:1px solid rgba(217,80,58,.3);color:#d9503a;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit" onclick="deleteAllFreeAccounts()">Delete Free Accounts</button>
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
      <p style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;margin-bottom:10px">MESSAGE</p>
      <textarea id="fb-ta-${u.id}" rows="2" placeholder="Message ${u.name}..." class="mb8" style="font-size:13px"></textarea>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="bp" style="font-size:12px;padding:8px 14px" onclick="sendFBLive('${u.id}')">Send →</button>
        <button class="bs" style="font-size:12px;padding:8px 14px" onclick="sendLilDraft('${u.id}')">✦ Lil Draft</button>
        <button class="bs" style="font-size:12px;padding:8px 14px" onclick="openCallSchedule('${u.id}')">📞 Call</button>
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
  const pending=getPendingInbox();
  c.innerHTML=`<div class="row mb12" style="justify-content:space-between;align-items:center">
      <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">UPLOADS TO REVIEW · ${pending.length}</p>
      ${pending.length>=2?`<button class="bs" style="font-size:11px;padding:5px 12px" onclick="batchMarkAllReviewed()">Mark All Done (${pending.length})</button>`:""}
    </div>
    ${pending.map(({u,day,note,i,hasVoice,voiceUrl,fileUrl,link,fileName,behavior})=>`
      <div class="card mb10">
        <div class="row mb8" style="justify-content:space-between;align-items:flex-start">
          <div class="row" style="gap:8px;flex:1;min-width:0">
            <div style="width:30px;height:30px;border-radius:7px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.22);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#c49a1c;flex-shrink:0">${u.ini}</div>
            <div style="min-width:0">
              <p style="font-size:12px;font-weight:700">${u.name} <span class="muted">Day ${day}</span></p>
              ${note&&note!=="—"?`<p style="font-size:12px;margin-top:3px;line-height:1.5">${note}</p>`:""}
              ${behavior?`<p style="font-size:11px;margin-top:3px;color:#c49a1c">Behavior: ${behavior==="yes"?"✓ Did it":"✗ Did not do it"}</p>`:""}
              ${link?`<a href="${link}" target="_blank" style="font-size:11px;color:#4dc98a;margin-top:3px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🔗 ${link}</a>`:""}
              ${fileUrl?thumbHtml(fileUrl,fileName):fileName?`<p style="font-size:11px;color:#888;margin-top:2px">📎 ${fileName}</p>`:""}
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

async function renderAdminAnalytics(c){
  c.innerHTML=`<div style="text-align:center;padding:40px 0"><p class="muted" style="font-size:12px">Loading analytics...</p></div>`;
  if(!sb)return;
  try{
    const {data:events}=await sb.from("analytics_events").select("event_type,event_data,created_at").order("created_at",{ascending:false}).limit(500);
    if(!events||!events.length){
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
      {key:"payment_initiated",label:"Reached Payment",icon:"💳"},
      {key:"payment_completed",label:"Paid",icon:"✓"},
      {key:"upload_submitted",label:"Uploaded Proof",icon:"↑"},
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
          <span style="font-size:10px;color:#444;margin-left:6px">${ago}</span>
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
    const payInit=counts["payment_initiated"]||0;
    const payDone=counts["payment_completed"]||0;
    const uploads=counts["upload_submitted"]||0;
    const chatChallenger=counts["chat_msg_sent"]||0;
    const chatAdmin=counts["admin_msg_sent"]||0;
    const energy=counts["energy_logged"]||0;
    const mood=counts["mood_logged"]||0;
    const signIns=counts["sign_in_attempt"]||0;

    /* Funnel drop-off insights */
    if(visits>5&&obStart===0) insights.push({type:"warning",text:"People are visiting but nobody starts onboarding. Your landing page might not be compelling enough — try a stronger CTA or social proof."});
    if(obStart>3&&durPick===0) insights.push({type:"warning",text:"People start onboarding but never pick a duration. The onboarding questions might be causing friction — consider simplifying."});
    if(durPick>2&&payInit===0) insights.push({type:"warning",text:"People pick a duration but never reach payment. The commitment screen or pricing might be scaring them off."});
    if(payInit>2&&payDone===0) insights.push({type:"error",text:"People reach payment but nobody completes it. Check if Paystack is working, or consider the price point."});
    if(payDone>0&&uploads===0) insights.push({type:"warning",text:"People paid but haven't uploaded any proof yet. Consider a welcome message nudging them to upload Day 1."});
    if(visits>0&&obStart>0) insights.push({type:"success",text:`${Math.round(obStart/visits*100)}% of visitors start onboarding. ${obStart>visits*0.3?"That's solid.":"Try improving the landing page hook."}`});
    if(obStart>0&&payDone>0) insights.push({type:"success",text:`${Math.round(payDone/obStart*100)}% onboarding-to-paid conversion rate. ${payDone>obStart*0.5?"Excellent.":"There's room to improve."}`});

    /* Engagement insights */
    if(uploads>5&&energy===0&&mood===0) insights.push({type:"info",text:"Nobody is using energy or mood check-ins. Consider making them more prominent or removing them to reduce clutter."});
    if(uploads>3&&chatChallenger===0) insights.push({type:"info",text:"Challengers are uploading but not messaging you. They might not know the chat exists — consider a prompt after their first upload."});
    if(chatChallenger>5&&chatAdmin===0) insights.push({type:"warning",text:"Challengers are messaging you but you haven't replied. Engagement drops when there's no response."});
    if(signIns>3) insights.push({type:"success",text:`${signIns} return sign-ins — people are coming back. That's a strong retention signal.`});
    if(uploads>10) insights.push({type:"success",text:`${uploads} proofs uploaded. Your challengers are showing up.`});

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

function timeAgo(ts){
  const diff=Date.now()-new Date(ts).getTime();
  const mins=Math.floor(diff/60000);
  if(mins<1)return "just now";
  if(mins<60)return mins+"m ago";
  const hrs=Math.floor(mins/60);
  if(hrs<24)return hrs+"h ago";
  const days=Math.floor(hrs/24);
  return days+"d ago";
}

async function togRv(uid,i){
  /* Toggle review in Supabase */
  if(sb){
    try{
      const dayNum=i+1;
      const {data:existing}=await sb.from("uploads").select("id,reviewed").eq("challenger_id",uid).eq("day_number",dayNum).single();
      if(existing){
        const newState=!existing.reviewed;
        await sb.from("uploads").update({reviewed:newState,reviewed_at:new Date().toISOString()}).eq("id",existing.id);
        showToast(newState?"Marked as reviewed":"Unmarked review","success");
      }
      /* Reload data */
      await loadAdminData();
    }catch(e){console.error("Review toggle error:",e);showToast("Review toggle failed","error");}
  }
  if(adminCurrentTab==="challengers")renderAdminChallengers(el("admin-content"));
  if(adminCurrentTab==="inbox")renderAdminInbox(el("admin-content"));
  if(adminCurrentTab==="overview")renderAdminOverview(el("admin-content"));
}

async function batchMarkAllReviewed(){
  if(!confirm("Mark all pending uploads as reviewed?"))return;
  if(!sb)return;
  const pending=getAM().flatMap(u=>{
    const items=[];
    for(let i=0;i<u.day-1;i++){if(u.up[i]&&!u.rv[i])items.push({uid:u.id,day:i+1});}
    return items;
  });
  let count=0;
  for(const p of pending){
    try{
      const {data}=await sb.from("uploads").select("id").eq("challenger_id",p.uid).eq("day_number",p.day).single();
      if(data) {await sb.from("uploads").update({reviewed:true,reviewed_at:new Date().toISOString()}).eq("id",data.id);count++;}
    }catch(e){}
  }
  await loadAdminData();
  showToast(`${count} uploads marked as reviewed`,"success");
  renderAdminInbox(el("admin-content"));
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

