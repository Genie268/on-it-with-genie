/* ── TRANSITION SCREEN ── */
function renderTransition(){
  const u=S.user;
  const dur=u.duration||15;
  const msg=el("genie-transition-msg");
  msg.textContent=`${u.name}, the commitment is signed. I'm watching. The only thing that matters now is what you upload today — and every day after it for the next ${dur} days.`;
}


/* ── DASHBOARD ── */
function renderDash(){
  if(!S.user)return;
  calcDay();
  const u=S.user,d=S.day;
  const dur=u.duration||15;
  el("day-bdg").textContent=`Day ${d} / ${dur}`;
  el("grid-lbl").textContent=`${dur}-DAY GRID`;
  const uc=el("dash-user-circle");
  if(u.photo){uc.innerHTML=`<img src="${u.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;uc.style.background="none";}
  else{uc.textContent=u.name?u.name[0].toUpperCase():"?";}
  const un=el("dash-user-name"); if(un) un.textContent=u.name||"Challenger";
  const goalDisplay=u.answers.goalSummary||u.answers.goal;
  /* Streak lives as a compact row at the bottom of the goal card */
  let sk=0;for(let i=S.day-1;i>=0;i--){if(S.uploads[i]!==null)sk++;else break;}
  const skColor=sk>0?"#c49a1c":"#3a3a3a";
  const skText=sk===0?"No streak yet":sk===1?"1 day streak":`${sk} day streak`;
  el("goal-c").innerHTML=`<span class="lbl">CURRENT GOAL</span><p style="font-size:15px;font-weight:600;line-height:1.5">${goalDisplay}</p><div class="row mt8" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><div class="row" style="gap:6px"><span class="tag">${PT[u.answers.proofType]||"Proof"}</span><span class="muted" style="font-size:11px">${u.name}</span></div><span style="font-size:11px;font-weight:700;color:${skColor}">🔥 ${skText}</span></div>`;
  renderGrid(); renderUnlock(); renderRecCard(); renderStats();
  updateMsgBadge();
  initPushNotifications();
  /* Start realtime + polling (startChallengerPoll handles both) */
  if(typeof startChallengerPoll==="function") startChallengerPoll();
  if(typeof startHeartbeat==="function") startHeartbeat();
  renderPlanArea();
  if(_hasPlanToday()) renderEnergyCheck(); else el("energy-check-area").innerHTML="";
  showChatFab();
  if(!_chatRenderedOnce){_chatRenderedOnce=true;renderChat();}
  _check2ndVisitPush();
  startProofWall();
  const dnr=el("day-nav-row");
  if(S.devMode){dnr.style.display="flex";el("sim-l").textContent=`Sim day ${d}`;el("prev-b").disabled=d===1;el("next-b").disabled=d===getDur();}
  else{dnr.style.display="none";}
  /* Call day reminder — shown inline, never blocks upload */
  const callReminderEl=el("call-day-banner");
  if(callReminderEl){
    const isTodayCallDay=(CALL_DAYS[dur]||[]).includes(d);
    callReminderEl.style.display=isTodayCallDay?"block":"none";
  }
  updateUpBtn();
  renderCoachNotes();
  if(!S.lilDone){ S.lilDone=true; }
  /* Call day banner link */
  const callLinkEl=el("call-day-link");
  if(callLinkEl) callLinkEl.href=CALENDLY_URL||"#";
  /* First-timer walkthrough (no overlay gate) */
  if(S.uploads.every(v=>v===null)&&!S.devMode){
    const wtKey="oiwg_wt_"+S.user.startDate;
    if(!localStorage.getItem(wtKey)){
      localStorage.setItem(wtKey,"1");
      setTimeout(fireConfetti,600);
      setTimeout(()=>{showWalkthrough(wtKey);},2200);
    }
  }
}

function renderGenieNote(){
  /* Now merged into renderCoachNotes */
}

async function loadLilDash(){
  /* Now merged into renderCoachNotes */
}

async function renderCoachNotes(){
  const cn=el("coach-notes");
  if(!cn||!S.user)return;
  const u=S.user,d=S.day,dur=getDur();
  const up=S.uploads.filter(v=>v!==null).length;
  const mid=Math.ceil(dur/2);
  const near=dur-2>mid?dur-2:null;
  
  /* Genie speaks at milestones */
  const genieNotes={};
  genieNotes[1]=`The commitment is signed. The only thing that matters now is whether you upload today.`;
  if(mid>1) genieNotes[mid]=`Halfway. Most people quit right around here. That's the real test — showing up when it stops feeling new.`;
  if(near&&near>mid) genieNotes[near]=`${near} days of evidence. You have proven something. ${dur-near} day${dur-near===1?"":"s"} left.`;
  genieNotes[dur]=`${dur} days done. Whatever happens next — you now know you can execute.`;
  
  if(genieNotes[d]){
    cn.innerHTML=`<div class="card mb10" style="border-color:rgba(196,154,28,.15);background:rgba(196,154,28,.03)">
      <div class="row" style="gap:10px">
        <div style="width:28px;height:28px;border-radius:7px;background:#c49a1c;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:#000;flex-shrink:0">G</div>
        <div style="flex:1"><span style="font-size:9px;font-weight:700;letter-spacing:.06em;color:#c49a1c;display:block;margin-bottom:3px">FROM GENIE</span><p style="font-size:13px;line-height:1.7">${genieNotes[d]}</p></div>
      </div>
    </div>`;
    return;
  }
  
  /* Lil nudge on non-milestone days when not yet uploaded */
  if(S.uploads[d-1]){cn.innerHTML="";return;}
  cn.innerHTML=`<div class="card mb10" style="border-color:rgba(196,154,28,.1)">
    <div class="row" style="gap:10px">
      <div style="width:28px;height:28px;border-radius:7px;background:rgba(196,154,28,.1);border:1px solid rgba(196,154,28,.2);display:flex;align-items:center;justify-content:center;font-size:11px;color:#c49a1c;flex-shrink:0">✦</div>
      <div class="row" style="gap:8px;flex:1">${spn()}<span class="muted" style="font-size:13px">Thinking...</span></div>
    </div>
  </div>`;
  const recContext=u.recovery&&u.recovery.length>0?`\nRecovery insight: "${u.recovery[u.recovery.length-1].text}"`:"";
  const prompt=`One sentence only. Max 12 words. Sharp, direct — name their threat or goal. No filler.\n\nGoal: "${u.answers.goal}"\nThreat: "${u.answers.threat||"unknown"}"\nDay: ${d}/${dur}${recContext}`;
  let msg=await lil(prompt,80);
  if(!msg) msg=FB.nudge(u.answers.goal,u.answers.threat||"what you described",d);
  cn.innerHTML=`<div class="card mb10" style="border-color:rgba(196,154,28,.1)">
    <div class="row" style="gap:10px">
      <div style="width:28px;height:28px;border-radius:7px;background:rgba(196,154,28,.1);border:1px solid rgba(196,154,28,.2);display:flex;align-items:center;justify-content:center;font-size:11px;color:#c49a1c;flex-shrink:0">✦</div>
      <p style="font-size:13px;line-height:1.7;flex:1">${msg}</p>
    </div>
  </div>`;
}

function renderStreak(){
  /* Streak is now rendered inline in the goal card by renderDash — no-op here */
}

function renderGrid(){
  const g=el("d-grid"); g.innerHTML="";
  const dur=getDur();
  const callDays=CALL_DAYS[dur]||[];
  for(let i=0;i<dur;i++){
    const d=i+1,isUp=S.uploads[i]!==null,isT=d===S.day,isF=d>S.day,isM=d<S.day&&!isUp;
    const isCall=callDays.includes(d);
    let cls="dc",ds="";
    if(isUp){cls+=" up";ds="✓";}
    else if(isT){cls+=" tod";ds="NOW";}
    else if(isM){cls+=" ms";ds="—";}
    else if(isF)cls+=" ft";
    if(isCall)cls+=" call-day";
    const c=document.createElement("div");
    c.className=cls;
    c.style.position="relative";
    let inner=`<span class="dn">D${d}</span>${ds?`<span class="ds">${ds}</span>`:""}`;
    if(isCall) inner+=`<span class="call-icon-anim" style="position:absolute;top:-2px;right:-2px;width:13px;height:13px;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:50%;opacity:0;animation:callIconPop .4s ease 2s forwards"><svg width="7" height="7" viewBox="0 0 24 24" fill="#111" stroke="none"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg></span>`;
    c.innerHTML=inner;
    if(isT&&!isUp)c.onclick=openMod;
    if(isUp){const idx=i;c.onclick=()=>openViewMod(idx);c.style.cursor="pointer";}
    if(isCall&&isF){c.onclick=()=>openCallModal(d);c.style.cursor="pointer";}
    g.appendChild(c);
  }
}

function renderUnlock(){
  const up=S.uploads.filter(v=>v!==null).length,ul=up>=12;
  el("ul-bar").style.width=Math.min(100,Math.round((up/12)*100))+"%";
  el("ul-bar").style.background=ul?"#4dc98a":"#c49a1c";
  el("ul-ct").textContent=`${up}/12`;
  if(ul){
    el("ul-msg").innerHTML=`<span class="ok" style="font-weight:700">Unlocked.</span> Multi-goal mode will be available in The Gauntlet — you've earned the right to hold two goals at once.`;
  } else {
    el("ul-msg").textContent=`${Math.max(0,12-up)} more upload${12-up===1?"":"s"} to unlock a second goal.`;
  }
}

function renderRecCard(){
  const missed=S.uploads.slice(0,S.day-1).filter(v=>v===null).length;
  const rc=el("rec-c");
  if(missed>4&&S.day>6){ rc.innerHTML=`<div class="card ce mt10"><span class="lbl lbl-e">TOO MANY MISSED DAYS</span><p style="font-size:13px;line-height:1.6;margin-bottom:12px">You've missed ${missed} days. A Recovery Round will serve you better than pushing through.</p><button class="bd" style="padding:8px 16px;font-size:13px" onclick="goTo('rec')">Enter Recovery Round</button></div>`; }
  else rc.innerHTML="";
}

function updateUpBtn(){
  const btn=el("up-btn"),done=S.uploads[S.day-1]!==null;
  if(done){
    btn.textContent=`View / Edit Day ${S.day} ✓`;
    btn.disabled=false;
    btn.onclick=()=>openViewMod(S.day-1);
  }else{
    btn.textContent=`Upload Day ${S.day} Proof ↑`;
    btn.disabled=false;
    btn.onclick=openMod;
  }
}

function chDay(dir){ S.day=Math.min(getDur(),Math.max(1,S.day+dir)); S.lilDone=false; renderDash(); }


/* ── COMPLETION SCREEN ── */
async function initD15(){
  const u=S.user;
  const dur=getDur();
  const uploads=S.uploads.filter(v=>v!==null).length;
  let streak=0;for(let i=dur-1;i>=0;i--){if(S.uploads[i]!==null)streak++;else break;}
  el("pf-dur-lbl").textContent=`${dur} DAYS COMPLETE`;
  el("pf-lbl").textContent=`PROOF OF EXECUTION · ${(u?.name||"").toUpperCase()}`;
  el("pf-days").textContent=dur;
  el("pf-uploads").textContent=uploads;
  el("pf-streak").textContent=streak;
  el("pf-goal").textContent=`Goal: "${u.answers.goal}"`;
  /* User photo on proof card */
  const pfUser=el("pf-user-photo");
  if(u.photo){pfUser.innerHTML=`<img src="${u.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;pfUser.style.background="none";}
  else{pfUser.textContent=u.name?u.name[0].toUpperCase():"?";}
  el("pf-txt").innerHTML=`<div class="row" style="gap:10px">${spn()}<span class="muted" style="font-size:13px">Lil is writing your summary...</span></div>`;
  const journey=buildJourneyNarrative();
  const planStats=_buildPlanStats();
  const proofPrompt=`Write ONE sentence — max 18 words — about what this person proved through action. Use "you" not their name. Don't repeat their goal words. Be specific about the character trait or capability they demonstrated. No fluff, no cliches.${journey?`\n\nJourney context: ${journey}`:""}\n\nGoal: "${u.answers.goal}"`;
  const pf=await lil(proofPrompt,80);
  let finalText=pf||FB.proof(u.name,u.answers.goal);
  if(journey) finalText+=`<br><br><span style="font-size:12px;color:#888;line-height:1.7">${journey}</span>`;
  if(planStats) finalText+=`<br><span style="font-size:12px;color:#888;line-height:1.7">${planStats}</span>`;
  el("pf-txt").innerHTML=finalText;
}
function _buildPlanStats(){
  if(!S.plans)return"";
  const days=Object.keys(S.plans).filter(k=>S.plans[k].mainStep&&!S.plans[k].skipped);
  if(!days.length)return"";
  const dur=getDur();
  const plannedDays=days.length;
  const uploadDaysWithPlan=days.filter(d=>S.uploads[+d-1]!==null).length;
  const uploadDaysWithoutPlan=S.uploads.filter((v,i)=>v!==null&&!days.includes(String(i+1))).length;
  const totalUploads=S.uploads.filter(v=>v!==null).length;
  let s=`You planned ${plannedDays} out of ${dur} days.`;
  if(plannedDays>=3&&totalUploads>0){
    const planRate=Math.round(uploadDaysWithPlan/plannedDays*100);
    const noPlanDays=dur-plannedDays;
    const noPlanRate=noPlanDays>0?Math.round(uploadDaysWithoutPlan/noPlanDays*100):0;
    if(planRate>noPlanRate) s+=` On days you planned, you uploaded ${planRate}% of the time vs ${noPlanRate}% when you didn't.`;
  }
  return s;
}


/* ── ENERGY & MOOD CHECK (Gamification) ── */
const ENERGY_PROMPTS = [
  {type:"energy",q:"How's your energy right now?",sub:"Be honest — this is just for you."},
  {type:"mood",q:"One word for today:",sub:"Whatever comes to mind first."},
  {type:"reflection",q:"What almost stopped you today?",sub:"Name it. That's how you beat it next time."}
];
const MOOD_OPTIONS=["Focused","Tired","Anxious","Motivated","Meh","Fired up","Struggling","Calm"];

function shouldShowEnergyCheck(){
  if(!S.user||!S.uploads)return false;
  const d=S.day;
  /* Show on ~40% of days, seeded by day number for consistency */
  const seed=(d*7+13)%10;
  if(seed>3)return false;
  /* Don't show if already filled for today */
  if(S.user.energyLog&&S.user.energyLog[d])return false;
  /* Don't show on day 1 */
  if(d===1)return false;
  return true;
}

function renderEnergyCheck(){
  const area=el("energy-check-area");
  if(!shouldShowEnergyCheck()){area.innerHTML="";return;}
  const d=S.day;
  const promptIdx=(d*3+5)%ENERGY_PROMPTS.length;
  const prompt=ENERGY_PROMPTS[promptIdx];
  
  if(prompt.type==="energy"){
    area.innerHTML=`<div class="energy-card">
      <span class="lbl lbl-a" style="text-align:center;display:block">DAILY CHECK-IN</span>
      <p style="font-size:14px;font-weight:700;text-align:center;margin-bottom:2px">${prompt.q}</p>
      <p class="muted" style="font-size:11px;text-align:center">${prompt.sub}</p>
      <div class="energy-flames" id="energy-flames">
        ${[1,2,3,4,5].map(n=>`<div class="energy-flame" onclick="setEnergy(${n})" id="ef-${n}">🔥</div>`).join("")}
      </div>
      <p class="muted" style="font-size:10px;text-align:center"><span style="color:#5a5a5a">1 = barely alive</span> · <span style="color:#c49a1c">5 = unstoppable</span></p>
      <button class="bg" style="width:100%;margin-top:6px;font-size:11px" onclick="skipEnergyCheck()">Skip for today</button>
    </div>`;
  } else if(prompt.type==="mood"){
    area.innerHTML=`<div class="energy-card">
      <span class="lbl lbl-a" style="text-align:center;display:block">DAILY CHECK-IN</span>
      <p style="font-size:14px;font-weight:700;text-align:center;margin-bottom:2px">${prompt.q}</p>
      <p class="muted" style="font-size:11px;text-align:center">${prompt.sub}</p>
      <div class="mood-chips" id="mood-chips">
        ${MOOD_OPTIONS.map(m=>`<div class="mood-chip" onclick="setMood('${m}')">${m}</div>`).join("")}
      </div>
      <button class="bg" style="width:100%;margin-top:4px;font-size:11px" onclick="skipEnergyCheck()">Skip</button>
    </div>`;
  } else {
    area.innerHTML=`<div class="energy-card">
      <span class="lbl lbl-a" style="text-align:center;display:block">DAILY CHECK-IN</span>
      <p style="font-size:14px;font-weight:700;text-align:center;margin-bottom:4px">${prompt.q}</p>
      <p class="muted" style="font-size:11px;text-align:center;margin-bottom:10px">${prompt.sub}</p>
      <input id="reflect-input" type="text" placeholder="Type a short answer..." style="text-align:center;font-size:13px">
      <div class="row mt8" style="justify-content:center;gap:8px">
        <button class="bp" style="padding:8px 18px;font-size:12px" onclick="setReflection()">Save</button>
        <button class="bg" style="font-size:11px" onclick="skipEnergyCheck()">Skip</button>
      </div>
    </div>`;
  }
}

function setEnergy(level){
  trackEvent("energy_logged",{level});
  if(!S.user.energyLog) S.user.energyLog={};
  S.user.energyLog[S.day]={type:"energy",value:level};
  saveState();
  syncEnergyToSupabase(S.day,{type:"energy",value:level});
  document.querySelectorAll(".energy-flame").forEach((f,i)=>{
    f.className="energy-flame"+(i<level?" active":"");
  });
  setTimeout(()=>{
    el("energy-check-area").innerHTML=`<div style="text-align:center;padding:10px;font-size:12px;color:#c49a1c;animation:heroFadeUp .3s ease forwards">Energy logged: ${"🔥".repeat(level)} — noted.</div>`;
    setTimeout(()=>el("energy-check-area").innerHTML="",2000);
  },500);
}

function setMood(mood){
  trackEvent("mood_logged",{mood});
  if(!S.user.energyLog) S.user.energyLog={};
  S.user.energyLog[S.day]={type:"mood",value:mood};
  saveState();
  syncEnergyToSupabase(S.day,{type:"mood",value:mood});
  document.querySelectorAll(".mood-chip").forEach(c=>{
    c.className="mood-chip"+(c.textContent===mood?" active":"");
  });
  setTimeout(()=>{
    el("energy-check-area").innerHTML=`<div style="text-align:center;padding:10px;font-size:12px;color:#c49a1c;animation:heroFadeUp .3s ease forwards">"${mood}" — logged for Day ${S.day}.</div>`;
    setTimeout(()=>el("energy-check-area").innerHTML="",2000);
  },400);
}

function setReflection(){
  const v=el("reflect-input")?.value?.trim();
  if(!v)return;
  if(!S.user.energyLog) S.user.energyLog={};
  S.user.energyLog[S.day]={type:"reflection",value:v};
  saveState();
  el("energy-check-area").innerHTML=`<div style="text-align:center;padding:10px;font-size:12px;color:#c49a1c;animation:heroFadeUp .3s ease forwards">Noted. That honesty matters.</div>`;
  setTimeout(()=>el("energy-check-area").innerHTML="",2000);
}

function skipEnergyCheck(){
  if(!S.user.energyLog) S.user.energyLog={};
  S.user.energyLog[S.day]={type:"skip",value:null};
  el("energy-check-area").innerHTML="";
}


/* ── DAILY PLANNING ── */
function _todayPlan(){return S.plans[S.day]||null;}
function _hasPlanToday(){const p=_todayPlan();return p&&!p.skipped&&p.mainStep;}

function renderPlanArea(){
  const area=el("plan-area");if(!area)return;
  if(!S.user||!S.uploads)return;
  const d=S.day;
  const p=_todayPlan();
  if(p&&p.skipped){area.innerHTML="";return;}
  if(p&&p.mainStep){_renderPlanSummary(area,p,d);return;}
  if(d===1&&S.uploads.every(v=>v===null)&&!localStorage.getItem("oiwg_wt_"+S.user?.supabaseId)){area.innerHTML="";return;}
  _renderPlanPrompt(area,d);
}

function _renderPlanPrompt(area,d){
  const goal=S.user.answers?.goalSummary||S.user.answers?.goal||"your goal";
  area.innerHTML=`<div class="card mb10" style="border:1px solid rgba(196,154,28,.15);background:rgba(196,154,28,.03)">
    <span class="lbl lbl-a" style="display:block;text-align:center;margin-bottom:6px">DAILY PLAN · DAY ${d}</span>
    <p style="font-size:14px;font-weight:600;text-align:center;margin-bottom:12px">What's the one thing you're doing today?</p>
    <p class="muted" style="font-size:11px;text-align:center;margin-bottom:10px">Toward: ${goal}</p>
    <textarea id="plan-main-input" rows="2" placeholder="Be specific. What will you actually do?" style="font-size:14px;width:100%;margin-bottom:10px"></textarea>
    <button class="bp" style="width:100%;padding:12px;font-size:14px" onclick="_planStep2()" id="plan-continue-btn">Continue</button>
    <button class="bg" style="width:100%;margin-top:6px;font-size:11px" onclick="_skipPlan()">Skip for today</button>
  </div>`;
}

function _planStep2(){
  const input=el("plan-main-input");
  const mainStep=(input?.value||"").trim();
  if(mainStep.length<10){input.style.border="1px solid #d9503a";input.placeholder="Tell me more. What exactly?";return;}
  const area=el("plan-area");
  area.innerHTML=`<div class="card mb10" style="border:1px solid rgba(196,154,28,.15);background:rgba(196,154,28,.03)">
    <span class="lbl lbl-a" style="display:block;text-align:center;margin-bottom:4px">YOUR ONE THING</span>
    <p style="font-size:13px;font-weight:600;text-align:center;margin-bottom:12px;color:#ccc">"${_esc(mainStep)}"</p>
    <p style="font-size:14px;font-weight:600;text-align:center;margin-bottom:10px">How does that break down? Give me three.</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
      <input id="plan-s1" type="text" placeholder="Step 1" style="font-size:14px;padding:12px 14px">
      <input id="plan-s2" type="text" placeholder="Step 2" style="font-size:14px;padding:12px 14px">
      <input id="plan-s3" type="text" placeholder="Step 3" style="font-size:14px;padding:12px 14px">
    </div>
    <div style="display:flex;gap:8px">
      <button class="bg" style="flex:1;font-size:12px;padding:10px" onclick="_planAISuggest('${_esc(mainStep)}')" id="plan-ai-btn">Stuck? Get suggestions</button>
      <button class="bp" style="flex:1;font-size:14px;padding:10px" onclick="_submitPlan('${_esc(mainStep)}')">Set my plan</button>
    </div>
  </div>`;
  el("plan-s1")?.focus();
}

function _esc(s){return s.replace(/'/g,"\\'").replace(/"/g,"&quot;");}

async function _planAISuggest(mainStep){
  const btn=el("plan-ai-btn");if(!btn)return;
  btn.innerHTML=spn();btn.disabled=true;
  try{
    const goal=S.user.answers?.goalSummary||S.user.answers?.goal||"";
    const threat=S.user.answers?.threat||"";
    const prompt=`Goal: "${goal}"\nToday's main step: "${mainStep}"\nBiggest blocker: "${threat}"\n\nSuggest 3 specific, actionable sub-steps for today. Each starts with a verb. Doable in under 2 hours. Return ONLY 3 lines, numbered 1-3. Max 12 words each. No intro.`;
    const res=await lil(prompt,100);
    const lines=(res||"").split("\n").map(l=>l.replace(/^\d+[\.\)]\s*/,"").trim()).filter(l=>l.length>3);
    if(lines[0])el("plan-s1").value=lines[0];
    if(lines[1])el("plan-s2").value=lines[1];
    if(lines[2])el("plan-s3").value=lines[2];
    S._planAiUsed=true;
  }catch(e){}
  btn.textContent="Stuck? Get suggestions";btn.disabled=false;
}

function _submitPlan(mainStep){
  const s1=(el("plan-s1")?.value||"").trim();
  const s2=(el("plan-s2")?.value||"").trim();
  const s3=(el("plan-s3")?.value||"").trim();
  if(!s1||!s2||!s3){
    [el("plan-s1"),el("plan-s2"),el("plan-s3")].forEach(i=>{if(i&&!i.value.trim())i.style.border="1px solid #d9503a";});
    return;
  }
  const plan={mainStep,subSteps:[{text:s1,done:false},{text:s2,done:false},{text:s3,done:false}],aiAssisted:!!S._planAiUsed,skipped:false};
  S.plans[S.day]=plan;
  S._planAiUsed=false;
  saveState();
  syncPlanToSupabase(S.day,plan);
  const area=el("plan-area");
  area.innerHTML=`<div style="text-align:center;padding:14px;font-size:13px;color:#c49a1c;animation:heroFadeUp .3s ease forwards">Plan set. Now go do it.</div>`;
  setTimeout(()=>_renderPlanSummary(area,plan,S.day),1500);
}

function _renderPlanSummary(area,plan,d){
  const done=plan.subSteps.filter(s=>s.done).length;
  const total=plan.subSteps.length;
  const allDone=done===total;
  area.innerHTML=`<div class="card mb10" style="border:1px solid ${allDone?"rgba(77,201,138,.2)":"rgba(196,154,28,.1)"};padding:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">TODAY'S PLAN · DAY ${d}</span>
      <span style="font-size:10px;color:${allDone?"#4dc98a":"#888"}">${done}/${total} done</span>
    </div>
    <p style="font-size:12px;color:#999;margin-bottom:10px">${_esc(plan.mainStep)}</p>
    ${plan.subSteps.map((s,i)=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;${i<total-1?"border-bottom:1px solid #1a1a1a":""}">
      <div onclick="_togglePlanStep(${i})" style="width:20px;height:20px;border-radius:5px;border:1.5px solid ${s.done?"#4dc98a":"#333"};background:${s.done?"rgba(77,201,138,.15)":"transparent"};cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;color:#4dc98a">${s.done?"✓":""}</div>
      <span style="font-size:13px;color:${s.done?"#666":"#ccc"};${s.done?"text-decoration:line-through":""}">${_esc(s.text)}</span>
    </div>`).join("")}
    ${allDone?`<p style="font-size:12px;color:#4dc98a;text-align:center;margin-top:10px;font-weight:600">All done. Upload your proof.</p>`:""}
  </div>`;
}

function _togglePlanStep(idx){
  const plan=S.plans[S.day];if(!plan||!plan.subSteps[idx])return;
  plan.subSteps[idx].done=!plan.subSteps[idx].done;
  saveState();
  syncPlanToSupabase(S.day,plan);
  _renderPlanSummary(el("plan-area"),plan,S.day);
}

function _skipPlan(){
  S.plans[S.day]={mainStep:"",subSteps:[],aiAssisted:false,skipped:true};
  saveState();
  syncPlanToSupabase(S.day,S.plans[S.day]);
  el("plan-area").innerHTML="";
}


/* ── CALL DAY MODAL ── */
function openCallModal(day){
  const u=S.user;
  el("view-mod-dl").textContent=`DAY ${day} · CALL`;
  el("view-mod-body").innerHTML=`
    <div style="text-align:center;padding:12px 0">
      <div style="width:56px;height:56px;border-radius:50%;border:2px solid #c49a1c;overflow:hidden;margin:0 auto 14px;background:#c49a1c">
        <img class="genie-photo-img" src="" style="width:100%;height:100%;object-fit:cover;object-position:top;display:block">
      </div>
      <p style="font-size:15px;font-weight:700;margin-bottom:4px">Call Day with Genie</p>
      <p class="muted" style="font-size:12px;line-height:1.6;margin-bottom:16px">Day ${day} is your scheduled check-in. Book a time that works for you — Genie will be there.</p>
      <a href="${CALENDLY_URL}" target="_blank" style="display:inline-flex;align-items:center;gap:8px;background:#c49a1c;color:#000;padding:12px 24px;border-radius:9px;font-size:14px;font-weight:700;text-decoration:none">Book Your Call →</a>
      <p class="muted" style="font-size:10px;margin-top:10px">You'll pick a time slot. Genie gets notified automatically.</p>
    </div>`;
  el("view-mod-actions").innerHTML=`<button class="bs" style="width:100%;padding:10px;font-size:13px" onclick="closeViewMod()">Close</button>`;
  el("view-mod").classList.add("show");
  setTimeout(setGeniePhotos,50);
}


/* ── JOURNEY NARRATIVE (for completion screen) ── */
function buildJourneyNarrative(){
  if(!S.user?.energyLog) return "";
  const log=S.user.energyLog;
  const entries=Object.keys(log).filter(k=>log[k].type!=="skip").sort((a,b)=>+a - +b);
  if(entries.length===0) return "";
  let narrative="";
  const lowEnergy=entries.filter(k=>log[k].type==="energy"&&log[k].value<=2);
  const highEnergy=entries.filter(k=>log[k].type==="energy"&&log[k].value>=4);
  const toughMoods=entries.filter(k=>log[k].type==="mood"&&["Tired","Anxious","Struggling"].includes(log[k].value));
  if(lowEnergy.length>0) narrative+=`On Day${lowEnergy.length>1?"s":""} ${lowEnergy.join(", ")} your energy was at rock bottom — but you still showed up. `;
  if(toughMoods.length>0) narrative+=`You logged "${toughMoods.map(k=>log[k].value).join(", ")}" and pushed through anyway. `;
  if(highEnergy.length>0) narrative+=`Days ${highEnergy.join(", ")} — that's where the fire was. `;
  const reflections=entries.filter(k=>log[k].type==="reflection");
  if(reflections.length>0) narrative+=`You named what almost stopped you: "${log[reflections[0]].value}." And you uploaded anyway.`;
  return narrative;
}


