/* ===== ACCOUNTABILITY INTAKE: edit these three lines =====
   closes:    last day people can join this intake, Lagos time ("2026-10-18"). null = no ribbon, always open.
   nextOpens: day the next intake opens ("2026-11-01"), or null if not set yet.
   cap:       how many people you take at a time (12). Shown on the tile and the app page.

   How it behaves, so nothing ever goes stale:
   - Up to and including the close day: ribbon shows "CLOSES SAT 18 OCT" (or "CLOSES TODAY" / "CLOSES TOMORROW").
   - After the close day: sign-up is paused and the page says when the next intake opens.
   - Once nextOpens arrives and you haven't set a new close date: ribbon disappears and sign-up reopens.
   ======================================================== */
window.INTAKE = { closes: null, nextOpens: null, cap: 12 };

window.intakeState = function(){
  var C = window.INTAKE || {};
  if(!C.closes) return { mode: "off", cap: C.cap || null };
  var today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }); // YYYY-MM-DD
  var fmt = function(s){
    var d = new Date(s + "T12:00:00Z");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
  };
  var days = Math.round((new Date(C.closes + "T12:00:00Z") - new Date(today + "T12:00:00Z")) / 864e5);
  if(days >= 0){
    var ribbon = days === 0 ? "CLOSES TODAY" : days === 1 ? "CLOSES TOMORROW" : "CLOSES " + fmt(C.closes).toUpperCase();
    return { mode: "open", ribbon: ribbon, closes: fmt(C.closes), daysLeft: days, cap: C.cap || null };
  }
  if(C.nextOpens && today >= C.nextOpens) return { mode: "off", cap: C.cap || null };
  return { mode: "closed", ribbon: C.nextOpens ? "NEXT INTAKE: " + fmt(C.nextOpens).replace(/^\w+ /,"").toUpperCase() : "INTAKE CLOSED",
           nextOpens: C.nextOpens ? fmt(C.nextOpens) : null, cap: C.cap || null };
};
