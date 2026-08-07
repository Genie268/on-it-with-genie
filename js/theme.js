/* ============================================================
   theme.js — Global design tokens + live theme.

   Reads the published theme from site_config, applies it to :root as CSS
   variables, and renders the landing photo, free text blocks and film-grain
   overlay. Runs on the PUBLIC site and in the admin Design editor (which
   reuses applyTheme / renderCanvas against a scoped preview element).

   DEFAULT_BASELINE captures the site's current look and is the fixed fallback
   the Revert button restores to. It is never overwritten.
   ============================================================ */
(function(){

  /* ---- STEP 1: the current look, frozen. Revert restores exactly this. ---- */
  const DEFAULT_BASELINE = {
    tokens: {
      bg: "#060606", text: "#ebebeb", muted: "#7a7a7a",
      accent: "#c49a1c", accentText: "#000000", border: "#171717",
      fontHeading: "'DM Sans', system-ui, -apple-system, sans-serif",
      fontBody: "'DM Sans', system-ui, -apple-system, sans-serif",
      fsH1: "clamp(38px,8vw,62px)", fsBase: "15px", fsEyebrow: "11px",
      fwHeading: "800", letterSpacing: "-0.02em", lineHeight: "1.6",
      container: "500px", rhythm: "20px", radius: "12px", btnPadding: "14px 28px",
      align: "center",
      photoSize: "120px", photoRadius: "50%", photoGrayscale: "0",
      useGradient: false, bg2: "#0c0c0c", gradientAngle: "160",
      grain: false, grainAmount: "0.05"
    },
    photo: {
      src: "", shape: "circle", radius: "18", size: "120", grayscale: "0",
      ring: true, placement: "hidden", overlay: "0.5", x: 50, y: 30
    },
    textBlocks: []
  };

  /* Deep clone so callers can mutate a draft without touching the baseline. */
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function merge(base, over){
    const out = clone(base);
    if(!over) return out;
    if(over.tokens) Object.assign(out.tokens, over.tokens);
    if(over.photo) Object.assign(out.photo, over.photo);
    if(Array.isArray(over.textBlocks)) out.textBlocks = clone(over.textBlocks);
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

  /* ---- render photo + text blocks into a hero canvas layer ----
     Positions are percentages of the hero box so they hold across sizes.
     editable=false (public): decorative, non-interactive. The editor passes
     editable=true and wires its own drag handlers afterward. */
  function renderCanvas(theme, layerEl, opts){
    if(!layerEl) return;
    const th = merge(DEFAULT_BASELINE, theme);
    const p = th.photo || {};
    const blocks = th.textBlocks || [];
    layerEl.innerHTML = "";

    /* Full-bleed background photo is painted on the layer itself. */
    layerEl.style.background = "";
    if(p.src && p.placement === "background"){
      const ov = Math.max(0, Math.min(1, parseFloat(p.overlay != null ? p.overlay : 0.5)));
      layerEl.style.background = `linear-gradient(rgba(0,0,0,${ov}),rgba(0,0,0,${ov})), url("${_esc(p.src)}") center/cover no-repeat`;
    }

    /* Positioned photo (above / beside / dragged). */
    if(p.src && p.placement !== "background" && p.placement !== "hidden"){
      const shape = p.shape || "circle";
      const rad = shape === "circle" ? "50%" : shape === "square" ? "0" : ((p.radius || 18) + "px");
      const size = (p.size || 120);
      const ring = p.ring ? "3px solid var(--accent,#c49a1c)" : "none";
      const gray = Math.max(0, Math.min(1, parseFloat(p.grayscale || 0)));
      const img = document.createElement("div");
      img.className = "dz-photo";
      img.dataset.dz = "photo";
      img.style.cssText = `position:absolute;left:${p.x != null ? p.x : 50}%;top:${p.y != null ? p.y : 30}%;transform:translate(-50%,-50%);width:${size}px;height:${size}px;border-radius:${rad};border:${ring};background:url("${_esc(p.src)}") center/cover no-repeat;filter:grayscale(${gray});box-shadow:0 8px 30px rgba(0,0,0,.35)`;
      layerEl.appendChild(img);
    }

    /* Free text blocks. */
    blocks.forEach(b => {
      const el = document.createElement("div");
      el.className = "dz-text";
      el.dataset.dz = "text";
      el.dataset.id = b.id;
      el.style.cssText = `position:absolute;left:${b.x != null ? b.x : 50}%;top:${b.y != null ? b.y : 50}%;transform:translate(-50%,-50%);max-width:${b.maxWidth || 60}%;font-family:${b.font || "var(--font-heading)"};font-size:${b.size || 24}px;font-weight:${b.weight || 700};color:${b.color || "var(--text)"};line-height:1.2;text-align:center;white-space:pre-wrap;word-break:break-word`;
      el.textContent = b.content || "";
      layerEl.appendChild(el);
    });
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

  /* ---- apply everything (tokens + grain + canvas) ---- */
  function applyAll(theme){
    applyTheme(theme);
    applyGrain(theme);
    const layer = document.getElementById("landing-canvas-layer");
    if(layer) renderCanvas(theme, layer, { editable:false });
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
    applyTheme, applyGrain, renderCanvas, applyAll,
    fetchPublished, publish, writeCache, readCache,
    getPublished: () => _published,
    GRAIN_URI
  };
})();
