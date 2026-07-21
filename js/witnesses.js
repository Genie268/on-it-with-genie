/* ============================================================
   witnesses.js — people who watch whether you show up.

   RULES:
   - Only appears if the challenger has witnesses_enabled (admin toggle).
   - On-platform witnesses (have a challenger account) see proof thumbnails.
     Invited-by-email witnesses see the SIGNAL only (uploaded / streak).
   - Witnesses never review, score, comment, or cheer. Genie reviews.
   - They hear from us only on a MISS (handled server-side).
   ============================================================ */

function witnessesOn(){ return !!(S.user && S.user.witnessesEnabled); }

async function loadWitnesses(){
  if(!S.user?.supabaseId || typeof sb === "undefined" || !sb) return;
  /* Refresh the enabled flag from the source of truth. Admin toggles it on
     the challenger row, and a returning user resumes from localStorage (which
     never carried the flag) — so without this the dashboard row would never
     appear until the user signed out and back in. */
  try{
    const { data: c } = await sb.from("challengers")
      .select("witnesses_enabled").eq("id", S.user.supabaseId).single();
    if(c){
      const on = c.witnesses_enabled === true;
      if(S.user.witnessesEnabled !== on){
        S.user.witnessesEnabled = on;
        if(typeof saveState === "function") saveState();
      }
    }
  }catch(e){}
  try{
    const { data } = await sb.from("witnesses").select("*")
      .eq("challenger_id", S.user.supabaseId)
      .order("invited_at", { ascending: true });
    S.witnesses = Array.isArray(data) ? data : [];
  }catch(e){ S.witnesses = S.witnesses || []; }
}

function _witList(){ return Array.isArray(S.witnesses) ? S.witnesses : []; }
function _witAccepted(){ return _witList().filter(w => w.status === "accepted"); }

/* ---------- "seen" bookkeeping for the new-feature signal ---------- */
function _witSeenKey(){ return "oiwg_wit_seen_" + (S.user?.supabaseId || "x"); }
function _witSeen(){ try{ return localStorage.getItem(_witSeenKey()) === "1"; }catch(e){ return false; } }
function _witMarkSeen(){ try{ localStorage.setItem(_witSeenKey(), "1"); }catch(e){} renderWitnessNavSignal(); }

/* The pulsing dot on the dashboard menu (profile) trigger — draws the eye to
   the new feature until it's been opened once. */
function renderWitnessNavSignal(){
  const dot = document.getElementById("menu-new-dot");
  if(!dot) return;
  dot.style.display = (witnessesOn() && !_witSeen()) ? "block" : "none";
}

/* ---------- the menu entry (lives in the profile sheet now) ---------- */
function renderWitnessRow(){
  renderWitnessNavSignal();
  const host = document.getElementById("profile-witness-entry");
  if(!host) return;
  if(!witnessesOn()){ host.innerHTML = ""; return; }

  const accepted = _witAccepted();
  const pending = _witList().filter(w => w.status === "pending").length;
  const sub = accepted.length
    ? `${accepted.length} witnessing${pending ? ` · ${pending} pending` : ""}`
    : "Invite someone to keep you honest";
  const newTag = _witSeen() ? "" : `<span class="wit-new-tag">NEW</span>`;

  host.innerHTML =
    `<div class="wit-menu-row" onclick="closeProfile();setTimeout(openWitnesses,180)">
       <span class="wit-menu-ico">◠</span>
       <div style="flex:1;min-width:0">
         <p style="font-size:14px;font-weight:700;margin:0">Witnesses${newTag}</p>
         <p style="font-size:11px;color:var(--muted);margin:2px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sub}</p>
       </div>
       <span class="wit-arrow">›</span>
     </div>`;
}

/* A witness is now known by a name, and reached by phone (WhatsApp) and/or
   email — email is no longer required. */
function _witDisplay(w){ return (w.witness_name || w.witness_email || w.witness_phone || "Someone"); }
function _witContactLine(w){
  const bits = [];
  if(w.witness_phone) bits.push("WhatsApp");
  if(w.witness_email) bits.push(w.witness_email);
  return bits.join(" · ");
}
/* WhatsApp wants a country-coded number, digits only (no +, spaces, dashes). */
function _normPhone(s){ return String(s||"").replace(/[^\d]/g, ""); }