/* ── RECOVERY ── */
async function initRec(){
  S.recDay=1;
  if(S.user&&!S.user.recovery)S.user.recovery=[];
  updRec();
  const rl=el("rec-lil"); rl.style.display="flex";
  el("rec-lil-t").innerHTML=`${spn()} <span class="muted" style="font-size:13px">Lil is thinking...</span>`;
  const recPrompt=`Write 2 sentences about what the Recovery Round is for. Direct, not comforting. Reference their goal and the threat they identified.\n\nGoal: "${S.user?.answers?.goal}"\nThreat to quitting: "${S.user?.answers?.threat||""}"`;
  const m=await lil(recPrompt,100);
  el("rec-lil-t").textContent=m||FB.rec(S.user?.answers?.goal);
}

function updRec(){
  const d=S.recDay;
  el("rec-lbl").textContent=`RECOVERY · DAY ${d}/7`;
  el("rec-bar").style.width=Math.round((d/7)*100)+"%";
  el("rec-day-l").textContent=`Day ${d} reflection:`;
  el("rec-btn").textContent=d<7?`Complete Day ${d} →`:"Finish Recovery →";
  el("rec-ta").value="";
  const g=el("rec-grid"); g.innerHTML="";
  for(let i=0;i<7;i++){
    const c=document.createElement("div");
    c.style.cssText=`height:34px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${i<d-1?"rgba(77,201,138,.07)":i===d-1?"rgba(217,80,58,.07)":"#131313"};border:1px solid ${i<d-1?"rgba(77,201,138,.22)":i===d-1?"rgba(217,80,58,.22)":"#171717"};color:${i<d-1?"#4dc98a":i===d-1?"#d9503a":"#5a5a5a"}`;
    c.textContent=i<d-1?"✓":`D${i+1}`; g.appendChild(c);
  }
}

