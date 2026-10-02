/* ============================================================
   bookings-admin.js — the "Bookings" tab in /admin.
   Controls for the services site: clarity calls, mentorship plans,
   waitlists, the email list, and your hours. Talks to the
   booking-admin edge function with the same admin session token.
   ============================================================ */
const BOOKING_ADMIN_URL = SUPABASE_URL + "/functions/v1/booking-admin";
const BK = { data:null, view:"calls", filter:"upcoming", loading:false };

async function bkFetch(action, params){
  const token = getAdminToken();
  const r = await fetch(BOOKING_ADMIN_URL, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ action, token, ...(params||{}) }) });
  const d = await r.json().catch(()=>({ ok:false, error:"network" }));
  if(d.error==="invalid_or_expired_token"){ setAdminToken(""); S._adminAuth=false; renderAdmin(); throw new Error("Session expired"); }
  if(!d.ok) throw new Error(d.error||"error");
  return d;
}
const bkEsc = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const bkNaira = k => "₦" + Math.round((k||0)/100).toLocaleString("en-NG");
const bkMins = n => n<60 ? `${n} min` : (n%60 ? `${Math.floor(n/60)}h ${n%60}m` : `${n/60}h`);
const BK_DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function bkWa(phone){
  let d = String(phone||"").replace(/\D/g,""); if(!d) return "";
  if(d.startsWith("0")) d = "234" + d.slice(1);
  else if(d.length===10) d = "234" + d;
  return "https://wa.me/" + d;
}
function bkCopy(text, msg){
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(()=>showToast(msg||"Copied","success")).catch(()=>{ prompt("Copy this:", text); });
}

function bkStyles(){
  if(document.getElementById("bk-css")) return;
  const s = document.createElement("style"); s.id = "bk-css";
  s.textContent = `
  .bk{padding:4px 0 60px}
  .bk-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px}
  .bk-stat{background:#0f0f0f;border:1px solid #1c1c1c;border-radius:12px;padding:12px}
  .bk-stat b{display:block;font-size:22px;font-weight:900;color:#ededed}.bk-stat span{font-size:11px;color:#777;font-weight:600}
  .bk-seg{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-bottom:14px}
  .bk-seg button{flex:none;padding:8px 14px;border-radius:999px;border:1px solid #232323;background:transparent;color:#9a9a9a;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
  .bk-seg button.on{background:#c49a1c;border-color:#c49a1c;color:#000}
  .bk-sub{display:flex;gap:14px;margin:0 0 12px;font-size:12px}
  .bk-sub button{background:none;border:0;padding:4px 0;color:#6a6a6a;font:inherit;font-weight:700;cursor:pointer;border-bottom:2px solid transparent}
  .bk-sub button.on{color:#ededed;border-bottom-color:#c49a1c}
  .bk-day{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#c49a1c;margin:18px 0 8px}
  .bk-row{background:#0f0f0f;border:1px solid #1c1c1c;border-radius:14px;padding:13px 14px;margin-bottom:8px}
  .bk-row.cx{opacity:.5}
  .bk-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
  .bk-time{font-size:15px;font-weight:800;color:#ededed}
  .bk-name{font-size:14px;font-weight:700;color:#ededed;margin-top:2px}
  .bk-tag{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:999px;margin-left:6px;vertical-align:middle}
  .bk-tag.free{background:rgba(77,201,138,.12);color:#4dc98a}.bk-tag.ment{background:rgba(196,154,28,.14);color:#c49a1c}
  .bk-tag.warn{background:rgba(217,80,58,.14);color:#e0705c}.bk-tag.grey{background:#1c1c1c;color:#8a8a8a}
  .bk-note{font-size:13px;color:#b5b5b5;margin-top:8px;line-height:1.45;font-style:italic}
  .bk-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:12px;color:#7a7a7a}
  .bk-meta a{color:#9a9a9a;text-decoration:underline;text-underline-offset:2px}
  .bk-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
  .bk-btn{padding:7px 12px;border-radius:9px;border:1px solid #2a2a2a;background:transparent;color:#cfcfcf;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
  .bk-btn.gold{background:#c49a1c;border-color:#c49a1c;color:#000}
  .bk-btn.red{border-color:rgba(217,80,58,.35);color:#e0705c}
  .bk-btn.on{background:#1f1f1f;border-color:#c49a1c;color:#c49a1c}
  .bk-card{background:#0f0f0f;border:1px solid #1c1c1c;border-radius:14px;padding:16px;margin-bottom:12px}
  .bk-card h4{margin:0 0 4px;font-size:15px;font-weight:800;color:#ededed}
  .bk-card p.h{margin:0 0 12px;font-size:12.5px;color:#7a7a7a;line-height:1.5}
  .bk-in{width:100%;padding:10px 12px;border-radius:9px;border:1px solid #262626;background:#080808;color:#ededed;font:inherit;font-size:13.5px;margin-bottom:8px}
  .bk-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .bk-bar{height:6px;border-radius:6px;background:#1c1c1c;margin:10px 0 4px;overflow:hidden}.bk-bar span{display:block;height:100%;background:#c49a1c}
  .bk-rule{display:grid;grid-template-columns:92px minmax(0,1fr) minmax(0,1fr) 40px;gap:8px;align-items:center;padding:8px 0;border-top:1px solid #181818;font-size:13px;color:#cfcfcf}
  .bk-rule input[type=time]{min-width:0;padding:7px 6px;border-radius:8px;border:1px solid #262626;background:#080808;color:#ededed;font:inherit;font-size:13px;width:100%}
  .bk-rule.off{color:#5a5a5a}
  .bk-rule input[type=time]::-webkit-calendar-picker-indicator{display:none}
  .bk-tog{width:40px;height:22px;border-radius:999px;background:#2a2a2a;border:0;position:relative;cursor:pointer;flex:none}
  .bk-tog::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#777;transition:.2s}
  .bk-tog.on{background:#c49a1c}.bk-tog.on::after{left:21px;background:#000}
  .bk-empty{text-align:center;padding:30px 10px;color:#6a6a6a;font-size:13px}
  .bk-email{font-size:12.5px;color:#9a9a9a;padding:6px 0;border-top:1px solid #161616;display:flex;justify-content:space-between;gap:10px}
  .bk-modal{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9000;display:grid;place-items:center;padding:20px}
  .bk-modal>div{background:#111;border:1px solid #262626;border-radius:16px;padding:20px;max-width:380px;width:100%}
  .bk-modal h4{margin:0 0 8px;color:#ededed;font-size:16px}.bk-modal p{margin:0 0 14px;color:#9a9a9a;font-size:13px;line-height:1.5}
  .bk-check{display:flex;gap:10px;align-items:center;font-size:13px;color:#cfcfcf;margin:0 0 16px;cursor:pointer}
  .bk-check input{width:18px!important;height:18px;flex:none;margin:0;accent-color:#c49a1c}
  @media(max-width:520px){.bk-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.bk-rule{grid-template-columns:62px minmax(0,1fr) minmax(0,1fr) 40px;gap:6px;font-size:12px}.bk-rule input[type=time]{font-size:12px}}
  `;
  document.head.appendChild(s);
}

