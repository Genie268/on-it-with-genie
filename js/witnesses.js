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
