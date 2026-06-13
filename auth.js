// ── auth.js ─────────────────────────────────────────────────────────────────────
// Google sign-in using Google Identity Services (token model).
// We request ONLY the drive.appdata scope — the narrowest access that lets the
// app read/write its own hidden data file. No profile/email scope is requested,
// which keeps verification simple and means the app never sees your identity
// beyond the access token it needs to talk to Drive.
//
// ▶ REPLACE the CLIENT_ID below with the OAuth client ID you'll create in the
//   Google Cloud Console (I'll walk you through that step). It looks like:
//   "1234567890-abcdefg.apps.googleusercontent.com"

var Auth = (function () {
  var CLIENT_ID = "694311008078-76mtksod9bpslribsvdrh72dq0v3spu7.apps.googleusercontent.com";
  var SCOPE = "https://www.googleapis.com/auth/drive.appdata";

  var tokenClient = null;
  var accessToken = null;
  var tokenExpiry = 0;            // epoch ms when the current token goes stale
  var onChange = function () {};  // app callback: onChange(signedIn:boolean)
  var pending = null;             // { resolve, reject } for an in-flight token request

  function gisReady() {
    return window.google && google.accounts && google.accounts.oauth2;
  }

  function settle(token, err) {
    if (!pending) return;
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
          settle(accessToken);
          onChange(true);
        } else {
          settle(null, new Error("Authorisation failed"));
        }
      },
      error_callback: function (err) {
        // fires when the popup is closed or consent is dismissed
        settle(null, err);
      }
    });
    onChange(false); // signed-out until the user acts
  }

  function init(cb) {
    onChange = cb || function () {};
    if (gisReady()) { setup(); return; }
    var poll = setInterval(function () {
      if (gisReady()) { clearInterval(poll); setup(); }
    }, 100);
  }

  // Interactive: shows the Google popup (and, in testing mode, the unverified-app
  // warning the user clicks through). Used by the "Sign in" button.
  function signIn() {
    return new Promise(function (resolve, reject) {
      pending = { resolve: resolve, reject: reject };
      try { tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" }); }
      catch (e) { pending = null; reject(e); }
    });
  }

  // Returns a valid token, refreshing silently if the current one is stale.
  // A silent refresh works while the Google session is alive; if it can't, the
  // promise rejects and the caller surfaces a "please sign in again" state.
  function ensureToken() {
    if (accessToken && Date.now() < tokenExpiry) return Promise.resolve(accessToken);
    return new Promise(function (resolve, reject) {
      pending = { resolve: resolve, reject: reject };
      try { tokenClient.requestAccessToken({ prompt: "" }); }
      catch (e) { pending = null; reject(e); }
    });
  }

  // Forces the next ensureToken() to fetch a fresh token (used after a 401).
  function invalidate() { accessToken = null; tokenExpiry = 0; }

  function signOut() {
    if (accessToken && gisReady()) {
      try { google.accounts.oauth2.revoke(accessToken, function () {}); } catch (e) {}
    }
    accessToken = null; tokenExpiry = 0;
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
