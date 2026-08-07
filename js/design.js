/* ============================================================
   design.js — In-admin visual design editor (Design tab).

   A live preview of the landing page plus a control panel. Every control
   updates the preview instantly by writing CSS variables onto the preview
   stage (never the admin chrome). Draft / Publish / Revert / Undo manage what
   reaches the live site (site_config, read by theme.js on every visitor).

   Presentation only. Touches no auth, payment, upload or review logic.
   ============================================================ */
const DZ = (function(){
  const T = () => window.OIWG_THEME;
  const DRAFT_KEY = "oiwg_theme_draft";

  const FONTS = [
    ["'DM Sans', system-ui, sans-serif","DM Sans"],
    ["'Inter', system-ui, sans-serif","Inter"],
    ["'Poppins', sans-serif","Poppins"],
    ["'Montserrat', sans-serif","Montserrat"],
    ["'Space Grotesk', sans-serif","Space Grotesk"],
    ["'Oswald', sans-serif","Oswald"],
    ["'Bebas Neue', sans-serif","Bebas Neue"],
    ["'Archivo Black', sans-serif","Archivo Black"],
    ["'Playfair Display', serif","Playfair Display"],
    ["'DM Serif Display', serif","DM Serif Display"],
    ["'Lora', serif","Lora"],
    ["Helvetica, Arial, sans-serif","Helvetica"],
    ["Georgia, serif","Georgia"]
  ];

  let draft = null, published = null, editMode = false, selectedBlock = null, blockCounter = 0;

  /* ---------- state helpers ---------- */
  function loadDraftFromStorage(){
    try{ const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); return v && typeof v === "object" ? v : null; }
    catch(e){ return null; }
  }
  function saveDraftToStorage(){ try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }catch(e){} }

  function _get(path){ return path.split(".").reduce((o,k)=> (o == null ? o : o[k]), draft); }
  function set(path, value){
    const parts = path.split(".");
    let o = draft;
    for(let i=0;i<parts.length-1;i++){ if(o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
    o[parts[parts.length-1]] = value;
    applyPreview();
  }
  /* Booleans from checkboxes */
  function setBool(path, checked){ set(path, !!checked); }
  function setNum(path, value, unit){ set(path, (unit ? (value+unit) : Number(value))); }

  /* ---------- apply the draft to the preview stage only ---------- */
  function applyPreview(){
    const stage = document.getElementById("dz-stage");
    if(!stage || !T()) return;
    T().applyTheme(draft, stage);
    T().applyGrain(draft, document.getElementById("dz-grain"));
    const layer = document.getElementById("dz-canvas");
    T().renderCanvas(draft, layer, { editable: editMode });
    if(editMode) wireDrag();
    const be = document.getElementById("dz-block-editor");
    if(be) renderBlockEditor();
  }

  /* ---------- drag (photo + text blocks) ---------- */
  function wireDrag(){
    const stage = document.getElementById("dz-stage");
    const layer = document.getElementById("dz-canvas");
    if(!stage || !layer) return;
    layer.querySelectorAll(".dz-text,.dz-photo").forEach(elm => {
      elm.onpointerdown = (e) => {
        e.preventDefault();
        const isPhoto = elm.dataset.dz === "photo";
        const id = elm.dataset.id;
        if(!isPhoto) selectBlock(id);
        const rect = stage.getBoundingClientRect();
        const move = (ev) => {
          let x = ((ev.clientX - rect.left) / rect.width) * 100;
          let y = ((ev.clientY - rect.top) / rect.height) * 100;
          x = Math.max(0, Math.min(100, x)); y = Math.max(0, Math.min(100, y));
          elm.style.left = x + "%"; elm.style.top = y + "%";
          if(isPhoto){ draft.photo.x = Math.round(x); draft.photo.y = Math.round(y); }
          else { const b = (draft.textBlocks||[]).find(bl => bl.id === id); if(b){ b.x = Math.round(x); b.y = Math.round(y); } }
        };
        const up = () => {
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
      };
    });
  }

  /* ---------- text blocks ---------- */
  function addTextBlock(){
    if(!Array.isArray(draft.textBlocks)) draft.textBlocks = [];
    const id = "b" + (Date.now().toString(36)) + (blockCounter++);
    draft.textBlocks.push({ id, content:"New text", x:50, y:50, size:26, weight:700, color:"#ffffff", font:"var(--font-heading)", maxWidth:70 });
    if(!editMode) toggleEdit(true);
    selectedBlock = id;
    applyPreview();
  }
  function deleteBlock(id){
    draft.textBlocks = (draft.textBlocks||[]).filter(b => b.id !== id);
    if(selectedBlock === id) selectedBlock = null;
    applyPreview();
  }
  function selectBlock(id){ selectedBlock = id; renderBlockEditor(); }
  function updateBlock(id, key, value){
    const b = (draft.textBlocks||[]).find(bl => bl.id === id);
    if(!b) return;
    b[key] = (key === "size" || key === "weight" || key === "maxWidth") ? Number(value) : value;
    applyPreview();
  }

  function renderBlockEditor(){
    const box = document.getElementById("dz-block-editor");
    if(!box) return;
    const b = (draft.textBlocks||[]).find(bl => bl.id === selectedBlock);
    if(!b){ box.innerHTML = `<p style="font-size:11px;color:#5a5a5a">Add a text block, then tap it in the preview to edit it.</p>`; return; }
    const fontOpts = FONTS.map(f => `<option value="${f[0]}"${b.font===f[0]?" selected":""}>${f[1]}</option>`).join("")
      + `<option value="var(--font-heading)"${b.font==="var(--font-heading)"?" selected":""}>Heading font</option>`
      + `<option value="var(--font-body)"${b.font==="var(--font-body)"?" selected":""}>Body font</option>`;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="ch-block-lbl" style="margin:0">SELECTED TEXT</span>
        <button onclick="DZ.deleteBlock('${b.id}')" style="background:none;border:1px solid rgba(217,80,58,.4);color:#d9503a;font-size:11px;padding:4px 10px;border-radius:7px;cursor:pointer;font-family:inherit">Delete</button>
      </div>
      <textarea oninput="DZ.updateBlock('${b.id}','content',this.value)" rows="2" style="width:100%;font-size:13px;margin-bottom:8px">${(b.content||"").replace(/</g,"&lt;")}</textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <label style="font-size:11px;color:#888">Font<select onchange="DZ.updateBlock('${b.id}','font',this.value)" style="width:100%;font-size:12px;padding:6px">${fontOpts}</select></label>
        <label style="font-size:11px;color:#888">Colour<input type="color" value="${b.color||'#ffffff'}" oninput="DZ.updateBlock('${b.id}','color',this.value)" style="width:100%;height:32px;padding:2px;background:#111;border:1px solid #222;border-radius:6px"></label>
        <label style="font-size:11px;color:#888">Size ${b.size}px<input type="range" min="10" max="80" value="${b.size}" oninput="DZ.updateBlock('${b.id}','size',this.value);this.previousSibling.textContent='Size '+this.value+'px'" style="width:100%"></label>
        <label style="font-size:11px;color:#888">Weight<select onchange="DZ.updateBlock('${b.id}','weight',this.value)" style="width:100%;font-size:12px;padding:6px">${[400,500,600,700,800,900].map(w=>`<option value="${w}"${+b.weight===w?" selected":""}>${w}</option>`).join("")}</select></label>
      </div>`;
  }

  /* ---------- photo upload ---------- */
  async function uploadPhoto(input){
    const file = input.files && input.files[0];
    if(!file) return;
    const status = document.getElementById("dz-photo-status");
    if(status) status.textContent = "Uploading...";
    try{
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `design/photo-${Date.now()}.${ext}`;
      let url = null;
      if(typeof uploadToStorage === "function"){
        url = await uploadToStorage("site-assets", path, file, file.type || "image/png");
      }
      if(!url) throw new Error("upload failed");
      draft.photo.src = url;
      if(draft.photo.placement === "hidden") draft.photo.placement = "above";
      draft.photo.x = draft.photo.x || 50; draft.photo.y = draft.photo.y || 30;
      if(status) status.textContent = "Uploaded";
      renderControls();
      applyPreview();
    }catch(e){
      if(status) status.textContent = "Upload failed";
      if(typeof showToast === "function") showToast("Photo upload failed","error");
    }
  }

  /* ---------- edit mode + persistence actions ---------- */
  function toggleEdit(force){
    editMode = (force === undefined) ? !editMode : !!force;
    const stage = document.getElementById("dz-stage");
    if(stage) stage.classList.toggle("dz-editing", editMode);
    const btn = document.getElementById("dz-edit-btn");
    if(btn){
      btn.textContent = editMode ? "Editing: on" : "Edit mode";
      btn.style.background = editMode ? "rgba(196,154,28,.15)" : "transparent";
      btn.style.color = editMode ? "#c49a1c" : "#888";
    }
    applyPreview();
  }

  function saveDraft(){
    saveDraftToStorage();
    if(typeof showToast === "function") showToast("Draft saved. The live site is unchanged.","success");
  }
  async function publish(){
    const btn = document.getElementById("dz-publish-btn");
    if(btn){ btn.disabled = true; btn.textContent = "Publishing..."; }
    const res = await T().publish(draft);
    if(btn){ btn.disabled = false; btn.textContent = "Publish"; }
    if(res && res.ok){
      published = T().clone(draft);
      saveDraftToStorage();
      if(typeof showToast === "function") showToast("Published. The live site is updated.","success",4000);
    }else{
      if(typeof showToast === "function") showToast("Publish failed. Try again.","error");
    }
  }
  function revert(){
    draft = T().clone(T().DEFAULT_BASELINE);
    saveDraftToStorage();
    renderControls(); applyPreview();
    if(typeof showToast === "function") showToast("Reverted to the original look in your draft.","info",3500);
    /* Ask before pushing the revert live. */
    setTimeout(() => {
      if(confirm("Publish this revert now, so the live site matches the original look?")){
        publish();
      }
    }, 300);
  }
  function undo(){
    const base = published || T().getPublished() || T().DEFAULT_BASELINE;
    draft = T().clone(base);
    saveDraftToStorage();
    renderControls(); applyPreview();
    if(typeof showToast === "function") showToast("Reset to the last published look.","info");
  }

  /* ---------- control builders ---------- */
  function colorRow(label, path){
    const v = _get(path) || "#000000";
    return `<label class="dz-row"><span>${label}</span><input type="color" value="${v}" oninput="DZ.set('${path}',this.value)"></label>`;
  }
  function rangeRow(label, path, min, max, step, unit){
    const raw = _get(path); const num = parseFloat(raw); const val = isNaN(num) ? min : num;
    const u = unit || "";
    return `<label class="dz-row dz-col"><span>${label}: <b class="dz-v">${val}${u}</b></span><input type="range" min="${min}" max="${max}" step="${step||1}" value="${val}" oninput="DZ.setNum('${path}',this.value,'${u}');this.parentNode.querySelector('.dz-v').textContent=this.value+'${u}'"></label>`;
  }
  function selectRow(label, path, opts){
    const v = _get(path);
    const o = opts.map(x => `<option value="${x[0]}"${String(v)===String(x[0])?" selected":""}>${x[1]}</option>`).join("");
    return `<label class="dz-row"><span>${label}</span><select onchange="DZ.set('${path}',this.value)">${o}</select></label>`;
  }
  function fontRow(label, path){
    const v = _get(path);
    const o = FONTS.map(f => `<option value="${f[0]}"${v===f[0]?" selected":""}>${f[1]}</option>`).join("");
    return `<label class="dz-row"><span>${label}</span><select onchange="DZ.set('${path}',this.value)">${o}</select></label>`;
  }
  function toggleRow(label, path){
    const v = !!_get(path);
    return `<label class="dz-row"><span>${label}</span><input type="checkbox"${v?" checked":""} onchange="DZ.setBool('${path}',this.checked)"></label>`;
  }
  function section(title, inner){
    return `<div class="admin-section"><div class="admin-section-hd" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
      <span class="ch-block-lbl" style="margin:0">${title}</span><span style="color:#5a5a5a">⌄</span></div>
      <div class="admin-section-bd" style="display:block">${inner}</div></div>`;
  }

  function renderControls(){
    const box = document.getElementById("dz-controls");
    if(!box) return;
    box.innerHTML =
      section("COLOURS",
        colorRow("Background","tokens.bg") + colorRow("Text","tokens.text") + colorRow("Muted text","tokens.muted") +
        colorRow("Accent","tokens.accent") + colorRow("Text on accent","tokens.accentText") + colorRow("Borders","tokens.border")
      ) +
      section("BACKGROUND",
        toggleRow("Use gradient","tokens.useGradient") + colorRow("Second colour","tokens.bg2") +
        rangeRow("Angle","tokens.gradientAngle",0,360,1,"")
      ) +
      section("TYPE",
        fontRow("Heading font","tokens.fontHeading") + fontRow("Body font","tokens.fontBody") +
        rangeRow("Headline size","tokens.fsH1",24,96,1,"px") +
        rangeRow("Body size","tokens.fsBase",12,22,1,"px") +
        rangeRow("Eyebrow size","tokens.fsEyebrow",8,18,1,"px") +
        selectRow("Heading weight","tokens.fwHeading",[["400","Regular"],["500","Medium"],["600","Semibold"],["700","Bold"],["800","Extrabold"],["900","Black"]]) +
        rangeRow("Line height","tokens.lineHeight",1,2.2,0.05,"")
        /* Letter spacing (em) is appended by _injectLetterSpacing after render. */
      ) +
      section("LAYOUT",
        selectRow("Text alignment","tokens.align",[["left","Left"],["center","Center"],["right","Right"]]) +
        rangeRow("Content width","tokens.container",320,900,10,"px") +
        rangeRow("Vertical spacing","tokens.rhythm",8,48,1,"px") +
        rangeRow("Corner radius","tokens.radius",0,32,1,"px") +
        selectRow("Button size","tokens.btnPadding",[["10px 18px","Small"],["14px 28px","Medium"],["18px 38px","Large"]])
      ) +
      section("TEXTURE",
        toggleRow("Film grain","tokens.grain") + rangeRow("Grain amount","tokens.grainAmount",0,0.3,0.01,"")
      ) +
      section("PHOTO",
        `<label class="dz-row"><span>Upload</span><input type="file" accept="image/*" onchange="DZ.uploadPhoto(this)" style="font-size:11px"></label>
         <p id="dz-photo-status" style="font-size:10px;color:#5a5a5a;margin:2px 0 8px">${draft.photo && draft.photo.src ? "Photo set" : "No photo yet"}</p>` +
        selectRow("Placement","photo.placement",[["above","Above text"],["beside","Beside text"],["background","Full background"],["hidden","Off"]]) +
        selectRow("Shape","photo.shape",[["circle","Circle"],["rounded","Rounded"],["square","Square"]]) +
        rangeRow("Rounded radius","photo.radius",0,80,1,"") +
        rangeRow("Size","photo.size",48,320,2,"") +
        rangeRow("Black & white","photo.grayscale",0,1,0.05,"") +
        toggleRow("Accent ring","photo.ring") +
        rangeRow("Background darkness","photo.overlay",0,0.9,0.05,"")
      );
    _injectLetterSpacing();
  }

  /* ---------- the tab ---------- */
  function renderDesignTab(container){
    if(!container) return;
    if(!T()){ container.innerHTML = "<p style='padding:20px;color:#888'>Theme engine not loaded.</p>"; return; }
    /* Seed the draft: saved draft > published > baseline. */
    draft = loadDraftFromStorage() || T().clone(T().getPublished() || T().DEFAULT_BASELINE);
    published = T().getPublished() ? T().clone(T().getPublished()) : T().clone(T().DEFAULT_BASELINE);
    if(!draft.photo) draft.photo = T().clone(T().DEFAULT_BASELINE.photo);
    if(!draft.tokens) draft.tokens = T().clone(T().DEFAULT_BASELINE.tokens);
    if(!Array.isArray(draft.textBlocks)) draft.textBlocks = [];
    editMode = false; selectedBlock = null;

    container.innerHTML = `
      <style>
        #dz-wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
        #dz-left{flex:1;min-width:300px}
        #dz-right{flex:1;min-width:300px;position:sticky;top:8px}
        .dz-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;font-size:12px;color:#cfcfcf}
        .dz-row.dz-col{flex-direction:column;align-items:stretch}
        .dz-row span{flex-shrink:0}
        .dz-row input[type=color]{width:44px;height:28px;padding:2px;background:#111;border:1px solid #222;border-radius:6px;cursor:pointer}
        .dz-row input[type=range]{flex:1}
        .dz-row select{background:#111;border:1px solid #222;color:#e8e8e8;border-radius:6px;padding:6px 8px;font-family:inherit;font-size:12px}
        .dz-actions button{font-family:inherit}
        #dz-stage{position:relative;width:100%;height:600px;max-height:72vh;overflow:hidden;border:1px solid #222;border-radius:12px;display:flex;flex-direction:column;align-items:var(--align-items,center);justify-content:center;text-align:var(--align,center);padding:36px 20px;background:var(--page-bg)}
        #dz-grain{position:absolute;inset:0;pointer-events:none;z-index:6;display:none;mix-blend-mode:overlay}
        #dz-canvas{position:absolute;inset:0;z-index:4;overflow:hidden}
      </style>
      <div id="dz-wrap">
        <div id="dz-left">
          <div class="dz-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
            <button id="dz-edit-btn" onclick="DZ.toggleEdit()" style="padding:8px 14px;border:1px solid #333;border-radius:8px;background:transparent;color:#888;font-size:12px;font-weight:700;cursor:pointer">Edit mode</button>
            <button onclick="DZ.addTextBlock()" style="padding:8px 14px;border:1px solid rgba(196,154,28,.3);border-radius:8px;background:rgba(196,154,28,.08);color:#c49a1c;font-size:12px;font-weight:700;cursor:pointer">+ Add text</button>
          </div>
          <div class="dz-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
            <button onclick="DZ.saveDraft()" style="padding:8px 14px;border:1px solid #333;border-radius:8px;background:#161616;color:#e8e8e8;font-size:12px;font-weight:700;cursor:pointer">Save draft</button>
            <button id="dz-publish-btn" onclick="DZ.publish()" style="padding:8px 16px;border:none;border-radius:8px;background:#c49a1c;color:#000;font-size:12px;font-weight:800;cursor:pointer">Publish</button>
            <button onclick="DZ.undo()" style="padding:8px 14px;border:1px solid #333;border-radius:8px;background:transparent;color:#aaa;font-size:12px;font-weight:700;cursor:pointer">Undo my changes</button>
            <button onclick="DZ.revert()" style="padding:8px 14px;border:1px solid rgba(217,80,58,.35);border-radius:8px;background:transparent;color:#d9503a;font-size:12px;font-weight:700;cursor:pointer">Revert to current look</button>
          </div>
          <div id="dz-block-editor" class="ch-block" style="margin-bottom:12px"></div>
          <div id="dz-controls"></div>
        </div>
        <div id="dz-right">
          <p class="ch-block-lbl">LIVE PREVIEW · LANDING</p>
          <div id="dz-stage">
            <div id="dz-grain"></div>
            <div id="dz-canvas"></div>
            <div style="position:relative;z-index:5;max-width:var(--container,500px);width:100%">
              <div style="display:flex;gap:8px;align-items:center;justify-content:var(--align-items,center);margin-bottom:26px">
                <div style="width:34px;height:34px;background:var(--accent);border-radius:7px;display:flex;align-items:center;justify-content:center;font-weight:900;color:var(--accent-text)">G</div>
                <span style="font-size:15px;font-weight:700;color:var(--text)">ON IT <b>WITH GENIE</b></span>
              </div>
              <h1 style="font-family:var(--font-heading);font-size:var(--fs-h1);font-weight:var(--fw-heading);letter-spacing:var(--letter-spacing);line-height:1.08;color:var(--text);margin-bottom:16px">You already know what to do. <span style="color:var(--accent)">Do it here.</span></h1>
              <p style="font-family:var(--font-body);font-size:var(--fs-base);line-height:var(--line-height);color:var(--muted);margin-bottom:24px">Pick a duration. Commit to one goal. Upload proof daily.</p>
              <button style="background:var(--accent);color:var(--accent-text);border:none;border-radius:var(--radius);padding:var(--btn-padding);font-size:15px;font-weight:800;font-family:var(--font-body);cursor:default">Begin Your Challenge →</button>
            </div>
          </div>
          <p style="font-size:11px;color:#5a5a5a;margin-top:8px">Turn on Edit mode to drag the photo and text blocks. Publish to push this look to the live site. Revert restores the original.</p>
        </div>
      </div>`;

    renderControls();
    renderBlockEditor();
    applyPreview();
  }

  /* letter-spacing in em, appended to the TYPE section */
  function _injectLetterSpacing(){
    const box = document.getElementById("dz-controls");
    if(!box) return;
    const secs = box.querySelectorAll(".admin-section .admin-section-bd");
    const typeBody = secs[2];
    if(!typeBody) return;
    const cur = parseFloat(_get("tokens.letterSpacing")) || 0;
    const row = document.createElement("label");
    row.className = "dz-row dz-col";
    row.innerHTML = `<span>Letter spacing: <b class="dz-v2">${cur}em</b></span><input type="range" min="-0.1" max="0.3" step="0.01" value="${cur}">`;
    const input = row.querySelector("input");
    input.addEventListener("input", () => {
      set("tokens.letterSpacing", input.value + "em");
      row.querySelector(".dz-v2").textContent = input.value + "em";
    });
    typeBody.appendChild(row);
  }

  return {
    renderDesignTab, set, setBool, setNum,
    addTextBlock, deleteBlock, selectBlock, updateBlock, uploadPhoto,
    toggleEdit, saveDraft, publish, revert, undo
  };
})();
function renderDesignTab(c){ return DZ.renderDesignTab(c); }