async function renderBookingsTab(c){
  bkStyles();
  if(!BK.data && !BK.loading){ c.innerHTML = `<div class="bk-empty">Loading bookings…</div>`; await bkLoad(); }
  bkRender();
}
async function bkLoad(){
  BK.loading = true;
  try{ BK.data = await bkFetch("list"); }
  catch(e){ const c=el("admin-content"); if(c && adminCurrentTab==="bookings") c.innerHTML = `<div class="bk-empty">Couldn't load bookings: ${bkEsc(e.message)}<br><br><button class="bk-btn" onclick="BK.data=null;adminTab('bookings')">Try again</button></div>`; }
  BK.loading = false;
}
async function bkRefresh(){ await bkLoad(); bkRender(); }

function bkRender(){
  const c = el("admin-content"); if(!c || adminCurrentTab!=="bookings" || !BK.data) return;
  const d = BK.data, now = Date.parse(d.now);
  const upcoming = d.bookings.filter(b=>b.status==="confirmed" && Date.parse(b.ends_at) > now);
  const optedIn = d.contacts.filter(x=>x.opted_in).length;
  const tabs = [["calls","Calls"],["mentorship","Mentorship"],["lists","Waitlists & emails"],["hours","Hours & settings"]];
  const body = { calls:bkCalls, mentorship:bkMentorship, lists:bkLists, hours:bkHours }[BK.view](d, now);
  c.innerHTML = `<div class="bk">
    <div class="bk-stats">
      <div class="bk-stat"><b>${upcoming.filter(b=>b.service==="free_call").length}</b><span>Clarity calls coming</span></div>
      <div class="bk-stat"><b>${upcoming.filter(b=>b.service==="mentorship").length}</b><span>Mentorship sessions</span></div>
      <div class="bk-stat"><b>${d.waitlist.length}</b><span>On waitlists</span></div>
      <div class="bk-stat"><b>${optedIn}</b><span>On your email list</span></div>
    </div>
    <div class="bk-seg">${tabs.map(([k,l])=>`<button class="${BK.view===k?"on":""}" onclick="BK.view='${k}';bkRender()">${l}</button>`).join("")}
      <button onclick="bkRefresh()" title="Refresh">↻</button></div>
    ${body}
  </div>`;
}