function advRec(){
  const txt=el("rec-ta").value.trim();
  if(!txt)return;
  if(S.user&&S.user.recovery)S.user.recovery.push({day:S.recDay,text:txt});
  if(S.recDay<7){S.recDay++;updRec();}
  else{
    saveState();
    el("s-rec").innerHTML=`<div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:44px 20px"><div style="max-width:320px"><span class="lbl lbl-o" style="display:block;margin-bottom:5px">RECOVERY COMPLETE</span><h2 style="font-size:36px;font-weight:900;margin-bottom:12px">You're back.</h2><p class="muted mb24" style="font-size:14px;line-height:1.8">7 days of honest reflection. Restart with what you just learned.</p><button class="bp" style="width:100%;font-size:15px;padding:13px" onclick="restartChallenge()">Restart Challenge →</button></div></div>`;
  }
}

function restartChallenge(){
  S.uploads=Array(getDur()).fill(null);
  S.day=1;
  S.lilDone=false;
  if(S.user)S.user.startDate=new Date().toISOString();
  saveState();
  goTo("dash");
}

/* ── CHALLENGE STATS ── */
function renderStats(){
  const sc=el("stats-card");if(!sc||!S.user)return;
  const u=S.user,d=S.day,dur=getDur();
  const uploads=S.uploads.filter(v=>v!==null).length;
  const missed=Math.max(0,d-1-uploads);
  const pct=d>1?Math.round((uploads/Math.max(d-1,1))*100):0;
  const remaining=Math.max(0,dur-d);
  let sk=0;for(let i=S.day-1;i>=0;i--){if(S.uploads[i]!==null)sk++;else break;}

  sc.style.display="block";
  sc.innerHTML=`<div class="row mb8" style="justify-content:space-between">
    <span class="lbl m0">YOUR PROGRESS</span>
    <button class="bs" style="padding:4px 10px;font-size:10px" onclick="openShareCard()">Share</button>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
    <div style="text-align:center;padding:10px 4px;background:var(--card2,#131313);border-radius:8px;border:1px solid var(--bd,#1a1a1a)">
      <p style="font-size:20px;font-weight:900;color:#c49a1c">${uploads}</p>
      <p style="font-size:9px;color:var(--muted,#5a5a5a);font-weight:600;letter-spacing:.04em">UPLOADS</p>
    </div>
    <div style="text-align:center;padding:10px 4px;background:var(--card2,#131313);border-radius:8px;border:1px solid var(--bd,#1a1a1a)">
      <p style="font-size:20px;font-weight:900;color:${sk>0?"#c49a1c":"var(--muted,#5a5a5a)"}">${sk}</p>
      <p style="font-size:9px;color:var(--muted,#5a5a5a);font-weight:600;letter-spacing:.04em">STREAK</p>
    </div>
    <div style="text-align:center;padding:10px 4px;background:var(--card2,#131313);border-radius:8px;border:1px solid var(--bd,#1a1a1a)">
      <p style="font-size:20px;font-weight:900;color:${pct>=80?"#4dc98a":pct>=50?"#c49a1c":"#d9503a"}">${pct}%</p>
      <p style="font-size:9px;color:var(--muted,#5a5a5a);font-weight:600;letter-spacing:.04em">HIT RATE</p>
    </div>
  </div>
  <div class="row" style="justify-content:space-between;font-size:11px;color:var(--muted,#5a5a5a)">
    <span>${missed} missed</span>
    <span>${remaining} day${remaining!==1?"s":""} left</span>
  </div>`;
}