/* ---------- the witnesses screen ---------- */
function openWitnesses(){
  _witMarkSeen();
  const accepted = _witAccepted();
  const pending = _witList().filter(w => w.status === "pending");

  const row = (w) => {
    const onPlatform = !!w.witness_challenger_id;
    const depth = w.depth === "proof" ? "Sees your proof" : "Signal only";
    const tag = w.status === "accepted"
      ? `<span class="wit-tag ok">WATCHING</span>`
      : `<span class="wit-tag pend">PENDING</span>`;
    /* WhatsApp button on every witness — for pending ones it (re)sends the
       invite (reliable path when email doesn't land); for accepted ones it
       nudges them with a fresh look at your progress. Straight to their
       number when we have it. */
    const mode = w.status === "accepted" ? "progress" : "invite";
    const reshare = w.invite_token
      ? `<button class="wit-x" style="color:#4dc98a;font-size:15px" title="${w.status === "accepted" ? "Nudge on WhatsApp" : "Send invite on WhatsApp"}" onclick="shareWitnessWhatsApp('${w.invite_token}','${_normPhone(w.witness_phone)}','${mode}')">↗</button>`
      : "";
    const name = _witDisplay(w);
    const contact = _witContactLine(w);
    return `<div class="wit-item">
      <span class="wit-face lg">${_wEsc(name).charAt(0).toUpperCase()}</span>
      <div class="wit-item-i">
        <div class="wit-item-n">${_wEsc(name)}</div>
        <div class="wit-item-r">${depth}${onPlatform ? " · on the platform" : (contact ? " · " + _wEsc(contact) : "")}</div>
      </div>
      ${tag}
      ${reshare}
      <button class="wit-x" onclick="revokeWitness('${w.id}')" aria-label="Remove">×</button>
    </div>`;
  };

  const body = `
    <div style="font-size:9px;letter-spacing:.14em;color:#7a7a7a;font-weight:800;margin-bottom:6px">WITNESSES</div>
    <h3 style="margin:0 0 4px;font-size:19px">Who's watching</h3>
    <p style="color:#7a7a7a;font-size:12px;line-height:1.55;margin:0 0 16px">
      They watch. They don't grade. Genie stays the only reviewer.</p>

    ${accepted.length ? accepted.map(row).join("") : ""}
    ${pending.length ? `<div style="font-size:9px;letter-spacing:.14em;color:#5f5f5f;font-weight:800;margin:14px 0 8px">PENDING</div>` + pending.map(row).join("") : ""}
    ${(!accepted.length && !pending.length) ? `<p style="color:#5f5f5f;font-size:12px;margin:0 0 14px">No witnesses yet. Ask someone whose opinion you'd hate to let down.</p>` : ""}

    ${_witActiveCount() >= WITNESS_MAX
      ? `<div style="text-align:center;font-size:11px;color:#7a7a7a;margin-top:14px">Your circle is full (${WITNESS_MAX}). Remove someone to add another.</div>`
      : `<button class="bp" style="width:100%;padding:13px;margin-top:12px" onclick="openInviteWitness()">+ Invite a witness <span style="opacity:.6;font-weight:400">· ${_witActiveCount()}/${WITNESS_MAX}</span></button>`}
    <div style="margin-top:14px;padding:12px 13px;border-radius:11px;background:rgba(196,154,28,.05);
      border:1px solid rgba(196,154,28,.16);font-size:11.5px;line-height:1.6;color:#bcbcbc">
      No likes. No comments. They hear from us only when you <b style="color:#c49a1c">miss</b>. Silence means you showed up.
    </div>
    <button class="bs" style="width:100%;padding:11px;margin-top:10px" onclick="closeWitMod()">Done</button>`;

  _witOpen(body);
}

/* ---------- invite ---------- */
function openInviteWitness(){
  _witOpen(`
    <div style="font-size:9px;letter-spacing:.14em;color:#7a7a7a;font-weight:800;margin-bottom:6px">INVITE A WITNESS</div>
    <h3 style="margin:0 0 4px;font-size:19px">Ask someone to witness you</h3>
    <p style="color:#7a7a7a;font-size:12px;line-height:1.55;margin:0 0 14px">
      Their name, and a WhatsApp number or email — whichever you have.
      A number lets you send the invite straight to their WhatsApp.</p>

    <label style="font-size:11px;color:#888;font-weight:700">THEIR NAME</label>
    <input id="wit-name" type="text" autocomplete="off"
      placeholder="e.g. Ada" style="margin:6px 0 12px;width:100%">

    <label style="font-size:11px;color:#888;font-weight:700">WHATSAPP NUMBER</label>
    <input id="wit-phone" type="tel" inputmode="tel" autocomplete="off"
      placeholder="+234 801 234 5678" style="margin:6px 0 12px;width:100%">

    <div style="text-align:center;font-size:10px;color:#5f5f5f;margin-bottom:12px">— and / or —</div>

    <label style="font-size:11px;color:#888;font-weight:700">EMAIL <span style="font-weight:400;color:#5f5f5f">(optional)</span></label>
    <input id="wit-email" type="email" inputmode="email" autocomplete="off"
      placeholder="name@email.com" style="margin:6px 0 14px;width:100%">

    <button id="wit-send" class="bp" style="width:100%;padding:13px" onclick="sendWitnessInvite()">Create invite →</button>
    <button class="bs" style="width:100%;padding:11px;margin-top:8px" onclick="openWitnesses()">Back</button>`);
  setTimeout(()=>{ const n=document.getElementById("wit-name"); if(n) n.focus(); }, 60);
}

/* The public link a witness opens. Uses a query param on the root path so
   it works on ANY host with no server-side rewrite needed (a bare /witness/
   path only resolves if the host rewrites unknown paths to index.html). */
function _witnessLink(token){ return `${window.location.origin}/?witness=${token}`; }
function _witnessShareText(token, mode){
  if(mode === "progress"){
    return `Checking in with my witness 👀 — here's where I'm at on the challenge you're watching: ${_witnessLink(token)}`;
  }
  return `I'm doing a challenge on On It With Genie and I'd like you to witness me — you'll just see whether I show up each day, nothing to do on your end. Say yes here: ${_witnessLink(token)}`;
}
/* Given a phone (digits, country-coded) send straight to that person's
   WhatsApp; otherwise open the share picker. mode 'invite' (default) or
   'progress' (nudge an accepted witness with a live progress link). */
