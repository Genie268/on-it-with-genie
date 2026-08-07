/* Custom voice-note player.
   The native <audio controls> renders as a sterile white pill on most
   browsers, which clashes with the matte/gold theme. This builds a
   dark-themed pill: gold play/pause, slim gold progress, tabular time
   stamp. Multiple players on the same screen auto-pause each other when
   one starts. Wire it up by calling _vpAttachAll() once the markup is
   in the DOM. */
let _vpIdCounter=0;
function buildVoicePlayer(url){
  if(!url)return "";
  const id="vp"+(++_vpIdCounter)+"-"+Date.now().toString(36);
  const safeUrl=String(url).replace(/"/g,"&quot;");
  return `<div class="vp-shell" data-vp-id="${id}">
    <audio id="${id}-aud" src="${safeUrl}" preload="metadata" style="display:none"></audio>
    <button class="vp-btn" onclick="_vpToggle('${id}')" aria-label="Play voice note" type="button">
      <svg class="vp-icon-play" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>
      <svg class="vp-icon-pause" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="display:none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
    </button>
    <div class="vp-wave">
      <div class="vp-track" onclick="_vpSeek('${id}',event)">
        <div class="vp-fill" id="${id}-fill"></div>
        <div class="vp-knob" id="${id}-knob"></div>
      </div>
    </div>
    <span class="vp-time" id="${id}-time">0:00</span>
  </div>`;
}

function _vpFmt(s){
  s=Math.max(0,Math.floor(s||0));
  const m=Math.floor(s/60),r=s%60;
  return m+":"+(r<10?"0":"")+r;
}

function _vpUpdateBtn(id,playing){
  const shell=document.querySelector('.vp-shell[data-vp-id="'+id+'"]');
  if(!shell)return;
  const play=shell.querySelector(".vp-icon-play");
  const pause=shell.querySelector(".vp-icon-pause");
  if(play) play.style.display=playing?"none":"block";
  if(pause) pause.style.display=playing?"block":"none";
  shell.classList.toggle("vp-playing",playing);
}

function _vpToggle(id){
  const a=document.getElementById(id+"-aud");
  if(!a)return;
  if(a.paused){
    document.querySelectorAll(".vp-shell audio").forEach(other=>{
      if(other!==a&&!other.paused){
        other.pause();
        const oid=other.id.replace(/-aud$/,"");
        _vpUpdateBtn(oid,false);
      }
    });
    a.play().catch(()=>{});
    _vpUpdateBtn(id,true);
  }else{
    a.pause();
    _vpUpdateBtn(id,false);
  }
}

function _vpSeek(id,event){
  const a=document.getElementById(id+"-aud");
  const track=event.currentTarget;
  if(!a||!track||!a.duration)return;
  const rect=track.getBoundingClientRect();
  const pct=Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width));
  a.currentTime=pct*a.duration;
  _vpRenderProgress(id);
}

function _vpRenderProgress(id){
  const a=document.getElementById(id+"-aud");
  const fill=document.getElementById(id+"-fill");
  const knob=document.getElementById(id+"-knob");
  const time=document.getElementById(id+"-time");
  if(!a)return;
  const dur=a.duration||0;
  const pct=dur?(a.currentTime/dur*100):0;
  if(fill) fill.style.width=pct+"%";
  if(knob) knob.style.left=pct+"%";
  if(time) time.textContent=_vpFmt(a.currentTime)+(dur?" / "+_vpFmt(dur):"");
}

function _vpAttachAll(root){
  const scope=root||document;
  scope.querySelectorAll(".vp-shell").forEach(shell=>{
    const id=shell.getAttribute("data-vp-id");
    const a=document.getElementById(id+"-aud");
    if(!a||a._vpWired)return;
    a._vpWired=true;
    a.addEventListener("timeupdate",()=>_vpRenderProgress(id));
    a.addEventListener("loadedmetadata",()=>_vpRenderProgress(id));
    a.addEventListener("ended",()=>{_vpUpdateBtn(id,false);_vpRenderProgress(id);});
    if(a.readyState>=1) _vpRenderProgress(id);
  });
}

/* ── UPLOAD MODAL ── */

/* Image detection helper */
function isImageUrl(url){
  if(!url)return false;
  return /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url)||url.includes("image");
}

