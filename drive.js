// ── drive.js ────────────────────────────────────────────────────────────────────
// Persistence layer. Stores ALL training history as a single JSON file named
// "training-log.json" inside the app data folder — a hidden, app-private folder
// in the user's own Google Drive. It doesn't appear in their normal Drive view
// and can't be touched by other apps. The "Data" button exports a copy so the
// user can see/keep it whenever they like.
//
// Data shape written here is identical to the old localStorage blob:
//   { version:1, currentWeek:<n|null>, weeks:{ "1":{plan,log,reflection,...}, ... } }

var Drive = (function () {
  var FILE_NAME = "training-log.json";
  var fileId = null;

  // Authenticated fetch with a one-shot retry if the token was rejected.
  function api(url, opts, retried) {
    return Auth.ensureToken().then(function (token) {
      opts = opts || {};
      opts.headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + token });
      return fetch(url, opts).then(function (r) {
        if (r.status === 401 && !retried) {
          Auth.invalidate();
          return api(url, opts, true);
        }
        if (!r.ok) throw new Error("Drive request failed (" + r.status + ")");
        return r;
      });
    });
  }

  function findFile() {
    if (fileId) return Promise.resolve(fileId);
    var q = encodeURIComponent("name='" + FILE_NAME + "'");
    var url = "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" +
              q + "&fields=files(id,name)";
    return api(url).then(function (r) { return r.json(); }).then(function (d) {
      fileId = (d.files && d.files.length) ? d.files[0].id : null;
      return fileId;
    });
  }

  // Returns the parsed data object, or null if the user has no file yet.
  function load() {
    return findFile().then(function (id) {
      if (!id) return null;
      var url = "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media";
      return api(url).then(function (r) { return r.text(); }).then(function (t) {
        if (!t) return null;
        try { return JSON.parse(t); } catch (e) { return null; }
      });
    });
  }

  function createFile(dataObj) {
    var boundary = "tlog_" + Date.now();
    var metadata = { name: FILE_NAME, parents: ["appDataFolder"] };
    var body =
      "--" + boundary + "\r\n" +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) + "\r\n" +
      "--" + boundary + "\r\n" +
      "Content-Type: application/json\r\n\r\n" +
      JSON.stringify(dataObj) + "\r\n" +
      "--" + boundary + "--";
    var url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
    return api(url, {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body: body
    }).then(function (r) { return r.json(); }).then(function (d) {
      fileId = d.id; return d.id;
    });
  }

  function updateFile(dataObj) {
    var url = "https://www.googleapis.com/upload/drive/v3/files/" + fileId +
              "?uploadType=media";
    return api(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataObj)
    }).then(function (r) { return r.json(); });
  }

  // Creates the file on first save, updates it thereafter.
  function save(dataObj) {
    return findFile().then(function (id) {
      return id ? updateFile(dataObj) : createFile(dataObj);
    });
  }

  return { load: load, save: save };
})();