/* ── SHARE PROGRESS CARD ── */
function openShareCard(){
  generateShareCanvas();
  el("share-mod").classList.add("show");
}

function generateShareCanvas(){
  const c=el("share-canvas");if(!c)return;
  const u=S.user,d=S.day,dur=getDur();
  const uploads=S.uploads.filter(v=>v!==null).length;
  let sk=0;for(let i=S.day-1;i>=0;i--){if(S.uploads[i]!==null)sk++;else break;}
  const pct=d>1?Math.round((uploads/Math.max(d-1,1))*100):0;

  const W=600,H=800;
  c.width=W;c.height=H;
  const ctx=c.getContext("2d");

  ctx.fillStyle="#0a0a0a";
  ctx.fillRect(0,0,W,H);

  const grd=ctx.createRadialGradient(W/2,200,0,W/2,200,400);
  grd.addColorStop(0,"rgba(196,154,28,.08)");
  grd.addColorStop(1,"transparent");
  ctx.fillStyle=grd;
  ctx.fillRect(0,0,W,H);

  ctx.fillStyle="#c49a1c";
  ctx.font="bold 11px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing="2px";
  ctx.textAlign="center";
  ctx.fillText("ON IT WITH GENIE",W/2,60);
  ctx.letterSpacing="0px";

  ctx.fillStyle="#e0e0e0";
  ctx.font="bold 28px system-ui, -apple-system, sans-serif";
  ctx.fillText(u.name||"Challenger",W/2,110);

  ctx.fillStyle="#888";
  ctx.font="14px system-ui, -apple-system, sans-serif";
  const goalText=u.answers.goalSummary||u.answers.goal||"";
  const maxW=W-80;
  if(ctx.measureText(goalText).width>maxW){
    const words=goalText.split(" ");let line="",y=150;
    for(const w of words){
      const test=line?line+" "+w:w;
      if(ctx.measureText(test).width>maxW){ctx.fillText(line,W/2,y);line=w;y+=22;}
      else line=test;
    }
    if(line)ctx.fillText(line,W/2,y);
  }else{
    ctx.fillText(goalText,W/2,150);
  }

  const gridTop=200,cellSize=40,gap=6,cols=Math.min(dur,7);
  const rows=Math.ceil(dur/cols);
  const gridW=cols*cellSize+(cols-1)*gap;
  const gridX=(W-gridW)/2;
  for(let i=0;i<dur;i++){
    const col=i%cols,row=Math.floor(i/cols);
    const x=gridX+col*(cellSize+gap),y=gridTop+row*(cellSize+gap);
    const isUp=S.uploads[i]!==null;
    const isPast=i+1<d;
    ctx.beginPath();
    ctx.roundRect(x,y,cellSize,cellSize,6);
    ctx.fillStyle=isUp?"rgba(77,201,138,.15)":isPast?"rgba(217,80,58,.08)":"#131313";
    ctx.fill();
    ctx.strokeStyle=isUp?"rgba(77,201,138,.4)":isPast?"rgba(217,80,58,.2)":"#1a1a1a";
    ctx.lineWidth=1;
    ctx.stroke();
    if(isUp){
      ctx.fillStyle="#4dc98a";ctx.font="bold 16px system-ui";ctx.textAlign="center";
      ctx.fillText("✓",x+cellSize/2,y+cellSize/2+6);
    }else{
      ctx.fillStyle="#3a3a3a";ctx.font="bold 10px system-ui";ctx.textAlign="center";
      ctx.fillText("D"+(i+1),x+cellSize/2,y+cellSize/2+4);
    }
  }

  const statsY=gridTop+rows*(cellSize+gap)+40;
  const statBoxW=140,statBoxH=80,statGap=20;
  const totalW=3*statBoxW+2*statGap;
  const statX=(W-totalW)/2;

  [{v:String(uploads),l:"UPLOADS",c:"#c49a1c"},{v:String(sk),l:"STREAK",c:sk>0?"#c49a1c":"#5a5a5a"},{v:pct+"%",l:"HIT RATE",c:pct>=80?"#4dc98a":pct>=50?"#c49a1c":"#d9503a"}].forEach((s,i)=>{
    const bx=statX+i*(statBoxW+statGap);
    ctx.beginPath();ctx.roundRect(bx,statsY,statBoxW,statBoxH,10);
    ctx.fillStyle="#131313";ctx.fill();
    ctx.strokeStyle="#1a1a1a";ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle=s.c;ctx.font="bold 28px system-ui";ctx.textAlign="center";
    ctx.fillText(s.v,bx+statBoxW/2,statsY+38);
    ctx.fillStyle="#5a5a5a";ctx.font="bold 9px system-ui";
    ctx.fillText(s.l,bx+statBoxW/2,statsY+60);
  });

  const dayY=statsY+statBoxH+30;
  ctx.fillStyle="#888";ctx.font="13px system-ui";ctx.textAlign="center";
  ctx.fillText(`Day ${d} of ${dur}`,W/2,dayY);

  ctx.fillStyle="#c49a1c";ctx.font="bold 12px system-ui";
  ctx.fillText("oiwg.vercel.app",W/2,H-30);

  const preview=el("share-card-preview");
  if(preview) preview.innerHTML=`<img src="${c.toDataURL("image/png")}" style="width:100%;border-radius:10px">`;
}

