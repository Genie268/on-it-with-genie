/* Goal Card illustrations: one clean spot drawing per card. Same palette, same line weight. */
(function(){
  var I='#17140F', R='#D2402F', C='#FFFDF8', S='#EDE4D3', P='#F7DCD5';
  function svg(inner){
    return '<svg viewBox="0 0 220 150" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<ellipse cx="110" cy="138" rx="74" ry="6" fill="'+I+'" opacity=".07"/>' + inner + '</svg>';
  }
  function spark(x,y,c){ return '<path d="M'+x+' '+(y-7)+'v14M'+(x-7)+' '+y+'h14" stroke="'+(c||R)+'" stroke-width="2.5"/>'; }
  var A = {};

  A.welcome = svg(
    '<g transform="rotate(-9 110 76)"><rect x="64" y="28" width="94" height="102" rx="13" fill="'+S+'" stroke="'+I+'" stroke-width="2.5"/></g>'+
    '<g transform="rotate(6 110 76)"><rect x="64" y="26" width="94" height="102" rx="13" fill="'+P+'" stroke="'+I+'" stroke-width="2.5"/></g>'+
    '<rect x="62" y="22" width="96" height="104" rx="13" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M78 44h40" stroke="'+R+'" stroke-width="5"/>'+
    '<path d="M78 62h62M78 76h50M78 90h34" stroke="'+I+'" stroke-width="2.5" opacity=".35"/>'+
    '<circle cx="140" cy="106" r="14" fill="'+R+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M133 106l5 5 9-10" stroke="#fff" stroke-width="3"/>'+
    spark(42,44) + spark(184,58,I)
  );

  A.worry = svg(
    '<path d="M66 96C46 96 44 70 64 66C62 44 90 36 102 50C110 32 142 34 146 56C168 54 176 82 158 94C156 95 153 96 150 96Z" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M84 64c6-6 12 6 18 0s12 6 18 0 12 6 18 0" stroke="'+I+'" stroke-width="2.5" opacity=".35"/>'+
    '<path d="M80 106l-5 12M98 106l-5 12M150 106l-5 12" stroke="'+I+'" stroke-width="2.5" opacity=".45"/>'+
    '<path d="M120 90L108 112H120L114 132L136 104H124L130 90Z" fill="'+R+'" stroke="'+I+'" stroke-width="2.5"/>'
  );

  A.poll = svg(
    '<path d="M40 126h140" stroke="'+I+'" stroke-width="2.5"/>'+
    '<rect x="52" y="86" width="24" height="40" rx="6" fill="'+S+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<rect x="86" y="46" width="24" height="80" rx="6" fill="'+R+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<rect x="120" y="70" width="24" height="56" rx="6" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<rect x="154" y="98" width="24" height="28" rx="6" fill="'+P+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<circle cx="98" cy="30" r="6" fill="'+P+'" stroke="'+I+'" stroke-width="2"/>'+
    '<circle cx="118" cy="20" r="4.5" fill="'+R+'"/>'+
    '<circle cx="80" cy="18" r="4" fill="'+I+'" opacity=".25"/>'
  );

  A.goal = svg(
    '<path d="M28 126L92 48L116 78L136 58L192 126Z" fill="'+S+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M80 63L92 48L104 63L97 60L92 66L86 60Z" fill="'+C+'" stroke="'+I+'" stroke-width="2"/>'+
    '<path d="M56 126C66 112 92 112 86 98S104 84 92 70" stroke="'+R+'" stroke-width="2.5" stroke-dasharray="4 7"/>'+
    '<path d="M92 48V14" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M92 14L124 22L92 31Z" fill="'+R+'" stroke="'+I+'" stroke-width="2.5"/>'+
    spark(166,30,I)
  );

  A.say = svg(
    '<rect x="30" y="28" width="96" height="58" rx="18" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M54 86l-8 18 22-18" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M50 50h52M50 64h36" stroke="'+I+'" stroke-width="2.5" opacity=".35"/>'+
    '<rect x="96" y="64" width="96" height="54" rx="18" fill="'+R+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M164 118l10 16-26-16" fill="'+R+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M116 85h52M116 99h32" stroke="#fff" stroke-width="2.5"/>'+
    '<path d="M150 30c8 4 12 12 12 20M164 22c12 6 18 18 18 30" stroke="'+R+'" stroke-width="2.5"/>'
  );

  A.cost = svg(
    '<g transform="rotate(-10 112 76)">'+
      '<path d="M72 40H138L174 76L138 112H72Q62 112 62 102V50Q62 40 72 40Z" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
      '<circle cx="148" cy="76" r="6" fill="'+S+'" stroke="'+I+'" stroke-width="2.5"/>'+
      '<path d="M88 56h28l-14 20 14 20H88l14-20Z" fill="'+P+'" stroke="'+I+'" stroke-width="2.5"/>'+
      '<path d="M94 94h16l-8-9Z" fill="'+R+'"/>'+
    '</g>'+
    '<path d="M158 70C172 56 172 34 190 26" stroke="'+R+'" stroke-width="2.5"/>'
  );

  A.week = svg(
    '<rect x="46" y="30" width="128" height="98" rx="13" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M46 56V43Q46 30 59 30H161Q174 30 174 43V56Z" fill="'+R+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M80 20v18M140 20v18" stroke="'+I+'" stroke-width="4"/>'+
    (function(){ var s=''; for(var r=0;r<3;r++) for(var c=0;c<7;c++){ s+='<rect x="'+(58+c*16)+'" y="'+(66+r*18)+'" width="10" height="10" rx="3" fill="'+S+'"/>'; } return s; })()+
    '<circle cx="95" cy="89" r="11" stroke="'+R+'" stroke-width="3"/>'+
    '<circle cx="160" cy="118" r="14" fill="'+I+'"/>'+
    '<path d="M153 118l5 5 9-10" stroke="#fff" stroke-width="3"/>'
  );

  A.person = svg(
    '<path d="M108 126C108 100 118 90 136 90C154 90 164 100 164 126Z" fill="'+R+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<circle cx="136" cy="66" r="16" fill="'+R+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M56 126C56 96 68 84 86 84C104 84 116 96 116 126Z" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<circle cx="86" cy="58" r="17" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<rect x="96" y="14" width="34" height="26" rx="10" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M106 40l-2 8 9-8" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M106 27l5 5 9-9" stroke="'+R+'" stroke-width="3"/>'
  );

  A.reveal = svg(
    '<rect x="48" y="22" width="124" height="106" rx="14" fill="'+C+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M68 48h72" stroke="'+I+'" stroke-width="6" opacity=".18"/>'+
    '<path d="M62 48h84" stroke="'+R+'" stroke-width="3"/>'+
    '<path d="M68 76h84" stroke="'+I+'" stroke-width="7"/>'+
    '<path d="M68 98h56" stroke="'+I+'" stroke-width="7" opacity=".35"/>'+
    '<circle cx="168" cy="30" r="16" fill="'+R+'" stroke="'+I+'" stroke-width="2.5"/>'+
    '<path d="M160 30l6 6 10-11" stroke="#fff" stroke-width="3"/>'+
    spark(36,96) + spark(194,92,I)
  );

  window.GC_ART = function(key, type){
    return A[key] || (type==='poll' ? A.poll : type==='pair' ? A.say : A.goal);
  };
  window.GC_ART_ALL = A;
})();
