/* ── ONBOARDING ── */
function startOB(){
  trackEvent("onboarding_start");
  S.stepIdx=-1; S.ans={}; S.inFU=false; S.fuQ="";
  goTo("ob"); renderOB();
}

function curStep(){ return getSteps()[S.stepIdx]; }
function totalSteps(){ return getSteps().length; }

function renderOB(){
  const idx=S.stepIdx, tot=totalSteps();
  el("ob-ct").textContent = (idx>=0&&idx<tot) ? `${idx+1} / ${tot}` : "";
  el("ob-bar").style.width = idx<0 ? "0%" : Math.round(((idx+1)/tot)*100)+"%";
  const b = el("ob-body");
  b.classList.add("ob-fade");
  setTimeout(async ()=>{
    await _renderOBContent(b,idx,tot);
    b.classList.remove("ob-fade");
  },200);
}

async function _renderOBContent(b,idx,tot){

  /* Name */
  if(idx===-1){
    b.innerHTML=`<span class="lbl lbl-a">WELCOME</span>
      <h2 style="font-size:22px;font-weight:900;line-height:1.2;margin-bottom:6px">Before we begin, what do I call you?</h2>
      <p class="muted mb18" style="font-size:13px">This is how Lil and Genie will address you throughout the challenge.</p>
      <input id="n-in" type="text" placeholder="Your first name" class="mb14">
      <button class="bp" style="width:100%;padding:12px" onclick="advOB()">Continue</button>`;
    const ni=el("n-in");
    ni.addEventListener("keydown", e=>e.key==="Enter"&&advOB());
    setTimeout(()=>ni.focus(),80);
    return;
  }

  /* Proof type confirm */
  if(idx===tot){
    const pt=S.ans.proofType||"output";
    /* Generate AI summary of goal if not already done */
    if(!S.ans.goalSummary){
      b.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:48px 0">${spn()}<p class="muted" style="font-size:14px">Lil is summarizing your goal...</p></div>`;
      const sumPrompt=`Summarize this person's goal into ONE clear, compelling sentence (max 15 words). Be specific. No fluff.\n\nWhat they said: "${S.ans.goal}"\nReturn ONLY the summary sentence, nothing else.`;
      const summary=await lil(sumPrompt,40);
      S.ans.goalSummary=summary||S.ans.goal;
    }
    b.innerHTML=`<span class="lbl lbl-a">YOUR CHALLENGE SUMMARY</span>
      <h2 style="font-size:22px;font-weight:900;margin-bottom:16px">Here's what you're signing up for</h2>
      <div class="card mb12">
        <div class="row" style="justify-content:space-between;margin-bottom:6px">
          <span class="lbl m0">YOUR GOAL</span>
          <button class="bg" style="font-size:10px;padding:2px 8px" onclick="editGoalSummary()">Edit</button>
        </div>
        <p id="goal-summary-text" style="font-size:15px;line-height:1.55;font-weight:600" contenteditable="false">${S.ans.goalSummary||S.ans.goal}</p>
        <div id="goal-edit-controls" style="display:none;margin-top:8px">
          <div class="row" style="gap:6px">
            <button class="bs" style="font-size:11px;padding:6px 12px" onclick="rewordGoal()">✦ Reword</button>
            <button class="bp" style="font-size:11px;padding:6px 12px" onclick="saveGoalEdit()">Save</button>
          </div>
        </div>
      </div>
      <div class="card ca mb12" style="display:flex;gap:14px;align-items:center">
        <div style="width:40px;height:40px;border-radius:9px;background:#1b1b1b;border:2px solid #c49a1c;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <div style="width:12px;height:12px;border-radius:50%;background:#c49a1c"></div>
        </div>
        <div><strong style="font-size:14px">${PT[pt]||"Output Proof"}</strong><p class="muted" style="font-size:12px;margin-top:2px">${PTD[pt]||""}</p></div>
      </div>
      <div class="card mb16"><span class="lbl">DAILY EVIDENCE</span><p style="font-size:13px;line-height:1.55;color:#888">${S.ans.proof||""}</p></div>
      <button class="bp" style="width:100%;font-size:15px;padding:13px" onclick="finishOB()">This is correct. Continue →</button>
      <button class="bg" style="width:100%;margin-top:6px" onclick="S.stepIdx=0;S.inFU=false;renderOB()">← Edit my answers</button>`;
    return;
  }

  const step = curStep();

  /* Lil nudge for short answers — show original, ask for more detail separately */
  if(S.inFU){
    const prevAnswer=S.ans[step.id]||"";
    b.innerHTML=`<div style="padding:10px 14px;background:var(--s2);border:1px solid var(--bd);border-radius:10px;margin-bottom:12px">
        <span class="lbl" style="margin-bottom:4px">YOU WROTE</span>
        <p style="font-size:14px;line-height:1.55;color:var(--text);font-weight:600">${prevAnswer}</p>
      </div>
      <div style="padding:10px 14px;background:rgba(196,154,28,.05);border:1px solid rgba(196,154,28,.15);border-radius:10px;margin-bottom:14px;display:flex;gap:10px;align-items:flex-start">
        <div class="lil-icon" style="width:26px;height:26px;font-size:11px;flex-shrink:0">✦</div>
        <p style="font-size:13px;line-height:1.55;color:#c49a1c">${S.fuQ}</p>
      </div>
      <textarea id="ob-ta" rows="3" placeholder="Add more detail here..." class="mb14"></textarea>
      <button class="bp" style="width:100%;padding:12px" onclick="advOB()">Continue →</button>`;
    setTimeout(()=>{const t=el("ob-ta");if(t)t.focus();},80);
    return;
  }

  /* Standard question */
  const placeholderText=step.placeholder||'Type your answer...';
  
  /* Special handler for proof type picker */
  if(step.isProofPicker){
    const goal=S.ans.goal||"";
    const proofTypes=[
      {id:"photo",icon:`<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>`,label:"Photos",descId:"pd-photo",defaultDesc:"Screenshots, progress pics, evidence shots"},
      {id:"link",icon:`<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h3a5 5 0 010 10h-3m-6 0H6A5 5 0 016 7h3"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,label:"Links",descId:"pd-link",defaultDesc:"URLs to published work, portfolios, resources"},
      {id:"note",icon:`<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,label:"Notes",descId:"pd-note",defaultDesc:"Written updates, reflections, word counts"},
      {id:"voice",icon:`<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,label:"Voice Notes",descId:"pd-voice",defaultDesc:"Audio check-ins and verbal updates"}
    ];
    b.innerHTML=`<span class="lbl lbl-a">CLARITY FORM · ${idx+1}/${tot}</span>
      <h2 style="font-size:clamp(17px,3.2vw,22px);font-weight:800;line-height:1.3;margin-bottom:6px">${step.q}</h2>
      <p class="muted mb16" style="font-size:12px">${step.h}</p>
      <div id="proof-type-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
        ${proofTypes.map(p=>`<div class="proof-pick-opt" data-pid="${p.id}" onclick="toggleProofPick('${p.id}')" style="padding:16px 12px;border:1px solid var(--bd);border-radius:12px;cursor:pointer;transition:all .15s;text-align:center;-webkit-tap-highlight-color:transparent;background:var(--s2)">
          <div style="margin-bottom:8px;display:flex;justify-content:center">${p.icon}</div>
          <p style="font-size:13px;font-weight:700;margin-bottom:4px">${p.label}</p>
          <p id="${p.descId}" class="muted" style="font-size:10px;line-height:1.4">${p.defaultDesc}</p>
        </div>`).join("")}
      </div>
      <textarea id="ob-ta" rows="2" placeholder="Any additional detail about your proof format (optional)" class="mb14" style="font-size:13px"></textarea>
      <input type="hidden" id="proof-picks" value="">
      <div class="row" style="justify-content:space-between">
        ${idx>0?`<button class="bg" onclick="backOB()">← Back</button>`:"<div>"}
        <button class="bp" id="proof-next-btn" onclick="advProofPick()" disabled>Next →</button>
      </div>`;
    /* Generate goal-adaptive descriptions */
    if(goal.length>10){
      adaptProofDescriptions(goal);
    }
    return;
  }

  b.innerHTML=`<span class="lbl lbl-a">CLARITY FORM · ${idx+1}/${tot}</span>
    <h2 style="font-size:clamp(17px,3.2vw,22px);font-weight:800;line-height:1.3;margin-bottom:6px">${step.q}</h2>
    <p class="muted mb16" style="font-size:12px">${step.h}</p>
    <textarea id="ob-ta" rows="4" placeholder="${placeholderText}" class="mb14"></textarea>
    <div class="row" style="justify-content:space-between">
      ${idx>0?`<button class="bg" onclick="backOB()">← Back</button>`:"<div>"}
      <button class="bp" onclick="advOB()">Next →</button>
    </div>`;
  setTimeout(()=>el("ob-ta")&&el("ob-ta").focus(),80);
}

async function advOB(){
  const idx=S.stepIdx, tot=totalSteps();

  /* Name step */
  if(idx===-1){
    const v=el("n-in")?.value?.trim(); if(!v)return;
    S.ans.name=v; S.stepIdx=0; renderOB(); return;
  }

  const ta=el("ob-ta");
  const txt=(ta?.value||"").trim();
  const step=curStep();

  /* Returning from "tell me more" nudge — allow continuing with or without extra text */
  if(S.inFU){
    const prev=S.ans[step.id]||"";
    if(txt) S.ans[step.id]=prev+". "+txt;
    S.inFU=false;
    if(idx<tot-1){S.stepIdx++;renderOB();}
    else await detectPT();
    return;
  }

  if(!txt)return;

  /* Save answer */
  S.ans[step.id]=txt;

  /* Short answer nudge — only for goal, only if too short, no AI involved */
  if(step.minLen&&txt.length<step.minLen){
    S.inFU=true;
    S.fuQ="Tell me more about this goal. What specifically are you trying to achieve?";
    renderOB();
    return;
  }

  /* Move to next step or detect proof type */
  if(idx<tot-1){S.stepIdx++;renderOB();}
  else await detectPT();
}

async function detectPT(){
  el("ob-body").innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:48px 0">${spn()}<p class="muted" style="font-size:14px">Lil is preparing your challenge...</p></div>`;
  const ptPrompt=`Based on this goal and proof description, classify the proof type. Return ONLY one word: output, process, milestone, behavior, or measurement.\n\nGoal: "${S.ans.goal}"\nProof description: "${S.ans.proof||""}"`;
  const pt=await lil(ptPrompt,20);
  S.ans.proofType=["output","process","milestone","behavior","measurement"].find(k=>pt?.toLowerCase().includes(k))||FB.pt;
  S.stepIdx=totalSteps(); renderOB();
}

function backOB(){
  if(S.stepIdx>0) S.stepIdx--;
  S.inFU=false; renderOB();
}


/* ── ONBOARDING → DURATION ── */
function editGoalSummary(){
  const txt=el("goal-summary-text");
  const controls=el("goal-edit-controls");
  txt.contentEditable="true";
  txt.style.background="var(--s3)";
  txt.style.padding="8px 10px";
  txt.style.borderRadius="8px";
  txt.style.outline="1px solid rgba(196,154,28,.3)";
  txt.focus();
  controls.style.display="block";
}
async function rewordGoal(){
  const txt=el("goal-summary-text");
  txt.innerHTML=`${spn()} <span class="muted" style="font-size:13px">Rewording...</span>`;
  const prompt=`Rewrite this goal differently in ONE clear sentence (max 15 words). Be specific, fresh wording.\n\nOriginal context: "${S.ans.goal}"\nPrevious summary: "${S.ans.goalSummary}"\nReturn ONLY the new sentence.`;
  const result=await lil(prompt,40);
  if(result){
    S.ans.goalSummary=result;
    txt.textContent=result;
  } else {
    txt.textContent=S.ans.goalSummary;
  }
  txt.contentEditable="true";
}
function saveGoalEdit(){
  const txt=el("goal-summary-text");
  const controls=el("goal-edit-controls");
  S.ans.goalSummary=txt.textContent.trim();
  txt.contentEditable="false";
  txt.style.background="";
  txt.style.padding="";
  txt.style.outline="";
  controls.style.display="none";
}

/* Use goalSummary on dashboard instead of raw goal */
async function finishOB(){
  goTo("duration");
}

async function _prepareCommitScreen(){
  const dur=S.ans.duration||15;
  const ct=el("cl-text");
  ct.innerHTML=`<div class="row" style="gap:10px">${spn()}<span class="muted" style="font-size:13px">Lil is drafting your commitment...</span></div>`;
  const commitPrompt = `Write a 3-sentence personal commitment letter in first person. CRITICAL RULES: 1) Start with "I, ${S.ans.name}," 2) Be specific to their exact goal and proof format 3) Mention the ${dur}-day duration explicitly 4) Acknowledge their stated threat without being soft about it 5) Serious tone, no fluff, no generic phrases. Return only the letter.\n\nName: ${S.ans.name}\nGoal: "${S.ans.goal}"\nDaily proof: "${S.ans.proof||""}"\nDuration: ${dur} days\nBiggest threat to quitting: "${S.ans.threat||""}"`;
  const txt=await lil(commitPrompt,150);
  ct.textContent=txt||FB.commit(S.ans.name,S.ans.goal,S.ans.proof,S.ans.threat);
  const si=el("sig");
  si.value="";
  si.placeholder=`Type "${S.ans.name}" to confirm`;
  el("commit-sub").textContent=`You're in. Now make it official. Sign your commitment for the next ${dur} days.`;
  el("commit-btn").textContent=`I Commit. Let's Go →`;
  el("commit-btn").disabled=true;
  si.oninput=()=>{ el("commit-btn").disabled=!si.value.trim(); };
}

function doCommit(){
  const sig=el("sig").value.trim(); if(!sig)return;
  if(S.user){S.user.sig=sig;S.user.answers.sig=sig;}
  S.ans.sig=sig;
  saveState();
  if(typeof syncToSupabase==="function") syncToSupabase();
  goTo("photo");
}


/* ── PROOF TYPE PICKER ── */
let selectedProofTypes=[];
function toggleProofPick(pid){
  const idx=selectedProofTypes.indexOf(pid);
  if(idx>-1) selectedProofTypes.splice(idx,1);
  else selectedProofTypes.push(pid);
  document.querySelectorAll(".proof-pick-opt").forEach(o=>{
    const active=selectedProofTypes.includes(o.dataset.pid);
    o.style.borderColor=active?"#c49a1c":"var(--bd)";
    o.style.background=active?"rgba(196,154,28,.08)":"var(--s2)";
  });
  const btn=el("proof-next-btn");
  if(btn) btn.disabled=selectedProofTypes.length===0;
}
async function advProofPick(){
  if(selectedProofTypes.length===0)return;
  const labels={photo:"Photos",link:"Links",note:"Notes",voice:"Voice notes"};
  const extra=el("ob-ta")?.value?.trim()||"";
  const proofDesc=selectedProofTypes.map(p=>labels[p]).join(", ")+(extra?". "+extra:"");
  S.ans.proof=proofDesc;
  S.ans.proofMethods=selectedProofTypes;
  selectedProofTypes=[];
  if(S.stepIdx<totalSteps()-1){S.stepIdx++;renderOB();}
  else await detectPT();
}

async function adaptProofDescriptions(goal){
  try{
    const prompt=`Given this goal: "${goal}", generate 4 short example descriptions (max 6 words each) for these proof types. Return ONLY a JSON object like {"photo":"...","link":"...","note":"...","voice":"..."} - no markdown, no backticks, no extra text.`;
    const result=await lil(prompt,80);
    if(!result)return;
    const clean=result.replace(/```json|```/g,"").trim();
    const parsed=JSON.parse(clean);
    if(parsed.photo){const e=el("pd-photo");if(e)e.textContent=parsed.photo;}
    if(parsed.link){const e=el("pd-link");if(e)e.textContent=parsed.link;}
    if(parsed.note){const e=el("pd-note");if(e)e.textContent=parsed.note;}
    if(parsed.voice){const e=el("pd-voice");if(e)e.textContent=parsed.voice;}
  }catch(e){/* Silent fail — defaults stay */}
}

