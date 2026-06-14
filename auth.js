// ── auth.js ─────────────────────────────────────────────────────────────────────
// Google sign-in using Google Identity Services (token model).
// We request ONLY the drive.appdata scope — the narrowest access that lets the
// app read/write its own hidden data file. No profile/email scope is requested,
// which keeps verification simple and means the app never sees your identity
// beyond the access token it needs to talk to Drive.
//
// Session persistence note: the GIS token client is popup-based and cannot
// restore a session silently on page load (a popup opened without a user click
// is blocked, and the call never returns). So instead of re-requesting on load,
// we cache the short-lived access token in sessionStorage and rehydrate it on
// refresh. sessionStorage survives a reload but is cleared when the tab closes,
// and the token expires within ~an hour regardless — so the exposure is small.

var Auth = (function () {
  var CLIENT_ID = "694311008078-76mtksod9bpslribsvdrh72dq0v3spu7.apps.googleusercontent.com";
  var SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  var SS_KEY = "tlog:tok";

  var tokenClient = null;
  var accessToken = null;
  var tokenExpiry = 0;            // epoch ms when the current token goes stale
  var onChange = function () {};  // app callback: onChange(signedIn:boolean)
  var pending = null;             // { resolve, reject } for an in-flight token request
  var pendingTimer = null;

  function gisReady() {
    return window.google && google.accounts && google.accounts.oauth2;
  }

  // ── token cache (sessionStorage) ──────────────────────────────────────────────
  function persistToken() {
    try { sessionStorage.setItem(SS_KEY, JSON.stringify({ t: accessToken, e: tokenExpiry })); } catch (e) {}
  }
  function clearToken() {
    try { sessionStorage.removeItem(SS_KEY); } catch (e) {}
  }
  function restore() {
    try {
      var raw = sessionStorage.getItem(SS_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.t && o.e && Date.now() < o.e) { accessToken = o.t; tokenExpiry = o.e; return true; }
      }
    } catch (e) {}
    clearToken();
    return false;
  }

  // ── in-flight request bookkeeping ─────────────────────────────────────────────
  function setPending(resolve, reject) {
    pending = { resolve: resolve, reject: reject };
    clearTimeout(pendingTimer);
    // Watchdog: if Google never calls back, fail rather than hang forever.
    pendingTimer = setTimeout(function () { settle(null, new Error("Timed out")); }, 12000);
  }
  function settle(token, err) {
    if (!pending) return;
    clearTimeout(pendingTimer);
    var p = pending; pending = null;
    if (token) p.resolve(token); else p.reject(err || new Error("No token"));
  }

  function setup() {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: function (resp) {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          // expires_in is seconds; keep a 60s safety buffer
          tokenExpiry = Date.now() + ((resp.expires_in || 3600) * 1000) - 60000;
          persistToken();
          settle(accessToken);
          onChange(true);
        } else {
          settle(null, new Error("Authorisation failed"));
        }
      },
      error_callback: function (err) {
        // fires when the popup is closed, blocked, or consent is dismissed
        settle(null, err);
      }
    });
  }

  // On load: set up the client, then restore a cached token if one is still
  // valid. No popup is attempted here — that's what caused the hang.
  function start() {
    setup();
    if (restore()) onChange(true); else onChange(false);
  }

  function init(cb) {
    onChange = cb || function () {};
    if (gisReady()) { start(); return; }
    var waited = 0;
    var poll = setInterval(function () {
      if (gisReady()) { clearInterval(poll); start(); return; }
      waited += 100;
      if (waited >= 10000) {   // Google's script never loaded — stop waiting.
        clearInterval(poll);
        onChange(false);       // fall back to the sign-in screen, never hang
      }
    }, 100);
  }

  // Interactive: shows the Google popup (and, in testing mode, the unverified-app
  // warning the user clicks through). Must be triggered by a user action.
  function signIn() {
    if (!tokenClient && gisReady()) setup();   // recover if GIS loaded late
    return new Promise(function (resolve, reject) {
      if (!tokenClient) { reject(new Error("Sign-in unavailable")); return; }
      setPending(resolve, reject);
      try { tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" }); }
      catch (e) { settle(null, e); }
    });
  }

  // Returns a valid token. If the cached one is stale, asks Google for a fresh
  // one. This may need to open a popup; if the browser blocks it the watchdog
  // rejects, and the caller surfaces a "sign in again" state rather than hanging.
  function ensureToken() {
    if (accessToken && Date.now() < tokenExpiry) return Promise.resolve(accessToken);
    return new Promise(function (resolve, reject) {
      setPending(resolve, reject);
      try { tokenClient.requestAccessToken({ prompt: "" }); }
      catch (e) { settle(null, e); }
    });
  }

  // Forces the next ensureToken() to fetch a fresh token (used after a 401).
  function invalidate() { accessToken = null; tokenExpiry = 0; clearToken(); }

  function signOut() {
    if (accessToken && gisReady()) {
      try { google.accounts.oauth2.revoke(accessToken, function () {}); } catch (e) {}
    }
    accessToken = null; tokenExpiry = 0;
    clearToken();
    onChange(false);
  }

  function isSignedIn() { return !!accessToken && Date.now() < tokenExpiry; }

  return {
    init: init,
    signIn: signIn,
    ensureToken: ensureToken,
    invalidate: invalidate,
    signOut: signOut,
    isSignedIn: isSignedIn
  };
})();
