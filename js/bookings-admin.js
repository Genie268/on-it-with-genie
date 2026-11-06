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

function bkStylesExtra(){
  if(document.getElementById("bk-styles-x")) return;
  const st = document.createElement("style"); st.id = "bk-styles-x";
  st.textContent = `.bk-evpicks{display:flex;gap:8px;overflow-x:auto;padding:2px 0 12px;scrollbar-width:none}
  .bk-evpick{flex:none;min-width:120px;text-align:left;padding:10px 12px;border-radius:12px;background:#141414;border:1px solid #262626;color:#ddd;display:grid;gap:3px;font-family:inherit;cursor:pointer}
  .bk-evpick b{font-size:14px;color:#ededed}.bk-evpick span{font-size:12px;color:#8a8a8a}.bk-evpick.on{border-color:#c49a1c;background:#1c1810}.bk-evpick.new{border-style:dashed}
  .bk-chip{font-style:normal;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;justify-self:start;margin-top:3px}
  .bk-chip.green{background:rgba(77,201,138,.15);color:#4dc98a}.bk-chip.amber{background:rgba(196,154,28,.15);color:#e0b43a}.bk-chip.grey{background:#222;color:#888}
  .bk-evsum{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;padding-top:4px}.bk-evsum>div:first-child{display:grid;gap:4px}.bk-evsum b{font-size:15px;color:#ededed}.bk-evsum span{font-size:13px;color:#9a9a9a}
  .bk-lab{display:block;font-size:12px;color:#7a7a7a;margin-bottom:8px}.bk-lab .bk-in{margin-top:4px}
  .bk-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}@media(max-width:520px){.bk-grid3{grid-template-columns:1fr 1fr}}
  .bk-check{display:flex;gap:10px;align-items:center;font-size:14px;color:#ddd;margin:8px 0}.bk-check input{width:18px;height:18px;accent-color:#c49a1c}
  .bk-evform{border-top:1px solid #262626;padding-top:10px}`;
  document.head.appendChild(st);
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
  .bk-evhead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:2px 0 12px;font-size:15px;color:#cfcfcf;font-weight:700}
  .bk-evhead b{font-size:30px;font-weight:900;color:#ededed}.bk-evhead span{flex-basis:100%;font-size:12px;color:#777;font-weight:600}
  .bk-evq{font-size:16px!important;padding:14px!important;margin-bottom:12px}
  .bk-code{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#8a8a8a;letter-spacing:.06em;margin-top:3px}
  .bk-evbtn{flex:none;min-width:104px;padding:11px 14px;border-radius:11px;border:1.5px solid #c49a1c;background:transparent;color:#c49a1c;font:inherit;font-size:14px;font-weight:800;cursor:pointer}
  .bk-evbtn.on{background:#4dc98a;border-color:#4dc98a;color:#05140b}
  .bk-evrow.in{border-color:rgba(77,201,138,.35)}
  .sq-off{opacity:.6}
  .sq-stats{display:flex;flex-wrap:wrap;gap:14px;margin:10px 0 2px;font-size:12.5px;color:#8a8a8a}.sq-stats b{color:#ededed;font-size:16px;margin-right:3px}
  .sq-mems{margin-top:12px;display:grid;gap:8px}
  .sq-m{background:#080808;border:1px solid #1c1c1c;border-radius:12px;padding:12px}
  .sq-m b{color:#ededed;font-size:14px}.sq-g{color:#d6d6d6;font-size:14px;margin-top:4px;line-height:1.4}
  .sq-who{display:flex;align-items:center;gap:8px}.sq-who img,.sq-who i{width:28px;height:28px;border-radius:50%;object-fit:cover;flex:none}.sq-who i{display:grid;place-items:center;background:#222;color:#c49a1c;font-style:normal;font-weight:800;font-size:12px}
  .sq-media video{width:100%;max-height:260px;border-radius:10px;background:#000;margin-top:10px}
  .sq-media label{cursor:pointer}
  .sq-up{margin-top:8px;font-size:12px;color:#9a9a9a}.sq-up i{display:block;height:6px;border-radius:3px;background:#1c1c1c;margin-top:6px;overflow:hidden}.sq-up b{display:block;height:100%;width:0;background:#c49a1c;transition:width .2s}
  .sq-w{display:flex;gap:4px;margin-top:10px}
  .bk-switch{display:flex;align-items:center;justify-content:space-between;gap:14px}
  .vl{margin-top:12px;display:grid;gap:2px}
  .vl-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px 0;border-top:1px solid #1c1c1c}
  .vl-row:first-child{border-top:0}.vl-row .sq-up{grid-column:1/-1;margin:0}
  .vl-who{display:flex;align-items:center;gap:10px;min-width:0}.vl-who img,.vl-who i{width:38px;height:38px;border-radius:50%;object-fit:cover;flex:none}
  .vl-who i{display:grid;place-items:center;background:#222;color:#c49a1c;font-style:normal;font-weight:800}
  .vl-who b{display:block;color:#ededed;font-size:14px}.vl-who span{display:block;color:#8a8a8a;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
  .vl-act{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.vl-act label{cursor:pointer}
  .vl-ok{font-size:12px;font-weight:700;color:#4dc98a;margin-right:4px}.sq-w i{flex:1;height:22px;border-radius:6px;background:#161616;color:#666;font-style:normal;font-size:11px;font-weight:700;display:grid;place-items:center}
  .sq-w i.done{background:#178A4A;color:#fff}.sq-w i.partly{background:#C98A0B;color:#fff}.sq-w i.missed{background:#D7401C;color:#fff}.sq-w i.now{outline:1.5px solid #c49a1c;outline-offset:-1.5px}
  .bk-evby{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 12px}
  .bk-evby span{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#777;margin-right:2px}
  .bk-evby b{font-size:12.5px;font-weight:700;color:#ededed;background:#161616;border:1px solid #262626;border-radius:999px;padding:5px 10px}
  .bk-evby b i{font-style:normal;color:#c49a1c;margin-left:4px}.bk-evby b.ns{color:#8a8a8a}
  .bk-via{font-family:system-ui,sans-serif;letter-spacing:0;color:#c49a1c;font-weight:700;margin-left:6px}
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
  bkStylesExtra();
  const d = BK.data, now = Date.parse(d.now);
  const upcoming = d.bookings.filter(b=>b.status==="confirmed" && Date.parse(b.ends_at) > now);
  const optedIn = d.contacts.filter(x=>x.opted_in).length;
  const tabs = [["calls","Calls"],["event","Event"],["squads","Squads"],["videos","Videos"],["mentorship","Mentorship"],["test","Comm test"],["lists","Waitlists & emails"],["hours","Switches & hours"]];
  const body = { calls:bkCalls, event:bkEvent, squads:bkSquads, videos:bkVideos, mentorship:bkMentorship, test:bkTest, lists:bkLists, hours:bkHours }[BK.view](d, now);
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

/* ---------- Event: passes and door check-in ---------- */
/* which session the Event tab is showing: the one you picked, else the next one coming, else the latest */
function bkEvCur(){
  const evs = (BK.data && BK.data.events) || [], now = Date.now();
  if(BK.evCode && evs.some(e=>e.code===BK.evCode)) return BK.evCode;
  const up = evs.filter(e=>Date.parse(e.ends_at) > now).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))[0];
  return up ? up.code : (evs[0] ? evs[0].code : "");
}
function bkEvRows(){
  const all = (BK.data && BK.data.event_regs) || [], ev = bkEvCur();
  return all.filter(r=>r.event===ev);
}
const bkLagos = (iso, o) => new Date(iso).toLocaleString("en-GB", Object.assign({ timeZone:"Africa/Lagos" }, o));
const bkHM = iso => bkLagos(iso,{ hour:"2-digit", minute:"2-digit", hour12:false });
const bkYMD = iso => new Date(new Date(iso).getTime()+3600000).toISOString().slice(0,10);
function bkEvStatus(e){
  const now = Date.now();
  if(Date.parse(e.ends_at) < now) return ["Done","grey"];
  if(!e.published) return ["Hidden","grey"];
  return e.registration_open ? ["Passes open","green"] : ["Passes closed","amber"];
}
/* the session list + editor at the top of the Event tab */
function bkEvManage(d){
  const evs = d.events || [], cur = bkEvCur(), ed = BK.evEdit;
  const list = evs.map(e=>{ const [t,c] = bkEvStatus(e);
    return `<button class="bk-evpick${e.code===cur?" on":""}" onclick="BK.evCode='${e.code}';BK.evEdit=null;bkRender()">
      <b>Session ${bkEsc(e.session)}</b><span>${bkEsc(bkLagos(e.starts_at,{ weekday:"short", day:"numeric", month:"short" }))}</span><i class="bk-chip ${c}">${t}</i></button>`; }).join("");
  const e = ed === "new" ? null : evs.find(x=>x.code===cur);
  const form = ed ? bkEvForm(e, evs) : (e ? `<div class="bk-evsum">
      <div><b>${bkEsc(e.title)} · Session ${bkEsc(e.session)}</b>
      <span>${bkEsc(bkLagos(e.starts_at,{ weekday:"long", day:"numeric", month:"long" }))}, ${bkHM(e.starts_at)} to ${bkHM(e.ends_at)}</span>
      <span>${e.venue_short||e.venue ? bkEsc(e.venue_short||e.venue) + (e.address?` · ${bkEsc(e.address)}`:"") : `<em style="color:#c49a1c">No venue yet: the site says "Venue announced soon"</em>`}</span>
      <span>${e.capacity} seats · ${e.registration_open?"Passes open":"Passes closed (people can join the list)"}</span></div>
      <div class="bk-acts"><button class="bk-btn gold" onclick="BK.evEdit='edit';bkRender()">Edit</button>
      ${Date.parse(e.ends_at) > Date.now() ? `<button class="bk-btn" onclick="bkEvQuick('${e.code}',${!e.registration_open},this)">${e.registration_open?"Close passes":"Open passes"}</button>` : ""}</div></div>` : "");
  return `<div class="bk-card"><h4>Your sessions</h4><p class="h">What you set here is what the website, the passes and the emails show. The site always shows the next session that hasn't ended.</p>
    <div class="bk-evpicks">${list}<button class="bk-evpick new" onclick="BK.evEdit='new';bkRender()"><b>+ New session</b><span>Next one</span></button></div>
    ${form}</div>`;
}
function bkEvForm(e, evs){
  const nextNum = String(Math.max(0, ...evs.map(x=>+x.session||0)) + 1).padStart(2,"0");
  const last = evs[0] || {};
  const v = e ? { code:e.code, session:e.session, title:e.title, date:bkYMD(e.starts_at), start:bkHM(e.starts_at), end:bkHM(e.ends_at), venue:e.venue||"", venue_short:e.venue_short||"", address:e.address||"", maps:e.maps||"", capacity:e.capacity, open:e.registration_open, published:e.published }
    : { code:"", session:nextNum, title:last.title||"Forward with Genie", date:"", start:last.starts_at?bkHM(last.starts_at):"11:00", end:last.ends_at?bkHM(last.ends_at):"12:30", venue:"", venue_short:"", address:"", maps:"", capacity:last.capacity||20, open:false, published:true };
  const f = (id, label, val, extra="") => `<label class="bk-lab">${label}<input class="bk-in" id="${id}" value="${bkEsc(val)}" ${extra}></label>`;
  return `<div class="bk-evform">
    <h4 style="margin-top:6px">${e ? `Edit Session ${bkEsc(e.session)}` : "New session"}</h4>
    <div class="bk-grid2">${f("ef-session","Session number",v.session,'inputmode="numeric" maxlength="3"')}${f("ef-cap","Seats",v.capacity,'type="number" min="1" max="1000"')}</div>
    ${f("ef-title","Name",v.title,'maxlength="80"')}
    <div class="bk-grid3">${f("ef-date","Date",v.date,'type="date"')}${f("ef-start","Starts",v.start,'type="time" step="900"')}${f("ef-end","Ends",v.end,'type="time" step="900"')}</div>
    ${f("ef-vs","Venue (short, on the pass)",v.venue_short,'placeholder="e.g. Busy Mart, Jabi" maxlength="60"')}
    ${f("ef-venue","Venue name",v.venue,'placeholder="e.g. Busy Mart" maxlength="80"')}
    ${f("ef-addr","Full address",v.address,'placeholder="e.g. Suite TF2, 44 Ebitu Ukiwe, Jabi, Abuja" maxlength="200"')}
    ${f("ef-maps","Google Maps link (optional)",v.maps,'placeholder="Leave empty and it\'s made from the address"')}
    <label class="bk-check"><input type="checkbox" id="ef-open" ${v.open?"checked":""}> Passes open (people can get a free pass now)</label>
    <label class="bk-check"><input type="checkbox" id="ef-pub" ${v.published?"checked":""}> Show on the website</label>
    <p class="h" style="margin:8px 0 0">Leave the venue empty if you don't know it yet. The site will say "Venue announced soon" and people can join the list.</p>
    <div class="bk-acts" style="margin-top:12px"><button class="bk-btn gold" onclick="bkEvSave('${bkEsc(v.code)}',this)">${e?"Save changes":"Create session"}</button><button class="bk-btn" onclick="BK.evEdit=null;bkRender()">Cancel</button></div>
  </div>`;
}
async function bkEvSave(code, btn){
  const g = id => (document.getElementById(id)||{}).value || "";
  const body = { code, session:g("ef-session"), title:g("ef-title"), date:g("ef-date"), start:g("ef-start"), end:g("ef-end"), venue_short:g("ef-vs").trim(), venue:g("ef-venue").trim(), address:g("ef-addr").trim(), maps:g("ef-maps").trim(),
    capacity:g("ef-cap"), registration_open:document.getElementById("ef-open").checked, published:document.getElementById("ef-pub").checked };
  btn.disabled = true;
  try{ const r = await bkFetch("event_save", body); BK.evCode = r.code; BK.evEdit = null; showToast("Saved. The website shows it now.","success"); await bkRefresh(); }
  catch(e){ btn.disabled = false; showToast(e.message, "error"); }
}
async function bkEvQuick(code, open, btn){
  const e = (BK.data.events||[]).find(x=>x.code===code); if(!e) return;
  if(!confirm(open ? `Open passes for Session ${e.session}? People can get a free pass straight away.` : `Close passes for Session ${e.session}? People already holding one keep it. New people join the list instead.`)) return;
  btn.disabled = true;
  try{ await bkFetch("event_save",{ code, session:e.session, title:e.title, date:bkYMD(e.starts_at), start:bkHM(e.starts_at), end:bkHM(e.ends_at), venue:e.venue||"", venue_short:e.venue_short||"", address:e.address||"", maps:e.maps||"", capacity:e.capacity, registration_open:open, published:e.published });
    showToast(open?"Passes open":"Passes closed","success"); await bkRefresh(); }
  catch(err){ btn.disabled = false; showToast(err.message,"error"); }
}
const bkVia = r => r.ref ? r.ref.replace(/[-_]+/g," ").replace(/\b\w/g,c=>c.toUpperCase()) : (r.invited_by||"").trim();
function bkEvent(d){
  const rows = bkEvRows(), cur = (d.events||[]).find(e=>e.code===bkEvCur()), cap = cur ? cur.capacity : d.event_capacity;
  if(!rows.length) return bkEvManage(d) + `<div class="bk-empty">No passes for this session yet. They show up here as people sign up at eugeneobo.com/events.</div>`;
  const live = rows.filter(r=>!r.released_at), inn = live.filter(r=>r.checked_in).length, freed = rows.length-live.length;
  return bkEvManage(d) + `<div class="bk-evhead"><b>${inn}</b> of ${live.length} arrived<span>${live.length} of ${cap} passes taken${freed?` · ${freed} freed`:""}</span></div>
    ${(()=>{ const by={}; live.forEach(r=>{ const k=bkVia(r)||"Not said"; by[k]=(by[k]||0)+1; });
      const list=Object.entries(by).sort((a,b)=>(a[0]==="Not said")-(b[0]==="Not said")||b[1]-a[1]);
      return `<div class="bk-evby"><span>Invited by</span>${list.map(([k,n])=>`<b class="${k==="Not said"?"ns":""}">${bkEsc(k)} <i>${n}</i></b>`).join("")}</div>`; })()}
    <input class="bk-in bk-evq" id="bk-evq" type="search" placeholder="Search name or pass code" value="${bkEsc(BK.evq||"")}" oninput="BK.evq=this.value;bkEvList()" autocomplete="off">
    <div id="bk-evlist">${bkEvListHTML()}</div>
    <div class="bk-card" style="margin-top:18px"><h4>How the emails go</h4>
      <p class="h">6pm the evening before: reminder with their pass and a link to free their seat. Freed seats go to the waitlist by email. 4 hours after it ends: a follow-up to everyone marked <b>Arrived</b>, with their goal and the 15-day challenge. Tick people in at the door or they won't get it.</p></div>`;
}
function bkEvListHTML(){
  const q = (BK.evq||"").trim().toLowerCase().replace(/\s+/g," ");
  let rows = bkEvRows().filter(r=>!q || (r.name||"").toLowerCase().includes(q) || (r.pass_code||"").toLowerCase().includes(q) || (r.pass_code||"").toLowerCase().replace("-","").includes(q.replace("-","")));
  rows = rows.slice().sort((a,b)=>(!!a.released_at-!!b.released_at) || (a.checked_in-b.checked_in) || (a.name||"").localeCompare(b.name||""));
  if(!rows.length) return `<div class="bk-empty">No pass matches "${bkEsc(BK.evq)}".</div>`;
  return rows.map(r=>{
    const wa = bkWa(r.phone);
    return `<div class="bk-row bk-evrow${r.released_at?" cx":""}${r.checked_in?" in":""}">
      <div class="bk-top"><div><div class="bk-name" style="font-size:16px;margin:0">${bkEsc(r.name)}</div><div class="bk-code">${bkEsc(r.pass_code)}${bkVia(r)?` <span class="bk-via">via ${bkEsc(bkVia(r))}</span>`:""}</div></div>
        ${r.released_at?`<span class="bk-tag grey">Freed seat</span>`:`<button class="bk-evbtn${r.checked_in?" on":""}" onclick="bkCheckin('${r.id}',${!r.checked_in})">${r.checked_in?"✓ Arrived":"Arrived"}</button>`}</div>
      ${r.goal?`<div class="bk-note">"${bkEsc(r.goal)}"</div>`:""}
      <div class="bk-meta">${wa?`<a href="${wa}" target="_blank" rel="noopener">${bkEsc(r.phone)}</a>`:bkEsc(r.phone||"")}<span>${bkEsc(r.email)}</span></div>
    </div>`;
  }).join("");
}
function bkEvList(){ const n = document.getElementById("bk-evlist"); if(n) n.innerHTML = bkEvListHTML(); }
async function bkCheckin(id, value){
  const r = bkEvRows().find(x=>x.id===id); if(!r) return;
  const before = r.checked_in; r.checked_in = value;
  const head = document.querySelector(".bk-evhead b"); bkEvList();
  if(head){ head.textContent = bkEvRows().filter(x=>!x.released_at && x.checked_in).length; }
  try{ await bkFetch("checkin",{ id, value }); }
  catch(e){ r.checked_in = before; bkEvList(); showToast("Couldn't save. Check your connection.","error"); }
}

/* ---------- Squads: groups who declare a goal together ---------- */
const SQ_SITE = "https://eugeneobo.com";
function bkSquads(d){
  const sq = d.squads || [];
  const today = new Date(Date.now()+3600000).toISOString().slice(0,10);
  const next = (()=>{ const n = sq.length ? sq.length+1 : 1; return n; })();
  const list = sq.map(q=>{
    const link = `${SQ_SITE}/squad/${q.code}`, wk = Math.min(q.week, q.weeks);
    const started = q.members.filter(m=>m.started_at).length;
    const inWk = wk>=1 ? q.members.filter(m=>m.checkins[wk]).length : 0;
    return `<div class="bk-card${q.active?"":" sq-off"}">
      <div class="bk-top"><div><h4>${bkEsc(q.name)} <span class="bk-tag ${q.active?"free":"grey"}">${q.active?"Open":"Closed"}</span></h4>
        <div class="bk-code">${bkEsc(q.code)} · starts ${bkEsc(q.starts_on)} · ${q.weeks} weeks${q.week>=1&&q.week<=q.weeks?` · now week ${q.week}`:q.week>q.weeks?" · finished":""}</div></div></div>
      <div class="sq-stats"><span><b>${q.members.length}</b> declared</span><span><b>${started}</b> started</span>${wk>=1?`<span><b>${inWk}</b> checked in week ${wk}</span>`:""}</div>
      <div class="bk-acts">
        <a class="bk-btn gold" href="${link}?wall=1" target="_blank" rel="noopener">Open wall</a>
        <button class="bk-btn" onclick="bkCopy('${link}','Join link copied')">Copy join link</button>
        <button class="bk-btn" onclick="bkSquadToggle('${q.id}',${!q.active})">${q.active?"Close squad":"Reopen"}</button>
      </div>
      ${q.members.length ? `<div class="sq-mems">${q.members.map(m=>{ const wa = bkWa(m.phone); let wks=""; for(let w=1; w<=q.weeks; w++){ const c=m.checkins[w]; wks+=`<i class="${c?c.status:""}${w===q.week?" now":""}" title="Week ${w}${c&&c.note?": "+bkEsc(c.note):""}">${c?(c.status==="done"?"✓":c.status==="partly"?"½":"✕"):w}</i>`; }
        return `<div class="sq-m"><div class="bk-top"><div class="sq-who">${m.photo?`<img src="${bkEsc(m.photo)}" alt="">`:`<i>${bkEsc((m.name||"?").trim()[0].toUpperCase())}</i>`}<b>${bkEsc(m.name)}</b></div>${m.started_at?`<span class="bk-tag free">Started</span>`:""}</div>
          <div class="sq-g">${bkEsc(m.goal)}</div>
          <div class="bk-meta">${m.deadline?`<span>By ${bkEsc(m.deadline)}</span>`:""}${m.proof?`<span>Proof: ${bkEsc(m.proof)}</span>`:""}${wa?`<a href="${wa}" target="_blank" rel="noopener">${bkEsc(m.phone)}</a>`:""}<span>${bkEsc(m.email)}</span></div>
          <div class="sq-w">${wks}</div>
          <div class="sq-media">${m.video?`<video src="${bkEsc(m.video)}" ${m.cover?`poster="${bkEsc(m.cover)}"`:""} controls controlslist="nodownload" disablepictureinpicture playsinline preload="metadata"></video>`:""}
            <div class="bk-acts" style="margin-top:8px">
              <label class="bk-btn gold">${m.video?"Replace video":"Upload declaration video"}<input type="file" accept="video/*" hidden onchange="bkSqUpload(this,'${m.id}','video')"></label>${m.video?`<button class="bk-btn" onclick="bkCoverPicker('${m.id}')">${m.cover?"Change cover":"Pick cover"}</button>`:""}
              <label class="bk-btn">${m.photo?"Change photo":"Add photo"}<input type="file" accept="image/*" hidden onchange="bkSqUpload(this,'${m.id}','photo')"></label>
              <a class="bk-btn" href="${SQ_SITE}/squad/${q.code}/m/${m.id}" target="_blank" rel="noopener">Profile</a>
            </div><div class="sq-up" id="sq-up-${m.id}" hidden><span></span><i><b></b></i></div></div></div>`; }).join("")}</div>` : `<p class="h" style="margin:10px 0 0">Nobody yet. Put the wall on screen and have them scan the code.</p>`}
    </div>`;
  }).join("");
  return `${list || `<div class="bk-empty">No squads yet. Make one below for your next event.</div>`}
    <div class="bk-card" style="margin-top:18px"><h4>New squad</h4>
      <p class="h">People join at eugeneobo.com/squad/CODE, declare one goal, and check in every week. They get a reminder Friday 6pm. You get a summary Saturday 9am.</p>
      <input class="bk-in" id="sq-name" placeholder="Name, e.g. Forward Squad 07" value="Forward Squad ${String(next+5).padStart(2,"0")}">
      <input class="bk-in" id="sq-code" placeholder="Code, e.g. FWG07" value="FWG${String(next+5).padStart(2,"0")}" style="text-transform:uppercase;font-family:ui-monospace,Menlo,monospace">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><input class="bk-in" id="sq-start" type="date" value="${today}" title="Week 1 starts"><input class="bk-in" id="sq-weeks" type="number" min="1" max="12" value="4" title="Weeks"></div>
      <button class="bk-btn gold" onclick="bkSquadCreate(this)">Create squad</button></div>`;
}
/* upload straight to storage with a signed URL, showing progress (videos can be big on mobile data) */
function bkPut(url, blob, type, onprog){
  return new Promise((ok, no)=>{ const x = new XMLHttpRequest(); x.open("PUT", url); x.setRequestHeader("content-type", type); x.setRequestHeader("x-upsert","true");
    x.upload.onprogress = e=>{ if(e.lengthComputable && onprog) onprog(e.loaded/e.total); };
    x.onload = ()=> x.status < 300 ? ok() : no(new Error("upload "+x.status)); x.onerror = ()=>no(new Error("network")); x.send(blob); });
}
async function bkSqUpload(input, memberId, kind){
  const f = input.files && input.files[0]; input.value = ""; if(!f) return;
  if(kind === "video") return bkCoverPicker(memberId, f);
  const box = document.getElementById("sq-up-"+memberId), label = box.querySelector("span"), bar = box.querySelector("b");
  box.hidden = false; bar.style.width = "0%";
  try{
    label.textContent = "Uploading…";
    const type = f.type || "image/jpeg";
    const { url, path } = await bkFetch("squad_media_url",{ member_id:memberId, kind, type });
    await bkPut(url, f, type, r=>{ bar.style.width = Math.round(r*100)+"%"; });
    await bkFetch("squad_set_media",{ member_id:memberId, kind, path });
    showToast("Photo added","success"); await bkRefresh();
  }catch(e){ label.textContent = "Upload failed: " + e.message + ". Check your connection and try again."; }
}
/* pick the cover from the video's timeline. file = a new video to upload; no file = change the cover of the one already up */
function bkFindMember(id){ for(const q of (BK.data.squads||[])) for(const m of q.members) if(m.id===id) return m; return null; }
function bkCoverPicker(memberId, file){
  const m = bkFindMember(memberId) || {}, MB = file ? file.size/1048576 : 0;
  if(file && MB > 49){ showToast(`This video is ${MB.toFixed(0)}MB. The limit is 50MB.`, "error"); return; }
  const src = file ? URL.createObjectURL(file) : m.video;
  if(!src){ showToast("Upload the video first","error"); return; }
  const md = bkModal(`<h4>Pick the cover</h4><p>Drag the slider to the frame you want people to see before they press play.</p>
    <video id="cv-v" ${file?"":`crossorigin="anonymous"`} src="${bkEsc(src)}" muted playsinline preload="auto" style="width:100%;max-height:52vh;border-radius:10px;background:#000;display:block"></video>
    <input id="cv-r" type="range" min="0" max="1" step="0.04" value="0" style="width:100%;margin:14px 0 4px;accent-color:#c49a1c">
    <div id="cv-t" style="font-size:12px;color:#8a8a8a;margin-bottom:12px">0:00</div>
    <div class="sq-up" id="cv-up" hidden><span></span><i><b></b></i></div>
    <div class="bk-acts"><button class="bk-btn gold" id="cv-go" disabled>${file?"Use this frame and upload":"Save cover"}</button><button class="bk-btn" id="cv-no">Cancel</button></div>`);
  md.querySelector(":scope>div").style.maxWidth = "440px";
  const v = md.querySelector("#cv-v"), r = md.querySelector("#cv-r"), t = md.querySelector("#cv-t"), go = md.querySelector("#cv-go");
  const fmt = x=>`${Math.floor(x/60)}:${String(Math.floor(x%60)).padStart(2,"0")}`;
  const close = ()=>{ md.remove(); if(file) URL.revokeObjectURL(src); };
  md.querySelector("#cv-no").onclick = close;
  v.addEventListener("loadedmetadata", ()=>{ r.max = Math.max(0, v.duration - 0.1); const start = Math.min(1, v.duration/2); r.value = start; v.currentTime = start; t.textContent = fmt(start); go.disabled = false; });
  v.addEventListener("error", ()=>{ t.textContent = "This video won't play in this browser. Try Chrome, or upload an MP4."; });
  r.addEventListener("input", ()=>{ v.currentTime = +r.value; t.textContent = fmt(+r.value); });
  // iPhones won't load a video until it's played once; play-then-pause wakes it up
  v.play().then(()=>{ v.pause(); }).catch(()=>{});
  const frame = ()=> new Promise((ok, no)=>{ try{
      const w = Math.min(1080, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
      const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(v, 0, 0, w, h);
      c.toBlob(b=> b ? ok(b) : no(new Error("no frame")), "image/jpeg", 0.85);
    }catch(e){ no(e); } });
  go.onclick = async ()=>{
    go.disabled = true; r.disabled = true;
    const box = md.querySelector("#cv-up"), label = box.querySelector("span"); box.hidden = false;
    let cover;
    try{ cover = await frame(); }
    catch(e){ label.textContent = (e && e.name==="SecurityError") ? "Couldn't grab that frame. Upload the video again and pick the cover then." : "Couldn't grab that frame: " + (e.message||e); go.disabled = false; r.disabled = false; return; }
    // the upload carries on in the background so you can start the next person straight away
    close(); bkBgUpload(memberId, m.name || "Video", file, cover);
  };
}
/* background uploads: a small tray at the bottom shows each one; the list refreshes when they're all done */
const BK_UPS = {};
addEventListener("beforeunload", e=>{ if(Object.values(BK_UPS).some(x=>!x.done && !x.err)){ e.preventDefault(); e.returnValue = ""; } });
function bkTray(){
  let t = document.getElementById("bk-tray");
  const ids = Object.keys(BK_UPS);
  if(!ids.length){ if(t) t.remove(); return; }
  if(!t){ t = document.createElement("div"); t.id = "bk-tray"; t.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:8000;max-width:420px;margin:0 auto;background:#111;border:1px solid #2a2a2a;border-radius:14px;padding:10px 14px;box-shadow:0 10px 30px rgba(0,0,0,.5);font-size:13px;color:#ddd"; document.body.appendChild(t); }
  t.innerHTML = ids.map(id=>{ const u = BK_UPS[id];
    return `<div style="padding:6px 0"><div style="display:flex;justify-content:space-between;gap:10px"><b style="color:#ededed;font-weight:600">${bkEsc(u.name)}</b><span style="color:${u.err?"#ff6b6b":u.done?"#4dc98a":"#9a9a9a"}">${bkEsc(u.label)}</span></div>
      <i style="display:block;height:5px;border-radius:3px;background:#1c1c1c;margin-top:5px;overflow:hidden"><b style="display:block;height:100%;width:${u.pct}%;background:${u.err?"#ff6b6b":"#c49a1c"};transition:width .2s"></b></i></div>`; }).join("");
}
async function bkBgUpload(memberId, name, file, cover){
  const u = BK_UPS[memberId] = { name, pct:0, label:"Starting…", done:false, err:false }; bkTray();
  try{
    if(file){
      const type = file.type || "video/mp4", MB = file.size/1048576;
      const up = await bkFetch("squad_media_url",{ member_id:memberId, kind:"video", type });
      await bkPut(up.url, file, type, x=>{ u.pct = Math.round(x*95); u.label = `${Math.round(x*100)}% of ${MB.toFixed(0)}MB`; bkTray(); });
      await bkFetch("squad_set_media",{ member_id:memberId, kind:"video", path:up.path });
    }
    u.label = "Saving cover…"; bkTray();
    const cu = await bkFetch("squad_media_url",{ member_id:memberId, kind:"cover", type:"image/jpeg" });
    await bkPut(cu.url, cover, "image/jpeg");
    await bkFetch("squad_set_media",{ member_id:memberId, kind:"cover", path:cu.path });
    u.pct = 100; u.done = true; u.label = "Done ✓"; bkTray();
    setTimeout(()=>{ if(BK_UPS[memberId]===u){ delete BK_UPS[memberId]; bkTray(); } }, 2500);
  }catch(e){
    u.err = true; u.label = "Failed. Try again"; bkTray();
    setTimeout(()=>{ if(BK_UPS[memberId]===u){ delete BK_UPS[memberId]; bkTray(); } }, 8000);
  }
  // refresh the list once nothing is still uploading
  if(!Object.values(BK_UPS).some(x=>!x.done && !x.err)) bkRefresh();
}
async function bkSquadCreate(btn){
  const v = id => (document.getElementById(id).value||"").trim();
  btn.disabled = true;
  try{ await bkFetch("squad_create",{ name:v("sq-name"), code:v("sq-code"), starts_on:v("sq-start"), weeks:+v("sq-weeks") }); showToast("Squad created","success"); await bkRefresh(); }
  catch(e){ showToast(e.message==="code_taken"?"That code is taken":e.message==="bad_code"?"Code needs 3+ letters or numbers":"Couldn't create: "+e.message,"error"); btn.disabled=false; }
}
async function bkSquadToggle(id, active){
  try{ await bkFetch("squad_toggle",{ id, active }); showToast(active?"Squad reopened":"Squad closed","success"); await bkRefresh(); }
  catch(e){ showToast("Couldn't update","error"); }
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
/* ---------- Communication Gap Test ---------- */
function bkTest(d){
  const g = d.gap || { total:0, counts:{}, emails:0, recent:[] };
  const names = { freezer:"The Freezer", scrambler:"The Scrambler", over:"The Over-explainer", mumbler:"The Mumbler", peace:"The Peacekeeper", steady:"Steady" };
  const order = Object.keys(names).sort((a,b)=>(g.counts[b]||0)-(g.counts[a]||0));
  const max = Math.max(1, ...order.map(k=>g.counts[k]||0));
  const bars = order.map(k=>{ const n=g.counts[k]||0, pct=g.total?Math.round(n/g.total*100):0;
    return `<div style="display:grid;grid-template-columns:150px 1fr 70px;gap:10px;align-items:center;margin:8px 0;font-size:13px"><span style="color:#ededed;font-weight:700">${names[k]}</span><span style="height:10px;background:#1c1c1c;border-radius:99px;overflow:hidden"><i style="display:block;height:100%;width:${n/max*100}%;background:#c49a1c;border-radius:99px"></i></span><span style="color:#999;text-align:right">${n} · ${pct}%</span></div>`; }).join("");
  const recent = g.recent.length ? g.recent.map(r=>`<div class="bk-row" style="padding:10px 12px"><b style="color:#ededed">${bkEsc(names[r.type]||r.type)}</b>${r.second?` <span style="color:#777">with a bit of ${bkEsc(names[r.second]||r.second)}</span>`:""}<div style="font-size:12px;color:#777;margin-top:3px">${bkEsc(r.name||"")} ${bkEsc(r.email||"No email given")} · ${new Date(r.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</div></div>`).join("")
    : `<div class="bk-empty">Nobody has taken the test yet. Share eugeneobo.com/#test</div>`;
  return `<div class="bk-card"><div class="bk-top"><h4>How your audience splits</h4><b style="color:#c49a1c;font-size:18px">${g.total}</b></div>
      <p class="h">Everyone who finished the Communication Gap Test. ${g.emails} left their email. The biggest group is where your course should start.</p>${bars}</div>
    <div class="bk-day">Latest results</div>${recent}`;
}

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
  const freeOpen = d.rules.some(r=>r.service==="free_call" && r.active);
  const it = d.intake || { open:true }, itOpen = it.open !== false;
  const today = new Date(Date.now()+3600000).toISOString().slice(0,10);
  const itLine = !itOpen ? `Closed. The sign-up button is off${it.next_opens?` and the page says the next one opens ${bkEsc(it.next_opens)}`:""}.`
    : it.closes && it.closes < today ? `Closed by date (${bkEsc(it.closes)})${it.next_opens?`. Reopens by itself on ${bkEsc(it.next_opens)}`:""}.`
    : it.closes ? `Open until ${bkEsc(it.closes)}. The page shows a countdown.` : "Open. People can sign up any time.";
  return `<div class="bk-card"><div class="bk-switch" style="margin:0;padding:0;border:0;background:none"><div><h4>15-day challenge sign-ups</h4><p class="h" style="margin:0">${itLine}</p></div>
      <button class="bk-btn ${itOpen?"":"gold"}" onclick="bkIntake(${!itOpen}, this)">${itOpen ? "Close" : "Open"}</button></div>
      <div class="bk-grid3" style="margin-top:12px">
        <label class="bk-lab">Closes on (optional)<input class="bk-in" type="date" id="it-closes" value="${bkEsc(it.closes||"")}"></label>
        <label class="bk-lab">Next one opens (optional)<input class="bk-in" type="date" id="it-next" value="${bkEsc(it.next_opens||"")}"></label>
        <label class="bk-lab">People at a time<input class="bk-in" type="number" min="1" id="it-cap" value="${bkEsc(it.cap||"")}"></label></div>
      <div class="bk-acts"><button class="bk-btn gold" onclick="bkIntake(${itOpen}, this)">Save dates</button></div></div>
    <div class="bk-card bk-switch"><div><h4>Free clarity sessions</h4><p class="h" style="margin:0">${freeOpen ? "Open. People can book free 10-minute sessions." : "Closed for now. The tile shows greyed out and people are sent to coaching. Calls already booked still happen."}</p></div>
      <button class="bk-btn ${freeOpen?"":"gold"}" onclick="bkFreeCalls(${!freeOpen}, this)">${freeOpen ? "Close" : "Reopen"}</button></div>
    ${svc("free_call","Clarity call hours","10-minute slots. Anything in your Google Calendar blocks the time on its own.")}
    ${svc("mentorship","Mentorship hours","Sessions start on the half hour inside these hours.")}
    <div class="bk-card"><h4>Settings</h4>
      <p class="h">Your WhatsApp number is only shown to people after they pay for mentorship. Leave it empty to keep it private.</p>
      <input class="bk-in" id="st-wa" placeholder="WhatsApp number for paid clients" value="${bkEsc(s.genie_whatsapp)}">
      <div class="bk-grid2"><label style="font-size:12px;color:#7a7a7a">Clarity calls: days ahead<input class="bk-in" id="st-cw" type="number" min="1" max="14" value="${bkEsc(s.booking_window_days)}" style="margin-top:4px"></label>
      <label style="font-size:12px;color:#7a7a7a">Mentorship: days ahead<input class="bk-in" id="st-mw" type="number" min="1" max="60" value="${bkEsc(s.mentorship_window_days)}" style="margin-top:4px"></label></div>
      <button class="bk-btn gold" onclick="bkSaveSettings(this)">Save settings</button>
      <p class="h" style="margin:14px 0 0">Google Calendar last synced: ${bkEsc(synced)} (every 5 minutes). New bookings are emailed to ${bkEsc(s.notify_email||"you")}.</p></div>`;
}
async function bkIntake(open, btn){
  const g = id => (document.getElementById(id)||{}).value || "";
  const body = { open, closes:g("it-closes"), next_opens:g("it-next"), cap:g("it-cap") };
  const cur = (BK.data.intake||{}).open !== false;
  if(open !== cur && !confirm(open ? "Open the 15-day challenge? People can sign up straight away." : "Close the 15-day challenge? The sign-up button switches off. People already in carry on.")) return;
  btn.disabled = true;
  try{ await bkFetch("intake_save", body); showToast(open !== cur ? (open ? "Challenge open" : "Challenge closed") : "Saved","success"); await bkRefresh(); }
  catch(e){ btn.disabled = false; showToast(e.message,"error"); }
}
async function bkFreeCalls(open, btn){
  if(!confirm(open ? "Reopen free clarity sessions on your usual days?" : "Close free clarity sessions? Calls already booked still happen.")) return;
  btn.disabled = true;
  try{ await bkFetch("free_calls",{ open }); showToast(open ? "Free sessions reopened" : "Free sessions closed","success"); await bkRefresh(); }
  catch(e){ btn.disabled = false; showToast("Couldn't change it: " + e.message, "error"); }
}

/* ---------- Videos: one place to upload each person's declaration video ---------- */
function bkVideos(d){
  const sq = (d.squads||[]).filter(q=>q.members.length && q.code!=="ZZTEST");
  if(!sq.length) return `<div class="bk-empty">No squad members yet.</div>`;
  return sq.map(q=>{ const done = q.members.filter(m=>m.video).length;
    return `<div class="bk-card"><div class="bk-top"><div><h4>${bkEsc(q.name)}</h4><p class="h" style="margin:0">${done} of ${q.members.length} videos uploaded. Each video must be under 50MB.</p></div></div>
      <div class="vl">${q.members.map(m=>`<div class="vl-row">
        <div class="vl-who">${m.cover?`<img src="${bkEsc(m.cover)}" alt="" style="border-radius:8px;width:52px;height:38px">`:m.photo?`<img src="${bkEsc(m.photo)}" alt="">`:`<i>${bkEsc((m.name||"?").trim()[0].toUpperCase())}</i>`}<div><b>${bkEsc(m.name)}</b><span>${m.video?(m.cover?"Video and cover up":"Video up, no cover yet"):bkEsc(m.goal)}</span></div></div>
        <div class="vl-act">${m.video?`<span class="vl-ok">&#10003;</span><button class="bk-btn" onclick="bkCoverPicker('${m.id}')">${m.cover?"Change cover":"Pick cover"}</button>`:""}
          <label class="bk-btn ${m.video?"":"gold"}">${m.video?"Replace":"Upload video"}<input type="file" accept="video/*" hidden onchange="bkSqUpload(this,'${m.id}','video')"></label></div>
        <div class="sq-up" id="sq-up-${m.id}" hidden><span></span><i><b></b></i></div></div>`).join("")}</div>
      <p class="h" style="margin:12px 0 0">After you choose a video you pick the cover from its timeline, then it uploads. Each video must be under 50MB.</p></div>`; }).join("");
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