function shareWitnessWhatsApp(token, phone, mode){
  const digits = _normPhone(phone);
  const base = digits ? `https://wa.me/${digits}` : `https://wa.me/`;
  window.open(`${base}?text=${encodeURIComponent(_witnessShareText(token, mode))}`, "_blank");
}
function copyWitnessLink(token){
  const link = _witnessLink(token);
  try{
    navigator.clipboard.writeText(link);
    showToast("Link copied", "success");
  }catch(e){
    /* Fallback for browsers without clipboard API */
    const t = document.createElement("textarea");
    t.value = link; document.body.appendChild(t); t.select();
    try{ document.execCommand("copy"); showToast("Link copied", "success"); }
    catch(_e){ showToast("Couldn't copy — long-press the link", "error"); }
    t.remove();
  }
}

/* After the invite row exists, show the share step (WhatsApp is the reliable
   delivery path; email is best-effort behind the scenes). */
function _witnessShareStep(w){
  const phone = _normPhone(w.witness_phone);
  const waLabel = phone ? `Send to ${_wEsc(_witDisplay(w))} on WhatsApp` : "Share on WhatsApp";
  _witOpen(`
    <div style="font-size:9px;letter-spacing:.14em;color:#7a7a7a;font-weight:800;margin-bottom:6px">SEND THE INVITE</div>
    <h3 style="margin:0 0 4px;font-size:19px">Invite ready for ${_wEsc(_witDisplay(w))}</h3>
    <p style="color:#7a7a7a;font-size:12px;line-height:1.55;margin:0 0 16px">
      Send them this link. They tap it, say yes, and they're witnessing you.
      They only hear from us when you miss a day.</p>

    <button class="bp" style="width:100%;padding:14px;font-size:15px;background:#25D366;color:#062b16" onclick="shareWitnessWhatsApp('${w.invite_token}','${phone}')">
      ${waLabel}
    </button>
    <button class="bs" style="width:100%;padding:12px;margin-top:9px" onclick="copyWitnessLink('${w.invite_token}')">Copy link instead</button>
    <div style="margin-top:14px;word-break:break-all;font-size:11px;color:#5f5f5f;background:#111;border:1px solid #1e1e1e;border-radius:9px;padding:10px 12px">${_witnessLink(w.invite_token)}</div>
    <button class="bs" style="width:100%;padding:11px;margin-top:12px" onclick="openWitnesses()">Done</button>`);
}