/* Lightbox for full-size image viewing */
function openLightbox(src){
  const ov=document.createElement("div");
  ov.id="img-lightbox";
  ov.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;cursor:pointer;animation:fadeIn .15s ease";
  ov.onclick=()=>ov.remove();
  const img=document.createElement("img");
  img.src=src;
  img.style.cssText="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.5)";
  img.loading="lazy";
  img.onerror=()=>{ov.innerHTML=`<div style="color:#888;font-size:14px;text-align:center">Could not load image</div>`;};
  ov.appendChild(img);
  document.body.appendChild(ov);
}

/* Thumbnail HTML builder — tries image first for Supabase URLs (which may
   lack extensions), falls back to paperclip if the image fails to load. */
function thumbHtml(url,fileName){
  if(!url){
    if(!fileName)return "";
    return `<p style="margin-top:6px;font-size:11px;color:#888"><span style="opacity:.55">📎</span> ${(fileName||"").replace(/</g,"&lt;")}</p>`;
  }
  const safeUrl=url.replace(/'/g,"\\'");
  const rawName=fileName||url.split("/").pop()||"File";
  const escName=rawName.replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const shortName=escName.length>16?escName.slice(0,14)+"...":escName;
  /* Always try image rendering first. Supabase storage URLs often have no
     recognisable file extension, so extension-based detection misses them.
     The onerror handler swaps to a file-link fallback if it isn't an image. */
  return `<div style="margin-top:8px;display:inline-block;position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid #2a2a2a;background:#0e0e0e;cursor:pointer" onclick="event.stopPropagation();openLightbox('${safeUrl}')" title="${escName}">
    <img src="${url}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='flex'">
    <div style="display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:6px;font-size:10px;color:#888;line-height:1.3"><span style="font-size:18px;opacity:.55">📎</span><span style="margin-top:3px">${shortName}</span></div>
  </div>`;
}

function openMod(){
  /* Miss handling sits in front of the upload. While a gate or lock is open,
     the upload modal must not open. The gate's Continue button clears the
     block and calls openMod() itself. A closed (completed/ended) round has
     nothing to upload either. */
  if(S.uploadBlocked) return;
  if(typeof isRoundClosed==="function" && isRoundClosed()) return;
  S.fileOn=false; S.fileName=null; S.behaviorAnswer=null; S.voiceBlob=null;
  el("mod-form").style.display=""; el("mod-ack").style.display="none";
  el("mod-dl").textContent=`DAY ${S.day} UPLOAD`;
  const pt=S.user?.answers?.proofType||"output";
  const methods=S.user?.answers?.proofMethods||["photo","note"];
  el("mod-pt").textContent=`${PT[pt]||"Daily proof"}`;

  let html="";
  
  /* Behavior check */
  if(pt==="behavior"){
    html+=`<p style="font-size:14px;font-weight:700;margin-bottom:8px">Did you do it today?</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      <button id="mod-yes" class="yn-btn" style="padding:14px;font-size:14px" onclick="setBehavior('yes')">Yes</button>
      <button id="mod-no" class="yn-btn" style="padding:14px;font-size:14px" onclick="setBehavior('no')">Not today</button>
    </div>
    <div style="height:1px;background:#222;margin-bottom:14px"></div>`;
  }

  /* Show today's plan context if it exists */
  const _plan=typeof _todayPlan==="function"?_todayPlan():null;
  if(_plan&&_plan.mainStep&&!_plan.skipped){
    const _pd=(_plan.subSteps||[]).filter(s=>s.done).length;
    const _pt=(_plan.subSteps||[]).length;
    html+=`<div style="padding:10px 12px;margin-bottom:14px;background:rgba(196,154,28,.04);border:1px solid rgba(196,154,28,.1);border-radius:8px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:10px;font-weight:700;color:#5a5a5a;letter-spacing:.06em">TODAY'S PLAN</span><span style="font-size:10px;color:${_pd===_pt?"#4dc98a":"#888"}">${_pd}/${_pt} done</span></div>
      <p style="font-size:11px;color:#999;margin-bottom:4px">${(_plan.mainStep||"").replace(/</g,"&lt;")}</p>
      ${_plan.subSteps.map(s=>`<span style="font-size:11px;color:${s.done?"#4dc98a":"#666"};margin-right:8px">${s.done?"✓":"○"} ${(s.text||"").replace(/</g,"&lt;")}</span>`).join("")}
    </div>`;
  }

  html+=`<p style="font-size:12px;font-weight:700;color:#5a5a5a;letter-spacing:.06em;margin-bottom:10px">ADD YOUR EVIDENCE</p>`;

  /* Build slides based on selected proof methods */
  const slides=[
    {id:"note",icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,label:"Note",
     content:`<textarea id="mod-note" rows="4" placeholder="What did you work on? Be specific." style="font-size:14px;width:100%"></textarea>`},
    {id:"photo",icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,label:"Photo / Screenshot",
     content:`<div class="fd" id="fd" onclick="el('mod-file-input').click()" style="padding:24px;justify-content:center;flex-direction:column;gap:8px;text-align:center;border-radius:10px;min-height:80px"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.7"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span style="font-size:13px;color:#888">Tap to upload</span></div><input type="file" id="mod-file-input" accept="image/*" style="display:none" onchange="handleProofFile(this)"><div id="mod-file-preview" style="display:none;margin-top:8px;border-radius:8px;overflow:hidden;max-height:140px"><img id="mod-file-thumb" style="width:100%;object-fit:cover;display:none"></div>`},
    {id:"link",icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`,label:"Link",
     content:`<input id="mod-link" type="url" placeholder="https://..." style="font-size:14px;margin-bottom:6px"><p class="muted" style="font-size:10px">Paste a link to your work</p>`},
    {id:"voice",icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>`,label:"Voice Note",
     content:`<div id="vr-container"></div>`}
  ];
  
  const activeSlides=slides;

  html+=`<div class="ev-carousel" id="ev-carousel">
    <div class="ev-track" id="ev-track">
      ${activeSlides.map(s=>`<div class="ev-slide">
        <div class="ev-slide-inner">
          <div style="margin-bottom:4px">${s.icon}</div>
          <p style="font-size:14px;font-weight:700">${s.label}</p>
          <div style="width:100%;text-align:left;margin-top:6px">${s.content}</div>
        </div>
      </div>`).join("")}
    </div>
  </div>
  <div class="ev-dots" id="ev-dots">
    ${activeSlides.map((_,i)=>`<div class="ev-dot${i===0?' active':''}" onclick="goToSlide(${i})"></div>`).join("")}
  </div>`;

  html+=`<button id="mod-sub" class="bp" style="width:100%;font-size:15px;padding:13px;margin-top:14px" onclick="subUp()">Submit Proof ↑</button>`;

  el("mod-form").innerHTML=html;
  S._slideCount=activeSlides.length;
  S._slideIdx=0;
  initSwipe();
  /* Init voice recorder if voice slide exists */
  if(activeSlides.some(s=>s.id==="voice")) setTimeout(()=>initVoiceRecorder("vr-container"),100);
  el("mod").classList.add("show");
}

/* ── SWIPE LOGIC ── */
let swipeStartX=0, swipeCurrentX=0, swiping=false;
function initSwipe(){
  const carousel=el("ev-carousel");
  if(!carousel)return;
  carousel.addEventListener("touchstart",e=>{swipeStartX=e.touches[0].clientX;swipeCurrentX=swipeStartX;swiping=true;},{passive:true});
  carousel.addEventListener("touchmove",e=>{if(!swiping)return;swipeCurrentX=e.touches[0].clientX;
    const diff=swipeCurrentX-swipeStartX;
    const pxPerSlide=carousel.offsetWidth;
    const offset=-(S._slideIdx*pxPerSlide)+diff;
    const track=el("ev-track");
    track.style.transition="none";
    track.style.transform=`translateX(${offset}px)`;
  },{passive:true});
  carousel.addEventListener("touchend",()=>{
    if(!swiping)return;swiping=false;
    const diff=swipeCurrentX-swipeStartX;
    if(diff<-40&&S._slideIdx<S._slideCount-1) S._slideIdx++;
    else if(diff>40&&S._slideIdx>0) S._slideIdx--;
    goToSlide(S._slideIdx);
  });
}
function goToSlide(idx){
  S._slideIdx=idx;
  const carousel=el("ev-carousel");
  const track=el("ev-track");
  if(!carousel||!track)return;
  const pxPerSlide=carousel.offsetWidth;
  track.style.transition="transform .3s ease";
  track.style.transform=`translateX(-${idx*pxPerSlide}px)`;
  document.querySelectorAll(".ev-dot").forEach((d,i)=>d.className="ev-dot"+(i===idx?" active":""));
  /* Init voice recorder when swiping to voice slide */
  if(idx>=0){
    setTimeout(()=>{
      const vc=document.getElementById("vr-container");
      if(vc&&vc.offsetParent!==null&&!vc.hasChildNodes()) initVoiceRecorder("vr-container");
    },350);
  }
}

function closeMod(){ el("mod").classList.remove("show"); }

function setBehavior(val){
  S.behaviorAnswer=val;
  el("mod-yes").style.borderColor=val==="yes"?"#4dc98a":"#222";
  el("mod-yes").style.color=val==="yes"?"#4dc98a":"#ebebeb";
  el("mod-no").style.borderColor=val==="no"?"#d9503a":"#222";
  el("mod-no").style.color=val==="no"?"#d9503a":"#ebebeb";
}

/* Compress a picked image down to a max-1600px JPEG before it ever touches
   network. Raw phone photos routinely exceed 8-15 MB which silently fails
   against the 20 MB storage cap; this keeps every proof image well under
   1 MB without losing detail. Non-images pass through unchanged. */
function _compressProofImage(file,maxDim,quality){
  maxDim=maxDim||1600; quality=quality||0.85;
  return new Promise((resolve,reject)=>{
    if(!file||!file.type||!file.type.startsWith("image/")){
      resolve({blob:file,dataUrl:null,compressed:false});return;
    }
    const reader=new FileReader();
    reader.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        if(Math.max(img.width,img.height)<=maxDim && file.size<1.5*1024*1024){
          resolve({blob:file,dataUrl:ev.target.result,compressed:false});return;
        }
        const scale=Math.min(1,maxDim/Math.max(img.width,img.height));
        const w=Math.max(1,Math.round(img.width*scale));
        const h=Math.max(1,Math.round(img.height*scale));
        const canvas=document.createElement("canvas");
        canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext("2d");
        ctx.drawImage(img,0,0,w,h);
        canvas.toBlob(blob=>{
          if(!blob){reject(new Error("compress failed"));return;}
          const stem=(file.name||"upload").replace(/\.[^.]+$/,"");
          let out;
          try{out=new File([blob],stem+".jpg",{type:"image/jpeg"});}
          catch(e){out=blob; out.name=stem+".jpg";}
          resolve({blob:out,dataUrl:canvas.toDataURL("image/jpeg",quality),compressed:true});
        },"image/jpeg",quality);
      };
      img.onerror=reject;
      img.src=ev.target.result;
    };
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

async function handleProofFile(input){
  if(!input.files||!input.files[0]){S.fileOn=false;S.fileName=null;S.pendingFile=null;return;}
  const file=input.files[0];
  const fdEl=el("fd");
  if(fdEl){fdEl.className="fd";fdEl.innerHTML=`<div class="spinner" style="margin-right:8px"></div><span style="font-size:13px;color:#888">Processing...</span>`;}
  try{
    const {blob,dataUrl}=await _compressProofImage(file);
    S.fileOn=true;
    S.fileName=blob.name||file.name;
    S.pendingFile=blob;
    if(fdEl){
      fdEl.className="fd on";
      fdEl.innerHTML=`<span style="font-size:28px">✓</span><span style="font-size:13px;color:#4dc98a;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${S.fileName}</span>`;
    }
    if(dataUrl){
      const thumb=el("mod-file-thumb");
      const preview=el("mod-file-preview");
      if(thumb){thumb.src=dataUrl;thumb.style.display="block";}
      if(preview)preview.style.display="block";
    }
  }catch(e){
    console.error("Proof image processing failed:",e);
    S.fileOn=true;S.fileName=file.name;S.pendingFile=file;
    if(fdEl){fdEl.className="fd on";fdEl.innerHTML=`<span style="font-size:28px">✓</span><span style="font-size:13px;color:#4dc98a">${file.name}</span>`;}
  }
}

async function subUp(){
  const pt=S.user?.answers?.proofType||"output";
  const note=el("mod-note")?.value?.trim()||"";
  const link=el("mod-link")?.value?.trim()||"";
  
  /* Validate */
  if(pt==="behavior"&&!S.behaviorAnswer)return;
  if(!note&&!S.fileOn&&!S.voiceBlob&&!link)return;

  const btn=el("mod-sub"); btn.textContent="Uploading..."; btn.disabled=true;

  /* Upload file to Supabase Storage */
  let fileUrl=null;
  if(S.pendingFile&&S.user?.supabaseId){
    const ext=(S.pendingFile.name.split(".").pop()||"bin").toLowerCase();
    const path=`${S.user.supabaseId}/day${S.day}-${Date.now()}.${ext}`;
    const ctype=S.pendingFile.type||"image/jpeg";
    fileUrl=await uploadToStorage("uploads",path,S.pendingFile,ctype);
  }

  /* Upload voice proof to Supabase Storage */
  let voiceUrl=null;
  if(S.voiceBlob&&S.user?.supabaseId){
    if(S.voiceBlob.size<100){
      console.warn("Voice blob too small:",S.voiceBlob.size,"bytes");
      showToast("Voice note was empty, try recording again","error");
    } else {
      const vMime=S.voiceMime||S.voiceBlob.type||"audio/webm";
      const vExt=vMime.includes("mp4")?"mp4":vMime.includes("ogg")?"ogg":"webm";
      const path=`${S.user.supabaseId}/day${S.day}-voice-${Date.now()}.${vExt}`;
      voiceUrl=await uploadToStorage("uploads",path,S.voiceBlob,vMime);
      if(!voiceUrl) showToast("Voice upload failed. Proof saved without audio","error");
    }
  }

  /* Build the upload record */
  let summary=note;
  if(pt==="behavior") summary=`${S.behaviorAnswer==="yes"?"Did it":"Did not do it"}${note?". "+note:""}`;
  if(link) summary=(summary?summary+". ":"")+`Link: ${link}`;

  const ackPrompt=`ONE sentence, max 12 words. Reference what they actually wrote. Not praise.\n\nThey wrote: "${summary||"[file/voice only]"}"\nGoal: "${S.user.answers.goal}"`;
  const ack=await lil(ackPrompt,50);
  S.uploads[S.day-1]={note:summary,hasFile:S.fileOn,fileName:S.fileName||null,fileUrl,proofType:pt,link:link||null,behavior:S.behaviorAnswer,hasVoice:!!S.voiceBlob,voiceUrl,time:new Date().toISOString()};
  saveState();

  /* Compute new streak */
  let newStreak=0;
  for(let i=S.day-1;i>=0;i--){if(S.uploads[i])newStreak++;else break;}

  /* Streak pill */
  const ackIcon=el("mod-ack-icon");
  if(ackIcon&&!el("ack-streak-pill")){
    const pill=document.createElement("div");
    pill.id="ack-streak-pill";
    pill.style.cssText="margin:0 auto 14px;padding:8px 18px;background:rgba(196,154,28,.08);border:1px solid rgba(196,154,28,.25);border-radius:100px;display:inline-flex;align-items:center;gap:6px;animation:popIn .4s ease .15s backwards";
    ackIcon.insertAdjacentElement("afterend",pill);
  }
  const pillEl=el("ack-streak-pill");
  if(pillEl){
    pillEl.innerHTML=`<span style="font-size:15px">🔥</span><span style="font-weight:800;color:#c49a1c;font-size:13px">${newStreak} day streak</span>`;
  }

  el("ack-day").textContent=S.day;
  el("ack-t").textContent=ack||FB.ack(summary,S.day);
  el("mod-form").style.display="none"; el("mod-ack").style.display="";
  const dur=getDur();
  if(S.day<dur){
    el("ack-next").textContent=`Day ${S.day+1} opens at midnight. Come back and prove it again.`;
  } else {
    el("ack-next").textContent="";
  }
  playUploadSound();
  try{ if(navigator.vibrate) navigator.vibrate([60,40,60]); }catch(e){}

  /* Milestone confetti */
  const mid=Math.ceil(dur/2);
  const isMilestone=S.day===1||S.day===mid||S.day===dur-2||S.day===dur;
  if(isMilestone&&typeof fireConfetti==="function") setTimeout(fireConfetti,200);

  syncUploadToSupabase(S.day,S.uploads[S.day-1]);
  showToast("Day "+S.day+" proof submitted","success");
  trackEvent("upload_submitted",{day:S.day,has_file:!!S.uploads[S.day-1]?.fileUrl,has_note:!!S.uploads[S.day-1]?.note,has_voice:!!S.uploads[S.day-1]?.voiceUrl});
  S.lilDone=false; renderDash();
  if(S.day===dur)setTimeout(()=>{closeMod();goTo("d15");},1200);
}


/* ── VIEW PAST UPLOAD ── */
function openViewMod(dayIdx){
  const upload=S.uploads[dayIdx];
  if(!upload)return;
  const day=dayIdx+1;
  const isToday=day===S.day;
  el("view-mod-dl").textContent=`DAY ${day}`;
  const viewTimeStr=upload.time?new Date(upload.time).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}):"";
  let html=`<div class="view-upload-card">`;
  if(viewTimeStr) html+=`<p style="font-size:10px;color:#555;margin-bottom:12px">Uploaded ${viewTimeStr}</p>`;
  if(upload.behavior){
    html+=`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">BEHAVIOR</span><p style="margin-top:4px;font-size:14px;font-weight:700;color:${upload.behavior==="yes"?"#4dc98a":"#d9503a"}">${upload.behavior==="yes"?"✓ Did it":"✗ Did not do it"}</p></div>`;
  }
  if(upload.note){
    html+=`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">NOTE</span><p style="margin-top:4px;font-size:14px;line-height:1.7;color:#e0e0e0">${upload.note}</p></div>`;
  }
  if(upload.link){
    html+=`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">LINK</span><a href="${upload.link}" target="_blank" style="display:block;margin-top:4px;font-size:13px;color:#4dc98a;word-break:break-all">${upload.link}</a></div>`;
  }
  if(upload.fileUrl){
    html+=`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;display:block;margin-bottom:6px">FILE</span>${thumbHtml(upload.fileUrl,upload.fileName)}</div>`;
  }else if(upload.hasFile&&upload.fileName){
    html+=`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;display:block;margin-bottom:6px">FILE</span><p style="margin-top:4px;font-size:13px;color:#ccc">📎 ${upload.fileName}</p></div>`;
  }
  if(upload.voiceUrl){
    html+=`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;display:block;margin-bottom:6px">VOICE NOTE</span>${buildVoicePlayer(upload.voiceUrl)}</div>`;
  }else if(upload.hasVoice){
    html+=`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;display:block;margin-bottom:6px">VOICE NOTE</span><p style="margin-top:4px;font-size:12px;color:#888">🎙 Voice note recorded</p></div>`;
  }
  if(upload.proofType){
    html+=`<span class="tag mt6" style="display:inline-block;margin-top:6px">${PT[upload.proofType]||"Proof"}</span>`;
  }
  if(upload.reviewNote){
    html+=`<div style="margin-top:14px;padding:10px 12px;background:rgba(196,154,28,.06);border:1px solid rgba(196,154,28,.15);border-radius:8px"><span style="font-size:9px;font-weight:700;letter-spacing:.08em;color:#c49a1c">GENIE'S NOTE</span><p style="margin:4px 0 0;font-size:13px;line-height:1.6;color:#e0e0e0">${upload.reviewNote}</p></div>`;
  }
  html+=`</div>`;
  el("view-mod-body").innerHTML=html;
  if(isToday){
    el("view-mod-actions").innerHTML=`
      <div class="row" style="gap:8px">
        <button class="bs" style="flex:1;padding:10px;font-size:13px" onclick="editTodayUpload()">Edit Upload</button>
        <button style="flex:1;padding:10px;font-size:13px;background:transparent;border:1px solid rgba(217,80,58,.3);border-radius:9px;color:#d9503a;font-weight:600;cursor:pointer;font-family:inherit" onclick="deleteTodayUpload()">Delete</button>
      </div>`;
  }else{
    el("view-mod-actions").innerHTML=`<button class="bs" style="width:100%;padding:10px;font-size:13px" onclick="closeViewMod()">Close</button>`;
  }
  el("view-mod").classList.add("show");
  _vpAttachAll(el("view-mod-body"));
}
function closeViewMod(){el("view-mod").classList.remove("show");}
function editTodayUpload(){
  closeViewMod();
  S.uploads[S.day-1]=null;
  saveState();
  S.lilDone=false;
  renderDash();
  openMod();
}
async function deleteTodayUpload(){
  if(!confirm("Delete today's upload? You can re-upload before midnight."))return;
  const dayNum=S.day;
  S.uploads[S.day-1]=null;
  saveState();
  S.lilDone=false;
  closeViewMod();
  showToast("Upload deleted","info");
  renderDash();
  /* Also remove the server row — otherwise the next loadGoals() (which is
     server-authoritative) re-hydrates the deleted proof back into the grid. */
  try{
    if(sb&&S.user?.supabaseId){
      const gid=(typeof activeGoalRow==="function"&&activeGoalRow()?.id)||null;
      let q=sb.from("uploads").delete().eq("challenger_id",S.user.supabaseId).eq("day_number",dayNum);
      if(gid) q=q.eq("goal_id",gid);
      await q;
    }
  }catch(e){}
}


