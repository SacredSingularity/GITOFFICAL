// -------------------------------------------------------------------
//  CLOUD SYNC — shared Supabase auth/save layer for every page in this
//  gallery (the menu and each game). One sign-in (wherever it happens)
//  creates one real session, visible to every page on this origin via
//  Supabase's own localStorage-backed session.
//
//  Auth is email + password. First-time users go through a one-time
//  email code to prove they own the address, then set a password —
//  after that, every sign-in (anywhere) is just email + password, no
//  more codes.
//
//  Per-game "sign out" is intentionally NOT a real sign-out: it just
//  flips a per-game opt-out flag (and wipes that game's local data),
//  so leaving Duck Clicker signed out does not touch Bookworm,
//  Pitwall, or the menu. The menu's sign-out is the only one that
//  ends the real session everywhere, via CloudSync.signOutEverywhere().
// -------------------------------------------------------------------
(function (global) {
  const SUPABASE_URL = 'https://jfdpliogytcysqwaeted.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmZHBsaW9neXRjeXNxd2FldGVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTAxODYsImV4cCI6MjEwMzM4NjE4Nn0.xGJdKDDsWK-92bvFSXDQnQXVWehkHd2mgAiB5Gv_HIE';

  // every game's localStorage save key — kept here (not just inside each
  // game's own page) so a real sign-out from the menu can wipe every game's
  // local data even though the menu never loads those games' scripts.
  // All pages share one origin, so localStorage is already shared; this
  // list just needs to be kept in sync with each game's own SAVE_KEY.
  const KNOWN_GAME_SAVE_KEYS = {
    duckclicker: 'duckClickerSave',
    bookworm: 'bookworm_state_v1',
    pitwall: 'pitwall_state_v1',
    driftline: 'driftlineSave',
    quickdraw: 'quickdrawSave',
  };

  // passkeys are still a Supabase beta feature (opt-in required); harmless
  // to request even before it's enabled on the project.
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { experimental: { passkey: true } },
  });
  let session = null;
  let ready = false;
  let recoveryMode = false;
  const listeners = [];

  function notify() { listeners.forEach(fn => fn(session)); }

  function optOutKey(gameId) { return 'cloudSyncOptOut_' + gameId; }
  function isOptedOut(gameId) {
    try { return localStorage.getItem(optOutKey(gameId)) === '1'; } catch (e) { return false; }
  }
  function setOptOut(gameId, val) {
    try { localStorage.setItem(optOutKey(gameId), val ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  // widget visibility is separate from sign-in state — hiding it never
  // signs anyone out or opts a game out, it's purely "get this off my screen"
  function widgetHiddenKey(gameId) { return 'cloudSyncWidgetHidden_' + gameId; }
  function isWidgetHidden(gameId) {
    try { return localStorage.getItem(widgetHiddenKey(gameId)) === '1'; } catch (e) { return false; }
  }
  function setWidgetHidden(gameId, val) {
    try { localStorage.setItem(widgetHiddenKey(gameId), val ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  // tracks "this game has local changes that haven't been confirmed saved
  // to the cloud yet" — set optimistically before every push attempt,
  // cleared only once that push actually succeeds. This is what lets a
  // blocked/offline network (e.g. a school firewall) be recovered from
  // safely: if the page reloads while still pending, sign-in must push
  // the (newer) local save up instead of blindly pulling and overwriting
  // it with the older cloud copy.
  function pendingKey(gameId) { return 'cloudSyncPending_' + gameId; }
  function isPending(gameId) {
    try { return localStorage.getItem(pendingKey(gameId)) === '1'; } catch (e) { return false; }
  }
  function setPending(gameId, val) {
    try { localStorage.setItem(pendingKey(gameId), val ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  sb.auth.getSession().then(({ data }) => { session = data.session; ready = true; notify(); });
  sb.auth.onAuthStateChange((event, s) => {
    session = s; ready = true;
    if (event === 'PASSWORD_RECOVERY') recoveryMode = true;
    notify();
  });

  // wipes every known game's local save + resets its opt-out flag, so a
  // real account sign-out (from the menu) leaves no account data behind
  // in any game, not just the page the sign-out happened on.
  function wipeAllGameLocalData() {
    Object.keys(KNOWN_GAME_SAVE_KEYS).forEach((gameId) => {
      try { localStorage.removeItem(KNOWN_GAME_SAVE_KEYS[gameId]); } catch (e) { /* ignore */ }
      setOptOut(gameId, false);
      setPending(gameId, false);
    });
  }
  function realSignOut() {
    wipeAllGameLocalData();
    return sb.auth.signOut();
  }

  // one shared stylesheet for the bits every widget's markup uses, so each
  // page only has to theme its own container/input/button colors
  const sharedStyle = document.createElement('style');
  sharedStyle.textContent = `
    .cloudSyncMsg { opacity: 0.8; font-size: 11px; }
    .cloudSyncLink { background: transparent; border: none !important; padding: 0 !important;
      font-size: 11px; font-weight: 400 !important; text-decoration: underline; cursor: pointer;
      color: inherit; opacity: 0.75; }
    .cloudSyncLink:hover { opacity: 1; }
    .cloudSyncRow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .cloudSyncStack { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
  `;
  document.head.appendChild(sharedStyle);

  // -------------------------------------------------------------------
  //  mountAuthWidget — builds and owns the entire sign-in UI for one box.
  //  boxId: id of an existing empty container element, already CSS-themed
  //  by the page (colors/fonts/border) via `#<boxId> input`, `#<boxId>
  //  button` selectors. gameId: null for the menu (real sign-in/out,
  //  no per-game opt-out or local-data wipe); a string for a game (its
  //  "sign out" only opts that game out + wipes its local data).
  //  hooks: { resetLocalState(), syncFromCloud() } — only meaningful
  //  (and only called) when gameId is set.
  // -------------------------------------------------------------------
  function mountAuthWidget(boxId, gameId, hooks) {
    hooks = hooks || {};
    const resetLocalState = hooks.resetLocalState || function () {};
    const syncFromCloud = hooks.syncFromCloud || function () {};
    const getLocalState = hooks.getLocalState || null;

    let mode = 'closed'; // 'closed' | 'signin' | 'signup' | 'code' | 'setpw'
    let pendingEmail = '';
    let errorMsg = '';

    function box() { return document.getElementById(boxId); }
    function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

    function resetTransient() { mode = 'closed'; pendingEmail = ''; errorMsg = ''; }

    function render() {
      const b = box();
      if (!b) return;

      if (isWidgetHidden(gameId || 'menu')) {
        b.innerHTML = `<button id="${boxId}_show" title="show account">&#9729;</button>`;
        document.getElementById(boxId + '_show').onclick = () => { setWidgetHidden(gameId || 'menu', false); render(); };
        return;
      }

      const signedInHere = gameId ? (!!session && !isOptedOut(gameId)) : !!session;
      const signedInElsewhereOnly = gameId && !!session && isOptedOut(gameId);

      // password recovery wins over everything, including "signed in" (the
      // recovery link itself creates a session) -- otherwise clicking a
      // reset-password email would just look like a normal sign-in and
      // never actually offer to set a new password.
      if (recoveryMode) {
        b.innerHTML = `<div class="cloudSyncStack">
          <span class="cloudSyncMsg">set a new password</span>
          <div class="cloudSyncRow">
            <input id="${boxId}_rpw1" type="password" placeholder="new password" style="width:110px">
            <input id="${boxId}_rpw2" type="password" placeholder="confirm" style="width:100px">
            <button id="${boxId}_rpwsave">Save</button>
          </div>
          ${errorMsg ? `<span class="cloudSyncMsg">${errorMsg}</span>` : ''}
        </div>`;
        document.getElementById(boxId + '_rpwsave').onclick = async () => {
          const p1 = val(boxId + '_rpw1'), p2 = val(boxId + '_rpw2');
          if (p1.length < 6) { errorMsg = 'Password must be at least 6 characters.'; render(); return; }
          if (p1 !== p2) { errorMsg = "Passwords don't match."; render(); return; }
          errorMsg = 'Saving…'; render();
          const { error } = await global.CloudSync.completePasswordRecovery(p1);
          if (error) { errorMsg = error.message; render(); return; }
          errorMsg = '';
          render();
        };
        return;
      }

      // 'setpw' must win even though verifyOtp() already created a real session —
      // otherwise a freshly-verified sign-up jumps straight to "signed in" and the
      // account is left with no password ever set.
      if (mode === 'setpw') {
        b.innerHTML = `<div class="cloudSyncStack">
          <span class="cloudSyncMsg">email verified &mdash; set a password</span>
          <div class="cloudSyncRow">
            <input id="${boxId}_pw1" type="password" placeholder="password" style="width:110px">
            <input id="${boxId}_pw2" type="password" placeholder="confirm" style="width:100px">
            <button id="${boxId}_setpw">Save</button>
          </div>
          ${errorMsg ? `<span class="cloudSyncMsg">${errorMsg}</span>` : ''}
        </div>`;
        document.getElementById(boxId + '_setpw').onclick = async () => {
          const p1 = val(boxId + '_pw1'), p2 = val(boxId + '_pw2');
          if (p1.length < 6) { errorMsg = 'Password must be at least 6 characters.'; render(); return; }
          if (p1 !== p2) { errorMsg = "Passwords don't match."; render(); return; }
          errorMsg = 'Saving…'; render();
          const { error } = await sb.auth.updateUser({ password: p1 });
          if (error) { errorMsg = error.message; render(); return; }
          resetTransient();
          render();
          if (gameId && !isOptedOut(gameId)) syncFromCloud();
        };
      } else if (signedInHere) {
        b.innerHTML = `<button id="${boxId}_signout">Sign out</button>`;
        document.getElementById(boxId + '_signout').onclick = () => {
          if (gameId) {
            setOptOut(gameId, true);
            resetLocalState();
          } else {
            realSignOut();
          }
          render();
        };
      } else if (signedInElsewhereOnly) {
        b.innerHTML = `<button id="${boxId}_reactivate">Sign in</button>`;
        document.getElementById(boxId + '_reactivate').onclick = async () => {
          setOptOut(gameId, false);
          render();
          await syncFromCloud();
        };
      } else if (mode === 'closed') {
        b.innerHTML = `<button id="${boxId}_open">Sign in</button>`;
        document.getElementById(boxId + '_open').onclick = () => { mode = 'signin'; render(); };
      } else if (mode === 'code') {
        b.innerHTML = `<div class="cloudSyncStack">
          <span class="cloudSyncMsg">code sent to ${pendingEmail}</span>
          <div class="cloudSyncRow">
            <input id="${boxId}_code" type="text" inputmode="numeric" placeholder="6-digit code" style="width:90px">
            <button id="${boxId}_verify">Verify</button>
            <button id="${boxId}_back" class="cloudSyncLink">&times;</button>
          </div>
          ${errorMsg ? `<span class="cloudSyncMsg">${errorMsg}</span>` : ''}
        </div>`;
        document.getElementById(boxId + '_verify').onclick = async () => {
          const token = val(boxId + '_code');
          if (!token) return;
          errorMsg = 'Verifying…'; render();
          const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
          if (error) { errorMsg = error.message; render(); return; }
          mode = 'setpw';
          render();
        };
        document.getElementById(boxId + '_back').onclick = () => { resetTransient(); render(); };
      } else if (mode === 'signup') {
        b.innerHTML = `<div class="cloudSyncStack">
          <div class="cloudSyncRow">
            <input id="${boxId}_email" type="email" placeholder="email" value="${pendingEmail}" style="width:140px">
            <button id="${boxId}_dosignup">Sign up</button>
          </div>
          <div class="cloudSyncRow">
            <button id="${boxId}_toSignin" class="cloudSyncLink">have an account? sign in</button>
            <button id="${boxId}_close" class="cloudSyncLink">&times;</button>
          </div>
          ${errorMsg ? `<span class="cloudSyncMsg">${errorMsg}</span>` : ''}
        </div>`;
        document.getElementById(boxId + '_dosignup').onclick = async () => {
          const email = val(boxId + '_email');
          if (!email) return;
          errorMsg = 'Sending code…'; render();
          const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
          if (error) { errorMsg = error.message; render(); return; }
          pendingEmail = email;
          mode = 'code';
          render();
        };
        document.getElementById(boxId + '_toSignin').onclick = () => { pendingEmail = ''; errorMsg = ''; mode = 'signin'; render(); };
        document.getElementById(boxId + '_close').onclick = () => { resetTransient(); render(); };
      } else if (mode === 'forgotpw') {
        b.innerHTML = `<div class="cloudSyncStack">
          <div class="cloudSyncRow">
            <input id="${boxId}_email" type="email" placeholder="email" value="${pendingEmail}" style="width:140px">
            <button id="${boxId}_sendreset">Send reset link</button>
          </div>
          <div class="cloudSyncRow">
            <button id="${boxId}_close" class="cloudSyncLink">&times;</button>
          </div>
          ${errorMsg ? `<span class="cloudSyncMsg">${errorMsg}</span>` : ''}
        </div>`;
        document.getElementById(boxId + '_sendreset').onclick = async () => {
          const email = val(boxId + '_email');
          if (!email) return;
          errorMsg = 'Sending…'; render();
          const { error } = await global.CloudSync.requestPasswordReset(email);
          errorMsg = error ? error.message : 'Check your email for a reset link.';
          render();
        };
        document.getElementById(boxId + '_close').onclick = () => { resetTransient(); render(); };
      } else {
        // mode === 'signin'
        const passkeyBtn = global.CloudSync.passkeysSupported()
          ? `<button id="${boxId}_passkey" class="cloudSyncLink">use a passkey instead</button>`
          : '';
        b.innerHTML = `<div class="cloudSyncStack">
          <div class="cloudSyncRow">
            <input id="${boxId}_email" type="email" placeholder="email" value="${pendingEmail}" style="width:120px">
            <input id="${boxId}_pw" type="password" placeholder="password" style="width:100px">
            <button id="${boxId}_dosignin">Sign in</button>
          </div>
          <div class="cloudSyncRow">
            <button id="${boxId}_toSignup" class="cloudSyncLink">new here? sign up</button>
            <button id="${boxId}_forgot" class="cloudSyncLink">forgot password?</button>
            ${passkeyBtn}
            <button id="${boxId}_close" class="cloudSyncLink">&times;</button>
          </div>
          ${errorMsg ? `<span class="cloudSyncMsg">${errorMsg}</span>` : ''}
        </div>`;
        document.getElementById(boxId + '_dosignin').onclick = async () => {
          const email = val(boxId + '_email');
          const password = val(boxId + '_pw');
          if (!email || !password) return;
          errorMsg = 'Signing in…'; render();
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) { errorMsg = error.message; render(); return; }
          resetTransient();
        };
        document.getElementById(boxId + '_toSignup').onclick = () => { pendingEmail = val(boxId + '_email'); mode = 'signup'; errorMsg = ''; render(); };
        document.getElementById(boxId + '_forgot').onclick = () => { pendingEmail = val(boxId + '_email'); mode = 'forgotpw'; errorMsg = ''; render(); };
        document.getElementById(boxId + '_close').onclick = () => { resetTransient(); render(); };
        const passkeyEl = document.getElementById(boxId + '_passkey');
        if (passkeyEl) passkeyEl.onclick = async () => {
          errorMsg = 'Waiting for passkey…'; render();
          const { error } = await global.CloudSync.signInWithPasskey();
          if (error) { errorMsg = error.message; render(); return; }
          resetTransient();
        };
      }

      if (!isWidgetHidden(gameId || 'menu')) {
        b.insertAdjacentHTML('beforeend', `<button id="${boxId}_hide" class="cloudSyncLink" title="hide" style="margin-left:2px;">&times;</button>`);
        document.getElementById(boxId + '_hide').onclick = () => { setWidgetHidden(gameId || 'menu', true); render(); };
      }
    }

    let hadSession = false;
    listeners.push((s) => {
      // 'code'/'setpw' are a deliberate multi-step flow this widget is already
      // mid-way through; verifyOtp()/updateUser() fire this same auth-change
      // event at unpredictable times relative to their own await continuing,
      // so rather than race it, just don't touch anything while those steps
      // own the screen — the button handlers driving them call render()
      // themselves once each step actually finishes.
      if (mode === 'code' || mode === 'setpw') { hadSession = !!s; return; }
      const justSignedIn = !hadSession && !!s;
      hadSession = !!s;
      resetTransient();
      render();
      if (justSignedIn && gameId && !isOptedOut(gameId)) {
        // if local progress changed while a push couldn't reach the cloud
        // (e.g. a blocked school network), pulling now would silently
        // throw that progress away — push it up instead, once, then let
        // normal saves take over from here.
        const localData = isPending(gameId) && getLocalState ? getLocalState() : null;
        if (localData) global.CloudSync.pushSave(gameId, localData);
        else syncFromCloud();
      }
    });
    if (ready) render();
  }

  global.CloudSync = {
    subscribe(fn) { listeners.push(fn); if (ready) fn(session); },
    getSession() { return session; },
    signOutEverywhere() { return realSignOut(); },

    isOptedOut,
    setOptOut,
    isWidgetHidden,
    setWidgetHidden,

    // --- account recovery / settings ---
    isRecoveryMode() { return recoveryMode; },
    requestPasswordReset(email) {
      return sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
    },
    async completePasswordRecovery(newPassword) {
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (!error) recoveryMode = false;
      return { error };
    },
    async changePassword(currentPassword, newPassword) {
      if (!session) return { error: { message: 'Not signed in' } };
      // re-verify identity with the current password before allowing the change
      const { error: reauthError } = await sb.auth.signInWithPassword({
        email: session.user.email, password: currentPassword,
      });
      if (reauthError) return { error: reauthError };
      return sb.auth.updateUser({ password: newPassword });
    },

    // --- passkeys (Supabase Auth beta) ---
    passkeysSupported() {
      return !!(window.PublicKeyCredential) && typeof sb.auth.registerPasskey === 'function';
    },
    registerPasskey() { return sb.auth.registerPasskey(); },
    signInWithPasskey() { return sb.auth.signInWithPasskey(); },
    async listPasskeys() {
      if (!sb.auth.passkey) return [];
      const { data, error } = await sb.auth.passkey.list();
      if (error) { console.warn('list passkeys failed:', error.message); return []; }
      return data || [];
    },
    deletePasskey(id) { return sb.auth.passkey.delete(id); },
    isGameActive(gameId) { return !!session && !isOptedOut(gameId); },

    mountAuthWidget,

    async pushSave(gameId, data) {
      // set BEFORE the isGameActive check (and before attempting the
      // network call): a save made while fully signed out — not just
      // signed in with the network blocked — still needs to be flagged,
      // since it's the same "local is ahead of cloud" situation once the
      // user signs back in. Harmless to set this even when nobody's
      // signed in at all; it's only ever read right after a sign-in event.
      setPending(gameId, true);
      if (!this.isGameActive(gameId)) return;
      try {
        const { error } = await sb.from('game_saves').upsert({
          user_id: session.user.id,
          game_id: gameId,
          data,
          updated_at: new Date().toISOString(),
        });
        if (error) { console.warn('cloud save failed:', error.message); return; }
        setPending(gameId, false);
      } catch (e) {
        console.warn('cloud save failed:', e.message);
      }
    },
    async pullSave(gameId) {
      if (!session) return null;
      const { data } = await sb.from('game_saves')
        .select('data').eq('user_id', session.user.id).eq('game_id', gameId).maybeSingle();
      return data ? data.data : null;
    },

    // -------------------------------------------------------------------
    //  FILE STORAGE — private per-account uploads (photos/videos/etc) via
    //  the 'user-files' Storage bucket. Every path is prefixed with the
    //  user's own id, matching the RLS policies set up on that bucket, so
    //  one account can never see or touch another's files.
    // -------------------------------------------------------------------
    async uploadFile(file, filename) {
      if (!session) throw new Error('Not signed in');
      const safeName = (filename || file.name).replace(/[^\w.\- ]/g, '_');
      const path = session.user.id + '/' + Date.now() + '_' + safeName;
      const { error } = await sb.storage.from('user-files').upload(path, file);
      if (error) throw error;
      return path;
    },
    async listFiles() {
      if (!session) return [];
      const { data, error } = await sb.storage.from('user-files')
        .list(session.user.id, { sortBy: { column: 'created_at', order: 'desc' } });
      if (error) { console.warn('list files failed:', error.message); return []; }
      return (data || []).map(f => ({
        path: session.user.id + '/' + f.name,
        name: f.name.replace(/^\d+_/, ''), // strip the timestamp prefix for display
        size: f.metadata ? f.metadata.size : 0,
        createdAt: f.created_at,
      }));
    },
    async getFileUrl(path, expiresInSeconds) {
      const { data, error } = await sb.storage.from('user-files')
        .createSignedUrl(path, expiresInSeconds || 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    async deleteFile(path) {
      const { error } = await sb.storage.from('user-files').remove([path]);
      if (error) throw error;
    },
  };

  // -------------------------------------------------------------------
  //  UPDATE CHECK — a page that's been open a while doesn't know the
  //  server's copy of itself has changed since it loaded (deploys don't
  //  push to open tabs). Rather than requiring a manual refresh-and-hope,
  //  poll this exact URL for its ETag and surface a small "reload" banner
  //  the moment it differs, instead of silently forcing a reload mid-use.
  // -------------------------------------------------------------------
  let knownEtag = null;
  async function checkForPageUpdate() {
    try {
      const res = await fetch(window.location.pathname + window.location.search, { cache: 'no-store', method: 'HEAD' });
      const etag = res.headers.get('etag') || res.headers.get('last-modified');
      if (!etag) return;
      if (knownEtag === null) { knownEtag = etag; return; }
      if (etag !== knownEtag) showUpdateBanner();
    } catch (e) { /* offline, or request blocked — just skip this check */ }
  }
  function showUpdateBanner() {
    if (document.getElementById('cloudSyncUpdateBanner')) return;
    const bar = document.createElement('div');
    bar.id = 'cloudSyncUpdateBanner';
    bar.innerHTML = `
      <style>
        #cloudSyncUpdateBanner { position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999;
          background: #1c1c26; color: #f2f2ff; font-family: system-ui, sans-serif; font-size: 13px;
          padding: 10px 16px; display: flex; align-items: center; justify-content: center; gap: 12px;
          box-shadow: 0 -2px 10px rgba(0,0,0,0.3); }
        #cloudSyncUpdateBanner button { background: #ffb347; color: #2c1a0e; border: none;
          border-radius: 6px; padding: 6px 14px; font-weight: 700; cursor: pointer; font-size: 13px; }
      </style>
      <span>This page has been updated.</span>
      <button id="cloudSyncUpdateReload">Reload</button>
    `;
    document.body.appendChild(bar);
    document.getElementById('cloudSyncUpdateReload').onclick = () => window.location.reload();
  }
  setInterval(checkForPageUpdate, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForPageUpdate(); });
})(window);
