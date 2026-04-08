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
  if(diff<5) return "just now";
  if(diff<60) return diff+"s ago";
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

async function checkAdminPin(){
  const pin=(el("admin-pin-input")?.value||"").trim();
  /* Check DB-stored PIN first, fallback to hardcoded */
  let validPin=ADMIN_PIN;
  if(sb){
    try{
      const {data}=await sb.from("app_settings").select("value").eq("key","admin_pin").single();
      if(data&&data.value) validPin=data.value;
    }catch(e){}
  }
  if(pin===validPin){
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

/* ── ADMIN PIN MANAGEMENT ── */
async function changeAdminPin(){
  const newPin=prompt("Enter new admin PIN:");
  if(!newPin||!newPin.trim())return;
  if(newPin.trim().length<4){showToast("PIN must be at least 4 characters","error");return;}
  if(!sb){showToast("Database not connected","error");return;}
  try{
    await sb.from("app_settings").upsert({key:"admin_pin",value:newPin.trim()},{onConflict:"key"});
    showToast("Admin PIN updated","success");
  }catch(e){showToast("Failed to update PIN","error");}
}

/* ── ACCESS CODE MANAGEMENT ── */
async function loadAccessCodes(){
  if(!sb)return[];
  try{
    const {data}=await sb.from("access_codes").select("*").order("created_at",{ascending:false});
    return data||[];
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
  if(!sb){showToast("Database not connected","error");return;}
  try{
    await sb.from("access_codes").insert({code:code.trim().toUpperCase(),discount_percent:pct,max_uses:parseInt(maxUses)||0,times_used:0,active:true});
    showToast(`Code ${code.trim().toUpperCase()} created`,"success");
    renderAdminSettings();
  }catch(e){showToast("Failed to create code","error");}
}

async function toggleAccessCode(id,active){
  if(!sb)return;
  try{
    await sb.from("access_codes").update({active:!active}).eq("id",id);
    showToast(active?"Code deactivated":"Code activated",active?"error":"success");
    renderAdminSettings();
  }catch(e){showToast("Failed to update code","error");}
}

async function deleteAccessCode(id){
  if(!confirm("Delete this access code permanently?"))return;
  if(!sb)return;
  try{
    await sb.from("access_codes").delete().eq("id",id);
    showToast("Code deleted","info");
    renderAdminSettings();
  }catch(e){showToast("Failed to delete code","error");}
}

async function renderAdminSettings(){
  const c=el("admin-content");if(!c)return;
  const codes=await loadAccessCodes();
  c.innerHTML=`<div style="padding:18px">
    <h3 style="font-size:14px;font-weight:700;color:#e0e0e0;margin-bottom:14px">🔐 Admin PIN</h3>
    <p style="font-size:12px;color:#888;margin-bottom:10px">Change the PIN required to access this admin dashboard.</p>
    <button class="bs" style="padding:8px 16px;font-size:13px" onclick="changeAdminPin()">Change PIN</button>

    <h3 style="font-size:14px;font-weight:700;color:#e0e0e0;margin:24px 0 14px">🎟 Access Codes</h3>
    <p style="font-size:12px;color:#888;margin-bottom:10px">Manage discount and free-access codes. You control who gets in and for how long.</p>
    <button class="bs" style="padding:8px 16px;font-size:13px;margin-bottom:14px" onclick="createAccessCode()">+ Create Code</button>
    ${codes.length===0?`<p style="font-size:12px;color:#555">No access codes yet.</p>`:`
    <div style="display:flex;flex-direction:column;gap:8px">
      ${codes.map(c=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#111;border:1px solid ${c.active?"#2a2a2a":"#d9503a44"};border-radius:8px">
        <span style="font-weight:700;font-size:13px;color:${c.active?"#c49a1c":"#555"};min-width:100px;font-family:monospace">${c.code}</span>
        <span style="font-size:11px;color:#888;flex:1">${c.discount_percent===100?"FREE":c.discount_percent+"% off"} · ${c.max_uses===0?"Unlimited":c.times_used+"/"+c.max_uses} uses</span>
        <button onclick="toggleAccessCode('${c.id}',${c.active})" style="background:none;border:1px solid ${c.active?"#d9503a55":"#4dc98a55"};color:${c.active?"#d9503a":"#4dc98a"};font-size:10px;padding:4px 8px;border-radius:4px;cursor:pointer">${c.active?"Deactivate":"Activate"}</button>
        <button onclick="deleteAccessCode('${c.id}')" style="background:none;border:1px solid #33333366;color:#555;font-size:10px;padding:4px 8px;border-radius:4px;cursor:pointer">✕</button>
      </div>`).join("")}
    </div>`}
  </div>`;
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
  const reviewCount=getPendingInbox().length;
  const flaggedCount=getAM().filter(u=>u.up.slice(0,u.day-1).filter(v=>!v).length>=3||u.flag).length;
  const unreadCount=typeof getTotalUnreadCount==="function"?getTotalUnreadCount():0;
  const bdg=(n)=>n>0?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;border-radius:8px;background:#d9503a;color:#fff;font-size:9px;font-weight:800;padding:0 4px;margin-left:5px;vertical-align:middle">${n}</span>`:"";
  ["overview","messages","challengers","flagged","inbox","analytics","settings"].forEach(t=>{
    const btn = el("tab-"+t);
    if(!btn) return;
    btn.style.borderBottomColor = t===tab ? "#c49a1c" : "transparent";
    btn.style.color = t===tab ? "#c49a1c" : "#5a5a5a";
    if(t==="overview") btn.innerHTML=`Overview`;
    if(t==="messages") btn.innerHTML=`Messages${bdg(unreadCount)}`;
    if(t==="challengers") btn.innerHTML=`Challengers`;
    if(t==="inbox") btn.innerHTML=`Reviews${bdg(reviewCount)}`;
    if(t==="flagged") btn.innerHTML=`Attention${bdg(flaggedCount)}`;
    if(t==="analytics") btn.innerHTML=`Analytics`;
    if(t==="settings") btn.innerHTML=`Settings`;
  });
  const c = el("admin-content");
  if(!c) return;
  if(tab==="overview")    renderAdminOverview(c);
  if(tab==="messages")    renderAdminMessages(c);
  if(tab==="challengers") renderAdminChallengers(c);
  if(tab==="flagged")     renderAdminFlagged(c);
  if(tab==="inbox")       renderAdminInbox(c);
  if(tab==="analytics")   renderAdminAnalytics(c);
  if(tab==="settings")    renderAdminSettings();
}

/* ── MESSAGES TAB ── */
let _msgActiveChallengerId=null;

function renderAdminMessages(c){
  const challengers=getAM();
  if(!challengers.length&&!adminRecentMessages.length){
    c.innerHTML=`<div style="text-align:center;padding:60px 20px"><p class="muted">No conversations yet. Messages will appear here when challengers write to you.</p></div>`;
    return;
  }

  /* Build conversation list — sorted by most recent message, with unread on top */
  const convos=[];
  const seen=new Set();
  /* Start with recent messages to get ordering */
  adminRecentMessages.forEach(m=>{
    if(seen.has(m.challenger_id))return;
    seen.add(m.challenger_id);
    const u=challengers.find(x=>x.id===m.challenger_id);
    convos.push({
      id:m.challenger_id,
      name:u?u.name:"Unknown",
      ini:u?u.ini:"?",
      photo:u?u.photo:null,
      lastMsg:m,
      unread:getUnreadCountForChallenger(m.challenger_id)
    });
  });
  /* Add challengers with no messages yet */
  challengers.forEach(u=>{
    if(!seen.has(u.id)){
      convos.push({id:u.id,name:u.name,ini:u.ini,photo:u.photo,lastMsg:null,unread:0});
    }
  });
  /* Sort: unread first, then by last message time */
  convos.sort((a,b)=>{
    if(a.unread&&!b.unread)return -1;
    if(!a.unread&&b.unread)return 1;
    if(a.lastMsg&&b.lastMsg) return new Date(b.lastMsg.created_at)-new Date(a.lastMsg.created_at);
    if(a.lastMsg)return -1;
    return 1;
  });

  /* If no active conversation or it doesn't exist, pick the first with unread or first overall */
  if(!_msgActiveChallengerId||!convos.find(x=>x.id===_msgActiveChallengerId)){
    const firstUnread=convos.find(x=>x.unread>0);
    _msgActiveChallengerId=firstUnread?firstUnread.id:(convos[0]?convos[0].id:null);
  }

  const convoListHtml=convos.map(cv=>{
    const isActive=cv.id===_msgActiveChallengerId;
    const preview=cv.lastMsg?(cv.lastMsg.voice_url&&!cv.lastMsg.message?"🎙 Voice note":(cv.lastMsg.sender==="genie"?"You: ":"")+(cv.lastMsg.message||"").slice(0,40)):"No messages yet";
    const ta=cv.lastMsg?timeAgo(cv.lastMsg.created_at):"";
    const avatar=cv.photo?`<img src="${cv.photo}" style="width:36px;height:36px;object-fit:cover;border-radius:50%;flex-shrink:0">`:`<div style="width:36px;height:36px;border-radius:50%;background:rgba(196,154,28,.1);border:1.5px solid rgba(196,154,28,.25);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#c49a1c;flex-shrink:0">${cv.ini}</div>`;
    return `<div onclick="_msgActiveChallengerId='${cv.id}';renderAdminMessages(el('admin-content'))" style="padding:10px 14px;cursor:pointer;display:flex;gap:10px;align-items:center;border-left:3px solid ${isActive?"#c49a1c":"transparent"};background:${isActive?"rgba(196,154,28,.06)":cv.unread?"rgba(217,80,58,.04)":"transparent"};transition:background .15s" onmouseenter="if(!${isActive})this.style.background='rgba(255,255,255,.03)'" onmouseleave="if(!${isActive})this.style.background='${cv.unread?"rgba(217,80,58,.04)":"transparent"}'">
      ${avatar}
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <p style="font-size:13px;font-weight:${cv.unread?"800":"600"};margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cv.name}</p>
          <span class="muted" data-live-ts="${cv.lastMsg?cv.lastMsg.created_at:""}" style="font-size:10px;flex-shrink:0">${ta}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
          <p class="muted" style="font-size:11px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${cv.unread?"color:#ccc":""}">${preview}</p>
          ${cv.unread?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:9px;background:#d9503a;color:#fff;font-size:9px;font-weight:800;padding:0 5px;flex-shrink:0;margin-left:6px">${cv.unread}</span>`:""}
        </div>
      </div>
    </div>`;
  }).join("");

  /* Build the active chat thread */
  const activeConvo=convos.find(x=>x.id===_msgActiveChallengerId);
  const chatHeaderHtml=activeConvo?`
    <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #1f1f1f;background:#0a0a0a">
      ${activeConvo.photo?`<img src="${activeConvo.photo}" style="width:32px;height:32px;object-fit:cover;border-radius:50%">`:`<div style="width:32px;height:32px;border-radius:50%;background:rgba(196,154,28,.1);border:1.5px solid rgba(196,154,28,.25);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#c49a1c">${activeConvo.ini}</div>`}
      <div style="flex:1;min-width:0">
        <p style="font-size:14px;font-weight:700;margin:0">${activeConvo.name}</p>
        <p class="muted" style="font-size:10px;margin:0">Tap to view profile</p>
      </div>
      <button onclick="openProfilePanel('${activeConvo.id}')" style="padding:5px 12px;border-radius:100px;background:rgba(196,154,28,.07);border:1px solid rgba(196,154,28,.2);color:#c49a1c;font-size:10px;font-weight:700;cursor:pointer">Profile →</button>
    </div>`:"";

  c.innerHTML=`
    <div style="display:flex;flex-direction:column;height:calc(100vh - 120px);margin:-18px;border-radius:0">
      <!-- Conversation list -->
      <div style="border-bottom:1px solid #1f1f1f;max-height:220px;overflow-y:auto;flex-shrink:0">
        <p style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;padding:12px 14px 8px">CONVERSATIONS · ${convos.length}</p>
        ${convoListHtml}
      </div>
      <!-- Active chat -->
      <div style="flex:1;display:flex;flex-direction:column;min-height:0">
        ${chatHeaderHtml}
        <div id="msg-tab-thread" style="flex:1;overflow-y:auto;padding:12px 14px">
          <div style="text-align:center;padding:20px"><span class="muted" style="font-size:11px">Loading...</span></div>
        </div>
        <div id="msg-tab-voice-status" style="display:none;padding:4px 14px"></div>
        <div id="msg-tab-reply-indicator" style="display:none"></div>
        ${activeConvo?`<div style="padding:10px 14px;border-top:1px solid #1f1f1f;background:#0a0a0a;display:flex;gap:8px;align-items:flex-end">
          <div class="chat-input-pill" style="flex:1;display:flex;align-items:center;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;padding:0 4px 0 14px">
            <textarea id="msg-tab-input" class="chat-ta" rows="1" placeholder="Message ${activeConvo.name}..." style="flex:1;background:transparent;border:none;color:#ebebeb;font-size:13px;padding:10px 0;resize:none;outline:none;font-family:inherit;line-height:1.4"></textarea>
            <button id="msg-tab-mic" onclick="toggleMsgTabRecording()" style="background:none;border:none;color:#888;cursor:pointer;padding:6px 8px;font-size:14px" title="Voice note">🎙</button>
          </div>
          <button onclick="sendMsgTabMsg('${activeConvo.id}')" style="width:36px;height:36px;border-radius:50%;background:#c49a1c;border:none;color:#000;font-size:16px;font-weight:900;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">↑</button>
        </div>`:""}
      </div>
    </div>`;

  /* Load chat thread async */
  if(_msgActiveChallengerId){
    _loadMsgTabChat(_msgActiveChallengerId);
    /* Mark messages read for this challenger */
    _markMsgTabRead(_msgActiveChallengerId);
  }
}

async function _loadMsgTabChat(uid){
  const thread=document.getElementById("msg-tab-thread");
  if(!thread||!sb)return;
  try{
    const {data:msgs}=await sb.from("chat_messages").select("*").eq("challenger_id",uid).order("created_at",{ascending:true});
    if(!msgs||!msgs.length){thread.innerHTML=`<p style="text-align:center;color:#3a3a3a;font-size:12px;padding:28px 0">No messages yet. Start the conversation.</p>`;return;}
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
      const replyBtn=`<span onclick="event.stopPropagation();_msgTabSetReply('${m.id}','${msgPreview}','${uid}')" style="cursor:pointer;font-size:10px;color:#5a5a5a;margin-left:6px;opacity:0.5;transition:opacity .15s" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.5">↩</span>`;
      return `${dateSep}<div id="msg-${m.id}" class="cmsg ${isMe?"cmsg-me":"cmsg-them"}">
        <div class="cmsg-body">${body}</div>
        <div class="cmsg-time">${isMe?"You":"Challenger"} · ${timeStr}${readCheck}${replyBtn}</div>
      </div>`;
    }).join("");
    thread.scrollTop=thread.scrollHeight;
  }catch(e){thread.innerHTML=`<p style="text-align:center;color:#3a3a3a;font-size:12px;padding:20px 0">Could not load messages</p>`;}
}

function _markMsgTabRead(uid){
  /* Optimistic: remove from local unread cache immediately */
  if(typeof adminUnreadMessages!=="undefined"){
    const had=adminUnreadMessages.some(m=>m.challenger_id===uid);
    adminUnreadMessages=adminUnreadMessages.filter(m=>m.challenger_id!==uid);
    if(had){
      updateTabTitle();
      /* Update just the tab badges, not re-render content */
      const unreadCount=getTotalUnreadCount();
      const bdg=(n)=>n>0?`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;border-radius:8px;background:#d9503a;color:#fff;font-size:9px;font-weight:800;padding:0 4px;margin-left:5px;vertical-align:middle">${n}</span>`:"";
      const msgBtn=el("tab-messages");
      if(msgBtn) msgBtn.innerHTML=`Messages${bdg(unreadCount)}`;
    }
  }
  /* DB update in background */
  if(sb){
    sb.from("chat_messages").update({read_at:new Date().toISOString()}).eq("challenger_id",uid).eq("sender","challenger").is("read_at",null).then(()=>{}).catch(()=>{});
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
  if(_msgTabRecorder&&_msgTabRecorder.state==="recording"){_msgTabRecorder.stop();clearInterval(_msgTabRecTimer);return;}
  _msgTabVoiceBlob=null;
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
        if(ta)ta.placeholder="Recording failed — try again";
        setTimeout(()=>{if(ta)ta.placeholder="Message...";},2500);
        return;
      }
      _msgTabVoiceBlob=new Blob(_msgTabRecChunks,{type:_msgTabRecorder.mimeType||"audio/webm"});
      if(btn){btn.textContent="🎙";btn.style.color="#4dc98a";}
      if(ta)ta.placeholder="✓ Voice note ready — tap ↑ to send";
      if(status){
        const previewUrl=URL.createObjectURL(_msgTabVoiceBlob);
        status.style.display="flex";status.style.alignItems="center";status.style.gap="8px";status.style.padding="6px 14px";
        status.innerHTML=`<audio controls src="${previewUrl}" style="height:32px;flex:1"></audio><button onclick="discardMsgTabVoice()" style="background:none;border:none;color:#d9503a;font-size:16px;cursor:pointer;padding:4px 8px">✕</button>`;
      }
    };
    _msgTabRecorder.start();
    if(btn){btn.textContent="⏹";btn.style.color="#d9503a";}
    let secs=0;
    _msgTabRecTimer=setInterval(()=>{secs++;const m=Math.floor(secs/60),s=String(secs%60).padStart(2,"0");if(ta)ta.placeholder=`● Recording ${m}:${s} — tap to stop`;},1000);
    if(ta)ta.placeholder="● Recording 0:00 — tap to stop";
  }catch(e){if(ta)ta.placeholder="Microphone access denied";setTimeout(()=>{if(ta&&ta.placeholder.includes("denied"))ta.placeholder="Message...";},2500);}
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
  const ta=document.getElementById("msg-tab-input");
  const hasText=ta&&ta.value.trim();
  if(!hasText&&!_msgTabVoiceBlob)return;
  trackEvent("admin_msg_sent",{to:uid,has_voice:!!_msgTabVoiceBlob,has_text:!!hasText});
  if(!sb)return;
  const msg=hasText?ta.value.trim():"";
  if(ta){ta.value="";ta.disabled=true;}
  /* Upload voice if present */
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
    await sb.from("chat_messages").insert({challenger_id:uid,sender:"genie",message:msg||"",voice_url:voiceUrl||null,reply_to_id:_msgTabReplyToId||null});
    _msgTabReplyToId=null;
    const indicator=document.getElementById("msg-tab-reply-indicator");
    if(indicator)indicator.style.display="none";
    const u=getAM().find(x=>x.id===uid);
    if(u) triggerPush(uid,"Message from Genie",msg?msg.slice(0,80):"🎙 Voice note");
    showToast("Message sent","success");
  }catch(e){showToast("Failed to send","error");}
  if(ta){ta.disabled=false;ta.placeholder=`Message ${getAM().find(x=>x.id===uid)?.name||""}...`;}
  _loadMsgTabChat(uid);
  /* Sync recent messages cache */
  loadAdminMessages();
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

  /* Compact messages summary — links to Messages tab */
  const totalUnread=getTotalUnreadCount();
  let messagesSection="";
  if(totalUnread>0||adminRecentMessages.length>0){
    const latestMsg=adminRecentMessages[0];
    const latestName=latestMsg?getAM().find(u=>u.id===latestMsg.challenger_id)?.name||"Unknown":"";
    const latestPreview=latestMsg?(latestMsg.voice_url&&!latestMsg.message?"🎙 Voice note":(latestMsg.sender==="genie"?"You: ":"")+(latestMsg.message||"").slice(0,40)):"";
    messagesSection=`<div onclick="adminTab('messages')" style="margin-bottom:16px;padding:12px 14px;background:${totalUnread?"rgba(217,80,58,.06)":"rgba(196,154,28,.04)"};border:1px solid ${totalUnread?"rgba(217,80,58,.25)":"rgba(196,154,28,.15)"};border-radius:10px;cursor:pointer">
      <div class="row" style="justify-content:space-between">
        <div class="row" style="gap:8px">
          <span style="font-size:16px">${totalUnread?"💬":"✉"}</span>
          <div>
            <p style="font-size:13px;font-weight:700;color:${totalUnread?"#d9503a":"#c49a1c"}">${totalUnread?totalUnread+" unread message"+(totalUnread>1?"s":""):"Messages"}</p>
            ${latestMsg?`<p class="muted" style="font-size:11px;margin-top:2px">${latestName}: ${latestPreview}</p>`:""}
          </div>
        </div>
        <span style="color:${totalUnread?"#d9503a":"#c49a1c"};font-size:14px">→</span>
      </div>
    </div>`;
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