function downloadShareCard(){
  const c=el("share-canvas");if(!c)return;
  const link=document.createElement("a");
  link.download=`oiwg-day${S.day}-progress.png`;
  link.href=c.toDataURL("image/png");
  link.click();
}

async function nativeShareCard(){
  const c=el("share-canvas");if(!c)return;
  try{
    const blob=await new Promise(r=>c.toBlob(r,"image/png"));
    const file=new File([blob],`oiwg-day${S.day}.png`,{type:"image/png"});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      await navigator.share({files:[file],title:"My Progress — On It with Genie",text:`Day ${S.day} of ${getDur()} done.`});
    }else{
      downloadShareCard();
    }
  }catch(e){
    if(e.name!=="AbortError") downloadShareCard();
  }
}


/* ── FLOATING CHAT ── */
let _chatRenderedOnce=false;
let _chatOpen=false;

function showChatFab(){
  const fab=el("chat-fab");
  if(fab)fab.style.display="flex";
}

function toggleFloatingChat(){
  const panel=el("chat-float");
  const fab=el("chat-fab");
  if(!panel)return;
  _chatOpen=!_chatOpen;
  if(_chatOpen){
    panel.style.display="flex";
    fab.style.display="none";
    renderChat();
    setTimeout(()=>{const s=el("chat-scroll");if(s)s.scrollTop=s.scrollHeight;},100);
    if(typeof _markChatRead==="function") _markChatRead();
  }else{
    panel.style.display="none";
    fab.style.display="flex";
  }
}


