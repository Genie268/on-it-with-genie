/* ── RESUME GUARD ──
   Called on page load before we let a returning user back into the dashboard.
   Reads payment_status directly from Supabase (the authoritative source —
   payment columns on public.challengers are write-protected by trigger, so
   only verify-payment can ever set them to 'paid'/'free'). If the server
   disagrees with localStorage, the server wins and we bounce to land. */
async function verifyResumeAllowed(){
  if(!S.user) return false;
  if(!S.user.supabaseId){
    /* No server row at all ⇒ cannot possibly be paid. */
    return false;
  }
  if(!sb){
    /* Supabase client didn't init — fail closed rather than allow bypass. */
    return false;
  }
  try{
    const {data,error}=await sb
      .from("challengers")
      .select("payment_status")
      .eq("id",S.user.supabaseId)
      .maybeSingle();
    if(error||!data) return false;
    const status=data.payment_status;
    if(status!=="paid"&&status!=="free") return false;
    /* Reconcile localStorage with the server. */
    if(S.user.paymentStatus!==status){
      S.user.paymentStatus=status;
      try{saveState();}catch(e){}
    }
    return true;
  }catch(e){
    return false;
  }
}

/* ── NAV ──
   goTo('dash') is the ONLY path that mounts the dashboard screen. Every
   other flow (refresh-resume, sign-in, restart, payment completion) funnels
   through here, so gating this function is equivalent to gating the whole
   protected UI. The dash branch runs an async server-side verify via
   verifyResumeAllowed() and only activates s-dash AFTER that resolves paid/
   free. There is no local-state trust on this path. */
let _dashGateInFlight=false;

function goTo(s){
  if(s==="dash"){
    _gateAndMountDash();
    return;
  }
  _activateScreen(s);
}

/* Core screen activator — non-gated. Used directly for non-protected screens,
   and indirectly for dash (after the async gate resolves). */
function _activateScreen(s){
  trackEvent("screen_view",{screen:s});
  /* Close upload modal if open */
  const mo=document.getElementById("mod");
  if(mo&&mo.classList.contains("show"))mo.classList.remove("show");
  document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));
  const map={land:"s-land",ob:"s-ob",duration:"s-duration",commit:"s-commit",pay:"s-pay",photo:"s-photo",transition:"s-transition",dash:"s-dash",d15:"s-d15",gauntlet:"s-gauntlet",rec:"s-rec",admin:"s-admin"};
  const target=el(map[s]||"s-land");
  if(!target){console.error("goTo: no element for screen",s);el("s-land").classList.add("active");return;}
  target.classList.add("active");
  if(s==="dash")       renderDash();
  if(s==="admin")      renderAdmin();
  if(s==="rec")        initRec();
  if(s==="d15")        initD15();
  if(s==="transition") renderTransition();
  if(s==="duration")   initDuration();
  if(s==="pay")        initPayment();
}

/* Dash gate — runs a server-side payment verify before mounting s-dash.
   Fails closed on timeout, error, or any non-paid response. */
function _gateAndMountDash(){
  if(!S.user){_activateScreen("land");return;}
  if(_dashGateInFlight) return; /* dedupe concurrent attempts */
  _dashGateInFlight=true;
  /* Visible blocker so the user never sees protected UI during verify. */
  _showDashVerifying();
  /* 10s hard cap — if the verify can't complete, we fail closed. */
  const timeout=new Promise(res=>setTimeout(()=>res(false),10000));
  Promise.race([verifyResumeAllowed(),timeout]).then(ok=>{
    _dashGateInFlight=false;
    _hideDashVerifying();
    if(!ok){
      /* Server says not paid/free, verify failed, or timed out. Wipe
         state and bounce to landing — no protected UI ever mounted. */
      clearState();
      return;
    }
    _activateScreen("dash");
  }).catch(()=>{
    _dashGateInFlight=false;
    _hideDashVerifying();
    clearState();
  });
}

/* Lightweight blocker overlay — shown while the server-side payment verify
   is in flight, so the dashboard DOM is never visible before the check. */
function _showDashVerifying(){
  let ov=document.getElementById("dash-gate-ov");
  if(!ov){
    ov=document.createElement("div");
    ov.id="dash-gate-ov";
    ov.style.cssText="position:fixed;inset:0;background:#060606;display:flex;align-items:center;justify-content:center;z-index:99999;color:#c49a1c;font-family:system-ui,sans-serif;font-size:14px;font-weight:700;letter-spacing:.02em";
    ov.innerHTML='<div style="display:flex;align-items:center;gap:12px"><div style="width:18px;height:18px;border:2px solid #c49a1c;border-top-color:transparent;border-radius:50%;animation:dgspin 0.8s linear infinite"></div><span>Verifying access…</span></div><style>@keyframes dgspin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(ov);
  }
  ov.style.display="flex";
}
function _hideDashVerifying(){
  const ov=document.getElementById("dash-gate-ov");
  if(ov) ov.style.display="none";
}


/* ── ADMIN MESSAGING HELPERS ── */

function sendIntervention(uid){
  const ta=el("int-ta-"+uid);if(!ta||!ta.value.trim())return;
  const msg=ta.value;
  const u=getAM().find(x=>x.id===uid);
  const waText=encodeURIComponent(`${u?.name||""}, ${msg}`);
  window.open(`https://wa.me/?text=${waText}`,"_blank");
  el("intv-"+uid).innerHTML=`<div style="padding:8px 11px;background:rgba(77,201,138,.07);border:1px solid rgba(77,201,138,.22);border-radius:7px"><p class="ok" style="font-size:12px">✓ Opened WhatsApp.</p></div>`;
}

async function draftIntervention(uid){
  const u=getAM().find(x=>x.id===uid);if(!u)return;
  const ta=el("int-ta-"+uid);if(!ta)return;
  ta.placeholder="Lil is drafting...";ta.disabled=true;
  const missed=u.up.slice(0,u.day-1).filter(v=>!v).length;
  const p=await lil(`Write a short personal intervention message from an accountability coach to someone who has missed ${missed} days. Reference their goal. Direct, not harsh. Max 2 sentences.

Name: ${u.name}
Goal: "${u.goal}"
Day: ${u.day}/${u.dur||15}`,120);
  ta.value=p||`${u.name} — ${missed} missed days on "${u.goal}". Let's talk before the gap becomes a habit.`;
  ta.disabled=false;ta.placeholder="";
}

async function sendLilDraft(uid){
  const u=getAM().find(x=>x.id===uid);if(!u)return;
  const ta=el("fb-ta-"+uid);if(!ta)return;
  ta.placeholder="Lil is drafting...";ta.disabled=true;
  const up=u.up.filter(Boolean).length;
  const p=await lil(`Write a short personal feedback message from an accountability coach. ${up} uploads in toward their goal. Specific, honest. Max 2 sentences.

Name: ${u.name}
Goal: "${u.goal}"`,120);
  ta.value=p||`${up} uploads toward "${u.goal}" — the evidence is building. Keep the same standard tomorrow.`;
  ta.disabled=false;ta.placeholder=`Personal message to ${u.name}...`;
}

