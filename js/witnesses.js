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
  try{
    const { data } = await sb.from("witnesses").select("*")
      .eq("challenger_id", S.user.supabaseId)
      .order("invited_at", { ascending: true });
    S.witnesses = Array.isArray(data) ? data : [];
  }catch(e){ S.witnesses = S.witnesses || []; }
}

function _witList(){ return Array.isArray(S.witnesses) ? S.witnesses : []; }
function _witAccepted(){ return _witList().filter(w => w.status === "accepted"); }

/* ---------- the dashboard row (only when enabled) ---------- */
function renderWitnessRow(){
  const host = document.getElementById("witness-row");
  if(!host) return;
  if(!witnessesOn()){ host.innerHTML = ""; return; }

  const accepted = _witAccepted();
  const pending = _witList().filter(w => w.status === "pending").length;

  let faces = "";
  if(accepted.length){
    faces = `<div class="wit-faces">` + accepted.slice(0, 4).map(w => {
      const initial = (w.witness_email || "?").charAt(0).toUpperCase();
      return `<span class="wit-face">${initial}</span>`;
    }).join("") + `</div>`;
  }

  const label = accepted.length
    ? `<span class="wit-label"><b>${accepted.length}</b> witnessing${pending ? ` · ${pending} pending` : ""}</span>`
    : `<span class="wit-label">Invite someone to witness you</span>`;

  host.innerHTML =
    `<div class="wit-row" onclick="openWitnesses()">
       ${faces || `<span class="wit-eye">◠</span>`}
       ${label}
       <span class="wit-arrow">›</span>
     </div>`;
}

/* ---------- the witnesses screen ---------- */
function openWitnesses(){
  const accepted = _witAccepted();
  const pending = _witList().filter(w => w.status === "pending");

  const row = (w) => {
    const onPlatform = !!w.witness_challenger_id;
    const depth = w.depth === "proof" ? "Sees your proof" : "Signal only";
    const tag = w.status === "accepted"
      ? `<span class="wit-tag ok">WATCHING</span>`
      : `<span class="wit-tag pend">PENDING</span>`;
    return `<div class="wit-item">
      <span class="wit-face lg">${(w.witness_email || "?").charAt(0).toUpperCase()}</span>
      <div class="wit-item-i">
        <div class="wit-item-n">${_wEsc(w.witness_email)}</div>
        <div class="wit-item-r">${depth}${onPlatform ? " · on the platform" : ""}</div>
      </div>
      ${tag}
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

    <button class="bp" style="width:100%;padding:13px;margin-top:12px" onclick="openInviteWitness()">+ Invite a witness</button>
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
      Their email. If they're already on the platform, they'll see your proof.
      If not, they'll see whether you showed up.</p>

    <label style="font-size:11px;color:#888;font-weight:700">THEIR EMAIL</label>
    <input id="wit-email" type="email" inputmode="email" autocomplete="off"
      placeholder="name@email.com" style="margin:6px 0 14px;width:100%">

    <label style="font-size:11px;color:#888;font-weight:700">ONE LINE TO THEM</label>
    <textarea id="wit-msg" rows="2" placeholder="Why you're asking them, in a sentence."
      style="margin:6px 0 6px;width:100%"></textarea>
    <div style="font-size:10px;color:#5f5f5f;margin-bottom:14px">This is the only thing you ever say to them through the app.</div>

    <button id="wit-send" class="bp" style="width:100%;padding:13px" onclick="sendWitnessInvite()">Send the request →</button>
    <button class="bs" style="width:100%;padding:11px;margin-top:8px" onclick="openWitnesses()">Back</button>`);
}

async function sendWitnessInvite(){
  const email = (document.getElementById("wit-email")?.value || "").trim().toLowerCase();
  const msg = (document.getElementById("wit-msg")?.value || "").trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ showToast("Enter a valid email", "error"); return; }
  if(email === (S.user.email || "").toLowerCase()){ showToast("You can't witness yourself", "error"); return; }

  const btn = document.getElementById("wit-send");
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  try{
    /* Do they already have an account? That decides their depth. */
    let witnessCid = null, depth = "signal";
    try{
      const { data: acct } = await sb.from("challengers").select("id")
        .ilike("email", email).limit(1);
      if(acct && acct.length){ witnessCid = acct[0].id; depth = "proof"; }
    }catch(e){}

    const row = {
      challenger_id: S.user.supabaseId,
      witness_email: email,
      witness_challenger_id: witnessCid,
      depth,
      status: "pending",
    };
    const { data, error } = await sb.from("witnesses").insert(row).select().single();
    if(error){
      if(String(error.message || "").includes("duplicate")){ showToast("You already invited them", "info"); }
      else throw error;
    }else{
      S.witnesses = _witList().concat([data]);
      if(msg){ try{ await sb.from("witnesses").update({}).eq("id", data.id); }catch(e){} }
      /* fire the invite email via edge function (best effort) */
      try{
        await fetch(`${SUPABASE_URL}/functions/v1/witness-invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ witness_id: data.id, message: msg }),
        });
      }catch(e){}
    }
    if(typeof saveState === "function") saveState();
    showToast("Request sent", "success");
    renderWitnessRow();
    openWitnesses();
  }catch(e){
    if(btn){ btn.disabled = false; btn.textContent = "Send the request →"; }
    showToast("Could not send the request", "error");
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