/* ── PROOF WALL (subtle social proof) ── */
let _proofWallTimer=null;
let _proofWallData=null;

function startProofWall(){
  if(_proofWallTimer)return;
  const pw=el("proof-wall");if(!pw)return;
  _fetchProofWallData();
  setTimeout(()=>_showProofWallItem(pw),3000);
  _proofWallTimer=setInterval(()=>_showProofWallItem(pw),22000);
}

async function _fetchProofWallData(){
  if(!sb)return;
  try{
    const {count}=await sb.from("uploads").select("id",{count:"exact",head:true});
    const {count:active}=await sb.from("challengers").select("id",{count:"exact",head:true}).eq("status","active");
    if(count||active)_proofWallData={totalUploads:count||0,activeChallengers:active||0};
  }catch(e){}
}

function _showProofWallItem(pw){
  if(!S.user)return;
  pw.style.display="block";
  const pool=[];
  if(_proofWallData&&_proofWallData.totalUploads>5){
    pool.push(`${_proofWallData.totalUploads} proofs uploaded across all challengers`);
  }
  if(_proofWallData&&_proofWallData.activeChallengers>1){
    pool.push(`${_proofWallData.activeChallengers} challengers are active right now`);
  }
  pool.push("Someone just uploaded their daily proof");
  pool.push("A challenger just completed a check-in");
  pool.push("Someone is building their streak right now");
  const text=pool[Math.floor(Math.random()*pool.length)];
  pw.innerHTML=`<div class="proof-wall-item">
    <div style="width:6px;height:6px;border-radius:50%;background:#4dc98a;flex-shrink:0;opacity:.6"></div>
    <span>${text}</span>
  </div>`;
  setTimeout(()=>{pw.innerHTML="";},5000);
}


