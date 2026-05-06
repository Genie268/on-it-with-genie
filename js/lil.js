/* ── GROQ (via proxy, with temporary fallback) ── */
async function lil(prompt, maxTokens=300){
  const timeout=new Promise(resolve=>setTimeout(()=>resolve(null),10000));
  async function _call(){
    try {
      if(GROQ_PROXY_URL){
        try{
          const res=await fetch(GROQ_PROXY_URL,{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({prompt,maxTokens})
          });
          const data=await res.json();
          if(data?.content) return data.content;
          if(data?.error) console.warn("Proxy error:",data.error);
        }catch(proxyErr){console.warn("Proxy unreachable:",proxyErr);}
      }
      const _fk="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";
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {"Content-Type":"application/json","Authorization":`Bearer ${_fk}`},
        body: JSON.stringify({model:GROQ_MODEL,max_tokens:maxTokens,messages:[{role:"system",content:SYS},{role:"user",content:prompt}]})
      });
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() || null;
    } catch(e){ console.error("AI error:",e); return null; }
  }
  return Promise.race([_call(), timeout]);
}


/* ── CHAT INTERFACE ── */
async function renderChat(){
  const container=el("chat-container");
  if(!container||!S.user)return;
  
  /* Load messages from Supabase if available */
  let messages=[];
  if(sb&&S.user.supabaseId){
    try{
      const {data}=await sb.from("chat_messages").select("*").eq("challenger_id",S.user.supabaseId).order("created_at",{ascending:true});
      if(data)messages=data;
    }catch(e){}
  }
  /* Also include local genie messages not yet in chat */
  if(S.user.genieMessages){
    S.user.genieMessages.forEach(m=>{
      if(!m.inChat) messages.push({sender:"genie",message:m.text,created_at:m.date||new Date().toISOString()});
    });
  }
  messages.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));

  const unread=messages.filter(m=>m.sender==="genie"&&!m.read).length;
  /* Build lookup for reply_to */
  const msgMap={};messages.forEach(m=>{if(m.id)msgMap[m.id]=m;});
  let lastDateStr="";
  const bubbles=messages.map((m,i)=>{
    const isMe=m.sender==="challenger";
    const t=new Date(m.created_at);
    const timeStr=t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const dateStr=t.toLocaleDateString([],{month:"short",day:"numeric"});
    const aId=`uc-${i}-${t.getTime()}`;
    /* Date separator */
    let dateSep="";
    if(dateStr!==lastDateStr){
      lastDateStr=dateStr;
      const today=new Date().toLocaleDateString([],{month:"short",day:"numeric"});
      const yesterday=new Date(Date.now()-86400000).toLocaleDateString([],{month:"short",day:"numeric"});
      const label=dateStr===today?"Today":dateStr===yesterday?"Yesterday":dateStr;
      dateSep=`<div style="text-align:center;padding:8px 0 4px"><span style="font-size:10px;color:#444;background:#111;padding:2px 10px;border-radius:10px;font-weight:600">${label}</span></div>`;
    }
    /* Reply quote */
    let replyQuote="";
    if(m.reply_to_id&&msgMap[m.reply_to_id]){
      const orig=msgMap[m.reply_to_id];
      const origPreview=(orig.message||"").slice(0,50)+(orig.message&&orig.message.length>50?"…":"");
      replyQuote=`<div onclick="scrollToMsg('${m.reply_to_id}')" style="font-size:11px;color:${isMe?"rgba(0,0,0,.7)":"#999"};border-left:2px solid ${isMe?"rgba(0,0,0,.4)":"#555"};padding:3px 8px;margin-bottom:5px;cursor:pointer;border-radius:0 4px 4px 0;background:${isMe?"rgba(0,0,0,.12)":"rgba(255,255,255,.04)"}">${origPreview||"🎙 Voice note"}</div>`;
    }
    let body=replyQuote;
    if(m.message&&m.message.trim()) body+=`<p style="margin:0">${m.message}</p>`;
    if(m.voice_url) body+=buildAudioBubble(m.voice_url,aId);
    if(!body) return "";
    /* Read receipt for challenger's messages */
    const readCheck=isMe&&m.read_at?`<span style="color:rgba(0,0,0,.35);font-size:9px;margin-left:4px" title="Read">✓✓</span>`:(isMe?`<span style="color:rgba(0,0,0,.2);font-size:9px;margin-left:4px">✓</span>`:"");
    /* Reply + unsend buttons */
    const msgPreview=(m.message||"").replace(/'/g,"&#39;").slice(0,40);
    const replyBtn=m.id?` <span onclick="event.stopPropagation();chatSetReply('${m.id}','${msgPreview}')" style="cursor:pointer;color:${isMe?"rgba(0,0,0,.3)":"#444"};font-size:10px;margin-left:6px;padding:1px 4px;border-radius:3px" title="Reply">↩</span>`:"";
    const unsendBtn=isMe&&m.id?` <span onclick="event.stopPropagation();unsendChatMsg('${m.id}')" style="cursor:pointer;color:rgba(0,0,0,.2);font-size:10px;margin-left:2px;padding:1px 4px;border-radius:3px" title="Unsend">✕</span>`:"";
    return `${dateSep}<div id="msg-${m.id||i}" class="cmsg ${isMe?"cmsg-me":"cmsg-them"}">
      <div class="cmsg-body">${body}</div>
      <div class="cmsg-time">${isMe?"You":"Genie"} · ${timeStr}${readCheck}${replyBtn}${unsendBtn}</div>
    </div>`;
  }).join("");

  container.innerHTML=`<div class="chat-screen">
    <div class="chat-thread" id="chat-scroll">
      ${messages.length===0?`<p style="text-align:center;color:#3a3a3a;font-size:12px;padding:28px 0">No messages yet</p>`:bubbles}
    </div>
    <div class="chat-bar">
      <div class="chat-input-pill">
        <textarea id="chat-input" class="chat-ta" rows="1" placeholder="Message Genie..."></textarea>
        <button id="chat-mic-btn" class="chat-mic-btn" onclick="toggleChatRecording()" title="Voice note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg></button>
      </div>
      <button class="chat-send-btn" onclick="sendChatMsg()">↑</button>
    </div>
  </div>`;
  setTimeout(()=>{const s=el("chat-scroll");if(s)s.scrollTop=s.scrollHeight;},60);
  if(sb&&S.user.supabaseId&&unread>0){
    const chatPanel=el("chat-float");
    const chatVisible=chatPanel&&chatPanel.style.display!=="none";
    if(chatVisible){
      _markChatRead();
    }
  }
}

