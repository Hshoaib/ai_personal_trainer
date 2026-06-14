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

  function heatColumns(ev) {
    var doneDays = {};
    ev.forEach(function (e) { doneDays[e.dayKey] = true; });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today); start.setDate(start.getDate() - (HEATMAP_DAYS - 1));
    var cur = weekStart(start);
    var cols = [];
    while (cur <= today) {
      var col = [];
      for (var r = 0; r < 7; r++) {
        var inRange = cur >= start && cur <= today;
        col.push({ active: inRange && !!doneDays[dayKey(cur)], inRange: inRange, isToday: cur.getTime() === today.getTime() });
        cur.setDate(cur.getDate() + 1);
      }
      cols.push(col);
    }
    return cols;
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

    // Heatmap
    var activeColor = filter === "ALL" ? "var(--climb)" : meta(filter).color;
    var cols = heatColumns(fEv);
    var grid = '<div class="heatgrid">' + cols.map(function (col) {
      return '<div class="heatcol">' + col.map(function (c) {
        var cls = "heatcell" + (c.inRange ? "" : " out") + (c.isToday ? " today" : "");
        var style = c.active ? ' style="background:' + activeColor + '"' : '';
        return '<div class="' + cls + '"' + style + '></div>';
      }).join("") + '</div>';
    }).join("") + '</div>';

    var heat = '<div class="stats-section"><div class="lbl">Last 60 days' +
      (filter === "ALL" ? "" : " \u00b7 " + meta(filter).label) + '</div>' + grid + '</div>';

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
  function show() { visible = true; var p = document.getElementById("stats-panel"); if (p) { p.hidden = false; } render(); syncBtn(); }
  function hide() { visible = false; var p = document.getElementById("stats-panel"); if (p) p.hidden = true; if (chart) { chart.destroy(); chart = null; } syncBtn(); }
  function toggle() { visible ? hide() : show(); }
  function syncBtn() { var b = document.getElementById("chart-btn"); if (b) b.classList.toggle("on", visible); }

  function init() {
    var b = document.getElementById("chart-btn");
    if (b) b.addEventListener("click", toggle);
  }

  return { init: init, show: show, hide: hide, toggle: toggle, refresh: function () { if (visible) render(); } };
})();