/* ── 2ND-VISIT PUSH NOTIFICATION CHECK ── */
function _check2ndVisitPush(){
  if(typeof _pushSupported!=="function"||!_pushSupported())return;
  if(localStorage.getItem("oiwg_push_check_done"))return;
  const key="oiwg_dash_visits";
  const visits=parseInt(localStorage.getItem(key)||"0")+1;
  localStorage.setItem(key,String(visits));
  if(visits!==2)return;
  if(!("serviceWorker" in navigator))return;
  navigator.serviceWorker.getRegistration("/sw.js").then(reg=>{
    if(!reg){setTimeout(_show2ndVisitPrompt,3000);return;}
    reg.pushManager.getSubscription().then(sub=>{
      if(!sub)setTimeout(_show2ndVisitPrompt,3000);
    });
  }).catch(()=>{});
}

function _show2ndVisitPrompt(){
  if(document.getElementById("push-check-prompt"))return;
  localStorage.setItem("oiwg_push_check_done","1");
  const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone=window.navigator.standalone||window.matchMedia("(display-mode: standalone)").matches;
  const banner=document.createElement("div");
  banner.id="push-check-prompt";
  banner.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid rgba(196,154,28,.3);color:#e0e0e0;font-size:13px;padding:18px 20px;border-radius:14px;z-index:9999;max-width:340px;width:calc(100% - 32px);text-align:center;box-shadow:0 8px 30px #0008;animation:popIn .25s ease";
  banner.innerHTML=`<p style="font-weight:700;color:#c49a1c;margin-bottom:6px">Quick question</p>
    <p style="font-size:12px;color:#999;line-height:1.6;margin-bottom:14px">Have you been receiving notifications from us? They help you stay on track with your challenge.</p>
    <div style="display:flex;gap:8px;justify-content:center">
      <button onclick="this.closest('#push-check-prompt').remove()" style="padding:8px 20px;border-radius:8px;background:#222;border:1px solid #333;color:#ccc;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Yes, I have</button>
      <button onclick="_handle2ndVisitNo()" style="padding:8px 20px;border-radius:8px;background:#c49a1c;border:none;color:#000;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">No, not yet</button>
    </div>`;
  document.body.appendChild(banner);
}