async function sendInboxReply(uid,i){
  const ta=el("inb-"+uid+"-"+i);if(!ta||!ta.value.trim())return;
  const msg=ta.value.trim();
  ta.disabled=true;
  try{
    await adminFetch("send_message",{challenger_id:uid,message:msg});
    adminFetch("send_push",{push_type:"personal",challenger_id:uid,title:"Message from Genie 💬",body:msg.slice(0,120)}).catch(()=>{});
    showToast("Reply sent","success");
  }catch(e){console.warn("Inbox reply send error:",e);showToast("Failed to send","error");}
  ta.value="";ta.placeholder="✓ Sent";ta.style.borderColor="#4dc98a";
}

async function lilInboxDraft(uid,i,note){
  const u=getAM().find(x=>x.id===uid);if(!u)return;
  const ta=el("inb-"+uid+"-"+i);if(!ta)return;
  ta.placeholder="Lil is drafting...";ta.disabled=true;
  const p=await lil(`Write a 1-sentence review acknowledgment for a daily upload. Specific to what they did. Not praise — just direct acknowledgment.

Challenger: ${u.name}
Goal: "${u.goal}"
What they submitted: "${note}"`,80);
  ta.value=p||`Noted — that's the standard. Keep it there.`;
  ta.disabled=false;ta.placeholder="";
}

/* ── PHOTO UPLOAD ── */
function handlePhoto(input){
  if(!input.files||!input.files[0])return;
  const reader=new FileReader();
  reader.onload=function(e){
    const url=e.target.result;
    const lg=el("photo-preview-large");
    if(lg){lg.src=url;lg.style.display="block";el("photo-placeholder").style.display="none";}
    const sm=el("photo-preview-circle");
    if(sm){sm.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;sm.style.background="none";}
    if(S.user){S.user.photo=url;saveState();}
  };
  reader.readAsDataURL(input.files[0]);
}

function handleProfilePhoto(input){
  if(!input.files||!input.files[0])return;
  const reader=new FileReader();
  reader.onload=function(e){
    const url=e.target.result;
    const pv=el("profile-photo-preview");
    if(pv){pv.src=url;pv.style.display="block";el("profile-photo-placeholder").style.display="none";}
    if(S.user){S.user.photo=url;saveState();}
    const uc=el("dash-user-circle");
    if(uc&&S.user?.photo){uc.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;uc.style.background="none";}
  };
  reader.readAsDataURL(input.files[0]);
}


/* ── PROFILE SHEET ── */
function openProfile(){
  const ov=el("profile-overlay");if(!ov)return;
  ov.classList.add("show");
  if(S.user){
    el("profile-name-display").textContent=S.user.name||"Your Name";
    el("profile-name-input").value=S.user.name||"";
    el("profile-email").value=S.user.email||"";
    el("profile-phone").value=S.user.phone||"";
    if(S.user.photo){
      const pv=el("profile-photo-preview");
      if(pv){pv.src=S.user.photo;pv.style.display="block";el("profile-photo-placeholder").style.display="none";}
    }
  }
  const tp=el("theme-toggle");
  if(tp)tp.className="toggle-pill"+(document.body.classList.contains("light")?" active":"");
}

function closeProfile(evt){
  if(evt&&evt.target!==el("profile-overlay"))return;
  el("profile-overlay").classList.remove("show");
}

function saveProfile(){
  if(S.user){
    const name=el("profile-name-input").value.trim();
    if(name)S.user.name=name;
    S.user.email=el("profile-email").value.trim();
    S.user.phone=el("profile-phone").value.trim();
  }
  closeProfile();
  saveState();
  syncToSupabase();
  renderDash();
}


/* ── THEME TOGGLE ── */
function toggleTheme(){
  document.body.classList.toggle("light");
  const tp=el("theme-toggle");
  if(tp)tp.className="toggle-pill"+(document.body.classList.contains("light")?" active":"");
}


/* ── LANDING PARTICLES ── */
function initParticles(){
  const wrap=el("land-particles");if(!wrap)return;
  wrap.innerHTML="";
  for(let i=0;i<18;i++){
    const p=document.createElement("div");
    p.className="land-particle";
    p.style.left=Math.random()*100+"%";
    p.style.animationDuration=(6+Math.random()*8)+"s";
    p.style.animationDelay=(Math.random()*6)+"s";
    p.style.width=p.style.height=(2+Math.random()*3)+"px";
    wrap.appendChild(p);
  }
}

/* Landing tier pill rotation */
function animateTierPills(){
  const pills=["tp-7","tp-15","tp-30"];
  let idx=0;
  function cycle(){
    pills.forEach((id,i)=>{
      const pill=el(id);
      if(pill) pill.className="tier-pill"+(i===idx?" tp-active":"");
    });
    idx=(idx+1)%3;
  }
  cycle();
  setInterval(cycle,2200);
}

let _adminPollTimer=null;
let _adminLastMsgTs=null;

document.addEventListener("DOMContentLoaded",()=>{
  initParticles();
  animateTierPills();
  initSupabase();
  /* Close chat 3-dot menus on outside click */
  document.addEventListener("click",()=>closeChatMenus());
  const isAdmin=/^\/admin\/?$/.test(window.location.pathname);
  if(isAdmin){
    goTo('admin');
    /* Request notification permission for admin */
    if("Notification" in window && Notification.permission==="default"){
      Notification.requestPermission();
    }
    /* Start realtime + polling for new challenger messages */
    startAdminPoll();
    setTimeout(()=>updateTabTitle(),500);
  } else if(loadState()){
    /* All dash entries funnel through goTo('dash'), which runs the
       async server-side payment verify before mounting any protected
       UI. No local-state trust here. */
    goTo('dash');
  }
  /* Refresh immediately when tab becomes visible */
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden){
      if(isAdmin){
        adminRefreshBadges();
      } else if(S.user?.supabaseId){
        if(typeof updateMsgBadge==="function") updateMsgBadge();
        if(typeof renderChat==="function") renderChat();
      }
    }
  });
});

