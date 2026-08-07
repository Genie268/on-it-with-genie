/* ============================================================
   miss-preview.js — TEMPORARY visual-QA scaffolding. DELETE ME.

   Renders the miss-handling screens with hardcoded dummy data so
   they can be eyeballed without a real account. Gated entirely
   behind ?preview=STATE. When the param is absent this file does
   nothing at all.

   It performs NO database reads or writes and never persists to
   localStorage: on activation it stubs out every side-effecting
   helper the miss screens can reach, and it drives everything from
   a fake calendar and a fake name ("Sharon").

   To remove later, delete this file, its <script> tag in index.html,
   and the two `MISS_PREVIEW` guard lines (one in js/ui.js boot, one
   at the top of renderMissState in js/miss.js).
   ============================================================ */
const MISS_PREVIEW = (function(){
  const VALID = ["gate1","gate2","lock3","lock7","welcome","welcome-noname"];

  function active(){
    try{
      const p = new URLSearchParams(window.location.search).get("preview");
      return (p && VALID.indexOf(p) !== -1) ? p : null;
    }catch(e){ return null; }
  }

  /* Neutralize anything that would touch Supabase or localStorage, so even
     tapping the gate/lock buttons during QA writes nothing. */
  function stubSideEffects(){
    try{
      window.trackEvent = function(){};
      window.writeGapNote = function(){ return {}; };
      window._consumeClearance = function(){};
      window._refreshMissStateFromServer = function(){};
      window.saveGapNotesLocal = function(){};
      window.saveCoachLocal = function(){};
      window.saveState = function(){};
      /* Fixed fake number so the lock never reads localStorage / config. */
      window._coachPhone = function(){ return "+234 801 234 5678"; };
      /* The lock's "send" path inserts a chat row directly — make it inert. */
      window._lockMessageSend = function(){
        if(typeof showToast === "function") showToast("Preview only. Nothing was sent.", "info");
        if(typeof _unlockAfterContact === "function") _unlockAfterContact();
      };
      /* The real unlock bounces through renderDash (heartbeat, coach-notes AI,
         polling). In preview, just repaint the current preview screen so a
         button tap stays fully offline. */
      window._unlockAfterContact = function(){
        S.uploadBlocked = false; S._lockGap = null;
        if(typeof _clearLockOverlay === "function") _clearLockOverlay();
        if(typeof showToast === "function") showToast("Preview only. Nothing happened.", "info");
        render();
      };
    }catch(e){}
  }

  /* A throwaway in-memory session. Never saved. */
  function fakeSession(){
    if(typeof S === "undefined") return;
    S.user = { name:"Sharon", supabaseId:null, answers:{}, duration:15, startDate:"2026-08-01T00:00:00.000Z" };
    S.uploads = Array(15).fill(null);
    S.day = 8;
    S.goals = [];
    S.gapNotes = [];
    S.plans = {};
    S.coach = { name:"Genie", first_name:"Genie", phone:"+234 801 234 5678" };
    S._cleared = false;
    S._reentryConsumed = false;
    S._runResolved = false;
    S.uploadBlocked = false;
    S._lockGap = null;
    S._gateGap = null;
  }

  function badge(){
    if(document.getElementById("miss-preview-badge")) return;
    const b = document.createElement("div");
    b.id = "miss-preview-badge";
    b.textContent = "PREVIEW MODE · " + (active() || "");
    b.style.cssText = "position:fixed;top:10px;left:10px;z-index:2000;background:#c49a1c;color:#000;font-size:10px;font-weight:900;letter-spacing:.08em;padding:6px 10px;border-radius:6px;font-family:system-ui,sans-serif;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.4)";
    document.body.appendChild(b);
  }

  /* Paint the screen for the current ?preview= state. Called on boot and
     again if any handler bounces through renderMissState. */
  function render(){
    const state = active();
    if(!state) return;
    const cont = (typeof el === "function") ? el("miss-gate") : document.getElementById("miss-gate");
    if(typeof _clearLockOverlay === "function") _clearLockOverlay();
    if(cont) cont.innerHTML = "";
    S._cleared = false;

    if(state === "gate1"){ _renderGate({start:4,end:4,length:1}); }
    else if(state === "gate2"){ _renderGate({start:5,end:6,length:2}); }
    else if(state === "lock3"){ _renderLock({start:5,end:7,length:3}); }
    else if(state === "lock7"){ _renderLock({start:3,end:9,length:7}); }
    else if(state === "welcome"){ S.user.name = "Sharon"; _renderWelcomeBanner(); }
    else if(state === "welcome-noname"){ S.user.name = ""; _renderWelcomeBanner(); }
  }

  /* Owns boot when active: skips the real session/resume entirely. */
  function boot(){
    if(!active()) return;
    stubSideEffects();
    fakeSession();
    document.querySelectorAll(".screen").forEach(x => x.classList.remove("active"));
    const dash = document.getElementById("s-dash");
    if(dash) dash.classList.add("active");
    badge();
    render();
  }

  return { active, boot, render };
})();
