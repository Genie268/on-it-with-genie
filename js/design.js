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
    ["'Syne', sans-serif","Syne"],
    ["'Archivo', sans-serif","Archivo"],
    ["'Spectral', serif","Spectral"],
    ["Helvetica, Arial, sans-serif","Helvetica"],
    ["Georgia, serif","Georgia"]
  ];

  /* Full-look presets. Each applies its whole token set to the draft. */
  const PRESETS = {
    Koe:      { bg:"#0c0c0d", text:"#ededed", muted:"#7c7c82", accent:"#ededed", accentText:"#0c0c0d", border:"#242427", fontHeading:"'Syne', sans-serif", fontBody:"'Inter', sans-serif", fsH1:"64px", fwHeading:"700", align:"center", radius:"8px", grain:true },
    Monolith: { bg:"#000000", text:"#ffffff", muted:"#8a8a8a", accent:"#ffffff", accentText:"#000000", border:"#1c1c1c", fontHeading:"'Archivo', sans-serif", fontBody:"'Inter', sans-serif", fsH1:"86px", fwHeading:"900", align:"left", radius:"0px", grain:true },
    Stoic:    { bg:"#f4f1ea", text:"#17150f", muted:"#6f695c", accent:"#17150f", accentText:"#f4f1ea", border:"#ddd6c7", fontHeading:"'Spectral', serif", fontBody:"'Spectral', serif", fsH1:"70px", fwHeading:"500", align:"left", radius:"2px", grain:true },
    Graphite: { bg:"#18191b", text:"#e9eaec", muted:"#83878d", accent:"#c3c7ce", accentText:"#16171a", border:"#2a2c30", fontHeading:"'Space Grotesk', sans-serif", fontBody:"'Inter', sans-serif", fsH1:"56px", fwHeading:"700", align:"left", radius:"10px", grain:false },
    Bone:     { bg:"#fafafa", text:"#111111", muted:"#6a6a6a", accent:"#111111", accentText:"#ffffff", border:"#ececec", fontHeading:"'Space Grotesk', sans-serif", fontBody:"'Inter', sans-serif", fsH1:"58px", fwHeading:"700", align:"left", radius:"10px", grain:false },
    Dojo:     { bg:"#0e0f12", text:"#f4f5f7", muted:"#9aa0ad", accent:"#c7ff4f", accentText:"#0d0f08", border:"#2a2e38", fontHeading:"'Space Grotesk', sans-serif", fontBody:"'Inter', sans-serif", fsH1:"58px", fwHeading:"700", align:"left", radius:"10px", grain:false }
  };
  function applyPreset(name){
    const p = PRESETS[name];
    if(!p || !draft) return;
    history("preset", true);
    if(!draft.tokens) draft.tokens = {};
    Object.assign(draft.tokens, p, { useGradient:false });
    saveDraftToStorage();
    renderControls();
    applyPreview();
    if(typeof showToast === "function") showToast(name + " applied to your draft", "success");
  }

  let draft = null, published = null, editMode = true, blockCounter = 0;
  let sel = { kind: null, id: null };            /* current selection: block | override | image */
  let undoStack = [], redoStack = [], _histTag = null;
  let device = "laptop";                         /* preview device frame */
  const findBlock = (id) => (draft.textBlocks || []).find(b => b.id === id);
  const findImage = (id) => (draft.images || []).find(g => g.id === id);

  function _snapshot(){ return JSON.stringify(draft); }
  function history(tag, force){
    /* Coalesce consecutive edits to the same control into one undo step. */
    if(!force && tag && tag === _histTag) return;
    undoStack.push(_snapshot());
    if(undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    _histTag = tag;
    updateHistBtns();
  }
  function stepUndo(){
    if(!undoStack.length) return;
    redoStack.push(_snapshot());
    draft = JSON.parse(undoStack.pop());
    _histTag = null; sel = { kind:null, id:null };
    saveDraftToStorage(); renderControls(); applyPreview(true); renderItemEditor(); updateHistBtns();
  }
  function stepRedo(){
    if(!redoStack.length) return;
    undoStack.push(_snapshot());
    draft = JSON.parse(redoStack.pop());
    _histTag = null; sel = { kind:null, id:null };
    saveDraftToStorage(); renderControls(); applyPreview(true); renderItemEditor(); updateHistBtns();
  }
  function updateHistBtns(){
    const u = document.getElementById("dz-undo"), r = document.getElementById("dz-redo");
    if(u){ u.disabled = !undoStack.length; u.style.opacity = undoStack.length ? "1" : ".35"; }
    if(r){ r.disabled = !redoStack.length; r.style.opacity = redoStack.length ? "1" : ".35"; }
  }
  function ensureOverride(id){
    if(!draft.overrides) draft.overrides = {};
    if(!draft.overrides[id]) draft.overrides[id] = {};
    return draft.overrides[id];
  }
  function isSel(kind, id){ return sel.kind === kind && sel.id === id; }
  function _rgbToHex(c){
    const m = String(c).match(/(\d+),\s*(\d+),\s*(\d+)/);
    if(!m) return "#ffffff";
    return "#" + [m[1],m[2],m[3]].map(n => (+n).toString(16).padStart(2,"0")).join("");
  }

  /* ---------- state helpers ---------- */
  function loadDraftFromStorage(){
    try{ const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); return v && typeof v === "object" ? v : null; }
    catch(e){ return null; }
  }
  function saveDraftToStorage(){ try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }catch(e){} }

  function _get(path){ return path.split(".").reduce((o,k)=> (o == null ? o : o[k]), draft); }
  function set(path, value){
    history(path);
    const parts = path.split(".");
    let o = draft;
    for(let i=0;i<parts.length-1;i++){ if(o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
    o[parts[parts.length-1]] = value;
    saveDraftToStorage();
    applyPreview();
  }
  /* Booleans from checkboxes */
  function setBool(path, checked){ set(path, !!checked); }
  function setNum(path, value, unit){ set(path, (unit ? (value+unit) : Number(value))); }

  /* ---------- mount the REAL landing hero into the preview (a clone) ---------- */
  function mountPreview(){
    const stage = document.getElementById("dz-stage");
    if(!stage) return;
    const realHero = document.querySelector("#s-land .dz-hero") || document.querySelector(".dz-hero");
    stage.innerHTML = "";
    const grain = document.createElement("div");
    grain.id = "dz-grain";
    grain.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:40;display:none;mix-blend-mode:overlay";
    stage.appendChild(grain);
    if(realHero){
      /* Re-parse the real landing markup into FRESH elements (not cloneNode,
         which carries a stale paint that ignores live custom-property edits). */
      const tmp = document.createElement("div");
      tmp.innerHTML = realHero.outerHTML;
      const clone = tmp.firstElementChild;
      clone.removeAttribute("id");
      clone.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
      clone.querySelectorAll("[onclick]").forEach(n => n.removeAttribute("onclick"));
      const layer = clone.querySelector(".dz-canvas-layer"); if(layer) layer.innerHTML = "";
      stage.appendChild(clone);
    }else{
      stage.innerHTML = "<p style='padding:20px;color:#888'>Landing markup not found.</p>";
    }
  }

  /* ---------- apply the draft to the cloned landing in the preview ---------- */
  function applyPreview(remount){
    const stage = document.getElementById("dz-stage");
    if(!stage || !T()) return;
    if(remount || !stage.querySelector(".dz-hero")) mountPreview();
    T().applyTheme(draft, stage);                              /* tokens scoped to the stage */
    T().applyGrain(draft, document.getElementById("dz-grain"));
    T().applyBackground(draft, stage);
    T().applyCoachPhoto(draft, stage);
    T().applyOverrides(draft, stage);                          /* real-element edits */
    const layer = stage.querySelector(".dz-canvas-layer");
    if(layer){ T().renderTextBlocks(draft, layer); T().renderImages(draft, layer); }
    stage.classList.toggle("dz-editing", editMode);
    _applyDevice();
    /* Force a synchronous reflow so pre-existing elements (notably native
       <button> backgrounds) pick up live var() colour edits. Done in one JS
       turn, so the browser never paints the hidden frame (no flicker).
       Preserve the scroll position so editing never jumps the pane to the top. */
    const _sc = stage.scrollTop;
    stage.style.display = "none"; void stage.offsetHeight; stage.style.display = "";
    stage.scrollTop = _sc;
    if(editMode) wireDrag();
    renderToolbar();       /* re-create + reposition the floating toolbar */
    /* NOTE: the block-editor panel is re-rendered on select/add/delete only,
       never here, so typing in its fields keeps focus. */
  }

  /* ---------- device frame (laptop / tablet / phone) ---------- */
  function _applyDevice(){
    const stage = document.getElementById("dz-stage");
    const hero = stage && stage.querySelector(".dz-hero");
    if(!hero) return;
    const dw = { laptop: 0, tablet: 834, phone: 390 }[device] || 0;
    if(!dw){ hero.style.width = "100%"; hero.style.transform = ""; hero.style.margin = ""; hero.style.transformOrigin = ""; return; }
    const avail = stage.clientWidth - 6;
    const scale = Math.min(1, avail / dw);
    hero.style.width = dw + "px";
    hero.style.margin = "0 auto";
    hero.style.transformOrigin = "top center";
    hero.style.transform = scale < 1 ? "scale(" + scale + ")" : "";
  }
  function setDevice(d){
    device = d;
    ["laptop","tablet","phone"].forEach(k => {
      const b = document.getElementById("dz-dev-" + k);
      if(b){ b.style.background = k === d ? "rgba(196,154,28,.15)" : "transparent"; b.style.color = k === d ? "#c49a1c" : "#888"; }
    });
    applyPreview();
  }

  /* ---------- drag-or-select: a click selects, a drag past a small threshold
     moves. Works for text blocks, the coach photo and real landing elements. */
  function _dragOrSelect(e, node, hero, opts){
    if(!editMode) return;                 /* handlers persist; only act while editing */
    if(node.isContentEditable) return;    /* being inline-edited: let the caret work */
    const sx = e.clientX, sy = e.clientY;
    let dragging = false;
    const rect = hero.getBoundingClientRect();
    const move = (ev) => {
      if(!dragging){
        if(Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
        dragging = true;
        if(opts.onDragStart) opts.onDragStart();
      }
      let x = ((ev.clientX - rect.left) / rect.width) * 100;
      let y = ((ev.clientY - rect.top) / rect.height) * 100;
      x = Math.max(0, Math.min(100, x)); y = Math.max(0, Math.min(100, y));
      node.style.position = "absolute";
      node.style.left = x + "%"; node.style.top = y + "%";
      node.style.transform = "translate(-50%,-50%)"; node.style.zIndex = "6";
      opts.onMove(Math.round(x), Math.round(y));
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      if(dragging){ if(opts.onEnd) opts.onEnd(); }
      else if(opts.onClick){ opts.onClick(); }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  function wireDrag(){
    const stage = document.getElementById("dz-stage");
    const hero = stage && stage.querySelector(".dz-hero");
    if(!hero) return;

    /* coach photo */
    const avatar = stage.querySelector(".genie-float");
    if(avatar){
      avatar.onpointerdown = (e) => _dragOrSelect(e, avatar, hero, {
        onDragStart: () => { history("drag-photo", true); if(draft.photo.placement !== "floating"){ draft.photo.placement = "floating"; T().applyCoachPhoto(draft, stage); } },
        onMove: (x,y) => { draft.photo.x = x; draft.photo.y = y; },
        onEnd: () => { saveDraftToStorage(); renderControls(); }
      });
    }

    /* added text blocks — click selects, drag moves, double-click edits inline */
    stage.querySelectorAll(".dz-canvas-layer .dz-text").forEach(t => {
      t.classList.toggle("dz-selected", isSel("block", t.dataset.id));
      t.onpointerdown = (e) => _dragOrSelect(e, t, hero, {
        onDragStart: () => history("drag-block-" + t.dataset.id, true),
        onMove: (x,y) => { const b = findBlock(t.dataset.id); if(b){ b.x = x; b.y = y; } },
        onEnd: () => saveDraftToStorage(),
        onClick: () => selectItem("block", t.dataset.id)
      });
      t.ondblclick = () => _beginInline(t, "block", t.dataset.id);
    });

    /* real landing elements ([data-dz-id]) */
    stage.querySelectorAll("[data-dz-id]").forEach(el => {
      const id = el.dataset.dzId;
      el.classList.toggle("dz-selected", isSel("override", id));
      el.onpointerdown = (e) => _dragOrSelect(e, el, hero, {
        onDragStart: () => {
          history("drag-ov-" + id, true);
          const layer = stage.querySelector(".dz-canvas-layer");
          if(layer && el.parentElement !== layer) layer.appendChild(el);
          ensureOverride(id);
        },
        onMove: (x,y) => { const o = ensureOverride(id); o.x = x; o.y = y; },
        onEnd: () => saveDraftToStorage(),
        onClick: () => selectItem("override", id)
      });
      el.ondblclick = () => _beginInline(el, "override", id);
    });

    /* added images */
    stage.querySelectorAll(".dz-canvas-layer .dz-img").forEach(im => {
      im.classList.toggle("dz-selected", isSel("image", im.dataset.id));
      im.onpointerdown = (e) => _dragOrSelect(e, im, hero, {
        onDragStart: () => history("drag-img-" + im.dataset.id, true),
        onMove: (x,y) => { const g = findImage(im.dataset.id); if(g){ g.x = x; g.y = y; } },
        onEnd: () => saveDraftToStorage(),
        onClick: () => selectItem("image", im.dataset.id)
      });
    });
  }

  /* ---------- double-click to edit text in place (Canva-style) ---------- */
  function _beginInline(node, kind, id){
    if(!editMode || kind === "image") return;
    node.setAttribute("contenteditable", "true");
    node.classList.add("dz-inline");
    node.focus();
    try{
      const r = document.createRange(); r.selectNodeContents(node); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }catch(e){}
    const commit = () => {
      node.removeEventListener("blur", commit);
      node.removeAttribute("contenteditable");
      node.classList.remove("dz-inline");
      const text = (node.innerText || "").replace(/ /g, " ").replace(/\n{2,}/g, "\n").replace(/\s+$/,"");
      history("inline-" + kind + "-" + id, true);
      if(kind === "block"){ const b = findBlock(id); if(b) b.content = text; }
      else { ensureOverride(id).text = text; }
      saveDraftToStorage();
      applyPreview();
      selectItem(kind, id);
    };
    node.addEventListener("blur", commit);
  }

  /* ---------- floating toolbar on the selected element ---------- */
  function _ensureToolbar(){
    const stage = document.getElementById("dz-stage");
    if(!stage) return null;
    let tb = document.getElementById("dz-toolbar");
    if(!tb || tb.parentElement !== stage){        /* mountPreview wipes the stage; re-add it */
      tb = document.createElement("div");
      tb.id = "dz-toolbar";
      stage.appendChild(tb);
    }
    return tb;
  }
  function _hideToolbar(){ const tb = document.getElementById("dz-toolbar"); if(tb) tb.style.display = "none"; }
  function _positionToolbar(){
    const tb = _ensureToolbar();
    const stage = document.getElementById("dz-stage");
    if(!tb || !stage || !sel.kind){ if(tb) tb.style.display = "none"; return; }
    let node = null;
    if(sel.kind === "block") node = stage.querySelector('.dz-canvas-layer .dz-text[data-id="' + sel.id + '"]');
    else if(sel.kind === "image") node = stage.querySelector('.dz-canvas-layer .dz-img[data-id="' + sel.id + '"]');
    else node = stage.querySelector('[data-dz-id="' + sel.id + '"]');
    if(!node){ tb.style.display = "none"; return; }
    const nr = node.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    let top = nr.top - sr.top + stage.scrollTop - 40;
    if(top < 4) top = nr.bottom - sr.top + stage.scrollTop + 8;
    let left = nr.left - sr.left + stage.scrollTop * 0 + nr.width / 2;
    tb.style.display = "flex";
    tb.style.top = Math.max(2, top) + "px";
    tb.style.left = Math.max(40, Math.min(stage.clientWidth - 40, left)) + "px";
  }
  function _tbBtn(icon, title, fn){
    return `<button title="${title}" onclick="${fn}" style="width:30px;height:30px;border:none;border-radius:6px;background:#1c1c1c;color:#e8e8e8;font-size:14px;cursor:pointer;font-family:inherit">${icon}</button>`;
  }
  function renderToolbar(){
    const tb = _ensureToolbar();
    if(!tb) return;
    if(!sel.kind){ tb.style.display = "none"; tb.innerHTML = ""; return; }
    const k = sel.kind, id = sel.id;
    let btns = "";
    if(k === "block" || k === "override"){
      btns += _tbBtn("&#9998;", "Edit text", `DZ.inlineEdit('${k}','${id}')`);
    }
    if(k === "block" || k === "image"){
      btns += _tbBtn("&#10697;", "Duplicate", `DZ.duplicateItem('${k}','${id}')`);
    }
    btns += _tbBtn(k === "override" ? "&#8634;" : "&#128465;", k === "override" ? "Reset" : "Delete", `DZ.deleteItem('${k}','${id}')`);
    tb.innerHTML = btns;
    _positionToolbar();
  }
  function inlineEdit(kind, id){
    const stage = document.getElementById("dz-stage");
    let node = kind === "block" ? stage.querySelector('.dz-canvas-layer .dz-text[data-id="' + id + '"]') : stage.querySelector('[data-dz-id="' + id + '"]');
    if(node) _beginInline(node, kind, id);
  }

  function _highlightSelected(){
    const stage = document.getElementById("dz-stage");
    if(!stage) return;
    stage.querySelectorAll(".dz-canvas-layer .dz-text").forEach(t => t.classList.toggle("dz-selected", isSel("block", t.dataset.id)));
    stage.querySelectorAll("[data-dz-id]").forEach(el => el.classList.toggle("dz-selected", isSel("override", el.dataset.dzId)));
  }

  /* ---------- items: added text blocks + real-element overrides ---------- */
  function addTextBlock(){
    history("addtext", true);
    if(!Array.isArray(draft.textBlocks)) draft.textBlocks = [];
    const id = "b" + (Date.now().toString(36)) + (blockCounter++);
    draft.textBlocks.push({ id, content:"New text", x:50, y:40, size:26, weight:700, color:"#ffffff", font:"var(--font-heading)", maxWidth:70 });
    if(!editMode){ editMode = true; _syncEditBtn(); }
    applyPreview();
    selectItem("block", id);
  }
  function deleteItem(kind, id){
    history("delete", true);
    if(kind === "block"){ draft.textBlocks = (draft.textBlocks||[]).filter(b => b.id !== id); }
    else if(kind === "image"){ draft.images = (draft.images||[]).filter(g => g.id !== id); }
    else if(draft.overrides){ delete draft.overrides[id]; }
    if(isSel(kind, id)) sel = { kind:null, id:null };
    _hideToolbar();
    saveDraftToStorage();
    applyPreview(true);       /* remount so a reset element returns to its place */
    renderItemEditor();
  }
  function deleteBlock(id){ deleteItem("block", id); }   /* backward-compat */

  function selectItem(kind, id){
    sel = { kind, id };
    renderItemEditor();
    renderToolbar();
    _highlightSelected();
    const ta = document.querySelector("#dz-block-editor textarea");
    if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  function updateBlock(id, key, value){
    history("block-" + id + "-" + key);
    const b = findBlock(id);
    if(!b) return;
    b[key] = (key === "size" || key === "weight" || key === "maxWidth") ? Number(value) : value;
    saveDraftToStorage();
    applyPreview();
  }
  function updateOverride(id, key, value){
    history("ov-" + id + "-" + key);
    const o = ensureOverride(id);
    o[key] = (key === "size" || key === "weight") ? Number(value) : value;
    saveDraftToStorage();
    applyPreview();
  }
  function updateImage(id, key, value){
    history("img-" + id + "-" + key);
    const g = findImage(id);
    if(!g) return;
    g[key] = (key === "src") ? value : Number(value);
    saveDraftToStorage();
    applyPreview();
  }
  function duplicateItem(kind, id){
    history("dup", true);
    if(kind === "block"){
      const b = findBlock(id); if(!b) return;
      const n = Object.assign({}, b, { id:"b" + Date.now().toString(36) + (blockCounter++), x:(b.x||50)+4, y:(b.y||50)+4 });
      draft.textBlocks.push(n); saveDraftToStorage(); applyPreview(); selectItem("block", n.id);
    }else if(kind === "image"){
      const g = findImage(id); if(!g) return;
      const n = Object.assign({}, g, { id:"img" + Date.now().toString(36), x:(g.x||50)+4, y:(g.y||50)+4 });
      draft.images.push(n); saveDraftToStorage(); applyPreview(); selectItem("image", n.id);
    }
  }

  /* ---------- add / set images ---------- */
  async function addImage(input){
    const file = input.files && input.files[0];
    if(!file){ return; }
    const st = document.getElementById("dz-addimg-status");
    if(st) st.textContent = "Uploading...";
    try{
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const url = await uploadToStorage("site-assets", "design/img-" + Date.now() + "." + ext, file, file.type || "image/png");
      if(!url) throw new Error("upload");
      history("addimg", true);
      if(!Array.isArray(draft.images)) draft.images = [];
      const id = "img" + Date.now().toString(36);
      draft.images.push({ id, src:url, x:50, y:50, w:180, radius:0, grayscale:0 });
      editMode = true; _syncEditBtn();
      saveDraftToStorage(); applyPreview(); selectItem("image", id);
      if(st) st.textContent = "";
    }catch(e){ if(st) st.textContent = "Upload failed"; if(typeof showToast === "function") showToast("Image upload failed","error"); }
    input.value = "";
  }
  async function setBgImage(input){
    const file = input.files && input.files[0];
    if(!file){ return; }
    const st = document.getElementById("dz-bgimg-status");
    if(st) st.textContent = "Uploading...";
    try{
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const url = await uploadToStorage("site-assets", "design/bg-" + Date.now() + "." + ext, file, file.type || "image/jpeg");
      if(!url) throw new Error("upload");
      set("tokens.bgImage", url);
      if(st) st.textContent = "Background set";
    }catch(e){ if(st) st.textContent = "Upload failed"; }
    input.value = "";
  }
  function clearBgImage(){ set("tokens.bgImage", ""); const st = document.getElementById("dz-bgimg-status"); if(st) st.textContent = "No background image"; }

  function _fontOptions(cur){
    return FONTS.map(f => `<option value="${f[0]}"${cur===f[0]?" selected":""}>${f[1]}</option>`).join("")
      + `<option value="var(--font-heading)"${cur==="var(--font-heading)"?" selected":""}>Heading font</option>`
      + `<option value="var(--font-body)"${cur==="var(--font-body)"?" selected":""}>Body font</option>`;
  }
  function _styleGrid(kind, id, font, color, size, weight){
    const upd = kind === "block" ? "DZ.updateBlock" : "DZ.updateOverride";
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label style="font-size:11px;color:#888">Font<select onchange="${upd}('${id}','font',this.value)" style="width:100%;font-size:12px;padding:6px"><option value="">(unchanged)</option>${_fontOptions(font)}</select></label>
      <label style="font-size:11px;color:#888">Colour<input type="color" value="${color||'#ffffff'}" oninput="${upd}('${id}','color',this.value)" style="width:100%;height:32px;padding:2px;background:#111;border:1px solid #222;border-radius:6px"></label>
      <label style="font-size:11px;color:#888">Size ${size}px<input type="range" min="10" max="120" value="${size}" oninput="${upd}('${id}','size',this.value);this.previousSibling.textContent='Size '+this.value+'px'" style="width:100%"></label>
      <label style="font-size:11px;color:#888">Weight<select onchange="${upd}('${id}','weight',this.value)" style="width:100%;font-size:12px;padding:6px">${[400,500,600,700,800,900].map(w=>`<option value="${w}"${+weight===w?" selected":""}>${w}</option>`).join("")}</select></label>
    </div>`;
  }
  function _editorHint(){
    return `<p style="font-size:11px;color:#5a5a5a">Click any element in the preview to select it, drag to move it, double-click to type into it. A little toolbar appears on the element (edit, duplicate, delete). "+ Add text" and "+ Add image" add new items.</p>`;
  }
  function renderItemEditor(){
    const box = document.getElementById("dz-block-editor");
    if(!box) return;
    if(sel.kind === "image"){
      const g = findImage(sel.id);
      if(!g){ box.innerHTML = _editorHint(); return; }
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span class="ch-block-lbl" style="margin:0">SELECTED · IMAGE</span>
          <div style="display:flex;gap:6px">
            <button onclick="DZ.duplicateItem('image','${g.id}')" style="background:none;border:1px solid #333;color:#aaa;font-size:11px;padding:4px 8px;border-radius:7px;cursor:pointer;font-family:inherit">Duplicate</button>
            <button onclick="DZ.deleteItem('image','${g.id}')" style="background:none;border:1px solid rgba(217,80,58,.4);color:#d9503a;font-size:11px;padding:4px 10px;border-radius:7px;cursor:pointer;font-family:inherit">Delete</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label style="font-size:11px;color:#888">Width ${g.w||180}px<input type="range" min="40" max="600" value="${g.w||180}" oninput="DZ.updateImage('${g.id}','w',this.value);this.previousSibling.textContent='Width '+this.value+'px'" style="width:100%"></label>
          <label style="font-size:11px;color:#888">Corner ${g.radius||0}px<input type="range" min="0" max="200" value="${g.radius||0}" oninput="DZ.updateImage('${g.id}','radius',this.value);this.previousSibling.textContent='Corner '+this.value+'px'" style="width:100%"></label>
          <label style="font-size:11px;color:#888;grid-column:1/3">Black &amp; white ${Math.round((g.grayscale||0)*100)}%<input type="range" min="0" max="1" step="0.05" value="${g.grayscale||0}" oninput="DZ.updateImage('${g.id}','grayscale',this.value);this.previousSibling.textContent='Black & white '+Math.round(this.value*100)+'%'" style="width:100%"></label>
        </div>`;
      return;
    }
    if(sel.kind === "block"){
      const b = (draft.textBlocks||[]).find(bl => bl.id === sel.id);
      if(!b){ box.innerHTML = _editorHint(); return; }
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span class="ch-block-lbl" style="margin:0">SELECTED · TEXT BLOCK</span>
          <button onclick="DZ.deleteItem('block','${b.id}')" style="background:none;border:1px solid rgba(217,80,58,.4);color:#d9503a;font-size:11px;padding:4px 10px;border-radius:7px;cursor:pointer;font-family:inherit">Delete</button>
        </div>
        <textarea oninput="DZ.updateBlock('${b.id}','content',this.value)" rows="2" style="width:100%;font-size:13px;margin-bottom:8px">${(b.content||"").replace(/</g,"&lt;")}</textarea>
        ${_styleGrid("block", b.id, b.font, b.color, b.size, b.weight)}`;
      return;
    }
    if(sel.kind === "override"){
      const id = sel.id;
      const el = document.querySelector('#dz-stage [data-dz-id="' + id + '"]');
      const o = (draft.overrides && draft.overrides[id]) || {};
      const cs = el ? getComputedStyle(el) : null;
      const curText = o.text != null ? o.text : (el ? el.innerText : "");
      const curColor = o.color || (cs ? _rgbToHex(cs.color) : "#ffffff");
      const curSize = o.size || (cs ? Math.round(parseFloat(cs.fontSize)) : 16);
      const curWeight = o.weight || (cs ? (parseInt(cs.fontWeight) || 400) : 400);
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span class="ch-block-lbl" style="margin:0">SELECTED · ${String(id).toUpperCase()}</span>
          <button onclick="DZ.deleteItem('override','${id}')" style="background:none;border:1px solid #333;color:#aaa;font-size:11px;padding:4px 10px;border-radius:7px;cursor:pointer;font-family:inherit">Reset</button>
        </div>
        <textarea oninput="DZ.updateOverride('${id}','text',this.value)" rows="2" style="width:100%;font-size:13px;margin-bottom:8px">${String(curText).replace(/</g,"&lt;")}</textarea>
        ${_styleGrid("override", id, o.font || "", curColor, curSize, curWeight)}`;
      return;
    }
    box.innerHTML = _editorHint();
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
      if(draft.photo.placement === "hidden") draft.photo.placement = "card";
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
  function _syncEditBtn(){
    const btn = document.getElementById("dz-edit-btn");
    if(btn){
      btn.textContent = editMode ? "Editing: on" : "Edit mode";
      btn.style.background = editMode ? "rgba(196,154,28,.15)" : "transparent";
      btn.style.color = editMode ? "#c49a1c" : "#888";
    }
  }
  function toggleEdit(force){
    editMode = (force === undefined) ? !editMode : !!force;
    const stage = document.getElementById("dz-stage");
    if(stage) stage.classList.toggle("dz-editing", editMode);
    _syncEditBtn();
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
        rangeRow("Angle","tokens.gradientAngle",0,360,1,"") +
        `<div style="border-top:1px solid #1c1c1c;margin-top:8px;padding-top:8px">
           <label class="dz-row"><span>Background image</span><input type="file" accept="image/*" onchange="DZ.setBgImage(this)" style="font-size:11px"></label>
           <p id="dz-bgimg-status" style="font-size:10px;color:#5a5a5a;margin:2px 0 6px">${(_get("tokens.bgImage")) ? "Background image set" : "No background image"}</p>
           ${rangeRow("Image darkness","tokens.bgOverlay",0,0.9,0.05,"")}
           <button onclick="DZ.clearBgImage()" style="font-size:11px;padding:5px 10px;border:1px solid #333;border-radius:7px;background:transparent;color:#aaa;cursor:pointer;font-family:inherit">Remove background image</button>
         </div>`
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
      section("PHOTO (COACH AVATAR)",
        `<p style="font-size:11px;color:#8a8a8a;margin:0 0 8px">These control your coach photo in the landing coach card.</p>
         <label class="dz-row"><span>Replace photo</span><input type="file" accept="image/*" onchange="DZ.uploadPhoto(this)" style="font-size:11px"></label>
         <p id="dz-photo-status" style="font-size:10px;color:#5a5a5a;margin:2px 0 8px">${draft.photo && draft.photo.src ? "Custom photo uploaded" : "Using your current coach photo"}</p>` +
        selectRow("Placement","photo.placement",[["card","Coach card"],["floating","Floating (drag it)"],["background","Full background"],["hidden","Off"]]) +
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
    editMode = true; sel = { kind:null, id:null };   /* always-editable: click to select, drag to move, dbl-click to type */
    undoStack = []; redoStack = []; _histTag = null;

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
        #dz-stage{position:relative;width:100%;max-height:76vh;overflow-y:auto;overflow-x:hidden;border:1px solid #222;border-radius:12px;background:var(--page-bg,#060606);overscroll-behavior:contain}
        /* Natural height so the whole landing shows and the pane scrolls. */
        #dz-stage .dz-hero{height:auto!important;min-height:600px!important}
        /* Freeze animations in the preview: a running CSS animation stops
           Chromium from repainting live custom-property (accent/colour) edits.
           The landing content fades in from opacity:0 via those animations, so
           force it to its final visible state and hide the drifting particles. */
        #dz-stage *,#dz-stage *::before,#dz-stage *::after{animation:none!important}
        #dz-stage .land-logo,#dz-stage .land-h1,#dz-stage .land-sub,#dz-stage .land-genie,#dz-stage .land-cta,#dz-stage .land-tiers,#dz-stage .dz-text{opacity:1!important}
        #dz-stage .land-particles{display:none!important}
        #dz-toolbar{position:absolute;z-index:50;display:none;gap:4px;padding:4px;background:#0b0b0b;border:1px solid #333;border-radius:9px;transform:translateX(-50%);box-shadow:0 6px 20px rgba(0,0,0,.5)}
        #dz-toolbar button:hover{background:#2a2a2a}
        #dz-stage .dz-inline{outline:2px solid var(--accent,#c49a1c)!important;cursor:text!important;min-width:20px}
        #dz-stage .dz-img{cursor:grab}
        .dz-dev-btn{width:32px;height:30px;border:1px solid #333;border-radius:7px;background:transparent;color:#888;cursor:pointer;font-family:inherit;font-size:13px}
      </style>
      <div id="dz-diag" style="font-size:11px;color:#8a8a8a;margin-bottom:12px;padding:8px 12px;border:1px solid #222;border-radius:8px;background:#0e0e0e">Diagnostics: running...</div>
      <div style="margin-bottom:14px">
        <p class="ch-block-lbl" style="margin-bottom:6px">PRESETS</p>
        <div id="dz-presets" style="display:flex;flex-wrap:wrap;gap:6px">
          ${Object.keys(PRESETS).map(n => `<button onclick="DZ.applyPreset('${n}')" style="padding:7px 12px;border:1px solid #2c2c2c;border-radius:8px;background:#141414;color:#e8e8e8;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">${n}</button>`).join("")}
        </div>
      </div>
      <div id="dz-wrap">
        <div id="dz-left">
          <div class="dz-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center">
            <button id="dz-edit-btn" onclick="DZ.toggleEdit()" style="padding:8px 14px;border:1px solid #333;border-radius:8px;background:transparent;color:#888;font-size:12px;font-weight:700;cursor:pointer">Edit mode</button>
            <button onclick="DZ.addTextBlock()" style="padding:8px 14px;border:1px solid rgba(196,154,28,.3);border-radius:8px;background:rgba(196,154,28,.08);color:#c49a1c;font-size:12px;font-weight:700;cursor:pointer">+ Add text</button>
            <label style="padding:8px 14px;border:1px solid rgba(196,154,28,.3);border-radius:8px;background:rgba(196,154,28,.08);color:#c49a1c;font-size:12px;font-weight:700;cursor:pointer">+ Add image<input type="file" accept="image/*" onchange="DZ.addImage(this)" style="display:none"></label>
            <span id="dz-addimg-status" style="font-size:10px;color:#5a5a5a"></span>
            <div style="margin-left:auto;display:flex;gap:4px">
              <button id="dz-undo" title="Undo" onclick="DZ.stepUndo()" style="width:34px;height:34px;border:1px solid #333;border-radius:8px;background:#141414;color:#e8e8e8;font-size:16px;cursor:pointer;opacity:.35" disabled>&#8630;</button>
              <button id="dz-redo" title="Redo" onclick="DZ.stepRedo()" style="width:34px;height:34px;border:1px solid #333;border-radius:8px;background:#141414;color:#e8e8e8;font-size:16px;cursor:pointer;opacity:.35" disabled>&#8631;</button>
            </div>
          </div>
          <div class="dz-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
            <button onclick="DZ.saveDraft()" style="padding:8px 14px;border:1px solid #333;border-radius:8px;background:#161616;color:#e8e8e8;font-size:12px;font-weight:700;cursor:pointer">Save draft</button>
            <button id="dz-publish-btn" onclick="DZ.publish()" style="padding:8px 16px;border:none;border-radius:8px;background:#c49a1c;color:#000;font-size:12px;font-weight:800;cursor:pointer">Publish</button>
            <button onclick="DZ.undo()" style="padding:8px 14px;border:1px solid #333;border-radius:8px;background:transparent;color:#aaa;font-size:12px;font-weight:700;cursor:pointer">Reset to published</button>
            <button onclick="DZ.revert()" style="padding:8px 14px;border:1px solid rgba(217,80,58,.35);border-radius:8px;background:transparent;color:#d9503a;font-size:12px;font-weight:700;cursor:pointer">Revert to current look</button>
          </div>
          <div id="dz-block-editor" class="ch-block" style="margin-bottom:12px"></div>
          <div id="dz-controls"></div>
        </div>
        <div id="dz-right">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span class="ch-block-lbl" style="margin:0">LIVE PREVIEW · YOUR REAL LANDING</span>
            <div style="display:flex;gap:4px">
              <button id="dz-dev-laptop" class="dz-dev-btn" title="Laptop" onclick="DZ.setDevice('laptop')" style="background:rgba(196,154,28,.15);color:#c49a1c">&#128421;</button>
              <button id="dz-dev-tablet" class="dz-dev-btn" title="Tablet" onclick="DZ.setDevice('tablet')">&#9633;</button>
              <button id="dz-dev-phone" class="dz-dev-btn" title="Phone" onclick="DZ.setDevice('phone')">&#128241;</button>
            </div>
          </div>
          <div id="dz-stage"></div>
          <p style="font-size:11px;color:#5a5a5a;margin-top:8px">This is your actual landing page. Turn on Edit mode to drag the coach photo and text blocks. Publish pushes this look to the live site. Revert restores today's look.</p>
        </div>
      </div>`;

    renderControls();
    renderItemEditor();
    _syncEditBtn();
    applyPreview();
    updateHistBtns();
    runDiagnostics();
  }

  /* ---------- on-page diagnostics (tested against the REAL cloned preview) ----
     Prints OK/FAIL for token write, add text and drag wiring so failures are
     visible on the deployed page, not only in a harness. */
  function runDiagnostics(){
    const out = document.getElementById("dz-diag");
    const stage = document.getElementById("dz-stage");
    if(!out || !stage) return;
    const results = [];

    /* 1) token write: flip --accent and read the cloned button/headline colour */
    let tokenOK = false, tokenDetail = "";
    try{
      const el = stage.querySelector(".bp") || stage.querySelector(".ac");
      const before = el ? getComputedStyle(el).backgroundColor + "/" + getComputedStyle(el).color : "";
      const prev = draft.tokens.accent;
      draft.tokens.accent = (String(prev).toLowerCase() === "#ff0055") ? "#00ddff" : "#ff0055";
      applyPreview();
      const after = el ? getComputedStyle(el).backgroundColor + "/" + getComputedStyle(el).color : "";
      draft.tokens.accent = prev; applyPreview();
      tokenOK = !!el && (after !== before);
      if(!el) tokenDetail = "(no .bp/.ac in clone)";
    }catch(e){ tokenDetail = "(err)"; }
    results.push(["token write", tokenOK, tokenDetail]);

    /* 2) add text: create a block and confirm it exists in the preview */
    let addOK = false;
    try{
      if(!Array.isArray(draft.textBlocks)) draft.textBlocks = [];
      const n0 = stage.querySelectorAll(".dz-canvas-layer .dz-text").length;
      const id = "diag_" + Date.now();
      draft.textBlocks.push({ id, content:"diag", x:50, y:50, size:20, weight:700, color:"#fff", font:"var(--font-heading)", maxWidth:60 });
      applyPreview();
      const n1 = stage.querySelectorAll(".dz-canvas-layer .dz-text").length;
      addOK = (n1 === n0 + 1);
      draft.textBlocks = draft.textBlocks.filter(b => b.id !== id);
      applyPreview();
    }catch(e){}
    results.push(["add text", addOK, ""]);

    /* 3) drag wiring: confirm a text block has a pointer handler in edit mode */
    let dragOK = false;
    try{
      const wasEdit = editMode; editMode = true;
      const id = "diag2_" + Date.now();
      draft.textBlocks.push({ id, content:"diag", x:50, y:50, size:20, weight:700, color:"#fff", font:"var(--font-heading)", maxWidth:60 });
      applyPreview();
      const t = stage.querySelector('.dz-canvas-layer .dz-text[data-id="' + id + '"]') || stage.querySelector(".dz-canvas-layer .dz-text");
      dragOK = !!(t && typeof t.onpointerdown === "function");
      draft.textBlocks = draft.textBlocks.filter(b => b.id !== id);
      editMode = wasEdit; _syncEditBtn(); applyPreview();
    }catch(e){}
    results.push(["drag wiring", dragOK, ""]);

    out.innerHTML = "Diagnostics: " + results.map(([k, v, d]) =>
      `${k} <b style="color:${v ? "#4dc98a" : "#d9503a"}">${v ? "OK" : "FAIL"}</b>${d ? " <span style='color:#666'>" + d + "</span>" : ""}`
    ).join(" &nbsp;·&nbsp; ");
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
    addTextBlock, deleteBlock, deleteItem, selectItem, updateBlock, updateOverride, uploadPhoto,
    updateImage, duplicateItem, addImage, setBgImage, clearBgImage, setDevice, inlineEdit,
    toggleEdit, saveDraft, publish, revert, undo, applyPreset, stepUndo, stepRedo,
    getDraft: () => draft, isEditing: () => editMode
  };
})();
function renderDesignTab(c){ return DZ.renderDesignTab(c); }