function startAdminPoll(){
  if(_adminPollTimer) return;
  /* Supabase Realtime — instant notifications for new messages & uploads */
  if(sb){
    try{
      sb.channel("admin-realtime")
        .on("postgres_changes",{event:"INSERT",schema:"public",table:"chat_messages"},payload=>{
          const m=payload.new;
          if(m.sender==="challenger"){
            /* Browser notification if tab not focused */
            if(document.hidden&&"Notification" in window&&Notification.permission==="granted"){
              new Notification("New message from challenger",{body:(m.message||"🎙 Voice note").slice(0,80)});
            }
            /* Instantly add to unread cache for immediate badge update */
            if(typeof adminUnreadMessages!=="undefined"){
              adminUnreadMessages.push({id:m.id,challenger_id:m.challenger_id});
            }
            /* Add to recent messages for instant display */
            if(typeof adminRecentMessages!=="undefined"){
              adminRecentMessages.unshift(m);
            }
            /* Optimistic: update tab title + re-render immediately */
            updateTabTitle();
            /* Refresh Messages tab chat if viewing this challenger */
            if(adminCurrentTab==="messages"&&typeof _msgActiveChallengerId!=="undefined"&&_msgActiveChallengerId===m.challenger_id){
              if(typeof _loadMsgTabChat==="function") _loadMsgTabChat(m.challenger_id);
              if(typeof _markMsgTabRead==="function") _markMsgTabRead(m.challenger_id);
            } else {
              if(typeof adminTab==="function") adminTab(adminCurrentTab||"overview");
            }
            /* Refresh profile panel chat if open for this challenger */
            _refreshOpenProfileChat(m.challenger_id);
            /* Full background data sync */
            _adminSoftRefresh();
          }
        })
        /* Listen for UPDATE events (read receipts, edits) */
        .on("postgres_changes",{event:"UPDATE",schema:"public",table:"chat_messages"},payload=>{
          const m=payload.new;
          /* If admin's message was read by challenger, refresh the open chat */
          if(m.sender==="genie"&&m.read_at){
            _refreshOpenProfileChat(m.challenger_id);
            /* Also refresh Messages tab if viewing this conversation */
            if(adminCurrentTab==="messages"&&typeof _msgActiveChallengerId!=="undefined"&&_msgActiveChallengerId===m.challenger_id){
              if(typeof _loadMsgTabChat==="function") _loadMsgTabChat(m.challenger_id);
            }
          }
          /* If a challenger message was marked read (by us), update badge immediately */
          if(m.sender==="challenger"&&m.read_at){
            if(typeof adminUnreadMessages!=="undefined"){
              adminUnreadMessages=adminUnreadMessages.filter(x=>x.id!==m.id);
            }
            updateTabTitle();
            if(typeof adminTab==="function") adminTab(adminCurrentTab||"overview");
          }
        })
        .on("postgres_changes",{event:"INSERT",schema:"public",table:"uploads"},()=>{
          _adminSoftRefresh();
        })
        .subscribe();
    }catch(e){console.error("Realtime subscription failed:",e);}
  }
  /* Start live timestamp ticker */
  if(typeof startLiveTimestamps==="function") startLiveTimestamps();
  /* LIGHTWEIGHT poll every 3s — only fetches unread counts, not full data */
  _adminPollTimer=setInterval(()=>_adminLightPoll(),3000);
}

/* Lightweight poll: only check unread message count + update badges */
let _adminLastUnreadCount=-1;
let _adminLastInboxCount=-1;
let _adminPollRunning=false;
async function _adminLightPoll(){
  if(!getAdminToken()||_adminPollRunning)return;
  _adminPollRunning=true;
  try{
    await loadAdminMessages();
    const newUnreadCount=adminUnreadMessages.length;
    if(newUnreadCount!==_adminLastUnreadCount){
      _adminLastUnreadCount=newUnreadCount;
      await loadAdminData();
      if(typeof adminTab==="function") adminTab(adminCurrentTab||"overview");
    }
    updateTabTitle();
  }catch(e){}finally{_adminPollRunning=false;}
}

/* Full background data sync (called after realtime events) */
async function _adminSoftRefresh(){
  if(!getAdminToken())return;
  try{
    await loadAdminMessages();
    await loadAdminData();
    _adminLastUnreadCount=adminUnreadMessages.length;
  }catch(e){}
}

/* Helper: refresh the profile panel chat if it's open for a specific challenger */
function _refreshOpenProfileChat(challengerId){
  const panel=document.getElementById("profile-panel");
  if(!panel)return;
  /* Check both "translateX(0)" and "translateX(0px)" since browsers differ */
  const t=panel.style.transform;
  if(t!=="translateX(0)"&&t!=="translateX(0px)")return;
  const thread=document.getElementById("pf-chat-thread");
  if(!thread)return;
  if(typeof loadProfilePanelChat==="function"&&panel.dataset.challengerId===challengerId){
    loadProfilePanelChat(challengerId);
  }
}

async function adminRefreshBadges(){
  if(!getAdminToken())return;
  try{
    await loadAdminMessages();
    await loadAdminData();
    _adminLastUnreadCount=adminUnreadMessages.length;
    /* Re-render current tab badges without switching */
    if(typeof adminTab==="function") adminTab(adminCurrentTab||"overview");
    /* Update browser tab title with unread count */
    updateTabTitle();
  }catch(e){}
}

function stopAdminPoll(){
  if(_adminPollTimer){clearInterval(_adminPollTimer);_adminPollTimer=null;}
  if(typeof stopLiveTimestamps==="function") stopLiveTimestamps();
}


/* ── CHALLENGER REALTIME POLLING ── */
let _challengerPollTimer=null;
function startChallengerPoll(){
  if(_challengerPollTimer)return;
  /* Start realtime subscription */
  if(typeof startChallengerRealtime==="function") startChallengerRealtime();
  /* Start live timestamps */
  if(typeof startLiveTimestamps==="function") startLiveTimestamps();
  /* Poll every 5s: refresh badge + tab title for reliable real-time feel */
  _challengerPollTimer=setInterval(()=>{
    if(typeof updateMsgBadge==="function") updateMsgBadge();
  },5000);
  /* Initial badge + tab title update */
  setTimeout(()=>{
    if(typeof updateMsgBadge==="function") updateMsgBadge();
  },500);
}


/* ── CONFETTI ── */
function fireConfetti(){
  const wrap=el("confetti-wrap");
  wrap.style.display="block";
  wrap.innerHTML="";
  const colors=["#c49a1c","#e8b830","#4dc98a","#fff","#c49a1c"];
  for(let i=0;i<50;i++){
    const p=document.createElement("div");
    p.className="confetti-piece";
    p.style.left=Math.random()*100+"%";
    p.style.background=colors[Math.floor(Math.random()*colors.length)];
    p.style.animationDuration=(1.5+Math.random()*2)+"s";
    p.style.animationDelay=(Math.random()*0.6)+"s";
    p.style.borderRadius=Math.random()>.5?"50%":"2px";
    p.style.width=(5+Math.random()*6)+"px";
    p.style.height=(5+Math.random()*6)+"px";
    wrap.appendChild(p);
  }
  setTimeout(()=>{wrap.style.display="none";wrap.innerHTML="";},4000);
}