/* ---------- Calls ---------- */
function bkCalls(d, now){
  const f = BK.filter;
  let rows = d.bookings.filter(b=>{
    const past = Date.parse(b.ends_at) <= now;
    if(f==="upcoming") return b.status==="confirmed" && !past;
    if(f==="past") return b.status==="confirmed" && past;
    return b.status==="cancelled";
  });
  if(f!=="upcoming") rows = rows.slice().reverse();
  const groups = {}; rows.forEach(b=>{ (groups[b.date] = groups[b.date] || []).push(b); });
  const list = rows.length ? Object.keys(groups).map(day=>`<div class="bk-day">${bkEsc(day)}</div>${groups[day].map(b=>bkRow(b, now)).join("")}`).join("")
    : `<div class="bk-empty">${f==="upcoming"?"Nothing booked yet.":f==="past"?"No past calls in the last 3 weeks.":"No cancellations."}</div>`;
  return `<div class="bk-sub">${[["upcoming","Coming up"],["past","Past"],["cancelled","Cancelled"]].map(([k,l])=>`<button class="${f===k?"on":""}" onclick="BK.filter='${k}';bkRender()">${l}</button>`).join("")}</div>
    ${list}
    <div class="bk-card" style="margin-top:22px"><h4>Give someone another free call</h4>
      <p class="h">The site allows one free clarity call per person. Use this when someone missed theirs for a good reason.</p>
      <input class="bk-in" id="bk-grant" type="email" placeholder="Their email">
      <button class="bk-btn gold" onclick="bkGrant()">Allow one more call</button></div>`;
}
function bkRow(b, now){
  const past = Date.parse(b.ends_at) <= now, cx = b.status==="cancelled";
  const tag = b.service==="free_call" ? `<span class="bk-tag free">Clarity call</span>` : `<span class="bk-tag ment">Mentorship · ${bkMins(b.minutes||60)}</span>`;
  const dup = b.same_name>1 ? `<span class="bk-tag warn">${b.same_name} free calls under this name</span>` : "";
  const att = b.attended==="showed" ? `<span class="bk-tag free">Showed up</span>` : b.attended==="no_show" ? `<span class="bk-tag warn">No-show</span>` : "";
  const cxTag = cx ? `<span class="bk-tag grey">Cancelled${b.cancelled_by==="genie"?" by you":""}</span>` : "";
  const wa = bkWa(b.phone);
  let acts = "";
  if(!cx && !past) acts = `<button class="bk-btn red" onclick="bkCancel('${b.id}')">Cancel</button>`;
  if(!cx && past) acts = `<button class="bk-btn ${b.attended==="showed"?"on":""}" onclick="bkAttend('${b.id}','${b.attended==="showed"?"":"showed"}')">Showed up</button>
    <button class="bk-btn ${b.attended==="no_show"?"on":""}" onclick="bkAttend('${b.id}','${b.attended==="no_show"?"":"no_show"}')">No-show</button>`;
  return `<div class="bk-row${cx?" cx":""}">
    <div class="bk-top"><div><span class="bk-time">${bkEsc(b.label)}</span>${tag}${att}${cxTag}<div class="bk-name">${bkEsc(b.name)} ${dup}</div></div></div>
    ${b.note?`<div class="bk-note">“${bkEsc(b.note)}”</div>`:""}
    <div class="bk-meta"><a href="mailto:${bkEsc(b.email)}">${bkEsc(b.email)}</a>${b.phone?`<span>${bkEsc(b.phone)}</span>`:""}${wa?`<a href="${wa}" target="_blank" rel="noopener">WhatsApp</a>`:""}</div>
    ${acts?`<div class="bk-acts">${acts}</div>`:""}
  </div>`;
}
function bkModal(html){
  const m = document.createElement("div"); m.className = "bk-modal"; m.innerHTML = `<div>${html}</div>`;
  m.addEventListener("click", e=>{ if(e.target===m) m.remove(); });
  document.body.appendChild(m); return m;
}
function bkCancel(id){
  const b = BK.data.bookings.find(x=>x.id===id); if(!b) return;
  const m = bkModal(`<h4>Cancel ${bkEsc(b.name)}'s ${b.service==="free_call"?"call":"session"}?</h4>
    <p>${bkEsc(b.date)} at ${bkEsc(b.label)}. The slot opens up again for someone else.${b.service==="free_call"?" They'll also be able to book a new free call.":" The time goes back on their plan."}</p>
    <label class="bk-check"><input type="checkbox" id="bk-notify" checked> Email them that it's cancelled</label>
    <div class="bk-acts"><button class="bk-btn red" id="bk-yes">Yes, cancel it</button><button class="bk-btn" id="bk-no">Keep it</button></div>`);
  m.querySelector("#bk-no").onclick = ()=>m.remove();
  m.querySelector("#bk-yes").onclick = async ()=>{
    const notify = m.querySelector("#bk-notify").checked, btn = m.querySelector("#bk-yes");
    btn.disabled = true; btn.textContent = "Cancelling…";
    try{ const r = await bkFetch("cancel", { id, notify }); m.remove(); showToast(r.emailed ? "Cancelled. They've been emailed." : "Cancelled.", "success"); bkRefresh(); }
    catch(e){ btn.disabled = false; btn.textContent = "Try again"; showToast("Couldn't cancel: "+e.message, "error"); }
  };
}
async function bkAttend(id, value){
  const b = BK.data.bookings.find(x=>x.id===id); if(b) b.attended = value || null; bkRender();
  try{ await bkFetch("attend", { id, value: value || null }); }catch(e){ showToast("Couldn't save: "+e.message, "error"); bkRefresh(); }
}
async function bkGrant(){
  const email = (el("bk-grant").value||"").trim(); if(!email) return;
  try{ const r = await bkFetch("grant_call", { email }); el("bk-grant").value = ""; showToast(`Done. ${email} can book ${r.extra_free_calls} more free call${r.extra_free_calls>1?"s":""}.`, "success"); }
  catch(e){ showToast(e.message==="bad_email"?"That email doesn't look right.":"Couldn't save: "+e.message, "error"); }
}