/* ── CHALLENGER REPLY SYSTEM ── */
let _chatReplyToId=null;
function chatSetReply(msgId,preview){
  _chatReplyToId=msgId;
  let indicator=document.getElementById("chat-reply-indicator");
  if(!indicator){
    indicator=document.createElement("div");
    indicator.id="chat-reply-indicator";
    indicator.style.cssText="font-size:11px;color:#888;padding:4px 14px;background:#0f0f0f;border-left:2px solid #c49a1c;margin:0;display:flex;justify-content:space-between;align-items:center";
    const chatBar=document.querySelector(".chat-bar");
    if(chatBar)chatBar.parentNode.insertBefore(indicator,chatBar);
  }
  indicator.innerHTML=`<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">↩ Replying to: <em>${preview||"voice note"}</em></span><span onclick="_chatReplyToId=null;this.parentNode.remove()" style="cursor:pointer;color:#555;margin-left:8px;font-size:14px">×</span>`;
  indicator.style.display="flex";
  const ta=el("chat-input");
  if(ta)ta.focus();
}

async function sendChatMsg(){
  trackEvent("chat_msg_sent",{sender:"challenger"});
  const ta=el("chat-input");
  const hasText=ta&&ta.value.trim();
  if(!hasText&&!chatVoiceBlob)return;
  const msg=hasText?ta.value.trim():"";
  if(ta){ta.value="";ta.placeholder="Message Genie...";}
  const pill=ta&&ta.closest(".chat-input-pill");
  if(pill){pill.classList.remove("recording","recorded");}
  const micBtn=el("chat-mic-btn");
  if(micBtn){micBtn.innerHTML=MIC_SVG;micBtn.style.color="";}
  /* Capture and clear reply */
  const replyToId=_chatReplyToId;
  _chatReplyToId=null;
  const indicator=document.getElementById("chat-reply-indicator");
  if(indicator)indicator.remove();

  /* Upload voice if present */
  let voiceUrl=null;
  if(chatVoiceBlob&&S.user?.supabaseId){
    const vMime=chatVoiceBlob.type||"audio/webm";
    const vExt=vMime.includes("mp4")?"mp4":vMime.includes("ogg")?"ogg":"webm";
    const path=`${S.user.supabaseId}/chat-${Date.now()}.${vExt}`;
    voiceUrl=await uploadToStorage("chat-voice",path,chatVoiceBlob,vMime);
    if(!voiceUrl) showToast("Voice upload failed","error");
    chatVoiceBlob=null;
  }

  if(sb&&S.user?.supabaseId){
    try{
      await sb.from("chat_messages").insert({challenger_id:S.user.supabaseId,sender:"challenger",message:msg||"",voice_url:voiceUrl||null,reply_to_id:replyToId||null});
    }catch(e){console.error("Chat send error:",e);showToast("Message failed to send","error");}
  }
  renderChat();
}