/* ── WALKTHROUGH ── */
const WT_STEPS=[
  {target:"d-grid",title:"YOUR CALENDAR",text:"Each cell is one day of your challenge. Gold means today — tap it to upload your proof.",pos:"below"},
  {target:"up-btn",title:"DAILY UPLOAD",text:"This is your upload button. Photos, notes, links, voice — submit your evidence here every day.",pos:"above"},
  {target:"sk-num",title:"YOUR STREAK",text:"This ring tracks consecutive uploads. Miss a day, it resets. The number is your momentum.",pos:"below"},
  {target:"profile-area",title:"YOUR PROFILE",text:"Tap here to update your name, photo, and settings. This is how Genie sees you.",pos:"below"}
];
let wtIdx=0;
function showWalkthrough(key){
  wtIdx=0;
  S._wtKey=key||"oiwg_wt";
  renderWT();
}
function renderWT(){
  const wrap=el("wt-wrap");
  if(wtIdx>=WT_STEPS.length){
    wrap.style.display="none";
    wrap.innerHTML="";
    return;
  }
  const s=WT_STEPS[wtIdx];
  const targetEl=el(s.target);
  if(!targetEl){wtIdx++;renderWT();return;}
  
  const rect=targetEl.getBoundingClientRect();
  const pad=8;
  const spotTop=rect.top-pad+window.scrollY;
  const spotLeft=rect.left-pad;
  const spotW=rect.width+pad*2;
  const spotH=rect.height+pad*2;
  
  /* Scroll target into view */
  targetEl.scrollIntoView({behavior:"smooth",block:"center"});
  
  setTimeout(()=>{
    const rect2=targetEl.getBoundingClientRect();
    const spotTop2=rect2.top-pad;
    const tipTop=s.pos==="below"?rect2.bottom+16:rect2.top-160;
    
    wrap.style.display="block";
    wrap.innerHTML=`
      <div class="wt-backdrop-bg" onclick="skipWT()" style="clip-path:polygon(0% 0%,0% 100%,${spotLeft}px 100%,${spotLeft}px ${spotTop2}px,${spotLeft+spotW}px ${spotTop2}px,${spotLeft+spotW}px ${spotTop2+spotH}px,${spotLeft}px ${spotTop2+spotH}px,${spotLeft}px 100%,100% 100%,100% 0%)"></div>
      <div style="position:fixed;top:${spotTop2}px;left:${spotLeft}px;width:${spotW}px;height:${spotH}px;border:2px solid #c49a1c;border-radius:14px;z-index:901;pointer-events:none;animation:glow 2s ease infinite"></div>
      <div class="wt-tip" style="top:${Math.max(20,Math.min(tipTop,window.innerHeight-180))}px;pointer-events:auto">
        <span class="wt-step">${s.title} · ${wtIdx+1}/${WT_STEPS.length}</span>
        <p>${s.text}</p>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="wt-next" onclick="wtIdx++;renderWT()">Got it</button>
          <button class="wt-skip" onclick="skipWT()">Skip</button>
        </div>
      </div>`;
  },400);
}
function skipWT(){
  el("wt-wrap").style.display="none";
  el("wt-wrap").innerHTML="";
}


/* ── VOICE RECORDING ── */
let mediaRecorder=null, audioChunks=[], recordingStartTime=0, recInterval=null;
let chatMediaRecorder=null, chatAudioChunks=[], chatVoiceBlob=null;
let adminMediaRecorder=null, adminAudioChunks=[], adminVoiceBlob=null;

/* Pick a supported audio mimeType for MediaRecorder */
function _audioMime(){
  const types=["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4","audio/aac",""];
  for(const t of types){if(!t||MediaRecorder.isTypeSupported(t))return t;}
  return "";
}

/* Create a MediaRecorder with best available settings */
function _createRecorder(stream){
  const mime=_audioMime();
  const opts=mime?{mimeType:mime}:undefined;
  return new MediaRecorder(stream,opts);
}
function initVoiceRecorder(containerId){
  const c=el(containerId);if(!c)return;
  c.innerHTML=`<div class="vr-wrap" id="vr-area" onclick="toggleRecording()">
    <div class="vr-btn" id="vr-btn"><div class="vr-dot"></div></div>
    <div style="flex:1">
      <div class="vr-label" id="vr-status">Tap to record a voice note</div>
      <div class="vr-timer" id="vr-timer" style="display:none">00:00</div>
    </div>
  </div>
  <audio id="vr-playback" controls style="width:100%;display:none;margin-top:8px"></audio>`;
}
async function toggleRecording(){
  if(mediaRecorder&&mediaRecorder.state==="recording"){
    mediaRecorder.stop();
    return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    audioChunks=[];
    mediaRecorder=_createRecorder(stream);
    mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size>0)audioChunks.push(e.data);};
    mediaRecorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      clearInterval(recInterval);
      const recMime=mediaRecorder.mimeType||"audio/webm";
      const vrStatus=el("vr-status");
      if(audioChunks.length===0){
        if(vrStatus) vrStatus.textContent="Recording failed — try again";
        S.voiceBlob=null;S.voiceMime=null;
        return;
      }
      const blob=new Blob(audioChunks,{type:recMime});
      if(blob.size<100){
        if(vrStatus) vrStatus.textContent="Recording too short — try again";
        S.voiceBlob=null;S.voiceMime=null;
        return;
      }
      S.voiceBlob=blob;
      S.voiceMime=recMime;
      const url=URL.createObjectURL(blob);
      const pb=el("vr-playback");if(pb){pb.src=url;pb.style.display="block";}
      const area=el("vr-area");if(area)area.className="vr-wrap recorded";
      const btn=el("vr-btn");if(btn)btn.className="vr-btn";
      if(vrStatus) vrStatus.textContent=`Voice note recorded ✓ (${Math.round(blob.size/1024)}KB)`;
      const vrTimer=el("vr-timer");if(vrTimer) vrTimer.style.display="none";
    };
    mediaRecorder.start();
    recordingStartTime=Date.now();
    const area=el("vr-area");if(area)area.className="vr-wrap recording";
    const btn=el("vr-btn");if(btn)btn.className="vr-btn rec-active";
    const vrStatus=el("vr-status");if(vrStatus) vrStatus.textContent="Recording...";
    const vrTimer=el("vr-timer");if(vrTimer) vrTimer.style.display="block";
    recInterval=setInterval(()=>{
      const elapsed=Math.floor((Date.now()-recordingStartTime)/1000);
      const m=String(Math.floor(elapsed/60)).padStart(2,"0");
      const s=String(elapsed%60).padStart(2,"0");
      const t=el("vr-timer");if(t) t.textContent=`${m}:${s}`;
    },500);
  }catch(e){
    const vrStatus=el("vr-status");if(vrStatus) vrStatus.textContent="Microphone access denied";
  }
}

const MIC_SVG='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>';
const WAVE_HTML='<div class="rec-wave"><b></b><b></b><b></b><b></b><b></b></div>';
let chatRecTimer=null,adminRecTimer=null;

function startRecTimer(statusEl,onTick){
  let secs=0;
  return setInterval(()=>{
    secs++;
    const m=Math.floor(secs/60),s=String(secs%60).padStart(2,"0");
    if(statusEl) statusEl.innerHTML=`<span class="rec-dot"></span>${m}:${s}`;
    if(onTick) onTick(secs);
  },1000);
}