/* ---------- Mentorship ---------- */
function bkMentorship(d){
  const plans = d.plans.filter(p=>!/^TEST_/.test(p.payment_reference||""));
  const list = plans.length ? plans.map(p=>{
    const left = Math.max(0, p.minutes_total - p.minutes_used), pct = Math.min(100, Math.round(100*p.minutes_used/p.minutes_total));
    return `<div class="bk-card"><div class="bk-top"><div><h4>${bkEsc(p.name)}${p.manual?`<span class="bk-tag grey">Added by you</span>`:""}</h4>
      <div class="bk-meta" style="margin-top:2px"><a href="mailto:${bkEsc(p.email)}">${bkEsc(p.email)}</a>${p.phone?`<span>${bkEsc(p.phone)}</span>`:""}${bkWa(p.phone)?`<a href="${bkWa(p.phone)}" target="_blank" rel="noopener">WhatsApp</a>`:""}</div></div>
      <div style="text-align:right;font-size:12px;color:#7a7a7a">${p.amount_kobo?bkNaira(p.amount_kobo):""}</div></div>
      <div class="bk-bar"><span style="width:${pct}%"></span></div>
      <div style="font-size:12.5px;color:#9a9a9a">${bkMins(p.minutes_used)} booked · <b style="color:#ededed">${bkMins(left)} left</b> of ${bkMins(p.minutes_total)}</div>
      <div class="bk-acts"><button class="bk-btn" onclick="bkCopy('${p.link}','Plan link copied')">Copy their booking link</button><a class="bk-btn" style="text-decoration:none" href="${p.link}" target="_blank" rel="noopener">Open</a></div></div>`;
  }).join("") : `<div class="bk-empty">No mentorship plans yet.</div>`;
  return `${list}
    <div class="bk-card" style="margin-top:18px"><h4>Add hours for a client</h4>
      <p class="h">For someone who paid you directly, or who still has sessions from before. They get their own booking link and pick times themselves.</p>
      <div class="bk-grid2"><input class="bk-in" id="bp-name" placeholder="Name"><input class="bk-in" id="bp-email" type="email" placeholder="Email"></div>
      <div class="bk-grid2"><input class="bk-in" id="bp-phone" placeholder="Phone (optional)"><input class="bk-in" id="bp-hours" type="number" min="0.5" step="0.5" placeholder="Hours, e.g. 4"></div>
      <input class="bk-in" id="bp-amt" type="number" min="0" placeholder="Amount they paid in ₦ (optional, for your records)">
      <label class="bk-check"><input type="checkbox" id="bp-notify" checked> Email them their booking link</label>
      <button class="bk-btn gold" onclick="bkNewPlan(this)">Create plan</button>
      <div id="bp-out"></div></div>`;
}
async function bkNewPlan(btn){
  const v = id => (el(id).value||"").trim();
  btn.disabled = true; btn.textContent = "Creating…";
  try{
    const r = await bkFetch("new_plan", { name:v("bp-name"), email:v("bp-email"), phone:v("bp-phone"), hours:Number(v("bp-hours")), amount_naira:Number(v("bp-amt")||0), notify:el("bp-notify").checked });
    showToast(r.emailed ? "Plan created and emailed." : "Plan created.", "success");
    await bkRefresh();
    const out = el("bp-out"); if(out) out.innerHTML = `<div class="bk-row" style="margin-top:12px"><div style="font-size:12.5px;color:#9a9a9a;word-break:break-all">${bkEsc(r.link)}</div><div class="bk-acts"><button class="bk-btn gold" onclick="bkCopy('${r.link}','Link copied')">Copy link to send on WhatsApp</button></div></div>`;
  }catch(e){
    const m = { missing_name:"Add their name.", bad_email:"That email doesn't look right.", bad_hours:"Hours should be between 0.5 and 40." }[e.message] || ("Couldn't create: "+e.message);
    showToast(m, "error"); btn.disabled = false; btn.textContent = "Create plan";
  }
}