/* A witness circle is meant to be small and meaningful — a handful of people
   whose opinion you'd hate to let down, not a broadcast list. Cap keeps it
   that way and stops accidental invite spam. Only pending/accepted count. */
const WITNESS_MAX = 5;
function _witActiveCount(){ return _witList().filter(w => w.status === "pending" || w.status === "accepted").length; }

async function sendWitnessInvite(){
  const name = (document.getElementById("wit-name")?.value || "").trim();
  const email = (document.getElementById("wit-email")?.value || "").trim().toLowerCase();
  const phoneRaw = (document.getElementById("wit-phone")?.value || "").trim();
  const phone = _normPhone(phoneRaw);

  if(name.length < 1){ showToast("Add their name", "error"); return; }
  if(!email && !phone){ showToast("Add a WhatsApp number or an email", "error"); return; }
  if(email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ showToast("That email doesn't look right", "error"); return; }
  if(phone && phone.length < 7){ showToast("That number looks too short — include the country code", "error"); return; }
  if(email && email === (S.user.email || "").toLowerCase()){ showToast("You can't witness yourself", "error"); return; }

  const btn = document.getElementById("wit-send");
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  const _reset = () => { if(btn){ btn.disabled = false; btn.textContent = "Create invite →"; } };

  try{
    /* Already in the circle (pending or accepted)? Just re-open its share
       step instead of erroring on the unique key. Match on email OR phone. */
    const active = _witList().find(w => (w.status === "pending" || w.status === "accepted") &&
      ((email && (w.witness_email||"").toLowerCase() === email) || (phone && _normPhone(w.witness_phone) === phone)));
    if(active && active.invite_token){ _reset(); _witnessShareStep(active); return; }

    /* Circle full — block new people (re-inviting an existing one above is
       always allowed). */
    if(_witActiveCount() >= WITNESS_MAX){
      _reset();
      showToast(`Your circle is full (${WITNESS_MAX} witnesses). Remove one to add another.`, "info");
      openWitnesses();
      return;
    }

    /* Do they already have an account? Email is the reliable identity match,
       so on-platform "proof" depth is granted when the email matches a
       challenger. Phone-only invites default to signal (safe). */
    let witnessCid = null, depth = "signal";
    if(email){
      try{
        const { data: acct } = await sb.from("challengers").select("id").ilike("email", email).limit(1);
        if(acct && acct.length){ witnessCid = acct[0].id; depth = "proof"; }
      }catch(e){}
    }

    /* Reactivate a prior revoked/declined invite for this same contact rather
       than inserting a duplicate (unique keys on email and on phone). Look up
       by email first, then phone — separate queries keep it robust. */
    let data = null, prior = null;
    try{
      if(email){
        const { data: pr } = await sb.from("witnesses").select("*")
          .eq("challenger_id", S.user.supabaseId).ilike("witness_email", email).limit(1);
        if(pr && pr.length) prior = pr[0];
      }
      if(!prior && phone){
        const { data: pr2 } = await sb.from("witnesses").select("*")
          .eq("challenger_id", S.user.supabaseId).eq("witness_phone", phone).limit(1);
        if(pr2 && pr2.length) prior = pr2[0];
      }
    }catch(e){}

    const fields = {
      witness_name: name,
      witness_email: email || null,
      witness_phone: phone || null,
      witness_challenger_id: witnessCid,
      depth, status: "pending", responded_at: null,
    };
    if(prior){
      const { data: upd } = await sb.from("witnesses").update(fields).eq("id", prior.id).select().single();
      data = upd || { ...prior, ...fields };
    }else{
      const { data: ins, error } = await sb.from("witnesses")
        .insert({ challenger_id: S.user.supabaseId, ...fields }).select().single();
      if(error) throw error;
      data = ins;
    }

    /* Refresh local state from the row we just wrote. */
    S.witnesses = _witList().filter(w => w.id !== data.id).concat([data]);
    /* Fire the invite email too (best effort — only lands if email is
       configured; WhatsApp is the primary path). */
    try{
      fetch(`${SUPABASE_URL}/functions/v1/witness-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ witness_id: data.id, message: "" }),
      }).catch(()=>{});
    }catch(e){}
    if(typeof saveState === "function") saveState();
    renderWitnessRow();
    _witnessShareStep(data);
  }catch(e){
    _reset();
    showToast("Could not create the invite", "error");
  }
}

async function revokeWitness(id){
  if(!confirm("Remove this witness?")) return;
  try{ await sb.from("witnesses").update({ status: "revoked" }).eq("id", id); }catch(e){}
  S.witnesses = _witList().filter(w => w.id !== id);
  if(typeof saveState === "function") saveState();
  renderWitnessRow();
  openWitnesses();
}

/* ---------- modal plumbing (reuse the goal modal shell) ---------- */
function _witOpen(inner){
  let m = document.getElementById("wit-mod");
  if(!m){
    m = document.createElement("div");
    m.id = "wit-mod";
    m.style.cssText = "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.75);display:flex;" +
      "align-items:center;justify-content:center;padding:18px";
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="mb" style="max-width:420px;max-height:90vh;overflow-y:auto">${inner}</div>`;
  m.style.display = "flex";
}
function closeWitMod(){
  const m = document.getElementById("wit-mod");
  if(m){ m.style.display = "none"; m.innerHTML = ""; }
}
function _wEsc(t){ return String(t == null ? "" : t).replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

/* ============================================================
   WITNESS VIEW — the page someone lands on from an invite link
   (/witness/<token>). No account or app session required; all data
   comes from the witness-view edge function keyed by the token.
   ============================================================ */
let _witViewToken = null;

async function _witViewCall(action){
  const res = await fetch(`${SUPABASE_URL}/functions/v1/witness-view`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ token: _witViewToken, action }),
  });
  return res.json();
}

async function initWitnessView(token){
  _witViewToken = token;
  const host = document.getElementById("witness-view-body");
  if(!host) return;
  try{
    const r = await _witViewCall("get");
    _renderWitnessView(r);
  }catch(e){
    host.innerHTML = `<div style="text-align:center;padding:50px 0;color:#8a8a8a;font-size:13px">This link isn't working. Ask them to send it again.</div>`;
  }
}

function _renderWitnessView(r){
  const host = document.getElementById("witness-view-body");
  if(!host) return;
  if(!r || r.ok === false){
    const msg = r && r.error === "revoked" ? "This witness link was turned off."
      : r && r.error === "not_found" ? "We couldn't find this invitation."
      : "This link isn't valid.";
    host.innerHTML = `<div style="text-align:center;padding:50px 0;color:#8a8a8a;font-size:13px">${msg}</div>`;
    return;
  }
  const c = r.challenger, s = r.stats, w = r.witness;
  const who = _wEsc(c.name);
  const pending = w.status === "pending";

  // progress grid
  const cells = (r.days || []).map(d => {
    let bg = "#141414", bd = "#1e1e1e", txt = "#4a4a4a", mark = "";
    if(d.state === "up"){ bg = "rgba(77,201,138,.13)"; bd = "rgba(77,201,138,.4)"; txt = "#4dc98a"; mark = "✓"; }
    else if(d.state === "miss"){ bg = "rgba(217,80,58,.08)"; bd = "rgba(217,80,58,.28)"; txt = "#d9503a"; mark = "·"; }
    else if(d.state === "today"){ bg = "rgba(196,154,28,.08)"; bd = "rgba(196,154,28,.4)"; txt = "#c49a1c"; mark = "•"; }
    const thumb = (s.seesProof && d.fileUrl)
      ? `background-image:linear-gradient(rgba(10,10,10,.35),rgba(10,10,10,.55)),url('${d.fileUrl}');background-size:cover;background-position:center;`
      : "";
    return `<div style="aspect-ratio:1;border-radius:8px;border:1px solid ${bd};background:${bg};${thumb}
      display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative">
      <span style="font-size:8px;color:${thumb?"#e8e8e8":"#5a5a5a"};font-weight:700">D${d.n}</span>
      ${mark?`<span style="font-size:11px;color:${thumb?"#fff":txt};font-weight:800;line-height:1">${mark}</span>`:""}
    </div>`;
  }).join("");

  host.innerHTML = `
    <div style="text-align:center;margin-bottom:22px">
      <div style="font-size:9px;letter-spacing:.16em;color:#7a7a7a;font-weight:800;margin-bottom:8px">YOU'RE WITNESSING</div>
      <h2 style="font-size:23px;font-weight:800;margin:0 0 6px">${who}</h2>
      <p style="color:#8a8a8a;font-size:13px;margin:0">Day ${c.day} of ${c.dur}${c.finished?" · challenge complete":""}</p>
    </div>

    <div class="wit-item" style="justify-content:space-around;text-align:center;padding:14px 11px">
      <div><div style="font-size:22px;font-weight:900;color:#4dc98a">${s.uploaded}</div><div style="font-size:9px;color:#7a7a7a;font-weight:700;letter-spacing:.05em">SHOWED UP</div></div>
      <div style="width:1px;background:#242424;align-self:stretch"></div>
      <div><div style="font-size:22px;font-weight:900;color:${s.streak>0?"#c49a1c":"#5a5a5a"}">${s.streak}</div><div style="font-size:9px;color:#7a7a7a;font-weight:700;letter-spacing:.05em">DAY STREAK</div></div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin:16px 0 6px">${cells}</div>
    <p style="text-align:center;font-size:10.5px;color:#5f5f5f;margin:0 0 20px">
      ${s.seesProof ? "You can see their proof because you're on the platform too." : "You see whether they showed up. Not the proof itself."}
    </p>

    ${pending ? `
      <div style="padding:14px;border-radius:12px;background:rgba(196,154,28,.05);border:1px solid rgba(196,154,28,.16);margin-bottom:12px">
        <p style="font-size:12.5px;line-height:1.6;color:#c9c9c9;margin:0">
          Say yes and you'll get a note <b style="color:#c49a1c">only when ${who} misses a day</b>.
          No likes, no comments — you just quietly witness. Silence means they showed up.</p>
      </div>
      <button id="wit-accept-btn" class="bp" style="width:100%;padding:14px;font-size:15px" onclick="acceptWitness()">Yes, I'll witness them</button>
      <button class="bs" style="width:100%;padding:11px;margin-top:8px" onclick="declineWitness()">Not right now</button>
    ` : w.status === "accepted" ? `
      <div style="text-align:center;padding:14px;border-radius:12px;background:rgba(77,201,138,.06);border:1px solid rgba(77,201,138,.22)">
        <p style="font-size:13px;color:#4dc98a;font-weight:700;margin:0 0 3px">You're witnessing ${who} ✓</p>
        <p style="font-size:11.5px;color:#8a8a8a;margin:0">We'll email you only when they miss a day.</p>
      </div>
    ` : `
      <div style="text-align:center;padding:14px;color:#8a8a8a;font-size:12.5px">You declined this invitation.</div>
    `}`;
}

async function acceptWitness(){
  const btn = document.getElementById("wit-accept-btn");
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try{
    const r = await _witViewCall("accept");
    _renderWitnessView(r);
  }catch(e){
    if(btn){ btn.disabled = false; btn.textContent = "Yes, I'll witness them"; }
    if(typeof showToast === "function") showToast("Couldn't accept — try again", "error");
  }
}

async function declineWitness(){
  try{
    const r = await _witViewCall("decline");
    _renderWitnessView(r);
  }catch(e){}
}