async function toggleChatRecording(){
  const btn=el("chat-mic-btn");
  const pill=btn&&btn.closest(".chat-input-pill");
  const ta=el("chat-input");
  if(chatMediaRecorder&&chatMediaRecorder.state==="recording"){
    chatMediaRecorder.stop();
    clearInterval(chatRecTimer);
    return;
  }
  chatVoiceBlob=null;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    chatAudioChunks=[];
    chatMediaRecorder=_createRecorder(stream);
    chatMediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size>0)chatAudioChunks.push(e.data);};
    chatMediaRecorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      clearInterval(chatRecTimer);
      if(chatAudioChunks.length===0||new Blob(chatAudioChunks).size<100){
        chatVoiceBlob=null;
        if(ta)ta.placeholder="Recording failed — try again";
        setTimeout(()=>{if(ta)ta.placeholder="Message Genie...";},2500);
        return;
      }
      chatVoiceBlob=new Blob(chatAudioChunks,{type:chatMediaRecorder.mimeType||"audio/webm"});
      if(btn){btn.innerHTML=MIC_SVG;btn.style.color="#4dc98a";}
      if(pill){pill.classList.remove("recording");pill.classList.add("recorded");}
      if(ta) ta.placeholder="✓ Voice note ready — tap ↑ to send";
    };
    chatMediaRecorder.start();
    if(btn){btn.innerHTML=WAVE_HTML;btn.style.color="";}
    if(pill){pill.classList.add("recording");pill.classList.remove("recorded");}
    let secs=0;
    chatRecTimer=setInterval(()=>{
      secs++;
      const m=Math.floor(secs/60),s=String(secs%60).padStart(2,"0");
      if(ta) ta.placeholder=`● Recording ${m}:${s} — tap to stop`;
    },1000);
    if(ta) ta.placeholder="● Recording 0:00 — tap to stop";
  }catch(e){
    if(ta) ta.placeholder="Microphone access denied";
    setTimeout(()=>{if(ta)ta.placeholder="Message Genie...";},2500);
  }
}

async function toggleAdminRecording(){
  const btn=document.getElementById("admin-mic-btn");
  const pill=btn&&btn.closest(".chat-input-pill");
  const ta=document.getElementById("pf-reply-input");
  const status=document.getElementById("admin-voice-status");
  if(adminMediaRecorder&&adminMediaRecorder.state==="recording"){adminMediaRecorder.stop();clearInterval(adminRecTimer);return;}
  adminVoiceBlob=null;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    adminAudioChunks=[];
    adminMediaRecorder=_createRecorder(stream);
    adminMediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size>0)adminAudioChunks.push(e.data);};
    adminMediaRecorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      clearInterval(adminRecTimer);
      if(adminAudioChunks.length===0||new Blob(adminAudioChunks).size<100){
        adminVoiceBlob=null;
        if(ta)ta.placeholder="Recording failed — try again";
        setTimeout(()=>{if(ta)ta.placeholder="Message...";},2500);
        return;
      }
      adminVoiceBlob=new Blob(adminAudioChunks,{type:adminMediaRecorder.mimeType||"audio/webm"});
      if(btn){btn.innerHTML=MIC_SVG;btn.style.color="#4dc98a";}
      if(pill){pill.classList.remove("recording");pill.classList.add("recorded");}
      if(ta) ta.placeholder="✓ Voice note ready — tap ↑ to send";
      /* Show audio preview so admin can play back before sending */
      if(status){
        const previewUrl=URL.createObjectURL(adminVoiceBlob);
        status.style.display="flex";
        status.style.alignItems="center";
        status.style.gap="8px";
        status.style.padding="6px 0";
        status.innerHTML=`<audio controls src="${previewUrl}" style="height:32px;flex:1"></audio><button onclick="discardAdminVoice()" style="background:none;border:none;color:#d9503a;font-size:16px;cursor:pointer;padding:4px 8px" title="Discard">✕ Discard</button>`;
      }
    };
    adminMediaRecorder.start();
    if(btn){btn.innerHTML=WAVE_HTML;btn.style.color="";}
    if(pill){pill.classList.add("recording");pill.classList.remove("recorded");}
    let secs=0;
    adminRecTimer=setInterval(()=>{
      secs++;
      const m=Math.floor(secs/60),s=String(secs%60).padStart(2,"0");
      if(ta) ta.placeholder=`● Recording ${m}:${s} — tap to stop`;
    },1000);
    if(ta) ta.placeholder="● Recording 0:00 — tap to stop";
  }catch(e){
    if(ta) ta.placeholder="Microphone access denied";
    setTimeout(()=>{if(ta&&ta.placeholder.includes("denied"))ta.placeholder="Message...";},2500);
  }
}

function discardAdminVoice(){
  adminVoiceBlob=null;
  const btn=document.getElementById("admin-mic-btn");
  const pill=btn&&btn.closest(".chat-input-pill");
  const ta=document.getElementById("pf-reply-input");
  const status=document.getElementById("admin-voice-status");
  if(btn){btn.innerHTML=MIC_SVG;btn.style.color="#888";btn.style.borderColor="#2a2a2a";}
  if(pill){pill.classList.remove("recorded");}
  if(ta) ta.placeholder="Message...";
  if(status){status.style.display="none";status.innerHTML="";}
}


/* ── WELCOME OVERLAY (first visit only) ── */
function showWelcomeOverlay(){
  const key="oiwg_welcomed_"+S.user?.startDate;
  if(localStorage.getItem(key))return;
  const ov=el("welcome-overlay");
  if(!ov)return;
  const hasPhoto=!!S.user?.photo;
  const hasPhone=!!S.user?.phone;
  ov.style.display="flex";
  ov.className="welcome-overlay";
  ov.innerHTML=`<div class="welcome-card">
    <div style="width:52px;height:52px;border-radius:50%;border:2px solid #c49a1c;overflow:hidden;margin:0 auto 16px;background:#c49a1c">
      <img class="genie-photo-img" src="" style="width:100%;height:100%;object-fit:cover;object-position:top;display:block">
    </div>
    <h2 style="font-size:20px;font-weight:900;margin-bottom:8px">You're in, ${S.user?.name||"Challenger"}.</h2>
    <p class="muted" style="font-size:13px;line-height:1.7;margin-bottom:20px">Your ${getDur()}-day challenge starts now. Go do your first piece of work. When you're ready, come back and upload the proof.</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;text-align:left">
      <div class="row" style="gap:10px;padding:8px 12px;background:var(--s2);border-radius:8px">
        <span style="font-size:16px">📅</span>
        <span style="font-size:12px;color:var(--mid)">Upload daily before midnight</span>
      </div>
      <div class="row" style="gap:10px;padding:8px 12px;background:var(--s2);border-radius:8px">
        <span style="font-size:16px">👁</span>
        <span style="font-size:12px;color:var(--mid)">Genie reviews every upload personally</span>
      </div>
      <div class="row" style="gap:10px;padding:8px 12px;background:var(--s2);border-radius:8px">
        <span style="font-size:16px">💬</span>
        <span style="font-size:12px;color:var(--mid)">Message Genie anytime from your dashboard</span>
      </div>
    </div>
    ${(!hasPhoto||!hasPhone)?`<div style="border-top:1px solid var(--bd);padding-top:14px;margin-bottom:16px">
      <p style="font-size:11px;font-weight:700;color:#c49a1c;margin-bottom:8px">QUICK SETUP</p>
      ${!hasPhoto?`<p style="font-size:12px;color:var(--mid);margin-bottom:4px">📸 Add your photo — <span style="color:#c49a1c;cursor:pointer" onclick="dismissWelcome();openProfile()">set up now</span></p>`:""}
      ${!hasPhone?`<p style="font-size:12px;color:var(--mid)">📱 Add your phone — <span style="color:#c49a1c;cursor:pointer" onclick="dismissWelcome();openProfile()">add now</span></p>`:""}
    </div>`:""}
    <button class="bp" style="width:100%;padding:13px;font-size:15px" onclick="dismissWelcome()">Got it — Let's go</button>
    <p style="font-size:10px;color:#5a5a5a;margin-top:10px">Add to your home screen for easy access ↓</p>
  </div>`;
  setTimeout(setGeniePhotos,100);
}