/* ── UPLOAD DETAIL SLIDE-OVER ───────────────────────────── */
function openUploadDetail(uid, dayIndex, goalId){
  const u=getAM().find(x=>x.id===uid);
  if(!u)return;
  const d=dayIndex+1;
  /* Read from the specific goal's arrays when given (multi-goal challengers),
     otherwise the top-level arrays (single goal / legacy). */
  const a=(typeof _adminGoalArrays==="function")?_adminGoalArrays(u,goalId):u;
  const gmeta=(typeof _adminGoalMeta==="function")?_adminGoalMeta(u,goalId):null;
  const _gidArg=(goalId&&goalId!=="_primary")?`,'${goalId}'`:"";
  /* Challenger-supplied text is rendered into the admin's DOM via innerHTML,
     so it MUST be escaped — otherwise a note like "<img onerror=…>" runs
     script in the admin's session (stored XSS). */
  const _esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const note=_esc(a.notes[dayIndex]);
  const voiceUrl=a.voiceUrls&&a.voiceUrls[dayIndex];
  const fileUrl=a.fileUrls&&a.fileUrls[dayIndex];
  const link=a.links&&a.links[dayIndex];
  const fileName=_esc(a.fileNames&&a.fileNames[dayIndex]);
  const behavior=a.behaviors&&a.behaviors[dayIndex];
  const isRv=a.rv&&a.rv[dayIndex];
  const reviewNote=_esc(a.reviewNotes&&a.reviewNotes[dayIndex]);
  const energy=u.energyLog&&u.energyLog[d];
  const upTime=a.uploadTimes&&a.uploadTimes[dayIndex];
  const upTimeStr=upTime?new Date(upTime).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}):"";

  let energyHtml="";
  if(energy&&energy.type!=="skip"){
    if(energy.type==="energy") energyHtml=`<div style="margin-bottom:12px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">ENERGY</span><p style="margin-top:4px;font-size:20px">${"🔥".repeat(energy.value)}</p></div>`;
    else if(energy.type==="mood") energyHtml=`<div style="margin-bottom:12px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">MOOD</span><p style="margin-top:4px;font-size:22px">${energy.value}</p></div>`;
    else if(energy.type==="reflection") energyHtml=`<div style="margin-bottom:12px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">REFLECTION</span><p style="margin-top:4px;font-size:13px;line-height:1.6;color:#ccc">${energy.value}</p></div>`;
  }

  const panel=document.getElementById("upload-detail-panel");
  document.getElementById("upload-detail-body").innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <p style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">${u.name.toUpperCase()} · DAY ${d}${gmeta&&u.isMultiGoal?` · <span style="color:${gmeta.slot===2?"#4dc98a":"#c49a1c"}">GOAL ${gmeta.slot}</span>`:""}</p>
        <p style="font-size:13px;color:#888;margin-top:2px">${gmeta?(gmeta.goalSummary||gmeta.goalRaw||u.goal):u.goal}</p>
        ${upTimeStr?`<p style="font-size:10px;color:#555;margin-top:3px">Uploaded ${upTimeStr}</p>`:""}
      </div>
      <span style="font-size:11px;padding:4px 10px;border-radius:100px;background:${isRv?"rgba(196,154,28,.12)":"rgba(77,201,138,.12)"};color:${isRv?"#c49a1c":"#4dc98a"};font-weight:700">${isRv?"Reviewed":"Pending"}</span>
    </div>
    ${behavior?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">BEHAVIOR</span><p style="margin-top:4px;font-size:14px;font-weight:700;color:${behavior==="yes"?"#4dc98a":"#d9503a"}">${behavior==="yes"?"✓ Did it":"✗ Did not do it"}</p></div>`:""}
    ${note&&note!=="-"?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">NOTE</span><p style="margin-top:4px;font-size:13px;line-height:1.7;color:#e0e0e0">${note}</p></div>`:""}
    ${link?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">LINK</span><a href="${link}" target="_blank" style="display:block;margin-top:4px;font-size:13px;color:#4dc98a;word-break:break-all">${link}</a></div>`:""}
    ${fileUrl?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;display:block;margin-bottom:6px">FILE</span>${thumbHtml(fileUrl,fileName)}</div>`:fileName?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;display:block;margin-bottom:6px">FILE</span><p style="margin-top:4px;font-size:13px;color:#ccc">📎 ${fileName}</p></div>`:""}
    ${voiceUrl?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a;display:block;margin-bottom:6px">VOICE NOTE</span>${buildVoicePlayer(voiceUrl)}</div>`:""}
    ${energyHtml}
    <div style="margin-top:14px;padding:12px;background:#0a0a0a;border:1px solid #1a1a1a;border-radius:8px">
      <span style="font-size:9px;font-weight:700;letter-spacing:.08em;color:#c49a1c">YOUR REVIEW NOTE</span>
      ${reviewNote?`<p style="margin:6px 0 8px;font-size:12px;line-height:1.6;color:#ccc">${reviewNote}</p>`:""}
      <textarea id="ud-review-note-${dayIndex}" rows="2" placeholder="${reviewNote?"Update your note...":"Add a review note..."}" style="font-size:12px;margin-top:6px;width:100%;box-sizing:border-box">${reviewNote||""}</textarea>
      <button onclick="_saveDetailReviewNote('${uid}',${dayIndex}${_gidArg})" class="bp" style="font-size:11px;padding:5px 12px;margin-top:6px">Save Note</button>
    </div>
    <div style="border-top:1px solid #1f1f1f;padding-top:16px;margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="togRv('${uid}',${dayIndex}${_gidArg});closeUploadDetail()" style="padding:8px 16px;border-radius:100px;background:${isRv?"rgba(196,154,28,.1)":"#1b1b1b"};border:1px solid ${isRv?"rgba(196,154,28,.3)":"#333"};color:${isRv?"#c49a1c":"#888"};font-size:12px;font-weight:700;cursor:pointer">${isRv?"✓ Unmark Reviewed":"Mark Reviewed"}</button>
      <button onclick="closeUploadDetail();setTimeout(()=>{_msgActiveChallengerId='${uid}';_msgChatOpen=true;adminTab('messages')},150)" style="padding:8px 16px;border-radius:100px;background:rgba(196,154,28,.08);border:1px solid rgba(196,154,28,.2);color:#c49a1c;font-size:12px;font-weight:700;cursor:pointer">Message ${u.name} →</button>
    </div>
  `;
  panel.style.transform="translateX(0)";
  document.getElementById("upload-detail-backdrop").style.display="block";
  _vpAttachAll(document.getElementById("upload-detail-body"));
}

async function _saveDetailReviewNote(uid,dayIndex,goalId){
  const ta=document.getElementById("ud-review-note-"+dayIndex);
  if(!ta||!ta.value.trim()){showToast("Type a note first","error");return;}
  ta.disabled=true;
  try{
    const dayNum=dayIndex+1;
    const params={challenger_id:uid,day_number:dayNum,note:ta.value.trim()};
    if(goalId&&goalId!=="_primary") params.goal_id=goalId;
    await adminFetch("save_review_note",params);
    adminFetch("send_push",{push_type:"personal",challenger_id:uid,title:"Genie reviewed your Day "+dayNum,body:ta.value.trim().slice(0,120)}).catch(()=>{});
    showToast("Review note saved & notified","success");
    adminDataLoaded=false;
    await loadAdminData();
  }catch(e){showToast("Failed to save: "+(e.message||""),"error");}
  ta.disabled=false;
}

function closeUploadDetail(){
  document.getElementById("upload-detail-panel").style.transform="translateX(100%)";
  document.getElementById("upload-detail-backdrop").style.display="none";
}
