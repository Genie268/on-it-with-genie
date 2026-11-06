/* ===== Live site settings (edited in Admin, not in code) =====
   Loads from the database in one call (public_site):
   - intake:  15-day challenge sign-ups. Admin > Bookings > Switches & hours.
              { open, closes:"YYYY-MM-DD"|null, next_opens:"YYYY-MM-DD"|null, cap }
   - events:  Forward with Genie sessions. Admin > Bookings > Event.
   - squad:   newest active squad (homepage "People finishing things right now").

   The last values seen are kept on the phone, so pages draw instantly and still work
   if the database can't be reached. When fresh values arrive, "site-config" fires and
   pages that care redraw.

   Intake behaviour:
   - Switch off            -> closed. Shows when the next one opens, if you set it.
   - On, with a close date -> open with "Closes Sat 18 Oct" until that day, then closed
                              until the next-opens date (if set), then open again.
   - On, no close date     -> open, no countdown.
   ============================================================ */
window.INTAKE = { open: true, closes: null, nextOpens: null, cap: 12 };
window.SITE = { events: [], squad: null };

(function(){
  var URL_ = "https://vbafqulhbskaswkyjjdn.supabase.co";
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiYWZxdWxoYnNrYXN3a3lqamRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwODE3NDcsImV4cCI6MjA4MTY1Nzc0N30.cg7zCIJN9cPd1XUO29BVDjxDlOxcTzY1p6ndDThWr4Q";
  var KEY = "site_cfg_v1";
  function apply(d){
    if(!d || typeof d !== "object") return;
    var i = (d.settings && d.settings.intake) || {};
    window.INTAKE = { open: i.open !== false, closes: i.closes || null, nextOpens: i.next_opens || null, cap: i.cap || null };
    window.SITE = { events: Array.isArray(d.events) ? d.events : [], squad: d.squad || null };
  }
  try{ apply(JSON.parse(localStorage.getItem(KEY) || "null")); }catch(e){}
  window.SITE_READY = fetch(URL_ + "/rest/v1/rpc/public_site", { method: "POST", headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: "{}" })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      if(!d) return false;
      var before = JSON.stringify([window.INTAKE, window.SITE]);
      apply(d); try{ localStorage.setItem(KEY, JSON.stringify(d)); }catch(e){}
      var changed = before !== JSON.stringify([window.INTAKE, window.SITE]);
      if(changed) window.dispatchEvent(new Event("site-config"));
      return changed;
    })
    .catch(function(){ return false; });
})();

window.intakeState = function(){
  var C = window.INTAKE || {};
  var today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }); // YYYY-MM-DD
  var fmt = function(s){
    var d = new Date(s + "T12:00:00Z");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
  };
  var closed = function(){
    var next = C.nextOpens && C.nextOpens > today ? C.nextOpens : null;
    return { mode: "closed", ribbon: next ? "NEXT INTAKE: " + fmt(next).replace(/^\w+ /,"").toUpperCase() : "INTAKE CLOSED",
             nextOpens: next ? fmt(next) : null, cap: C.cap || null };
  };
  if(C.open === false) return closed();
  if(!C.closes) return { mode: "off", cap: C.cap || null };
  var days = Math.round((new Date(C.closes + "T12:00:00Z") - new Date(today + "T12:00:00Z")) / 864e5);
  if(days >= 0){
    var ribbon = days === 0 ? "CLOSES TODAY" : days === 1 ? "CLOSES TOMORROW" : "CLOSES " + fmt(C.closes).toUpperCase();
    return { mode: "open", ribbon: ribbon, closes: fmt(C.closes), daysLeft: days, cap: C.cap || null };
  }
  // closed by date: reopens by itself once the next intake date arrives
  if(C.nextOpens && today >= C.nextOpens) return { mode: "off", cap: C.cap || null };
  return closed();
};