function dismissWelcome(){
  const key="oiwg_welcomed_"+S.user?.startDate;
  localStorage.setItem(key,"1");
  el("welcome-overlay").style.display="none";
}


/* ── AUDIO PLAYER ── */
function buildAudioBubble(url,id){
  return `<div class="audio-player" id="ap-${id}">
    <button class="ap-play" onclick="toggleAudio('${id}')">▶</button>
    <div class="ap-track" onclick="seekAudio('${id}',event)"><div class="ap-fill" id="ap-fill-${id}"></div></div>
    <span class="ap-dur" id="ap-dur-${id}">0:00</span>
    <audio id="ap-el-${id}" src="${url}" preload="metadata" style="display:none"
      onended="audioEnded('${id}')" ontimeupdate="audioProgress('${id}')" onloadedmetadata="audioDuration('${id}')"></audio>
  </div>`;
}
function toggleAudio(id){
  document.querySelectorAll("[id^='ap-el-']").forEach(a=>{
    if(a.id!==`ap-el-${id}`&&!a.paused){a.pause();const oid=a.id.replace("ap-el-","");const b=document.querySelector(`#ap-${oid} .ap-play`);if(b)b.textContent="▶";}
  });
  const audio=document.getElementById(`ap-el-${id}`),btn=document.querySelector(`#ap-${id} .ap-play`);
  if(!audio)return;
  if(audio.paused){audio.play().catch(()=>{});if(btn)btn.textContent="⏸";}
  else{audio.pause();if(btn)btn.textContent="▶";}
}
function audioProgress(id){
  const audio=document.getElementById(`ap-el-${id}`),fill=document.getElementById(`ap-fill-${id}`),dur=document.getElementById(`ap-dur-${id}`);
  if(fill&&audio.duration)fill.style.width=(audio.currentTime/audio.duration*100)+"%";
  if(dur){const s=Math.floor(audio.currentTime);dur.textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}
}
function audioDuration(id){
  const audio=document.getElementById(`ap-el-${id}`),dur=document.getElementById(`ap-dur-${id}`);
  if(!audio||!dur||!audio.duration)return;
  const s=Math.floor(audio.duration);dur.textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
}
function audioEnded(id){
  const btn=document.querySelector(`#ap-${id} .ap-play`),fill=document.getElementById(`ap-fill-${id}`),audio=document.getElementById(`ap-el-${id}`);
  if(btn)btn.textContent="▶";if(fill)fill.style.width="0%";if(audio)audio.currentTime=0;
}
function seekAudio(id,e){
  const audio=document.getElementById(`ap-el-${id}`);
  if(!audio||!audio.duration)return;
  audio.currentTime=(e.offsetX/e.currentTarget.offsetWidth)*audio.duration;
}