function sendGenieMessage(text){
  if(!S.user) return;
  if(!S.user.genieMessages) S.user.genieMessages=[];
  S.user.genieMessages.push({text,date:new Date().toLocaleDateString(),read:false});
  saveState();
}

async function _markChatRead(){
  if(!sb||!S.user?.supabaseId)return;
  const ts=new Date().toISOString();
  try{
    await sb.from("chat_messages").update({read:true,read_at:ts})
      .eq("challenger_id",S.user.supabaseId).eq("sender","genie").is("read",null);
    await sb.from("chat_messages").update({read:true,read_at:ts})
      .eq("challenger_id",S.user.supabaseId).eq("sender","genie").eq("read",false);
  }catch(e){console.warn("Mark read failed:",e);}
  if(S.user.genieMessages){
    S.user.genieMessages.forEach(m=>{m.read=true;});
    saveState();
  }
  const badge=el("msg-badge");
  if(badge){badge.style.display="none";badge.textContent="0";}
  if(typeof updateMsgBadge==="function") updateMsgBadge();
  if(typeof updateTabTitle==="function") updateTabTitle();
}

async function unsendChatMsg(msgId){
  if(!sb||!S.user?.supabaseId||!msgId)return;
  try{
    await sb.from("chat_messages").delete().eq("id",msgId).eq("sender","challenger");
    renderChat();
    showToast("Message deleted","info");
  }catch(e){showToast("Could not delete","error");}
}

/* ── GENIE NOTIFICATION BANNER (JS) ── */
async function updateMsgBadge(){
  const badge=el("msg-badge");
  if(!badge)return;
  let count=0;
  /* Check chat_messages from Supabase — cover both NULL and false for the read column */
  if(sb&&S.user?.supabaseId){
    try{
      const {count:c1}=await sb.from("chat_messages").select("id",{count:"exact",head:true}).eq("challenger_id",S.user.supabaseId).eq("sender","genie").eq("read",false);
      if(c1)count+=c1;
      const {count:c2}=await sb.from("chat_messages").select("id",{count:"exact",head:true}).eq("challenger_id",S.user.supabaseId).eq("sender","genie").is("read",null);
      if(c2)count+=c2;
    }catch(e){}
  }
  /* Also check local genie messages */
  if(S.user?.genieMessages){
    count+=S.user.genieMessages.filter(m=>!m.read).length;
  }
  if(count>0){
    badge.style.display="flex";
    badge.textContent=count;
  } else {
    badge.style.display="none";
  }
  /* Update browser tab title */
  if(typeof updateTabTitle==="function") updateTabTitle();
}


/* ── ADAPTIVE PROOF PLACEHOLDER ── */
async function getAdaptivePlaceholder(goal){
  try{
    const prompt=`Given this goal: "${goal}", suggest 2-3 specific daily proof examples the person could upload. Return ONLY the examples as a comma-separated list, no quotes, no intro. Max 20 words total.`;
    const result=await lil(prompt,40);
    if(result&&result.length>10) return "e.g. "+result;
  }catch(e){}
  return null;
}

