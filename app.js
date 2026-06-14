// ── app.js ──────────────────────────────────────────────────────────────────────
// The logging engine, lifted almost wholesale from the original single-file app.
// The only structural change: where it used to read/write localStorage, it now
// reads on sign-in from Drive and saves changes back to Drive (debounced), with
// a Saving… → Saved ✓ → failed status shown in the top bar.

// ── Icons ──────────────────────────────────────────────────────────────────────
var IC = {
  check:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  copy:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  dl:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  ul:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  timer:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 14.5 15.5"/><path d="M9 3h6"/></svg>',
  pen:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  login:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
  chevL:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  chevR:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  lock:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  unlock:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>'
};

var SPORTS   = { running:{label:"Run",color:"#E8763C"}, climbing:{label:"Climb",color:"#4FB8A0"}, strength:{label:"Strength",color:"#E0B23C"} };
var FELT     = [{v:1,label:"Rough"},{v:2,label:"Tough"},{v:3,label:"Solid"},{v:4,label:"Good"},{v:5,label:"Flew"}];
var WORKLOAD = ["Light","Normal","Heavy","Brutal"];
var STORAGE_KEY = "tlog:v1"; // only read now, for one-time migration off this device

var state = { currentWeek:null, currentPlan:null, log:{}, reflection:{workload:null,energy:null,flags:""}, open:{}, allWeeks:{}, locked:false };
var saveTimer = null;

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatDoneAt(iso) {
  try {
    var d=new Date(iso), days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return "Done "+days[d.getDay()]+" "+d.getDate()+" "+months[d.getMonth()]+" \u00b7 "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
  } catch(e) { return "Done"; }
}

function blockText(b) { return typeof b==="string"?b:b.text; }
function blockHelp(b) { return (typeof b==="object"&&b.help)?b.help:null; }
function blockWeight(b) { return (typeof b==="object"&&b.recommendedWeight!=null)?b.recommendedWeight:null; }