function _handle2ndVisitNo(){
  const prompt=document.getElementById("push-check-prompt");
  if(!prompt)return;
  const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone=window.navigator.standalone||window.matchMedia("(display-mode: standalone)").matches;
  if(isIOS&&!isStandalone){
    prompt.innerHTML=`<p style="font-weight:700;color:#c49a1c;margin-bottom:8px">Let's fix that</p>
      <p style="font-size:12px;color:#999;line-height:1.6;margin-bottom:6px">On iPhone, notifications work best when the app is on your Home Screen:</p>
      <div style="text-align:left;font-size:12px;color:#ccc;line-height:1.8;margin-bottom:14px;padding:10px 14px;background:#111;border-radius:8px">
        1. Tap the <strong>Share</strong> button (bottom bar)<br>
        2. Scroll down and tap <strong>Add to Home Screen</strong><br>
        3. Open the app from your Home Screen
      </div>
      <button onclick="this.closest('#push-check-prompt').remove()" style="padding:8px 20px;border-radius:8px;background:#222;border:1px solid #333;color:#888;font-size:12px;cursor:pointer;font-family:inherit">Got it</button>`;
  }else{
    prompt.innerHTML=`<p style="font-weight:700;color:#c49a1c;margin-bottom:8px">Let's turn them on</p>
      <p style="font-size:12px;color:#999;line-height:1.6;margin-bottom:14px">Notifications help you stay consistent. Enable them so Genie can remind you when it matters.</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button onclick="_accept2ndVisitPush()" style="padding:8px 20px;border-radius:8px;background:#c49a1c;border:none;color:#000;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Enable Notifications</button>
        <button onclick="this.closest('#push-check-prompt').remove()" style="padding:8px 20px;border-radius:8px;background:#222;border:1px solid #333;color:#888;font-size:12px;cursor:pointer;font-family:inherit">Not now</button>
      </div>`;
  }
}

async function _accept2ndVisitPush(){
  const prompt=document.getElementById("push-check-prompt");
  if(prompt)prompt.remove();
  if(typeof _subscribePush==="function"){
    const ok=await _subscribePush();
    if(ok){
      showToast("Notifications enabled — you're all set","success");
      if(typeof _renderNotifToggle==="function")_renderNotifToggle();
    }else if(Notification.permission==="denied"){
      showToast("Blocked by browser — check notification settings","error",5000);
    }
  }
}


/* initD15 is defined above with the new proof card logic */

