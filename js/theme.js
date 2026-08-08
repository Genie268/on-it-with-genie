/* ============================================================
   theme.js — Global design tokens + live theme.

   Reads the published theme from site_config, applies it to :root as CSS
   variables, and renders the landing photo, free text blocks and film-grain
   overlay. Runs on the PUBLIC site and in the admin Design editor (which
   reuses these apply* functions against a scoped preview element).

   DEFAULT_BASELINE captures the site's current look and is the fixed fallback
   the Revert button restores to. It is never overwritten.
   ============================================================ */
(function(){

  /* ---- STEP 1: the current look, frozen. Revert restores exactly this. ---- */
  const DEFAULT_BASELINE = {
    tokens: {
      bg: "#060606", text: "#ededed", muted: "#8a8a8a",
      accent: "#c49a1c", accentText: "#000000", border: "#1c1c1c",
      /* Captured from the Dan-Koe-style landing: left-aligned, big bold
         Helvetica headline, single gold accent. Revert restores this design. */
      fontHeading: "Helvetica, Arial, sans-serif",
      fontBody: "'DM Sans', system-ui, -apple-system, sans-serif",
      fsH1: "clamp(44px,9vw,92px)", fsBase: "17px", fsEyebrow: "11px",
      fwHeading: "800", letterSpacing: "-0.03em", lineHeight: "1.6",
      container: "1080px", rhythm: "20px", radius: "10px", btnPadding: "16px 34px",
      align: "left",
      photoSize: "120px", photoRadius: "50%", photoGrayscale: "0",
      useGradient: false, bg2: "#0c0c0c", gradientAngle: "160",
      grain: false, grainAmount: "0.05"
    },
    /* The photo is the landing coach avatar. Baseline reproduces today's card
       avatar: a 52px gold-ringed circle sitting in the coach card. */
    photo: {
      src: "", shape: "circle", radius: "18", size: "52", grayscale: "0",
      ring: true, placement: "card", overlay: "0.5", x: 50, y: 30
    },
    textBlocks: [],
    overrides: {},
    images: []
  };

  /* Deep clone so callers can mutate a draft without touching the baseline. */
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function merge(base, over){
    const out = clone(base);
    if(!over) return out;
    if(over.tokens) Object.assign(out.tokens, over.tokens);
    if(over.photo) Object.assign(out.photo, over.photo);
    if(Array.isArray(over.textBlocks)) out.textBlocks = clone(over.textBlocks);
    if(over.overrides) out.overrides = clone(over.overrides);
    if(Array.isArray(over.images)) out.images = clone(over.images);
    return out;
  }

  /* ---- apply tokens to a root element (documentElement, or a preview box) ---- */
  function applyTheme(theme, rootEl){
    const t = merge(DEFAULT_BASELINE, theme).tokens;
    const r = rootEl || document.documentElement;
    const set = (k, v) => { if(v !== undefined && v !== null) r.style.setProperty(k, v); };

    set("--bg", t.bg);
    set("--text", t.text);
    set("--muted", t.muted);
    set("--accent", t.accent);
    set("--accent-text", t.accentText);
    set("--border", t.border);
    /* Keep the app's original variable names in sync so existing CSS re-themes. */
    set("--gold", t.accent);
    set("--bd", t.border);
    set("--font-heading", t.fontHeading);
    set("--font-body", t.fontBody);
    set("--fs-h1", t.fsH1);
    set("--fs-base", t.fsBase);
    set("--fs-eyebrow", t.fsEyebrow);
    set("--fw-heading", t.fwHeading);
    set("--letter-spacing", t.letterSpacing);
    set("--line-height", t.lineHeight);
    set("--container", t.container);
    set("--rhythm", t.rhythm);
    set("--radius", t.radius);
    set("--btn-padding", t.btnPadding);
    set("--align", t.align);
    const alignItems = { left:"flex-start", center:"center", right:"flex-end" };
    set("--align-items", alignItems[t.align] || "center");
    set("--photo-size", t.photoSize);
    set("--photo-radius", t.photoRadius);
    set("--photo-grayscale", t.photoGrayscale);

    const pageBg = t.useGradient
      ? `linear-gradient(${t.gradientAngle}deg, ${t.bg}, ${t.bg2})`
      : t.bg;
    set("--page-bg", pageBg);
  }

  /* ---- film grain overlay (a tiling SVG noise) ---- */
  const GRAIN_URI = "data:image/svg+xml;base64," + btoa(
    "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='120' height='120' filter='url(#n)'/></svg>"
  );
  function applyGrain(theme, overlayEl){
    const t = merge(DEFAULT_BASELINE, theme).tokens;
    const el = overlayEl || document.getElementById("grain-overlay");
    if(!el) return;
    if(t.grain){
      el.style.backgroundImage = `url("${GRAIN_URI}")`;
      el.style.opacity = String(t.grainAmount || 0.05);
      el.style.display = "block";
    }else{
      el.style.display = "none";
    }
  }

  function _esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function _shapeRadius(p){
    const shape = p.shape || "circle";
    return shape === "circle" ? "50%" : shape === "square" ? "0" : ((p.radius != null ? p.radius : 18) + "px");
  }

  /* Free text blocks into the canvas layer (positions are % of the hero). Only
     removes/re-adds the text blocks so a floated coach photo in the same layer
     is left in place. */
  function renderTextBlocks(theme, layerEl){
    if(!layerEl) return;
    const doc = layerEl.ownerDocument || document;
    const blocks = (merge(DEFAULT_BASELINE, theme).textBlocks) || [];
    layerEl.querySelectorAll(".dz-text").forEach(n => n.remove());
    blocks.forEach(b => {
      const el = doc.createElement("div");
      el.className = "dz-text";
      el.dataset.dz = "text";
      el.dataset.id = b.id;
      el.style.cssText = `position:absolute;left:${b.x != null ? b.x : 50}%;top:${b.y != null ? b.y : 50}%;transform:translate(-50%,-50%);max-width:${b.maxWidth || 70}%;font-family:${b.font || "var(--font-heading)"};font-size:${b.size || 26}px;font-weight:${b.weight || 700};color:${b.color || "var(--text)"};line-height:1.2;text-align:center;white-space:pre-wrap;word-break:break-word`;
      el.textContent = b.content || "";
      layerEl.appendChild(el);
    });
  }

  /* Free draggable images added by the editor. Rendered into the canvas layer,
     positioned by percentage, sized in px. */
  function renderImages(theme, layerEl){
    if(!layerEl) return;
    const doc = layerEl.ownerDocument || document;
    const imgs = (merge(DEFAULT_BASELINE, theme).images) || [];
    layerEl.querySelectorAll(".dz-img").forEach(n => n.remove());
    imgs.forEach(im => {
      if(!im.src) return;
      const el = doc.createElement("img");
      el.className = "dz-img";
      el.dataset.dz = "image";
      el.dataset.id = im.id;
      el.src = im.src;
      el.style.cssText = `position:absolute;left:${im.x != null ? im.x : 50}%;top:${im.y != null ? im.y : 50}%;transform:translate(-50%,-50%);width:${im.w || 160}px;height:auto;border-radius:${im.radius || 0}px;filter:grayscale(${im.grayscale || 0});object-fit:contain`;
      layerEl.appendChild(el);
    });
  }

  /* Full-hero background: an editor background image (tokens.bgImage) wins;
     otherwise the coach photo when its placement is "background". */
  function applyBackground(theme, scope){
    scope = scope || document;
    const th = merge(DEFAULT_BASELINE, theme);
    const p = th.photo || {};
    const t = th.tokens || {};
    const hero = scope.querySelector(".dz-hero");
    if(!hero) return;
    if(t.bgImage){
      const ov = Math.max(0, Math.min(1, parseFloat(t.bgOverlay != null ? t.bgOverlay : 0.4)));
      hero.style.backgroundImage = `linear-gradient(rgba(0,0,0,${ov}),rgba(0,0,0,${ov})), url("${_esc(t.bgImage)}")`;
      hero.style.backgroundSize = "cover";
      hero.style.backgroundPosition = "center";
    }else if(p.src && p.placement === "background"){
      const ov = Math.max(0, Math.min(1, parseFloat(p.overlay != null ? p.overlay : 0.5)));
      hero.style.backgroundImage = `linear-gradient(rgba(0,0,0,${ov}),rgba(0,0,0,${ov})), url("${_esc(p.src)}")`;
      hero.style.backgroundSize = "cover";
      hero.style.backgroundPosition = "center";
    }else{
      hero.style.backgroundImage = "";
    }
  }

  /* THE PHOTO IS THE COACH AVATAR. Style the real .genie-float in the landing
     coach card per the photo settings, and (when placement is "floating") lift
     it into the canvas layer so it can be dragged anywhere over the hero. */
  function applyCoachPhoto(theme, scope){
    scope = scope || document;
    const land = scope.querySelector("#s-land") || scope.querySelector(".dz-hero") || scope;
    const avatar = land.querySelector(".genie-float");
    if(!avatar) return;
    const p = (merge(DEFAULT_BASELINE, theme).photo) || {};
    const img = avatar.querySelector("img");
    const layer = land.querySelector(".dz-canvas-layer") || scope.querySelector(".dz-canvas-layer");
    const card = land.querySelector(".land-genie");

    if(p.placement === "hidden"){ avatar.style.display = "none"; return; }
    avatar.style.display = "";

    if(p.src && img){ img.src = p.src; img.style.display = "block"; }
    const rad = _shapeRadius(p);
    avatar.style.borderRadius = rad;
    if(img){ img.style.borderRadius = rad; img.style.filter = `grayscale(${Math.max(0,Math.min(1,parseFloat(p.grayscale||0)))})`; }
    const size = (p.size || 52);
    avatar.style.width = size + "px";
    avatar.style.height = size + "px";
    avatar.style.border = p.ring ? "2px solid var(--accent,#c49a1c)" : "none";
    avatar.style.overflow = "hidden";
    avatar.dataset.dz = "photo";

    if(p.placement === "floating" && layer){
      if(avatar.parentElement !== layer) layer.appendChild(avatar);
      avatar.style.position = "absolute";
      avatar.style.left = (p.x != null ? p.x : 50) + "%";
      avatar.style.top = (p.y != null ? p.y : 30) + "%";
      avatar.style.transform = "translate(-50%,-50%)";
      avatar.style.zIndex = "6";
      avatar.style.margin = "0";
      avatar.style.boxShadow = "0 8px 30px rgba(0,0,0,.35)";
    }else{
      /* Coach card (default): make sure it sits back in the card. */
      if(card && avatar.parentElement !== card) card.insertBefore(avatar, card.firstChild);
      avatar.style.position = "";
      avatar.style.left = ""; avatar.style.top = "";
      avatar.style.transform = ""; avatar.style.zIndex = ""; avatar.style.margin = "";
      avatar.style.boxShadow = "";
    }
  }

  /* ---- storage: read published theme (REST, no sb dependency at boot) ---- */
  const CACHE_KEY = "oiwg_theme_cache";
  function readCache(){
    try{ const v = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); return v && typeof v === "object" ? v : null; }
    catch(e){ return null; }
  }
  function writeCache(theme){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify(theme)); }catch(e){} }

  async function fetchPublished(){
    if(typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined") return null;
    try{
      const res = await fetch(`${SUPABASE_URL}/rest/v1/site_config?id=eq.live&select=theme`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY }
      });
      if(!res.ok) return null;
      const rows = await res.json();
      return (rows && rows[0] && rows[0].theme) ? rows[0].theme : null;
    }catch(e){ return null; }
  }

  async function publish(theme){
    if(typeof SUPABASE_URL === "undefined") return { ok:false };
    try{
      const res = await fetch(`${SUPABASE_URL}/rest/v1/site_config?on_conflict=id`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY,
          "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({ id: "live", theme, updated_at: new Date().toISOString() })
      });
      if(res.ok){ writeCache(theme); return { ok:true }; }
      return { ok:false, status:res.status };
    }catch(e){ return { ok:false, error:String(e) }; }
  }

  /* Per-element overrides for the REAL landing content ([data-dz-id]): edited
     words, position and text style. Text is applied as textContent only (never
     HTML) so a site_config write can never inject markup into the public page.
     A positioned element is lifted into the canvas layer so it can sit anywhere
     over the hero. */
  function applyOverrides(theme, scope){
    scope = scope || document;
    const ov = (merge(DEFAULT_BASELINE, theme).overrides) || {};
    const land = scope.querySelector("#s-land") || scope.querySelector(".dz-hero") || scope;
    const layer = land.querySelector(".dz-canvas-layer");
    Object.keys(ov).forEach(id => {
      const el = land.querySelector('[data-dz-id="' + id + '"]');
      if(!el) return;
      const o = ov[id] || {};
      if(o.text != null){
        el.textContent = o.text;
        if(/\n/.test(o.text)) el.style.whiteSpace = "pre-line";
      }
      if(o.color) el.style.color = o.color;
      if(o.size) el.style.fontSize = o.size + "px";
      if(o.weight) el.style.fontWeight = o.weight;
      if(o.font) el.style.fontFamily = o.font;
      if(o.x != null && o.y != null){
        if(layer && el.parentElement !== layer) layer.appendChild(el);
        el.style.position = "absolute";
        el.style.left = o.x + "%"; el.style.top = o.y + "%";
        el.style.transform = "translate(-50%,-50%)";
        el.style.zIndex = "6"; el.style.margin = "0"; el.style.maxWidth = "82%";
      }
    });
  }

  /* ---- apply everything to a document scope (tokens + grain + landing) ---- */
  function applyAll(theme, scope){
    scope = scope || document;
    applyTheme(theme, scope.documentElement || undefined);
    applyGrain(theme, (scope.getElementById ? scope.getElementById("grain-overlay") : null));
    applyBackground(theme, scope);
    applyCoachPhoto(theme, scope);
    applyOverrides(theme, scope);
    const layer = scope.querySelector(".dz-canvas-layer");
    if(layer){ renderTextBlocks(theme, layer); renderImages(theme, layer); }
  }

  /* ---- boot: instant paint from cache, then refresh from server ---- */
  let _published = null;
  function boot(){
    const cached = readCache();
    applyAll(cached || DEFAULT_BASELINE);
    fetchPublished().then(theme => {
      _published = theme || null;
      const eff = theme || DEFAULT_BASELINE;
      writeCache(theme || null);
      applyAll(eff);
      window.dispatchEvent(new CustomEvent("oiwg-theme-loaded"));
    });
  }

  /* Apply cached tokens synchronously right away to avoid a flash, then run the
     full boot (canvas/grain need the DOM). */
  applyTheme(readCache() || DEFAULT_BASELINE);
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* ---- public API for the Design editor ---- */
  window.OIWG_THEME = {
    DEFAULT_BASELINE,
    clone, merge,
    applyTheme, applyGrain, applyBackground, applyCoachPhoto, applyOverrides, renderTextBlocks, renderImages, applyAll,
    fetchPublished, publish, writeCache, readCache,
    getPublished: () => _published,
    GRAIN_URI
  };
})();