function titleCase(s) { return String(s||"").replace(/(^|[\s\-])([a-z])/g, function(m,a,b){ return a+b.toUpperCase(); }); }
function hashHue(s) { var h=0; s=String(s||""); for(var i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return Math.abs(h)%360; }
// Known sports keep their hand-picked colour; anything else gets a stable
// colour derived from its name and a tidied-up label.
function sportMeta(key) {
  if(SPORTS[key]) return SPORTS[key];
  if(!key) return {label:"Session",color:"#888"};
  return { label:titleCase(key), color:"hsl("+hashHue(key)+",52%,62%)" };
}

function exState(sessionId, idx) {
  var log=state.log[sessionId]; if(!log) return {checked:false,weight:"",note:""};
  var ex=log.exercises; if(!ex) return {checked:false,weight:"",note:""};
  return ex[String(idx)]||{checked:false,weight:"",note:""};
}

// ── State <-> data object ──────────────────────────────────────────────────────
function resetState() {
  state.currentWeek=null; state.currentPlan=null; state.log={};
  state.reflection={workload:null,energy:null,flags:""}; state.open={}; state.allWeeks={}; state.locked=false;
}

function weekNumbersSorted() {
  return Object.keys(state.allWeeks).map(Number).filter(function(n){return !isNaN(n);}).sort(function(a,b){return a-b;});
}
function latestWeek() { var ns=weekNumbersSorted(); return ns.length?ns[ns.length-1]:null; }

// Load a week into the view. Past weeks (anything but the latest) start locked.
function loadView(n) {
  state.currentWeek=n;
  var wk=state.allWeeks[String(n)]||{};
  state.currentPlan=wk.plan||null;
  state.log=wk.log||{};
  state.reflection=Object.assign({workload:null,energy:null,flags:""},wk.reflection||{});
  state.open={};
  if(state.currentPlan) state.currentPlan.sessions.forEach(function(s){state.open[s.id]=!(state.log[s.id]&&state.log[s.id].done);});
  state.locked=(n!==latestWeek());
}

function goToWeek(n) {
  commitView();   // keep the week we're leaving up to date in memory
  loadView(n);
  scheduleSave();
  renderApp();
}

function applyData(data) {
  resetState();
  state.allWeeks=data.weeks||{};
  var n=latestWeek();
  if(n!==null) loadView(n);
  state.locked=false; // open on the newest week, which is always editable
}

// Write the viewed week's working state back into allWeeks (in memory).
function commitView() {
  if(state.currentWeek===null) return;
  var wk=String(state.currentWeek);
  state.allWeeks[wk]=state.allWeeks[wk]||{};
  state.allWeeks[wk].log=state.log;
  state.allWeeks[wk].reflection=state.reflection;
  if(state.currentPlan) state.allWeeks[wk].plan=state.currentPlan;
  state.allWeeks[wk].updatedAt=new Date().toISOString();
}

function buildPayload() {
  commitView();
  return {version:1,currentWeek:state.currentWeek,weeks:state.allWeeks};
}

// Exercise name without its set/rep suffix, lower-cased, for matching across weeks.
function normName(text) { return String(text||"").split("\u2014")[0].split(" -")[0].trim().toLowerCase(); }

// Most recent earlier week that logged a weight for this exercise.
function previousWeight(viewWeek, rawName) {
  var target=normName(rawName); if(!target) return null;
  var ns=weekNumbersSorted().filter(function(w){return w<viewWeek;}).sort(function(a,b){return b-a;});
  for(var k=0;k<ns.length;k++) {
    var wk=state.allWeeks[String(ns[k])]; if(!wk||!wk.plan||!wk.log) continue;
    var sess=wk.plan.sessions||[];
    for(var si=0;si<sess.length;si++) {
      var s=sess[si]; if(s.sport!=="strength") continue;
      var blocks=s.blocks||[];
      for(var bi=0;bi<blocks.length;bi++) {
        if(normName(blockText(blocks[bi]))===target) {
          var lg=wk.log[s.id], ex=lg&&lg.exercises&&lg.exercises[String(bi)];
          if(ex&&ex.weight!=null&&String(ex.weight).trim()!=="") return { weight:ex.weight, week:ns[k] };
        }
      }
    }
  }
  return null;
}

// ── Drive persistence ──────────────────────────────────────────────────────────
function scheduleSave() { // debounced save (replaces the old localStorage debounce)
  clearTimeout(saveTimer);
  saveTimer=setTimeout(persistNow,600);
}

function persistNow() {
  var payload=buildPayload();
  setStatus("saving");
  return Drive.save(payload).then(function(){ setStatus("saved"); })
    .catch(function(){ setStatus("error"); });
}

// ── Sync status (top bar) ──────────────────────────────────────────────────────
function setStatus(s) {
  var el=document.getElementById("sync-status");
  if(el) {
    el.className="sync-status"+(s==="error"?" err":"")+(s==="saved"?" ok":"");
    el.textContent = s==="syncing" ? "Syncing\u2026"
                   : s==="saving"  ? "Saving\u2026"
                   : s==="saved"   ? "Saved \u2713"
                   : s==="error"   ? "Save failed \u2014 check connection"
                   : "";
  }
  if(s==="saved") {
    showSaved();
    setTimeout(function(){ var e=document.getElementById("sync-status"); if(e&&e.classList.contains("ok")){ e.textContent=""; e.className="sync-status"; } },2200);
  }
}

function showSaved() {
  var dot=document.getElementById("save-dot"); if(!dot) return;
  dot.classList.add("show"); clearTimeout(dot._t);
  dot._t=setTimeout(function(){dot.classList.remove("show");},1200);
}

function updateChrome() {
  var signed=Auth.isSignedIn();
  var dl=document.getElementById("dl-btn"), so=document.getElementById("signout-btn"), ch=document.getElementById("chart-btn");
  if(dl) dl.hidden=!signed;
  if(so) so.hidden=!signed;
  if(ch) ch.hidden=!signed;
  if(!signed && window.Stats) Stats.hide();
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderApp() {
  if(!Auth.isSignedIn()) { renderSignedOut(); updateChrome(); return; }
  if(!state.currentPlan) { renderNoPlan(); updateChrome(); return; }
  document.getElementById("app").innerHTML=buildApp();
  hydrateInputs();
  updateChrome();
}

function renderSignedOut() {
  document.getElementById("app").innerHTML=
    '<div class="wrap"><div class="landing">'+
    '<div class="kicker">Training Log</div>'+
    '<h1 class="h1">Plan. Log. <em>Sync.</em></h1>'+
    '<p class="intro">Your weekly training plans \u2014 logged, and synced privately to your own Google Drive, so they\u2019re on every device you sign in on.</p>'+
    '<div style="margin-top:30px"><button class="btn primary" data-action="signin">'+IC.login+' Sign in with Google</button></div>'+
    '<div style="margin-top:12px"><button class="btn ghost" data-action="open-help">'+IC.info+' How this works</button></div>'+
    '<p class="foot" style="margin-top:30px">Your training data lives in your Google Drive, in a private app folder.<br>It syncs to you, and only you.</p>'+
    '<p class="foot" style="margin-top:10px"><a href="privacy.html" style="color:var(--dim);text-decoration:underline">Privacy policy</a></p>'+
    '</div></div>';
}

function renderConnecting() {
  document.getElementById("app").innerHTML=
    '<div class="wrap"><div class="landing">'+
    '<div class="kicker">Training Log</div>'+
    '<p class="intro" style="margin-top:20px">Connecting\u2026</p>'+
    '</div></div>';
}

function renderError(msg) {
  document.getElementById("app").innerHTML=
    '<div class="wrap"><div class="landing">'+
    '<div class="kicker">Training Log</div>'+
    '<h1 class="h1">Can\u2019t reach <em>Drive.</em></h1>'+
    '<p class="intro">'+msg+'</p>'+
    '<div style="margin-top:26px"><button class="btn primary" data-action="retry">Try again</button></div>'+
    '</div></div>';
}

function hydrateInputs() {
  if(!state.currentPlan) return;
  state.currentPlan.sessions.forEach(function(s) {
    var l=state.log[s.id]||{};
    var ta=document.querySelector('[data-action="set-note"][data-id="'+s.id+'"]');
    if(ta) ta.value=l.note||"";
    if(s.sport==="strength") {
      (s.blocks||[]).forEach(function(b,i) {
        var ex=exState(s.id,i);
        var wi=document.getElementById("exw-"+s.id+"-"+i);
        if(wi) wi.value=ex.weight||"";
        var ni=document.getElementById("exn-"+s.id+"-"+i);
        if(ni) {
          ni.value=ex.note||"";
          if(ex.note&&ex.note.trim()) {
            var nw=document.getElementById("exnw-"+s.id+"-"+i);
            if(nw) { nw.style.display=""; var pb=document.getElementById("expb-"+s.id+"-"+i); if(pb) pb.classList.add("on"); }
          }
        }
      });
    }
  });
  var ft=document.getElementById("flags-ta"); if(ft) ft.value=state.reflection.flags||"";
}

function renderNoPlan() {
  document.getElementById("app").innerHTML=
    '<div class="wrap"><div style="padding:24px 0 40px">'+
    '<div class="kicker">Training Log</div>'+
    '<h1 class="h1">Ready to <em>train.</em></h1>'+
    '<p class="intro" style="margin-top:14px">Load your week plan file to get started. Each week your AI sends a small JSON file with your sessions \u2014 tap below to load it. New here? Tap <b>How this works</b> up top for the prompt to give your AI.</p>'+
    '<div style="margin-top:32px"><button class="btn primary" data-action="load-week-trigger" style="font-size:15px;padding:17px">'+IC.ul+' Load week plan</button></div>'+
    '<div style="margin-top:12px"><button class="btn ghost" data-action="open-help">'+IC.info+' How this works</button></div>'+
    '<p class="foot" style="margin-top:32px">Your sessions appear here once a plan is loaded.</p>'+
    '</div></div>';
}

// ── Build HTML ─────────────────────────────────────────────────────────────────
function buildApp() {
  var plan=state.currentPlan;
  var coreDone=plan.sessions.filter(function(s){return s.priority==="Core"&&state.log[s.id]&&state.log[s.id].done;}).length;
  var coreTotal=plan.sessions.filter(function(s){return s.priority==="Core";}).length;
  var allDone=plan.sessions.filter(function(s){return state.log[s.id]&&state.log[s.id].done;}).length;
  var sportsInPlan=[]; plan.sessions.forEach(function(s){ if(sportsInPlan.indexOf(s.sport)<0) sportsInPlan.push(s.sport); });
  var legend=sportsInPlan.map(function(k){ var m=sportMeta(k); return '<span><i style="background:'+m.color+'"></i>'+m.label+'</span>';}).join("");
  var wlChips=WORKLOAD.map(function(w){return '<button class="chip'+(state.reflection.workload===w?" on":"")+'" data-action="set-workload" data-workload="'+w+'">'+w+'</button>';}).join("");
  var enChips=[1,2,3,4,5].map(function(n){return '<button class="chip'+(state.reflection.energy===n?" on":"")+'" data-action="set-energy" data-energy="'+n+'">'+n+'</button>';}).join("");
  var ns=weekNumbersSorted(), idx=ns.indexOf(state.currentWeek);
  var hasPrev=idx>0, hasNext=idx>=0&&idx<ns.length-1, isLatest=state.currentWeek===latestWeek();
  var lockBtn=isLatest?'':
    '<button class="wn-lock'+(state.locked?'':' open')+'" data-action="toggle-lock">'+(state.locked?IC.lock:IC.unlock)+'<span>'+(state.locked?'Locked':'Editing')+'</span></button>';
  var weeknav=
    '<div class="weeknav">'+
      '<button class="wn-btn" data-action="week-prev"'+(hasPrev?'':' disabled')+' aria-label="Previous week">'+IC.chevL+'</button>'+
      '<div class="wn-mid"><span class="wn-label">Week '+state.currentWeek+'</span>'+(isLatest?'':'<span class="wn-tag">history</span>')+lockBtn+'</div>'+
      '<button class="wn-btn" data-action="week-next"'+(hasNext?'':' disabled')+' aria-label="Next week">'+IC.chevR+'</button>'+
    '</div>';
  return '<div class="wrap'+(state.locked?' locked':'')+'">'+
    '<header class="hd">'+
      '<div class="kicker">'+(plan.phase||"")+'</div>'+
      '<h1 class="h1">Training <em>Week '+plan.weekNumber+'</em></h1>'+
      '<p class="intro">'+(plan.intro||"")+'</p>'+
      '<div class="prog"><div><b class="c-run" id="core-done">'+coreDone+'</b><span>/'+coreTotal+' core</span></div><div><b id="all-done">'+allDone+'</b><span>/'+plan.sessions.length+' total</span></div></div>'+
      '<div class="legend">'+legend+'</div>'+
    '</header>'+
    weeknav+
    '<div id="cards">'+plan.sessions.map(buildCard).join("")+'</div>'+
    '<div class="foot">Sun \u00b7 full rest \u2014 light walk or mobility only if you feel like it.</div>'+
    '<h2 class="sec-h">How was the week?</h2>'+
    '<div class="lbl">Work load</div><div class="chips">'+wlChips+'</div>'+
    '<div class="lbl">Overall energy</div><div class="chips">'+enChips+'</div>'+
    '<div class="lbl">Anything to flag</div>'+
    '<textarea class="note" id="flags-ta" data-action="set-flags" placeholder="Sleep, niggles, fingers, busy stretch coming up\u2026" rows="2"></textarea>'+
    '<div class="actions">'+
      '<button class="btn primary" data-action="copy">'+IC.copy+' Copy summary for your AI</button>'+
      '<button class="btn load" data-action="load-week-trigger">'+IC.ul+' Load next week plan</button>'+
      '<div class="btn-row"><button class="btn ghost" data-action="export">'+IC.dl+' Export backup</button><button class="btn ghost" data-action="import-backup-trigger">'+IC.ul+' Import backup</button></div>'+
    '</div>'+
    '<p class="foot" style="margin-top:20px">Saved to your Drive automatically. Export a backup now and then for peace of mind.</p>'+
    '</div>';
}

function buildCard(s) {
  var sport=sportMeta(s.sport);
  var l=state.log[s.id]||{done:false,felt:null,note:"",doneAt:null};
  var isOpen=state.open[s.id]!==false;
  var tagClass='tag'+(s.priority==="Optional"?" opt":"");
  var tagStyle=s.priority==="Core"?' style="background:'+sport.color+';color:#1a1208"':'';
  var doneAtText=l.done&&l.doneAt?formatDoneAt(l.doneAt):"";
  var restHtml=s.rest?'<div class="rest-info">'+IC.timer+s.rest+'</div>':"";
  var blocksHtml=s.sport==="strength"?buildStrengthBlocks(s,sport):buildSimpleBlocks(s,sport);
  var notePlaceholder=s.sport==="strength"?"Overall session note \u2014 form, how you felt, anything to flag\u2026":"Optional note \u2014 how it felt, anything off, what you adjusted\u2026";
  var feltBtns=FELT.map(function(f){return '<button class="fbtn'+(l.felt===f.v?" on":"")+'" data-action="set-felt" data-id="'+s.id+'" data-felt="'+f.v+'"><b>'+f.v+'</b><small>'+f.label+'</small></button>';}).join("");
  return '<div class="card'+(l.done?" done":"")+'" id="card-'+s.id+'" style="border-left:3px solid '+sport.color+'">'+
    '<div class="crow">'+
      '<button class="check'+(l.done?" on":"")+'" id="check-'+s.id+'" '+(l.done?'style="background:'+sport.color+';border-color:'+sport.color+'"':'')+' data-action="toggle-done" data-id="'+s.id+'" aria-label="Mark done">'+(l.done?IC.check:'')+'</button>'+
      '<div class="cmid">'+
        '<div class="ctop"><span class="day">'+(s.day||"")+'</span><span class="'+tagClass+'"'+tagStyle+'>'+(s.priority||"")+'</span></div>'+
        '<div class="ctitle">'+(s.title||"")+'</div>'+
        '<div class="dur">'+(s.duration||"")+'</div>'+
        '<div class="done-at" id="done-at-'+s.id+'">'+doneAtText+'</div>'+
      '</div>'+
      '<button class="exp'+(isOpen?" open":"")+'" id="exp-'+s.id+'" data-action="toggle-expand" data-id="'+s.id+'" aria-label="Expand">'+IC.chevron+'</button>'+
    '</div>'+
    '<div class="body" id="body-'+s.id+'"'+(isOpen?'':' style="display:none"')+'>'+
      restHtml+
      '<ul class="blocks">'+blocksHtml+'</ul>'+
      '<div class="coach" style="border-left-color:'+sport.color+'">'+(s.note||"")+'</div>'+
      '<div class="felt">'+feltBtns+'</div>'+
      '<textarea class="note" data-action="set-note" data-id="'+s.id+'" placeholder="'+notePlaceholder+'" rows="2"></textarea>'+
    '</div>'+
  '</div>';
}

function buildSimpleBlocks(s, sport) {
  return (s.blocks||[]).map(function(b,i) {
    var text=blockText(b), help=blockHelp(b), helpId="help-"+s.id+"-"+i;
    return '<li class="sli" style="color:'+sport.color+'">'+
      '<div style="display:flex;align-items:flex-start;gap:8px">'+
        '<span style="flex:1;color:'+sport.color+'">'+text+'</span>'+
        (help?'<button class="help-btn" data-action="toggle-help" data-help-id="'+helpId+'">?</button>':'')+
      '</div>'+
      (help?'<div class="help-text" id="'+helpId+'">'+help+'</div>':'')+
    '</li>';
  }).join("");
}

function buildStrengthBlocks(s, sport) {
  return (s.blocks||[]).map(function(b,i) {
    var text=blockText(b), help=blockHelp(b), recW=blockWeight(b);
    var helpId="help-"+s.id+"-"+i;
    var ex=exState(s.id,i);
    var isChecked=ex.checked;
    var prev=previousWeight(state.currentWeek,text);
    return '<li class="eli">'+
      '<div class="ex-row">'+
        '<button class="ex-check'+(isChecked?" on":"")+'" id="exc-'+s.id+'-'+i+'" '+
                (isChecked?'style="background:'+sport.color+';border-color:'+sport.color+'"':'')+
                ' data-action="toggle-exercise" data-sid="'+s.id+'" data-eidx="'+i+'">'+
          (isChecked?IC.check:'')+
        '</button>'+
        '<span class="ex-text">'+text+'</span>'+
        (help?'<button class="help-btn" data-action="toggle-help" data-help-id="'+helpId+'">?</button>':'')+
      '</div>'+
      '<div class="ex-meta">'+
        '<input class="ex-weight" type="number" step="0.5" min="0" max="200" '+
               'id="exw-'+s.id+'-'+i+'" '+
               'data-action="set-ex-weight" data-sid="'+s.id+'" data-eidx="'+i+'" '+
               (recW!==null?'placeholder="'+recW+' \u2014 recommended"':'placeholder="kg"')+'>'+
        '<span class="ex-weight-unit">kg / DB</span>'+
        (prev?'<span class="ex-prev">last '+prev.weight+' \u00b7 wk '+prev.week+'</span>':'')+
        '<button class="ex-pen-btn" id="expb-'+s.id+'-'+i+'" data-action="toggle-ex-note" data-nwid="exnw-'+s.id+'-'+i+'" data-pbid="expb-'+s.id+'-'+i+'">'+IC.pen+'</button>'+
      '</div>'+
      '<div class="ex-note-wrap" id="exnw-'+s.id+'-'+i+'" style="display:none">'+
        '<textarea class="ex-note" id="exn-'+s.id+'-'+i+'" data-action="set-ex-note" data-sid="'+s.id+'" data-eidx="'+i+'" placeholder="Note for this exercise\u2026" rows="2"></textarea>'+
      '</div>'+
      (help?'<div class="help-text" id="'+helpId+'">'+help+'</div>':'')+
    '</li>';
  }).join("");
}

// ── DOM helpers ────────────────────────────────────────────────────────────────
function updateCheck(id) {
  if(!state.currentPlan) return;
  var s=state.currentPlan.sessions.filter(function(x){return x.id===id;})[0]; if(!s) return;
  var sport=sportMeta(s.sport), l=state.log[id]||{}, done=!!l.done;
  var card=document.getElementById("card-"+id), check=document.getElementById("check-"+id), dat=document.getElementById("done-at-"+id);
  if(card)  card.className="card"+(done?" done":"");
  if(check) { check.className="check"+(done?" on":""); check.style.background=done?sport.color:""; check.style.borderColor=done?sport.color:""; check.innerHTML=done?IC.check:""; }
  if(dat)   dat.textContent=done&&l.doneAt?formatDoneAt(l.doneAt):"";
}

function updateExCheck(sessionId, idx) {
  if(!state.currentPlan) return;
  var s=state.currentPlan.sessions.filter(function(x){return x.id===sessionId;})[0]; if(!s) return;
  var sport=sportMeta(s.sport), checked=exState(sessionId,idx).checked;
  var btn=document.getElementById("exc-"+sessionId+"-"+idx); if(!btn) return;
  btn.className="ex-check"+(checked?" on":"");
  btn.style.background=checked?sport.color:""; btn.style.borderColor=checked?sport.color:"";
  btn.innerHTML=checked?IC.check:"";
}

function checkAutoComplete(sessionId) {
  if(!state.currentPlan) return;
  var s=state.currentPlan.sessions.filter(function(x){return x.id===sessionId;})[0];
  if(!s||s.sport!=="strength") return;
  var allChecked=(s.blocks||[]).every(function(b,i){return exState(sessionId,i).checked;});
  var l=state.log[sessionId]||{};
  if(allChecked&&!l.done) {
    if(!state.log[sessionId]) state.log[sessionId]={done:false,felt:null,note:"",doneAt:null};
    state.log[sessionId].done=true; state.log[sessionId].doneAt=new Date().toISOString();
    updateCheck(sessionId); updateProgress();
  } else if(!allChecked&&l.done) {
    state.log[sessionId].done=false; state.log[sessionId].doneAt=null;
    updateCheck(sessionId); updateProgress();
  }
}

function updateFelt(id) {
  var felt=state.log[id]&&state.log[id].felt;
  var body=document.getElementById("body-"+id); if(!body) return;
  body.querySelectorAll('[data-action="set-felt"]').forEach(function(btn){
    btn.className="fbtn"+(felt!==null&&felt!==undefined&&felt===parseInt(btn.dataset.felt)?" on":"");
  });
}

function updateExpand(id) {
  var body=document.getElementById("body-"+id), btn=document.getElementById("exp-"+id);
  if(!body||!btn) return;
  body.style.display=state.open[id]?"":"none"; btn.className="exp"+(state.open[id]?" open":"");
}

function updateProgress() {
  if(!state.currentPlan) return;
  var cd=state.currentPlan.sessions.filter(function(s){return s.priority==="Core"&&state.log[s.id]&&state.log[s.id].done;}).length;
  var ad=state.currentPlan.sessions.filter(function(s){return state.log[s.id]&&state.log[s.id].done;}).length;
  var cde=document.getElementById("core-done"), ade=document.getElementById("all-done");
  if(cde) cde.textContent=cd; if(ade) ade.textContent=ad;
  if(window.Stats) Stats.refresh();
}

// ── Events ─────────────────────────────────────────────────────────────────────
function handleClick(e) {
  var btn=e.target; while(btn&&(!btn.dataset||!btn.dataset.action)) btn=btn.parentElement;
  if(!btn||!btn.dataset||!btn.dataset.action) return;
  var action=btn.dataset.action;

  // Navigation and lock work regardless of lock state.
  if(action==="week-prev") { var p=weekNumbersSorted(), j=p.indexOf(state.currentWeek); if(j>0) goToWeek(p[j-1]); return; }
  if(action==="week-next") { var q=weekNumbersSorted(), m=q.indexOf(state.currentWeek); if(m>=0&&m<q.length-1) goToWeek(q[m+1]); return; }
  if(action==="toggle-lock") { state.locked=!state.locked; renderApp(); return; }

  // While viewing a locked past week, ignore anything that would edit it.
  var EDIT={ "toggle-done":1,"toggle-exercise":1,"toggle-ex-note":1,"set-felt":1,"set-workload":1,"set-energy":1 };
  if(state.locked && EDIT[action]) return;

  if(action==="signin") {
    Auth.signIn().catch(function(){ /* popup closed or dismissed */ });

  } else if(action==="retry") {
    onAuthChange(Auth.isSignedIn());

  } else if(action==="open-help") {
    openHelp();

  } else if(action==="toggle-done") {
    var id=btn.dataset.id;
    if(!state.log[id]) state.log[id]={done:false,felt:null,note:"",doneAt:null};
    state.log[id].done=!state.log[id].done;
    state.log[id].doneAt=state.log[id].done?new Date().toISOString():null;
    updateCheck(id); updateProgress(); scheduleSave();

  } else if(action==="toggle-exercise") {
    var sid=btn.dataset.sid, idx=parseInt(btn.dataset.eidx);
    if(!state.log[sid]) state.log[sid]={done:false,felt:null,note:"",doneAt:null};
    if(!state.log[sid].exercises) state.log[sid].exercises={};
    var key=String(idx);
    if(!state.log[sid].exercises[key]) state.log[sid].exercises[key]={checked:false,weight:"",note:""};
    state.log[sid].exercises[key].checked=!state.log[sid].exercises[key].checked;
    updateExCheck(sid,idx); checkAutoComplete(sid); scheduleSave();

  } else if(action==="toggle-ex-note") {
    var nw=document.getElementById(btn.dataset.nwid), pb=document.getElementById(btn.dataset.pbid);
    if(nw) { var open=nw.style.display!=="none"&&nw.style.display!==""; nw.style.display=open?"":""; if(!open) { var ni=nw.querySelector("textarea"); if(ni) ni.focus(); } }
    if(pb) pb.classList.toggle("on", nw&&nw.style.display!=="none");

  } else if(action==="toggle-expand") {
    var id=btn.dataset.id; state.open[id]=!state.open[id]; updateExpand(id);

  } else if(action==="toggle-help") {
    var he=document.getElementById(btn.dataset.helpId);
    if(he) { var op=he.style.display!=="none"&&he.style.display!==""; he.style.display=op?"none":"block"; btn.classList.toggle("on",!op); }

  } else if(action==="set-felt") {
    var id=btn.dataset.id, v=parseInt(btn.dataset.felt);
    if(!state.log[id]) state.log[id]={done:false,felt:null,note:"",doneAt:null};
    state.log[id].felt=state.log[id].felt===v?null:v;
    updateFelt(id); scheduleSave();

  } else if(action==="set-workload") {
    var w=btn.dataset.workload; state.reflection.workload=state.reflection.workload===w?null:w;
    document.querySelectorAll('[data-action="set-workload"]').forEach(function(c){c.className="chip"+(state.reflection.workload===c.dataset.workload?" on":"");});
    scheduleSave();

  } else if(action==="set-energy") {
    var n=parseInt(btn.dataset.energy); state.reflection.energy=state.reflection.energy===n?null:n;
    document.querySelectorAll('[data-action="set-energy"]').forEach(function(c){c.className="chip"+(state.reflection.energy===parseInt(c.dataset.energy)?" on":"");});
    scheduleSave();

  } else if(action==="copy")                 { copySummary();
  } else if(action==="export")               { exportData();
  } else if(action==="load-week-trigger")    { document.getElementById("plan-file-input").click();
  } else if(action==="import-backup-trigger"){ document.getElementById("backup-file-input").click();
  }
}

function handleInput(e) {
  var el=e.target; if(!el.dataset||!el.dataset.action) return;
  if(state.locked) return;   // no edits to a locked past week
  var action=el.dataset.action;
  if(action==="set-note") {
    var id=el.dataset.id;
    if(!state.log[id]) state.log[id]={done:false,felt:null,note:"",doneAt:null};
    state.log[id].note=el.value; scheduleSave();
  } else if(action==="set-ex-weight") {
    var sid=el.dataset.sid, idx=String(el.dataset.eidx);
    if(!state.log[sid]) state.log[sid]={done:false,felt:null,note:"",doneAt:null};
    if(!state.log[sid].exercises) state.log[sid].exercises={};
    if(!state.log[sid].exercises[idx]) state.log[sid].exercises[idx]={checked:false,weight:"",note:""};
    state.log[sid].exercises[idx].weight=el.value; scheduleSave();
  } else if(action==="set-ex-note") {
    var sid=el.dataset.sid, idx=String(el.dataset.eidx);
    if(!state.log[sid]) state.log[sid]={done:false,felt:null,note:"",doneAt:null};
    if(!state.log[sid].exercises) state.log[sid].exercises={};
    if(!state.log[sid].exercises[idx]) state.log[sid].exercises[idx]={checked:false,weight:"",note:""};
    state.log[sid].exercises[idx].note=el.value; scheduleSave();
  } else if(action==="set-flags") {
    state.reflection.flags=el.value; scheduleSave();
  }
}

// ── File handlers ──────────────────────────────────────────────────────────────
function handlePlanFile(e) {
  var file=e.target.files&&e.target.files[0]; if(!file) return;
  var reader=new FileReader();
  reader.onload=function() {
    try {
      var plan=JSON.parse(reader.result);
      if(!plan.weekNumber||!Array.isArray(plan.sessions)||plan.sessions.length===0) throw new Error("Invalid");
      var wk=String(plan.weekNumber);
      var existingLog=state.allWeeks[wk]&&state.allWeeks[wk].log;
      var existingRef=state.allWeeks[wk]&&state.allWeeks[wk].reflection;
      var newLog={};
      plan.sessions.forEach(function(s) {
        var base=Object.assign({done:false,felt:null,note:"",doneAt:null},(existingLog&&existingLog[s.id])||{});
        if(s.sport==="strength") {
          var existEx=(existingLog&&existingLog[s.id]&&existingLog[s.id].exercises)||{};
          base.exercises={};
          (s.blocks||[]).forEach(function(b,i){
            base.exercises[String(i)]=existEx[String(i)]||{checked:false,weight:"",note:""};
          });
        }
        newLog[s.id]=base;
      });
      state.allWeeks[wk]={plan:plan,log:newLog,reflection:existingRef||{workload:null,energy:null,flags:""},updatedAt:new Date().toISOString()};
      state.currentWeek=plan.weekNumber; state.currentPlan=plan;
      state.log=state.allWeeks[wk].log; state.reflection=state.allWeeks[wk].reflection;
      state.open={}; plan.sessions.forEach(function(s){state.open[s.id]=!(state.log[s.id]&&state.log[s.id].done);});
      state.locked=false;
      persistNow();
      renderApp();
    } catch(err) { alert("Couldn\u2019t load plan \u2014 make sure you\u2019re opening a week plan file."); }
  };
  reader.readAsText(file); e.target.value="";
}

function handleBackupFile(e) {
  var file=e.target.files&&e.target.files[0]; if(!file) return;
  var reader=new FileReader();
  reader.onload=function() {
    try {
      var data=JSON.parse(reader.result); if(!data.weeks) throw new Error("Invalid");
      applyData(data);
      persistNow();
      renderApp();
    } catch(err) { alert("Import failed \u2014 make sure you\u2019re using a training log backup file."); }
  };
  reader.readAsText(file); e.target.value="";
}

// ── Summary ────────────────────────────────────────────────────────────────────
function buildSummary() {
  if(!state.currentPlan) return "";
  var plan=state.currentPlan;
  var lines=["WEEK "+plan.weekNumber+" ("+(plan.phase||"")+") \u2014 log summary",""];
  plan.sessions.forEach(function(s) {
    var l=state.log[s.id]||{};
    var fo=FELT.filter(function(f){return f.v===l.felt;})[0];
    var feltLabel=fo?"felt "+l.felt+"/5 ("+fo.label+")":"no rating";
    var doneLabel=l.done?("\u2705 done"+(l.doneAt?" ("+formatDoneAt(l.doneAt)+")":" (time not logged)")):"\u25a1 skipped";
    lines.push(s.day+" \u00b7 "+s.title+" \u2014 "+doneLabel+", "+feltLabel);
    if(s.sport==="strength"&&l.exercises) {
      (s.blocks||[]).forEach(function(b,i) {
        var ex=l.exercises[String(i)]; if(!ex) return;
        var name=blockText(b).split(" \u2014")[0].split(" -")[0];
        var chk=ex.checked?"\u2713":"\u25a1";
        var wt=ex.weight?ex.weight+" kg/DB":"no weight";
        var line="   "+chk+" "+name+": "+wt;
        if(ex.note&&ex.note.trim()) line+=" | "+ex.note.trim();
        lines.push(line);
      });
    }
    if(l.note&&l.note.trim()) lines.push("   note: "+l.note.trim());
  });
  lines.push("");
  lines.push("Work load: "+(state.reflection.workload||"\u2014")+" \u00b7 Energy: "+(state.reflection.energy?state.reflection.energy+"/5":"\u2014"));
  if(state.reflection.flags&&state.reflection.flags.trim()) lines.push("Flags: "+state.reflection.flags.trim());
  return lines.join("\n");
}

function copySummary() {
  var text=buildSummary(); if(!text) return;
  if(navigator.clipboard&&navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showSaved).catch(function(){showCopyModal(text);});
  } else { showCopyModal(text); }
}

function showCopyModal(text) {
  var ta=document.getElementById("copy-text"), modal=document.getElementById("copy-modal");
  ta.value=text; modal.classList.add("open"); setTimeout(function(){ta.focus();ta.select();},60);
}

function exportData() {
  try {
    var payload=JSON.stringify(buildPayload());
    var blob=new Blob([payload],{type:"application/json"}), url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download="training-log-backup-"+new Date().toISOString().slice(0,10)+".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch(e) { alert("Export failed: "+e.message); }
}

// ── Help modal ─────────────────────────────────────────────────────────────────
function openHelp()  { document.getElementById("help-modal").classList.add("open"); }
function closeHelp() { document.getElementById("help-modal").classList.remove("open"); }
function copyPrompt() {
  var pre=document.getElementById("kickoff-prompt"); if(!pre) return;
  var text=pre.textContent;
  var btn=document.getElementById("help-copy");
  function flash(){ if(btn){ var o=btn.textContent; btn.textContent="Copied \u2713"; setTimeout(function(){btn.textContent=o;},1400);} }
  if(navigator.clipboard&&navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash).catch(function(){ showCopyModal(text); });
  } else { showCopyModal(text); }
}

// ── Migration (one-time, off this device's localStorage) ───────────────────────
function maybeOfferMigration(driveEmpty) {
  if(!driveEmpty) return;
  var raw; try { raw=localStorage.getItem(STORAGE_KEY); } catch(e) { return; }
  if(!raw) return;
  var data; try { data=JSON.parse(raw); } catch(e) { return; }
  if(!data||!data.weeks||!Object.keys(data.weeks).length) return;
  if(confirm("Found training history saved on this device. Copy it into your Google Drive so it syncs across your devices?")) {
    applyData(data);
    persistNow();
    renderApp();
  }
}

// ── Auth orchestration / boot ──────────────────────────────────────────────────
function onAuthChange(signedIn) {
  updateChrome();
  if(!signedIn) { renderSignedOut(); return; }
  setStatus("syncing");
  Drive.load().then(function(data) {
    var driveEmpty = !data || !data.weeks || !Object.keys(data.weeks).length;
    if(data) applyData(data); else resetState();
    setStatus("idle");
    renderApp();
    maybeOfferMigration(driveEmpty);
  }).catch(function() {
    setStatus("idle");
    renderError("Couldn\u2019t load your training data. Check your connection and try again \u2014 the app needs to be online to read from Drive.");
  });
}

function boot() {
  // Top-bar chrome
  document.getElementById("help-btn").addEventListener("click", openHelp);
  document.getElementById("help-close").addEventListener("click", closeHelp);
  document.getElementById("help-copy").addEventListener("click", copyPrompt);
  document.getElementById("dl-btn").addEventListener("click", exportData);
  document.getElementById("signout-btn").addEventListener("click", function(){ Auth.signOut(); });

  // App (delegated)
  document.getElementById("app").addEventListener("click", handleClick);
  document.getElementById("app").addEventListener("input", handleInput);

  // File inputs
  document.getElementById("plan-file-input").addEventListener("change", handlePlanFile);
  document.getElementById("backup-file-input").addEventListener("change", handleBackupFile);

  // Copy modal
  document.getElementById("modal-close").addEventListener("click", function(){ document.getElementById("copy-modal").classList.remove("open"); });
  document.getElementById("copy-modal").addEventListener("click", function(e){ if(e.target===document.getElementById("copy-modal")) document.getElementById("copy-modal").classList.remove("open"); });

  // Help modal backdrop
  document.getElementById("help-modal").addEventListener("click", function(e){ if(e.target===document.getElementById("help-modal")) closeHelp(); });

  // Stats panel (bar-chart button in the top bar)
  if (window.Stats) Stats.init();

  // Show a brief connecting state, then try to restore the session silently.
  // onAuthChange(true) loads the app; onAuthChange(false) shows the sign-in
  // screen if there's no active session to restore.
  renderConnecting();
  Auth.init(onAuthChange);
}

document.addEventListener("DOMContentLoaded", boot);