/* ── PROFILE SLIDE-OVER ─────────────────────────────────── */
async function openProfilePanel(uid){
  const u=getAM().find(x=>x.id===uid);
  if(!u)return;
  /* Track which challenger's profile is open for realtime updates */
  const panel=document.getElementById("profile-panel");
  if(panel) panel.dataset.challengerId=uid;
  const startFmt=u.startDate?new Date(u.startDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";
  const avatarHTML=u.photo
    ?`<img src="${u.photo}" style="width:52px;height:52px;object-fit:cover;border-radius:50%;border:2px solid #2a2a2a;flex-shrink:0">`
    :`<div style="width:52px;height:52px;border-radius:50%;background:#1e1e1e;border:2px solid #2a2a2a;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#c49a1c;flex-shrink:0">${(u.name||"?").charAt(0).toUpperCase()}</div>`;
  document.getElementById("profile-panel-body").innerHTML=`
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px">
      ${avatarHTML}
      <div style="min-width:0">
        <p style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:4px">CHALLENGER</p>
        <p style="font-size:18px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.name}</p>
        <p style="font-size:12px;color:#666;margin-top:2px">Day ${u.day} of ${u.dur} · Started ${startFmt} · ${u.paymentStatus||"—"}</p>
      </div>
    </div>

    <div style="margin-bottom:20px">
      <p style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#5a5a5a;margin-bottom:10px;padding:0 0 0 4px">MESSAGES</p>
      <div class="chat-screen" style="margin-bottom:0">
        <div id="pf-chat-thread" class="chat-thread" style="max-height:300px">
          <p style="text-align:center;color:#3a3a3a;font-size:12px;padding:20px 0">Loading...</p>
        </div>
        <div class="chat-bar">
          <div class="chat-input-pill">
            <textarea id="pf-reply-input" class="chat-ta" rows="1" placeholder="Message ${u.name}..."></textarea>
            <button id="admin-mic-btn" class="chat-mic-btn" onclick="toggleAdminRecording()" title="Voice note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg></button>
          </div>
          <button class="chat-send-btn" onclick="sendProfilePanelMsg('${uid}')">↑</button>
        </div>
        <div id="admin-voice-status" style="display:none;font-size:10px;padding:4px 14px 6px;background:#0f0f0f;text-align:center"></div>
      </div>
    </div>

    <div id="profile-view-mode">
      <div class="profile-field-group">
        <p class="pf-lbl">NAME</p><p class="pf-val">${u.name||"—"}</p>
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">EMAIL</p><p class="pf-val">${u.email||"—"}</p>
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">PHONE</p><p class="pf-val">${u.phone||"—"}</p>
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">GOAL</p><p class="pf-val">${u.goalRaw||u.goal||"—"}</p>
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">GOAL SUMMARY</p><p class="pf-val">${u.goalSummary||"—"}</p>
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">DAILY PROOF</p><p class="pf-val">${u.proofDescription||"—"}</p>
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">THEIR THREAT</p>
        <p class="pf-val" style="color:#c49a1c;font-style:italic">"${u.threat||"—"}"</p>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <div class="profile-field-group" style="flex:1"><p class="pf-lbl">PROOF TYPE</p><p class="pf-val">${u.proofType||"—"}</p></div>
        <div class="profile-field-group" style="flex:1"><p class="pf-lbl">DURATION</p><p class="pf-val">${u.dur} days</p></div>
      </div>
      <div style="margin-top:16px">
        <button onclick="switchToEditMode('${uid}')" style="width:100%;padding:10px;border-radius:10px;background:rgba(196,154,28,.08);border:1px solid rgba(196,154,28,.2);color:#c49a1c;font-size:13px;font-weight:700;cursor:pointer">Edit Profile →</button>
      </div>
    </div>

    <div id="profile-edit-mode" style="display:none">
      <div class="profile-field-group">
        <p class="pf-lbl">NAME</p>
        <input id="pf-name" class="pf-input" value="${(u.name||"").replace(/"/g,"&quot;")}">
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">EMAIL</p>
        <input id="pf-email" class="pf-input" type="email" value="${(u.email||"").replace(/"/g,"&quot;")}">
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">PHONE</p>
        <input id="pf-phone" class="pf-input" type="tel" value="${(u.phone||"").replace(/"/g,"&quot;")}">
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">GOAL</p>
        <textarea id="pf-goal" class="pf-input" rows="3">${u.goalRaw||u.goal||""}</textarea>
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">GOAL SUMMARY <span style="color:#444;font-weight:400">(shown in dashboard)</span></p>
        <textarea id="pf-goal-summary" class="pf-input" rows="2">${u.goalSummary||""}</textarea>
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">DAILY PROOF</p>
        <textarea id="pf-proof" class="pf-input" rows="2">${u.proofDescription||""}</textarea>
      </div>
      <div class="profile-field-group">
        <p class="pf-lbl">THEIR THREAT</p>
        <textarea id="pf-threat" class="pf-input" rows="2">${u.threat||""}</textarea>
      </div>
      <p style="font-size:11px;color:#444;margin-bottom:16px">Duration and start date cannot be changed mid-challenge.</p>
      <div style="display:flex;gap:8px">
        <button onclick="saveProfile('${uid}')" style="flex:1;padding:10px;border-radius:10px;background:#c49a1c;border:none;color:#000;font-size:13px;font-weight:800;cursor:pointer">Save Changes</button>
        <button onclick="switchToViewMode()" style="padding:10px 16px;border-radius:10px;background:#1a1a1a;border:1px solid #2a2a2a;color:#888;font-size:13px;cursor:pointer">Cancel</button>
      </div>
      <p id="pf-save-status" style="font-size:12px;margin-top:10px;text-align:center"></p>
    </div>
  `;
  document.getElementById("profile-panel").style.transform="translateX(0)";
  document.getElementById("profile-panel-backdrop").style.display="block";
  /* Mark all challenger messages as read — optimistic: update local cache immediately */
  if(typeof adminUnreadMessages!=="undefined"){
    adminUnreadMessages=adminUnreadMessages.filter(m=>m.challenger_id!==uid);
    /* Immediately update tab title and badges */
    updateTabTitle();
    if(typeof adminTab==="function") adminTab(adminCurrentTab||"overview");
  }
  if(getAdminToken()){
    adminFetch("mark_read",{challenger_id:uid}).catch(()=>{});
  }
  /* Load chat messages async */
  loadProfilePanelChat(uid);
}

let _pfChatReplyToId=null;

async function loadProfilePanelChat(uid){
  const thread=document.getElementById("pf-chat-thread");
  if(!thread||!getAdminToken())return;
  _pfChatReplyToId=null;
  const ind=document.getElementById("pf-reply-indicator");if(ind)ind.remove();
  try{
    const res=await adminFetch("get_thread",{challenger_id:uid});
    const msgs=res.messages||[];
    if(!msgs||msgs.length===0){thread.innerHTML=`<p style="text-align:center;color:#3a3a3a;font-size:12px;padding:20px 0">No messages yet</p>`;return;}
    /* Build a lookup for reply_to */
    const msgMap={};msgs.forEach(m=>{msgMap[m.id]=m;});
    /* Date separator helper */
    let lastDateStr="";
    /* In admin panel: genie (admin) = right, challenger = left */
    thread.innerHTML=msgs.map((m,i)=>{
      const isMe=m.sender==="genie";
      const t=new Date(m.created_at);
      const timeStr=t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      const dateStr=t.toLocaleDateString([],{month:"short",day:"numeric"});
      const aId=`ac-${i}-${t.getTime()}`;
      /* Date separator */
      let dateSep="";
      if(dateStr!==lastDateStr){
        lastDateStr=dateStr;
        const today=new Date().toLocaleDateString([],{month:"short",day:"numeric"});
        const yesterday=new Date(Date.now()-86400000).toLocaleDateString([],{month:"short",day:"numeric"});
        const label=dateStr===today?"Today":dateStr===yesterday?"Yesterday":dateStr;
        dateSep=`<div style="text-align:center;padding:8px 0 4px"><span style="font-size:10px;color:#444;background:#111;padding:2px 10px;border-radius:10px;font-weight:600">${label}</span></div>`;
      }
      /* Reply quote — clickable to scroll to original */
      let replyQuote="";
      if(m.reply_to_id&&msgMap[m.reply_to_id]){
        const orig=msgMap[m.reply_to_id];
        const origPreview=(orig.message||"").slice(0,50)+(orig.message&&orig.message.length>50?"…":"");
        replyQuote=`<div onclick="scrollToMsg('${m.reply_to_id}')" style="font-size:11px;color:${isMe?"rgba(0,0,0,.7)":"#999"};border-left:2px solid ${isMe?"rgba(0,0,0,.4)":"#555"};padding:3px 8px;margin-bottom:5px;cursor:pointer;border-radius:0 4px 4px 0;background:${isMe?"rgba(0,0,0,.12)":"rgba(255,255,255,.04)"};transition:background .15s" onmouseenter="this.style.background='${isMe?"rgba(0,0,0,.2)":"rgba(255,255,255,.07)"}'" onmouseleave="this.style.background='${isMe?"rgba(0,0,0,.12)":"rgba(255,255,255,.04)"}'">${origPreview||"🎙 Voice note"}</div>`;
      }
      let body=replyQuote;
      if(m.message&&m.message.trim()) body+=`<p style="margin:0">${m.message}</p>`;
      if(m.voice_url) body+=buildAudioBubble(m.voice_url,aId);
      if(!body) return "";
      /* Read receipt for admin's messages */
      const readCheck=isMe&&m.read_at?`<span style="color:${isMe?"rgba(0,0,0,.35)":"#444"};font-size:9px;margin-left:4px" title="Read ${new Date(m.read_at).toLocaleString()}">✓✓</span>`:(isMe?`<span style="color:rgba(0,0,0,.2);font-size:9px;margin-left:4px">✓</span>`:"");
      /* Reply visible, Unsend behind 3-dot menu (admin's own messages only) */
      const msgPreview=(m.message||"").slice(0,40).replace(/"/g,"&quot;").replace(/'/g,"\\'");
      const replyBtn=`<span onclick="event.stopPropagation();pfChatSetReply('${m.id}','${msgPreview}','${uid}')" style="cursor:pointer;font-size:10px;color:#5a5a5a;margin-left:6px;opacity:0.5;transition:opacity .15s" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.5">↩ Reply</span>`;
      const menuId=`cmenu-${m.id}`;
      const wasRead=m.read_at?"true":"false";
      const dotMenu=isMe?`<span style="position:relative;margin-left:4px"><span onclick="event.stopPropagation();toggleChatMenu('${menuId}')" style="cursor:pointer;font-size:12px;color:#444;letter-spacing:1px;line-height:1;transition:color .15s" onmouseenter="this.style.color='#888'" onmouseleave="this.style.color='#444'">⋯</span><div id="${menuId}" style="display:none;position:absolute;bottom:18px;right:0;background:#181818;border:1px solid #2a2a2a;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.5);z-index:10;overflow:hidden"><div onclick="event.stopPropagation();pfChatDeleteMsg('${m.id}','${uid}',${wasRead});closeChatMenus()" style="padding:7px 14px;font-size:12px;color:#d9503a;cursor:pointer;white-space:nowrap" onmouseenter="this.style.background='#2a2a2a'" onmouseleave="this.style.background='none'">Unsend</div></div></span>`:"";
      return `${dateSep}<div id="msg-${m.id}" class="cmsg ${isMe?"cmsg-me":"cmsg-them"}">
        <div class="cmsg-body">${body}</div>
        <div class="cmsg-time">${isMe?"You":"Challenger"} · ${timeStr}${readCheck}${replyBtn}${dotMenu}</div>
      </div>`;
    }).join("");
    thread.scrollTop=thread.scrollHeight;
  }catch(e){thread.innerHTML=`<p style="text-align:center;color:#3a3a3a;font-size:12px;padding:20px 0">Could not load messages</p>`;}
}

function scrollToMsg(msgId){
  const el=document.getElementById("msg-"+msgId);
  if(!el)return;
  el.scrollIntoView({behavior:"smooth",block:"center"});
  el.style.transition="background .2s";
  el.style.background="rgba(196,154,28,.12)";
  setTimeout(()=>{el.style.background="";},1200);
}

function toggleChatMenu(id){
  closeChatMenus();
  const menu=document.getElementById(id);
  if(menu)menu.style.display=menu.style.display==="none"?"block":"none";
}
function closeChatMenus(){
  document.querySelectorAll('[id^="cmenu-"]').forEach(m=>m.style.display="none");
}

function pfChatSetReply(msgId,preview,uid){
  _pfChatReplyToId=msgId;
  /* Show reply indicator above input */
  let indicator=document.getElementById("pf-reply-indicator");
  if(!indicator){
    indicator=document.createElement("div");
    indicator.id="pf-reply-indicator";
    indicator.style.cssText="font-size:11px;color:#888;padding:4px 14px;background:#0f0f0f;border-left:2px solid #c49a1c;margin:0 0 0 0;display:flex;justify-content:space-between;align-items:center";
    const chatBar=document.querySelector(".chat-bar");
    if(chatBar)chatBar.parentNode.insertBefore(indicator,chatBar);
  }
  indicator.innerHTML=`<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">↩ Replying to: <em>${preview||"voice note"}</em></span><span onclick="_pfChatReplyToId=null;this.parentNode.remove()" style="cursor:pointer;color:#555;margin-left:8px;font-size:14px">×</span>`;
  indicator.style.display="flex";
  const ta=document.getElementById("pf-reply-input");
  if(ta)ta.focus();
}

async function pfChatDeleteMsg(msgId,uid,wasRead){
  const msg=wasRead?"This message was already read by the challenger. Unsend anyway?":"Unsend this message?";
  if(!confirm(msg))return;
  try{
    await adminFetch("delete_message",{message_id:msgId});
    showToast(wasRead?"Unsent — but they already saw it":"Message unsent",wasRead?"error":"info");
  }catch(e){showToast("Failed to unsend","error");}
  loadProfilePanelChat(uid);
}

async function sendProfilePanelMsg(uid){
  const ta=document.getElementById("pf-reply-input");
  const hasText=ta&&ta.value.trim();
  if(!hasText&&!adminVoiceBlob)return;
  if(typeof trackEvent==="function") trackEvent("admin_msg_sent",{to:uid,has_voice:!!adminVoiceBlob,has_text:!!hasText});
  if(!getAdminToken())return;
  const msg=hasText?ta.value.trim():"";
  if(ta){ta.value="";ta.disabled=true;}
  let voiceUrl=null;
  if(adminVoiceBlob){
    const vMime=adminVoiceBlob.type||"audio/webm";
    const vExt=vMime.includes("mp4")?"mp4":vMime.includes("ogg")?"ogg":"webm";
    const path=`admin/genie-${uid}-${Date.now()}.${vExt}`;
    voiceUrl=await uploadToStorage("chat-voice",path,adminVoiceBlob,vMime);
    adminVoiceBlob=null;
    const btn=document.getElementById("admin-mic-btn");
    const status=document.getElementById("admin-voice-status");
    if(btn){btn.textContent="🎙";btn.style.color="#888";btn.style.borderColor="#2a2a2a";}
    if(status)status.style.display="none";
  }
  try{
    await adminFetch("send_message",{challenger_id:uid,message:msg||"",voice_url:voiceUrl||null,reply_to_id:_pfChatReplyToId||null});
    _pfChatReplyToId=null;
    const ind=document.getElementById("pf-reply-indicator");if(ind)ind.remove();
    adminFetch("send_push",{push_type:"personal",challenger_id:uid,title:"Message from Genie",body:msg?msg.slice(0,80):"🎙 Voice note"}).catch(()=>{});
    showToast("Message sent","success");
  }catch(e){showToast("Failed to send","error");}
  if(ta)ta.disabled=false;
  loadProfilePanelChat(uid);
}

function switchToEditMode(uid){
  const vm=document.getElementById("profile-view-mode");
  const em=document.getElementById("profile-edit-mode");
  if(vm) vm.style.display="none";
  if(em) em.style.display="block";
}

function switchToViewMode(){
  const em=document.getElementById("profile-edit-mode");
  const vm=document.getElementById("profile-view-mode");
  if(em) em.style.display="none";
  if(vm) vm.style.display="block";
}

async function saveProfile(uid){
  const u=getAM().find(x=>x.id===uid);
  if(!u||!sb)return;
  const name=document.getElementById("pf-name").value.trim();
  const email=document.getElementById("pf-email").value.trim();
  const phone=document.getElementById("pf-phone").value.trim();
  const goalRaw=document.getElementById("pf-goal").value.trim();
  const goalSummary=document.getElementById("pf-goal-summary").value.trim();
  const proofDescription=document.getElementById("pf-proof").value.trim();
  const threat=document.getElementById("pf-threat").value.trim();
  if(!name||!goalRaw){document.getElementById("pf-save-status").textContent="Name and goal are required.";document.getElementById("pf-save-status").style.color="#d9503a";return;}
  const btn=document.querySelector("#profile-edit-mode button");
  btn.textContent="Saving...";btn.disabled=true;
  try{
    await sb.from("challengers").update({
      name,email:email||null,phone:phone||null,
      goal_raw:goalRaw,goal_summary:goalSummary||goalRaw,
      proof_description:proofDescription||null,threat:threat||null
    }).eq("id",uid);
    // Update local state so list reflects change immediately
    Object.assign(u,{name,email,phone,goalRaw,goalSummary:goalSummary||goalRaw,goal:goalSummary||goalRaw,proofDescription,threat,
      ini:name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)});
    document.getElementById("pf-save-status").textContent="✓ Saved";
    document.getElementById("pf-save-status").style.color="#4dc98a";
    showToast("Profile saved","success");
    btn.textContent="Save Changes";btn.disabled=false;
    setTimeout(()=>{switchToViewMode();openProfilePanel(uid);},800);
  }catch(e){
    document.getElementById("pf-save-status").textContent="Save failed. Try again.";
    document.getElementById("pf-save-status").style.color="#d9503a";
    showToast("Save failed","error");
    btn.textContent="Save Changes";btn.disabled=false;
  }
}

function closeProfilePanel(){
  document.getElementById("profile-panel").style.transform="translateX(100%)";
  document.getElementById("profile-panel-backdrop").style.display="none";
}

