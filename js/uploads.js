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

/* Thumbnail HTML builder */
function thumbHtml(url,fileName){
  if(isImageUrl(url)){
    return `<div style="margin-top:8px;cursor:pointer;display:inline-block" onclick="event.stopPropagation();openLightbox('${url.replace(/'/g,"\\'")}')">`
      +`<img src="${url}" loading="lazy" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #2a2a2a;display:block" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />`
      +`<div style="display:none;width:80px;height:80px;border-radius:8px;background:#1a1a1a;border:1px solid #2a2a2a;align-items:center;justify-content:center;font-size:11px;color:#666;text-align:center;padding:4px">📎 Image unavailable</div>`
      +`</div>`;
  }
  /* Non-image file — show file icon */
  const name=fileName||url.split("/").pop()||"File";
  return `<a href="${url}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:#4dc98a;text-decoration:none;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:8px 12px">📎 <span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span></a>`;
}

function openMod(){
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

  html+=`<p style="font-size:12px;font-weight:700;color:#5a5a5a;letter-spacing:.06em;margin-bottom:10px">ADD YOUR EVIDENCE</p>`;

  /* Build slides based on selected proof methods */
  const slides=[
    {id:"note",icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,label:"Note",
     content:`<textarea id="mod-note" rows="4" placeholder="What did you work on? Be specific." style="font-size:14px;width:100%"></textarea>`},
    {id:"photo",icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,label:"Photo / Screenshot",
     content:`<div class="fd" id="fd" onclick="el('mod-file-input').click()" style="padding:24px;justify-content:center;flex-direction:column;gap:6px;text-align:center;border-radius:10px;min-height:80px"><span style="font-size:28px;opacity:.6">📸</span><span style="font-size:13px;color:#888">Tap to upload</span></div><input type="file" id="mod-file-input" accept="image/*" style="display:none" onchange="handleProofFile(this)"><div id="mod-file-preview" style="display:none;margin-top:8px;border-radius:8px;overflow:hidden;max-height:140px"><img id="mod-file-thumb" style="width:100%;object-fit:cover;display:none"></div>`},
    {id:"link",icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`,label:"Link",
     content:`<input id="mod-link" type="url" placeholder="https://..." style="font-size:14px;margin-bottom:6px"><p class="muted" style="font-size:10px">Paste a link to your work</p>`},
    {id:"voice",icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c49a1c" stroke-width="1.5"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>`,label:"Voice Note",
     content:`<div id="vr-container"></div>`}
  ];
  
  /* Filter to only methods user selected (always include note) */
  const activeSlides=slides.filter(s=>s.id==="note"||methods.includes(s.id));

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

function switchEvTab(){}
function allTabIds(){return [];}

function closeMod(){ el("mod").classList.remove("show"); }

function setBehavior(val){
  S.behaviorAnswer=val;
  el("mod-yes").style.borderColor=val==="yes"?"#4dc98a":"#222";
  el("mod-yes").style.color=val==="yes"?"#4dc98a":"#ebebeb";
  el("mod-no").style.borderColor=val==="no"?"#d9503a":"#222";
  el("mod-no").style.color=val==="no"?"#d9503a":"#ebebeb";
}

function handleProofFile(input){
  if(!input.files||!input.files[0]){S.fileOn=false;S.fileName=null;S.pendingFile=null;return;}
  const file=input.files[0];
  S.fileOn=true; S.fileName=file.name; S.pendingFile=file;
  const fdEl=el("fd"); if(fdEl){fdEl.className="fd on";fdEl.innerHTML=`<span style="font-size:28px">✓</span><span style="font-size:13px;color:#4dc98a">${file.name}</span>`;}
  if(file.type.startsWith("image/")){
    const reader=new FileReader();
    reader.onload=e=>{el("mod-file-thumb").src=e.target.result;el("mod-file-thumb").style.display="block";el("mod-file-preview").style.display="block";};
    reader.readAsDataURL(file);
  }
}

async function subUp(){
  const pt=S.user?.answers?.proofType||"output";
  const note=el("mod-note")?.value?.trim()||"";
  const link=el("mod-link")?.value?.trim()||"";
  
  /* Validate — need at least one form of evidence */
  if(pt==="behavior"&&!S.behaviorAnswer)return;
  if(!note&&!S.fileOn&&!S.voiceBlob&&!link)return;

  const btn=el("mod-sub"); btn.textContent="Uploading..."; btn.disabled=true;

  /* Upload file to Supabase Storage */
  let fileUrl=null;
  if(S.pendingFile&&S.user?.supabaseId){
    const ext=(S.pendingFile.name.split(".").pop()||"bin").toLowerCase();
    const path=`${S.user.supabaseId}/day${S.day}-${Date.now()}.${ext}`;
    fileUrl=await uploadToStorage("uploads",path,S.pendingFile,S.pendingFile.type);
  }

  /* Upload voice proof to Supabase Storage */
  let voiceUrl=null;
  if(S.voiceBlob&&S.user?.supabaseId){
    const path=`${S.user.supabaseId}/day${S.day}-voice-${Date.now()}.webm`;
    voiceUrl=await uploadToStorage("uploads",path,S.voiceBlob,"audio/webm");
  }

  /* Build the upload record */
  let summary=note;
  if(pt==="behavior") summary=`${S.behaviorAnswer==="yes"?"Did it":"Did not do it"}${note?". "+note:""}`;
  if(link) summary=(summary?summary+". ":"")+`Link: ${link}`;

  const ackPrompt=`ONE sentence, max 12 words. Reference what they actually wrote. Not praise.\n\nThey wrote: "${summary||"[file/voice only]"}"\nGoal: "${S.user.answers.goal}"`;
  const ack=await lil(ackPrompt,50);
  S.uploads[S.day-1]={note:summary,hasFile:S.fileOn,fileName:S.fileName||null,fileUrl,proofType:pt,link:link||null,behavior:S.behaviorAnswer,hasVoice:!!S.voiceBlob,voiceUrl};
  saveState();
  el("ack-day").textContent=S.day;
  el("ack-t").textContent=ack||FB.ack(summary,S.day);
  el("mod-form").style.display="none"; el("mod-ack").style.display="";
  /* Show next upload window */
  const dur=getDur();
  if(S.day<dur){
    el("ack-next").textContent=`Day ${S.day+1} opens at midnight. Come back and prove it again.`;
  } else {
    el("ack-next").textContent="";
  }
  playUploadSound();
  syncUploadToSupabase(S.day,S.uploads[S.day-1]);
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
  let html=`<div class="view-upload-card">`;
  if(upload.note) html+=`<p style="font-size:14px;line-height:1.6;margin-bottom:6px">${upload.note}</p>`;
  if(upload.hasFile) html+=`<p class="muted" style="font-size:12px">📎 ${upload.fileName||"File attached"}</p>`;
  if(upload.hasVoice) html+=`<p class="muted" style="font-size:12px;margin-top:4px">🎙 Voice note recorded</p>`;
  if(upload.proofType) html+=`<span class="tag mt6" style="display:inline-block;margin-top:6px">${PT[upload.proofType]||"Proof"}</span>`;
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
function deleteTodayUpload(){
  if(!confirm("Delete today's upload? You can re-upload before midnight."))return;
  S.uploads[S.day-1]=null;
  saveState();
  S.lilDone=false;
  closeViewMod();
  renderDash();
}


/* ── UPLOAD DETAIL SLIDE-OVER ───────────────────────────── */
function openUploadDetail(uid, dayIndex){
  const u=getAM().find(x=>x.id===uid);
  if(!u)return;
  const d=dayIndex+1;
  const note=u.notes[dayIndex];
  const voiceUrl=u.voiceUrls&&u.voiceUrls[dayIndex];
  const fileUrl=u.fileUrls&&u.fileUrls[dayIndex];
  const link=u.links&&u.links[dayIndex];
  const fileName=u.fileNames&&u.fileNames[dayIndex];
  const behavior=u.behaviors&&u.behaviors[dayIndex];
  const isRv=u.rv&&u.rv[dayIndex];
  const energy=u.energyLog&&u.energyLog[d];

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
        <p style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#5a5a5a">${u.name.toUpperCase()} · DAY ${d}</p>
        <p style="font-size:13px;color:#888;margin-top:2px">${u.goal}</p>
      </div>
      <span style="font-size:11px;padding:4px 10px;border-radius:100px;background:${isRv?"rgba(196,154,28,.12)":"rgba(77,201,138,.12)"};color:${isRv?"#c49a1c":"#4dc98a"};font-weight:700">${isRv?"Reviewed":"Pending"}</span>
    </div>
    ${behavior?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">BEHAVIOR</span><p style="margin-top:4px;font-size:14px;font-weight:700;color:${behavior==="yes"?"#4dc98a":"#d9503a"}">${behavior==="yes"?"✓ Did it":"✗ Did not do it"}</p></div>`:""}
    ${note&&note!=="—"?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">NOTE</span><p style="margin-top:4px;font-size:13px;line-height:1.7;color:#e0e0e0">${note}</p></div>`:""}
    ${link?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">LINK</span><a href="${link}" target="_blank" style="display:block;margin-top:4px;font-size:13px;color:#4dc98a;word-break:break-all">${link}</a></div>`:""}
    ${fileUrl?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">FILE</span>${thumbHtml(fileUrl,fileName)}</div>`:fileName?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">FILE</span><p style="margin-top:4px;font-size:13px;color:#ccc">📎 ${fileName}</p></div>`:""}
    ${voiceUrl?`<div style="margin-bottom:14px"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#5a5a5a">VOICE NOTE</span><audio controls src="${voiceUrl}" style="width:100%;margin-top:8px;border-radius:8px"></audio></div>`:""}
    ${energyHtml}
    <div style="border-top:1px solid #1f1f1f;padding-top:16px;margin-top:4px;display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="togRv('${uid}',${dayIndex});closeUploadDetail()" style="padding:8px 16px;border-radius:100px;background:${isRv?"rgba(196,154,28,.1)":"#1b1b1b"};border:1px solid ${isRv?"rgba(196,154,28,.3)":"#333"};color:${isRv?"#c49a1c":"#888"};font-size:12px;font-weight:700;cursor:pointer">${isRv?"✓ Unmark Reviewed":"Mark Reviewed"}</button>
      <button onclick="closeUploadDetail();setTimeout(()=>openProfilePanel('${uid}'),150)" style="padding:8px 16px;border-radius:100px;background:rgba(196,154,28,.08);border:1px solid rgba(196,154,28,.2);color:#c49a1c;font-size:12px;font-weight:700;cursor:pointer">Message ${u.name} →</button>
    </div>
  `;
  panel.style.transform="translateX(0)";
  document.getElementById("upload-detail-backdrop").style.display="block";
}

function closeUploadDetail(){
  document.getElementById("upload-detail-panel").style.transform="translateX(100%)";
  document.getElementById("upload-detail-backdrop").style.display="none";
}
