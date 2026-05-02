/* ── SUPABASE CLIENT ── */
let sb=null;
function initSupabase(){
  if(SUPABASE_URL&&SUPABASE_ANON_KEY&&window.supabase){
    sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  }
}

async function syncToSupabase(){
  if(!sb||!S.user)return;
  try{
    const u=S.user;
    const {data}=await sb.from("challengers").upsert({
      id:u.supabaseId||undefined,
      name:u.name,email:u.email||null,phone:u.phone||null,
      goal_raw:u.answers.goal,goal_summary:u.answers.goalSummary||u.answers.goal,
      proof_description:u.answers.proof||null,proof_methods:u.answers.proofMethods||[],
      proof_type:u.answers.proofType||"output",threat:u.answers.threat||null,
      duration:u.duration,signature:u.sig,start_date:u.startDate,
      payment_ref:u.paymentRef||null,payment_status:u.paymentStatus||"pending",
      amount_paid:u.amountPaid||0,access_code:u.accessCode||null,
      status:"active",current_day:S.day
    },{onConflict:"id"}).select().single();
    if(data&&!u.supabaseId){S.user.supabaseId=data.id;saveState();initPushNotifications();}
  }catch(e){console.error("Sync error:",e);}
}

/* ── STORAGE UPLOAD (REST — works with anon key) ── */
async function uploadToStorage(bucket,path,blob,contentType){
  try{
    /* Strip codec suffix (e.g. "audio/webm;codecs=opus" → "audio/webm") — Supabase Storage rejects MIME types with parameters */
    const cleanType=contentType.split(";")[0].trim();
    const encodedPath=path.split("/").map(s=>encodeURIComponent(s)).join("/");
    const url=`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`;
    const res=await fetch(url,{method:"POST",headers:{"Authorization":`Bearer ${SUPABASE_ANON_KEY}`,"Content-Type":cleanType,"x-upsert":"true"},body:blob});
    if(!res.ok){console.error("Storage upload failed",res.status,await res.text());return null;}
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodedPath}`;
  }catch(e){console.error("Storage upload error",e);return null;}
}

async function syncUploadToSupabase(dayNum,upload){
  if(!sb||!S.user)return;
  if(!S.user.supabaseId){try{await syncToSupabase();}catch(e){}}
  if(!S.user.supabaseId)return;
  try{await sb.from("uploads").upsert({challenger_id:S.user.supabaseId,day_number:dayNum,note:upload.note||null,link_url:upload.link||null,file_name:upload.fileName||null,file_url:upload.fileUrl||null,voice_url:upload.voiceUrl||null,proof_type:upload.proofType||null,behavior_answer:upload.behavior||null},{onConflict:"challenger_id,day_number"});}catch(e){}
}

async function syncEnergyToSupabase(dayNum,entry){
  if(!sb||!S.user?.supabaseId)return;
  try{await sb.from("energy_logs").upsert({challenger_id:S.user.supabaseId,day_number:dayNum,log_type:entry.type,value:String(entry.value)},{onConflict:"challenger_id,day_number"});}catch(e){}
}


/* ── PAYMENT GATE ── */
function initPayment(){
  const dur=S.user?.duration||S.ans?.duration||15;
  const t=TIERS[dur];
  const callDays=CALL_DAYS[dur]||[];
  el("pay-tier-name").textContent=t.name;
  el("pay-tier-desc").textContent=`${dur} days · ${t.goals} goal${t.goals>1?"s":""}`;
  el("pay-price").textContent=t.price;
  el("pay-call-info").textContent=callDays.length>0?`${callDays.length} call${callDays.length>1?"s":""} with Genie`:"Genie batch review";
  el("pay-btn").textContent=`Pay ${t.price} & Start Challenge →`;
  el("pay-btn").disabled=false;
  el("pay-status").textContent="";
  S._accessDiscount=0;S._accessCode=null;
  el("access-code-msg").style.display="none";
}

async function applyAccessCode(){
  const code=el("access-code-input").value.trim().toUpperCase();
  const msg=el("access-code-msg");
  if(!code){msg.style.display="block";msg.style.color="#d9503a";msg.textContent="Enter a code";return;}
  if(!sb){msg.style.display="block";msg.style.color="#d9503a";msg.textContent="Not connected";return;}
  try{
    const {data}=await sb.from("access_codes").select("*").eq("code",code).eq("active",true).single();
    if(!data){msg.style.display="block";msg.style.color="#d9503a";msg.textContent="Invalid code";return;}
    if(data.max_uses>0&&data.times_used>=data.max_uses){msg.style.display="block";msg.style.color="#d9503a";msg.textContent="Code fully used";return;}
    if(data.valid_until&&new Date(data.valid_until)<new Date()){msg.style.display="block";msg.style.color="#d9503a";msg.textContent="Code expired";return;}
    S._accessDiscount=data.discount_percent;S._accessCode=code;S._accessCodeId=data.id;
    /* times_used is incremented server-side by verify-payment, NOT here. Anon
       writes to access_codes are denied by RLS so a client-side increment
       would silently fail anyway. */
    updatePayAfterDiscount(data.discount_percent);
    msg.style.display="block";msg.style.color="#4dc98a";msg.textContent=data.discount_percent===100?"Free access applied!":data.discount_percent+"% off applied!";
  }catch(e){
    msg.style.display="block";msg.style.color="#d9503a";msg.textContent="Invalid code";
  }
}

function updatePayAfterDiscount(pct){
  const dur=S.user?.duration||15;const t=TIERS[dur];
  if(pct===100){
    el("pay-price").innerHTML=`<s style="color:#5a5a5a">${t.price}</s> <span class="ok">FREE</span>`;
    el("pay-btn").textContent="Start Challenge (Free) →";
    el("pay-email-area").style.display="none";
  }else{
    const dk=Math.round(PRICES[dur]*(1-pct/100));const dn="₦"+(dk/100).toLocaleString();
    el("pay-price").innerHTML=`<s style="color:#5a5a5a">${t.price}</s> ${dn}`;
    el("pay-btn").textContent=`Pay ${dn} →`;
  }
}

/* Call the verify-payment edge function. Returns {ok, data, status}. */
async function verifyPaymentServerside(body){
  try{
    const res=await fetch(VERIFY_PAYMENT_URL,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":SUPABASE_ANON_KEY,
        "Authorization":"Bearer "+SUPABASE_ANON_KEY,
      },
      body:JSON.stringify(body),
    });
    let data=null;
    try{data=await res.json();}catch(e){}
    return {ok:res.ok&&data&&data.ok===true, data, status:res.status};
  }catch(e){
    return {ok:false, data:{error:"network"}, status:0};
  }
}

/* Ensure a pending challenger row exists in supabase (so verify-payment has
   something to update). Returns true if S.user.supabaseId is populated. */
async function ensureChallengerRow(){
  if(!sb||!S.user) return false;
  if(!S.user.supabaseId){
    try{ await syncToSupabase(); }catch(e){}
  }
  return !!S.user?.supabaseId;
}

function payError(text){
  const btn=el("pay-btn");
  if(btn){btn.disabled=false;btn.textContent="Pay & Start →";}
  const st=el("pay-status");
  if(st){st.textContent=text;st.style.color="#d9503a";}
}

async function initiatePayment(){
  const dur=S.user?.duration||15;
  const email=el("pay-email")?.value?.trim();
  trackEvent("payment_initiated",{duration:dur,has_discount:S._accessDiscount>0});

  el("pay-btn").disabled=true;
  el("pay-btn").textContent="Preparing...";
  el("pay-status").textContent="";

  /* Create the pending row first so verify-payment can promote it. */
  const hasRow=await ensureChallengerRow();
  if(!hasRow){payError("Connection problem. Try again.");return;}

  /* ── 100% ACCESS CODE PATH ─────────────────────────────────────── */
  if(S._accessDiscount===100){
    const result=await verifyPaymentServerside({
      method:"access_code",
      challenger_id:S.user.supabaseId,
      access_code:S._accessCode,
    });
    if(!result.ok){
      payError("Access code rejected ("+(result.data?.error||"error")+").");
      return;
    }
    await completePayment({status:"free",reference:null,amount:0,email:S.user.email});
    return;
  }

  /* ── PAYSTACK PATH ─────────────────────────────────────────────── */
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    payError("Enter a valid email");
    return;
  }
  const fk=S._accessDiscount>0?Math.round(PRICES[dur]*(1-S._accessDiscount/100)):PRICES[dur];
  el("pay-btn").textContent="Opening payment...";
  try{
    const h=PaystackPop.setup({
      key:PAYSTACK_PUBLIC_KEY,email,amount:fk,currency:"NGN",
      ref:"OIWG_"+Date.now()+"_"+Math.random().toString(36).substr(2,6),
      metadata:{custom_fields:[{display_name:"Challenger",variable_name:"name",value:S.user?.name||""},{display_name:"Tier",variable_name:"tier",value:TIERS[dur].name}]},
      onClose:()=>{el("pay-btn").disabled=false;el("pay-btn").textContent="Pay & Start →";el("pay-status").textContent="Payment cancelled";el("pay-status").style.color="#d9503a";},
      callback:async(r)=>{
        el("pay-btn").textContent="Verifying payment...";
        /* Paystack's client-side callback is NOT trustworthy on its own —
           we re-verify the reference against Paystack's API server-side
           via the verify-payment edge function. Only that call can flip
           payment_status to 'paid' in supabase. */
        const result=await verifyPaymentServerside({
          method:"paystack",
          challenger_id:S.user.supabaseId,
          reference:r.reference,
          access_code:S._accessCode||undefined,
        });
        if(!result.ok){
          payError("Payment could not be verified ("+(result.data?.error||"error")+"). Contact support with ref "+r.reference+".");
          return;
        }
        /* Best-effort welcome email */
        fetch('https://vbafqulhbskaswkyjjdn.supabase.co/functions/v1/send-welcome-email',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            email:email,
            first_name:(S.user?.name||"").split(" ")[0]||"there",
            tier:TIERS[dur].name.toLowerCase().replace("the ","")
          })
        }).catch(()=>{});
        await completePayment({status:"paid",reference:r.reference,amount:fk,email});
      }
    });
    h.openIframe();
  }catch(e){
    payError("Payment failed. Check connection.");
  }
}

async function completePayment(d){
  trackEvent("payment_completed",{status:d.status,duration:S.user?.duration});
  if(S.user){
    S.user.paymentRef=d.reference||S.user.paymentRef;
    S.user.paymentStatus=d.status;
    S.user.amountPaid=d.amount||0;
    S.user.email=d.email||S.user.email;
    S.user.phone=el("pay-phone")?.value?.trim()||S.user.phone||null;
    S.user.accessCode=S._accessCode||null;
    saveState();
    /* Non-payment columns sync via upsert. Payment columns are pinned by
       the protect_challenger_payment_columns trigger on the DB, so the
       server-side value from verify-payment is authoritative. */
    try{await syncToSupabase();}catch(e){}
  }
  goTo("photo");
}


/* ── GENIE IN-APP MESSAGES ── */
/* ── RETURNING USER SIGN-IN ── */
function showSignIn(){
  el("signin-mod").classList.add("show");
  setTimeout(()=>el("signin-email")?.focus(),200);
}

async function attemptSignIn(){
  trackEvent("sign_in_attempt");
  const email=el("signin-email")?.value?.trim();
  const msg=el("signin-msg");
  const btn=el("signin-btn");
  if(!email||!email.includes("@")){msg.textContent="Enter a valid email";msg.style.color="#d9503a";return;}
  
  if(!sb){msg.textContent="Database not connected. Clear your browser data and start fresh.";msg.style.color="#d9503a";return;}
  
  btn.disabled=true;btn.textContent="Looking up...";
  try{
    const {data,error}=await sb.from("challengers").select("*").eq("email",email).order("created_at",{ascending:false}).limit(1).single();
    if(error||!data){
      msg.textContent="No challenge found with that email. Check spelling or start a new one.";
      msg.style.color="#d9503a";
      btn.disabled=false;btn.textContent="Find My Challenge →";
      return;
    }

    /* ── PAYMENT GATE ── the row exists, but sign-in is only valid for
       a paid or free-access challenger. Anything else (pending, started)
       is treated as "no paid challenge" — no protected state is restored,
       no goTo('dash') is issued. */
    if(data.payment_status!=="paid"&&data.payment_status!=="free"){
      msg.textContent="No paid challenge on this email. Start a new one from the homepage.";
      msg.style.color="#d9503a";
      btn.disabled=false;btn.textContent="Find My Challenge →";
      return;
    }

    /* Restore session from database */
    const dur=data.duration||15;
    const startDate=new Date(data.start_date);
    const now=new Date();
    const curDay=Math.min(Math.max(Math.floor((now-startDate)/(1000*60*60*24))+1,1),dur);
    
    /* Load uploads */
    const {data:uploads}=await sb.from("uploads").select("*").eq("challenger_id",data.id).order("day_number",{ascending:true});
    const uploadArr=Array(dur).fill(null);
    (uploads||[]).forEach(u=>{
      if(u.day_number>=1&&u.day_number<=dur){
        uploadArr[u.day_number-1]={note:u.note,hasFile:!!u.file_url,fileName:u.file_name,fileUrl:u.file_url||null,proofType:u.proof_type,link:u.link_url,behavior:u.behavior_answer,hasVoice:!!u.voice_url,voiceUrl:u.voice_url||null};
      }
    });
    
    /* Load energy logs */
    const {data:energyData}=await sb.from("energy_logs").select("*").eq("challenger_id",data.id);
    const energyLog={};
    (energyData||[]).forEach(e=>{energyLog[e.day_number]={type:e.log_type,value:e.value};});
    
    /* Rebuild user state */
    S.user={
      name:data.name,
      email:data.email,
      phone:data.phone,
      photo:data.photo_url,
      answers:{goal:data.goal_raw,goalSummary:data.goal_summary,proof:data.proof_description,proofMethods:data.proof_methods||[],proofType:data.proof_type,threat:data.threat},
      sig:data.signature,
      startDate:data.start_date,
      duration:dur,
      paymentRef:data.payment_ref,
      paymentStatus:data.payment_status,
      amountPaid:data.amount_paid,
      accessCode:data.access_code,
      supabaseId:data.id,
      energyLog,
      genieMessages:[]
    };
    S.uploads=uploadArr;
    S.day=curDay;
    S.ans=S.user.answers;
    saveState();
    
    el("signin-mod").classList.remove("show");
    goTo("dash");
  }catch(e){
    console.error("Sign in error:",e);
    msg.textContent="Something went wrong. Try again.";
    msg.style.color="#d9503a";
    btn.disabled=false;btn.textContent="Find My Challenge →";
  }
}


/* ── PUSH NOTIFICATIONS ─────────────────────────────────── */
function urlBase64ToUint8Array(base64String){
  const padding="=".repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

async function initPushNotifications(){
  if(!("serviceWorker" in navigator)||!("PushManager" in window))return;
  if(!S.user?.supabaseId)return;
  try{
    const reg=await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      // iOS standalone check
      const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
      const isStandalone=window.navigator.standalone||window.matchMedia("(display-mode: standalone)").matches;
      if(isIOS&&!isStandalone){
        // Show a gentle prompt — don't block
        const banner=document.createElement("div");
        banner.id="ios-push-banner";
        banner.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #c49a1c44;color:#e0e0e0;font-size:13px;padding:12px 16px;border-radius:12px;z-index:9999;max-width:300px;text-align:center;box-shadow:0 4px 20px #0008";
        banner.innerHTML='<strong style="color:#c49a1c">Enable Notifications</strong><br>Add this app to your Home Screen to receive push notifications on iPhone.';
        const close=document.createElement("button");
        close.textContent="✕";
        close.style.cssText="position:absolute;top:6px;right:10px;background:none;border:none;color:#888;font-size:16px;cursor:pointer";
        close.onclick=()=>banner.remove();
        banner.appendChild(close);
        document.body.appendChild(banner);
        setTimeout(()=>banner.remove(),8000);
        return;
      }
      const perm=await Notification.requestPermission();
      if(perm!=="granted")return;
      sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)});
    }
    // Upsert subscription to Supabase
    if(sb){
      const k=sub.toJSON().keys||{};
      await sb.from("push_subscriptions").upsert({
        challenger_id:S.user.supabaseId,
        endpoint:sub.endpoint,
        p256dh:k.p256dh||"",
        auth:k.auth||""
      },{onConflict:"endpoint",ignoreDuplicates:false});
    }
  }catch(e){console.warn("Push init failed:",e);}
}

async function triggerPush(challengerId,title,body){
  if(typeof adminFetch!=="function"||!getAdminToken())return;
  try{
    await adminFetch("send_push",{push_type:"personal",challenger_id:challengerId,title,body:body.slice(0,120)});
  }catch(e){}
}

async function triggerPushBroadcast(title,body){
  if(typeof adminFetch!=="function"||!getAdminToken())return;
  try{
    await adminFetch("send_push",{push_type:"broadcast",title,body:body.slice(0,120)});
  }catch(e){}
}

/* Admin: Send feedback to a specific challenger */
async function sendFBLive(uid){
  const ta=el("fb-ta-"+uid);if(!ta||!ta.value.trim())return;
  const msg=ta.value.trim();
  const u=getAM().find(x=>x.id===uid);
  let sent=false;
  try{
    await adminFetch("send_message",{challenger_id:uid,message:msg});
    sent=true;
  }catch(e){}
  if(S.user&&S.user.supabaseId===uid&&typeof sendGenieMessage==="function"){sendGenieMessage(msg);}
  if(sent){triggerPush(uid,"Message from Genie 💬",msg);}
  el("fb-area-"+uid).innerHTML=`<div style="padding:10px 12px;background:rgba(77,201,138,.07);border:1px solid rgba(77,201,138,.22);border-radius:8px"><p class="ok" style="font-size:12px">${sent?"✓ Message sent to "+(u?.name||"challenger"):"⚠ Could not send"}</p></div>`;
  ta.value="";
}

/* Admin: Broadcast message to all active challengers */
async function broadcastMessage(){
  const ta=el("broadcast-ta");if(!ta||!ta.value.trim())return;
  const msg=ta.value.trim();
  const btn=el("broadcast-btn");
  btn.disabled=true;btn.textContent="Sending...";
  let sent=0;
  for(const u of getAM()){
    try{
      await adminFetch("send_message",{challenger_id:u.id,message:msg});
      sent++;
    }catch(e){}
  }
  btn.disabled=false;btn.textContent="Broadcast to All";
  if(sent>0){triggerPushBroadcast("Message from Genie 💬",msg);}
  ta.value="";
  el("broadcast-status").innerHTML=`<p class="ok" style="font-size:12px;margin-top:8px">✓ Sent to ${sent} challenger${sent!==1?"s":""}</p>`;
  setTimeout(()=>{const s=el("broadcast-status");if(s)s.innerHTML="";},3000);
}