/* ---------- Waitlists & email list ---------- */
function bkLists(d){
  const lists = { event:"Forward with Genie (event)", courses:"Communication courses" };
  const wl = Object.keys(lists).map(k=>{
    const rows = d.waitlist.filter(w=>w.list===k);
    return `<div class="bk-card"><div class="bk-top"><h4>${lists[k]}</h4><b style="color:#c49a1c;font-size:18px">${rows.length}</b></div>
      ${rows.length?`<div class="bk-acts" style="margin:6px 0 10px"><button class="bk-btn" onclick="bkCopyList('${k}')">Copy all emails</button></div>`+rows.slice(0,50).map(w=>`<div class="bk-email"><span>${bkEsc(w.name||"")}</span><span>${bkEsc(w.email)}</span></div>`).join(""):`<p class="h" style="margin:6px 0 0">Nobody yet.</p>`}</div>`;
  }).join("");
  const opted = d.contacts.filter(x=>x.opted_in);
  return `${wl}
    <div class="bk-card"><div class="bk-top"><h4>Your email list</h4><b style="color:#c49a1c;font-size:18px">${opted.length}</b></div>
      <p class="h">People who ticked "Send me Genie's emails". ${d.contacts.length} people in total have booked, joined a waitlist or paid.</p>
      <div class="bk-acts"><button class="bk-btn" onclick="bkCopy(BK.data.contacts.filter(x=>x.opted_in).map(x=>x.email).join(', '),'Emails copied')">Copy list emails</button><button class="bk-btn" onclick="bkCsv()">Download everyone (CSV)</button></div></div>`;
}
function bkCopyList(k){ bkCopy(BK.data.waitlist.filter(w=>w.list===k).map(w=>w.email).join(", "), "Emails copied"); }
function bkCsv(){
  const q = s => `"${String(s==null?"":s).replace(/"/g,'""')}"`;
  const rows = [["email","name","on_email_list","first_came_from","first_seen"]].concat(BK.data.contacts.map(x=>[x.email,x.name,x.opted_in?"yes":"no",x.first_source,(x.first_seen||"").slice(0,10)]));
  const blob = new Blob([rows.map(r=>r.map(q).join(",")).join("\n")], { type:"text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "genie-contacts.csv"; a.click();
}

/* ---------- Hours & settings ---------- */
function bkHours(d){
  const svc = (key, title, note)=>{
    const order = [1,2,3,4,5,6,0];
    const rows = order.map(wd=>{
      const r = d.rules.find(x=>x.service===key && x.weekday===wd);
      if(!r) return `<div class="bk-rule off"><span>${BK_DAYS[wd].slice(0,3)}</span><span style="grid-column:span 2;font-size:12px">Closed</span><button class="bk-btn" onclick="bkAddRule('${key}',${wd})">Open</button></div>`;
      return `<div class="bk-rule${r.active?"":" off"}"><span>${BK_DAYS[wd].slice(0,3)}</span>
        <input type="time" step="600" value="${r.start_time.slice(0,5)}" id="rs-${r.id}" ${r.active?"":"disabled"}>
        <input type="time" step="600" value="${r.end_time.slice(0,5)}" id="re-${r.id}" ${r.active?"":"disabled"}>
        <button class="bk-tog${r.active?" on":""}" title="${r.active?"Open":"Closed"}" onclick="bkToggleRule('${r.id}')"></button></div>`;
    }).join("");
    return `<div class="bk-card"><h4>${title}</h4><p class="h">${note}</p>${rows}
      <div class="bk-acts" style="margin-top:12px"><button class="bk-btn gold" onclick="bkSaveRules('${key}')">Save ${key==="free_call"?"call":"mentorship"} hours</button></div></div>`;
  };
  const s = d.settings, synced = s.calendar_synced_at ? new Date(s.calendar_synced_at).toLocaleString("en-GB",{ timeZone:"Africa/Lagos", hour:"numeric", minute:"2-digit", day:"numeric", month:"short" }) : "never";
  return `${svc("free_call","Clarity call hours","10-minute slots. Anything in your Google Calendar blocks the time on its own.")}
    ${svc("mentorship","Mentorship hours","Sessions start on the half hour inside these hours.")}
    <div class="bk-card"><h4>Settings</h4>
      <p class="h">Your WhatsApp number is only shown to people after they pay for mentorship. Leave it empty to keep it private.</p>
      <input class="bk-in" id="st-wa" placeholder="WhatsApp number for paid clients" value="${bkEsc(s.genie_whatsapp)}">
      <div class="bk-grid2"><label style="font-size:12px;color:#7a7a7a">Clarity calls: days ahead<input class="bk-in" id="st-cw" type="number" min="1" max="14" value="${bkEsc(s.booking_window_days)}" style="margin-top:4px"></label>
      <label style="font-size:12px;color:#7a7a7a">Mentorship: days ahead<input class="bk-in" id="st-mw" type="number" min="1" max="60" value="${bkEsc(s.mentorship_window_days)}" style="margin-top:4px"></label></div>
      <button class="bk-btn gold" onclick="bkSaveSettings(this)">Save settings</button>
      <p class="h" style="margin:14px 0 0">Google Calendar last synced: ${bkEsc(synced)} (every 5 minutes). New bookings are emailed to ${bkEsc(s.notify_email||"you")}.</p></div>`;
}
function bkToggleRule(id){
  const r = BK.data.rules.find(x=>x.id===id); if(!r) return;
  r.start_time = (el("rs-"+id)||{}).value || r.start_time; r.end_time = (el("re-"+id)||{}).value || r.end_time;
  r.active = !r.active; r._dirty = true; bkRender();
}
async function bkSaveRules(key){
  const rules = BK.data.rules.filter(r=>r.service===key);
  try{
    for(const r of rules){
      const st = (el("rs-"+r.id)||{}).value || r.start_time.slice(0,5), en = (el("re-"+r.id)||{}).value || r.end_time.slice(0,5);
      if(!r._dirty && st===r.start_time.slice(0,5) && en===r.end_time.slice(0,5)) continue;
      await bkFetch("save_rule", { id:r.id, start_time:st, end_time:en, active:!!r.active });
    }
    showToast("Hours saved. The booking page uses them right away.", "success"); bkRefresh();
  }catch(e){ showToast(e.message==="bad_time"?"The end time must be after the start time.":"Couldn't save: "+e.message, "error"); }
}
async function bkAddRule(key, wd){
  try{ await bkFetch("add_rule", { service:key, weekday:wd }); await bkLoad(); const r = BK.data.rules.find(x=>x.service===key && x.weekday===wd); if(r){ r.active = true; r._dirty = true; } bkRender(); showToast("Set the hours, then tap Save.", "info"); }
  catch(e){ showToast("Couldn't add: "+e.message, "error"); }
}
async function bkSaveSettings(btn){
  btn.disabled = true;
  try{ await bkFetch("save_settings", { genie_whatsapp:el("st-wa").value, booking_window_days:Number(el("st-cw").value), mentorship_window_days:Number(el("st-mw").value) }); showToast("Settings saved.", "success"); bkRefresh(); }
  catch(e){ showToast("Couldn't save: "+e.message, "error"); }
  btn.disabled = false;
}
