// ── stats.js ────────────────────────────────────────────────────────────────────
// Training stats panel: summary tiles, a 60-day binary heatmap (days with any
// completed session), week-level streaks, and a Chart.js bar chart of sessions
// per week stacked by sport. Reads everything from the app's in-memory state
// (state.allWeeks) and reuses sportMeta() from app.js for labels/colours.
//
// "Exercised" = any session with done === true. Dates come from doneAt.
// Streaks are counted in calendar weeks (Monday start) with at least one session.

var Stats = (function () {
  var HEATMAP_DAYS = 60;
  var CHART_WEEKS = 12;
  var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  var visible = false;
  var filter = "ALL";       // "ALL" or a specific sport key
  var chart = null;
  var monthOffset = 0;      // 0 = window ends on the current month; +1 pages back a month
  var CHEV_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  var CHEV_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

  // ── date helpers ──────────────────────────────────────────────────────────────
  function dayKey(d) { return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function weekStart(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var off = (x.getDay() + 6) % 7;            // Monday = 0
    x.setDate(x.getDate() - off); x.setHours(0, 0, 0, 0);
    return x;
  }
  function weekIdx(d) { return Math.round(weekStart(d).getTime() / (7 * 86400000)); }

  // ── data ──────────────────────────────────────────────────────────────────────
  function collectEvents() {
    var ev = [];
    var weeks = (typeof state !== "undefined" && state.allWeeks) || {};
    Object.keys(weeks).forEach(function (wk) {
      var w = weeks[wk]; if (!w || !w.plan || !w.log) return;
      var sportById = {};
      (w.plan.sessions || []).forEach(function (s) { sportById[s.id] = s.sport; });
      Object.keys(w.log).forEach(function (id) {
        var l = w.log[id];
        if (l && l.done && l.doneAt) {
          var d = new Date(l.doneAt);
          if (!isNaN(d.getTime())) ev.push({ date: d, sport: sportById[id] || "", dayKey: dayKey(d), weekIdx: weekIdx(d) });
        }
      });
    });
    return ev;
  }

  function sportsPresent(ev) {
    var seen = [];
    ev.forEach(function (e) { if (e.sport && seen.indexOf(e.sport) < 0) seen.push(e.sport); });
    return seen;
  }

  function applyFilter(ev) { return filter === "ALL" ? ev : ev.filter(function (e) { return e.sport === filter; }); }

  function meta(key) {
    return (typeof sportMeta === "function") ? sportMeta(key) : { label: key || "Session", color: "#888" };
  }

  // ── computations ──────────────────────────────────────────────────────────────
  function streaks(ev) {
    var set = {};
    ev.forEach(function (e) { set[e.weekIdx] = true; });
    var keys = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    if (!keys.length) return { current: 0, longest: 0, activeWeeks: 0 };
    var longest = 1, run = 1;
    for (var i = 1; i < keys.length; i++) {
      run = (keys[i] === keys[i - 1] + 1) ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    // Current streak: count back from this week. Grace: if this week has no
    // session yet, start from last week so an in-progress week doesn't zero it.
    var thisW = weekIdx(new Date());
    var startW = set[thisW] ? thisW : (set[thisW - 1] ? thisW - 1 : null);
    var current = 0;
    if (startW !== null) { var w = startW; while (set[w]) { current++; w--; } }
    return { current: current, longest: longest, activeWeeks: keys.length };
  }

  function monthIdxOf(d) { return d.getFullYear() * 12 + d.getMonth(); }
  function ymFromIdx(mi) { return { y: Math.floor(mi / 12), m: ((mi % 12) + 12) % 12 }; }
  function earliestEventMonth(ev) {
    var min = null;
    ev.forEach(function (e) { var mi = monthIdxOf(e.date); if (min === null || mi < min) min = mi; });
    return min;
  }

  // One calendar month as columns of weeks; rows are weekdays (Mon..Sun).
  function monthBlock(year, month, doneDays) {
    var firstCol = (new Date(year, month, 1).getDay() + 6) % 7;   // weekday of the 1st, Mon=0
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var weeks = Math.ceil((firstCol + daysInMonth) / 7);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var cols = [];
    for (var w = 0; w < weeks; w++) {
      var col = [];
      for (var r = 0; r < 7; r++) {
        var dayNum = w * 7 + r - firstCol + 1;
        if (dayNum < 1 || dayNum > daysInMonth) { col.push({ blank: true }); continue; }
        var d = new Date(year, month, dayNum);
        var k = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
        col.push({ blank: false, active: !!doneDays[k], isToday: d.getTime() === today.getTime(), future: d > today });
      }
      cols.push(col);
    }
    return cols;
  }

  function buildCalendar(doneDays, allEv) {
    var nowMI = monthIdxOf(new Date());
    var anchor = nowMI - monthOffset;
    var months = [anchor - 2, anchor - 1, anchor];
    var earliest = earliestEventMonth(allEv);
    var canLater = monthOffset > 0;
    var canEarlier = earliest !== null && months[0] > earliest;
    var activeColor = filter === "ALL" ? "var(--climb)" : meta(filter).color;

    var a = ymFromIdx(months[0]), b = ymFromIdx(months[2]);
    var range = (a.y === b.y) ? (MON[a.m] + " \u2013 " + MON[b.m] + " " + b.y)
                              : (MON[a.m] + " " + a.y + " \u2013 " + MON[b.m] + " " + b.y);

    var DL = ["M", "T", "W", "T", "F", "S", "S"];
    var dayCol = '<div class="cal-days"><div class="cal-monthhead"></div><div class="cal-daylabels">' +
      DL.map(function (x) { return "<span>" + x + "</span>"; }).join("") + '</div></div>';

    var blocks = months.map(function (mi) {
      var ym = ymFromIdx(mi);
      var grid = '<div class="cal-grid">' + monthBlock(ym.y, ym.m, doneDays).map(function (col) {
        return '<div class="heatcol">' + col.map(function (c) {
          if (c.blank) return '<div class="heatcell out"></div>';
          var cls = "heatcell" + (c.isToday ? " today" : "") + (c.future ? " future" : "");
          var style = c.active ? ' style="background:' + activeColor + '"' : '';
          return '<div class="' + cls + '"' + style + '></div>';
        }).join("") + '</div>';
      }).join("") + '</div>';
      return '<div class="cal-month"><div class="cal-monthhead">' + MON[ym.m] + '</div>' + grid + '</div>';
    }).join("");

    var pager = '<div class="cal-pager">' +
      '<button class="wn-btn cal-pg" data-stats-page="earlier"' + (canEarlier ? '' : ' disabled') + '>' + CHEV_L + '</button>' +
      '<span class="cal-range">' + range + '</span>' +
      '<button class="wn-btn cal-pg" data-stats-page="later"' + (canLater ? '' : ' disabled') + '>' + CHEV_R + '</button>' +
      '</div>';

    return pager + '<div class="cal">' + dayCol + blocks + '</div>';
  }

  function weeklyAxis() {
    var thisW = weekIdx(new Date());
    var base = weekStart(new Date());
    var labels = [], idxs = [];
    for (var k = 0; k < CHART_WEEKS; k++) {
      var w = thisW - (CHART_WEEKS - 1) + k;
      var ws = new Date(base); ws.setDate(ws.getDate() - (thisW - w) * 7);
      labels.push(ws.getDate() + " " + MON[ws.getMonth()]);
      idxs.push(w);
    }
    return { labels: labels, idxs: idxs };
  }

  // ── render ────────────────────────────────────────────────────────────────────
  function render() {
    var panel = document.getElementById("stats-panel");
    if (!panel) return;

    var allEv = collectEvents();
    var fEv = applyFilter(allEv);

    // Filter chips (All + each sport ever logged)
    var sports = sportsPresent(allEv);
    var chips = '<button class="chip' + (filter === "ALL" ? " on" : "") + '" data-stats-filter="ALL">All</button>' +
      sports.map(function (sp) {
        var m = meta(sp);
        return '<button class="chip' + (filter === sp ? " on" : "") + '" data-stats-filter="' + sp + '">' + m.label + '</button>';
      }).join("");

    var head =
      '<div class="stats-head"><h2>Your training</h2></div>' +
      '<div class="stats-chips">' + chips + '</div>';

    if (allEv.length === 0) {
      panel.innerHTML = '<div class="wrap stats-wrap">' + head +
        '<div class="stats-empty">Complete a session (tick it off) and it\u2019ll show up here \u2014 days trained, weekly streaks, and sessions per week.</div>' +
        '</div>';
      bindChips();
      return;
    }

    var st = streaks(fEv);
    var totalSessions = fEv.length;

    var tiles =
      '<div class="stat-tiles">' +
      tile(totalSessions, "Sessions") +
      tile(st.activeWeeks, "Weeks active") +
      tile(st.current, "Week streak") +
      tile(st.longest, "Best streak") +
      '</div>';

    // Heatmap (calendar months)
    var doneDays = {};
    fEv.forEach(function (e) { doneDays[e.dayKey] = true; });
    var heat = '<div class="stats-section"><div class="lbl">Days trained' +
      (filter === "ALL" ? "" : " \u00b7 " + meta(filter).label) + '</div>' +
      buildCalendar(doneDays, allEv) + '</div>';

    var chartSec = '<div class="stats-section"><div class="lbl">Sessions per week</div>' +
      '<div class="chartbox"><canvas id="vol-chart"></canvas></div></div>';

    panel.innerHTML = '<div class="wrap stats-wrap">' + head + tiles + heat + chartSec + '</div>';
    bindChips();
    drawChart(fEv);
  }

  function tile(value, label) {
    return '<div class="tile"><b>' + value + '</b><span>' + label + '</span></div>';
  }

  function bindChips() {
    var panel = document.getElementById("stats-panel");
    panel.querySelectorAll("[data-stats-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.getAttribute("data-stats-filter");
        render();
      });
    });
    panel.querySelectorAll("[data-stats-page]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.getAttribute("data-stats-page") === "earlier") monthOffset++;
        else monthOffset = Math.max(0, monthOffset - 1);
        render();
      });
    });
  }

  function drawChart(fEv) {
    if (chart) { chart.destroy(); chart = null; }
    if (typeof Chart === "undefined") return;             // CDN blocked — skip gracefully
    var canvas = document.getElementById("vol-chart"); if (!canvas) return;

    var axis = weeklyAxis();
    var idxPos = {}; axis.idxs.forEach(function (w, i) { idxPos[w] = i; });

    var datasets;
    if (filter === "ALL") {
      var sports = sportsPresent(fEv);
      if (!sports.length) sports = [""];
      datasets = sports.map(function (sp) {
        var data = axis.idxs.map(function () { return 0; });
        fEv.forEach(function (e) {
          if (e.sport === sp && idxPos[e.weekIdx] !== undefined) data[idxPos[e.weekIdx]]++;
        });
        var m = meta(sp);
        return { label: m.label, data: data, backgroundColor: m.color, borderRadius: 3, stack: "s" };
      });
    } else {
      var d = axis.idxs.map(function () { return 0; });
      fEv.forEach(function (e) { if (idxPos[e.weekIdx] !== undefined) d[idxPos[e.weekIdx]]++; });
      datasets = [{ label: meta(filter).label, data: d, backgroundColor: meta(filter).color, borderRadius: 3, stack: "s" }];
    }

    var tickColor = "#A1967F", gridColor = "rgba(231,221,201,0.07)";
    chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: axis.labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: filter === "ALL" && datasets.length > 1, labels: { color: tickColor, boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
          tooltip: { callbacks: {} }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: tickColor, font: { size: 10 }, maxRotation: 0, autoSkip: true } },
          y: { stacked: true, beginAtZero: true, grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 }, precision: 0, stepSize: 1 } }
        }
      }
    });
  }

  // ── public ────────────────────────────────────────────────────────────────────
  function show() { visible = true; monthOffset = 0; var p = document.getElementById("stats-panel"); if (p) { p.hidden = false; } render(); syncBtn(); }
  function hide() { visible = false; var p = document.getElementById("stats-panel"); if (p) p.hidden = true; if (chart) { chart.destroy(); chart = null; } syncBtn(); }
  function toggle() { visible ? hide() : show(); }
  function syncBtn() { var b = document.getElementById("chart-btn"); if (b) b.classList.toggle("on", visible); }

  function init() {
    var b = document.getElementById("chart-btn");
    if (b) b.addEventListener("click", toggle);
  }

  return { init: init, show: show, hide: hide, toggle: toggle, refresh: function () { if (visible) render(); } };
})();
