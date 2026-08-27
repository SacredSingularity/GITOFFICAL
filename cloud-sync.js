// -------------------------------------------------------------------
//  CLOUD SYNC — shared Supabase auth/save layer for every page in this
//  gallery (the menu and each game). One sign-in (wherever it happens)
//  creates one real session, visible to every page on this origin via
//  Supabase's own localStorage-backed session.
//
//  Per-game "sign out" is intentionally NOT a real sign-out: it just
//  flips a per-game opt-out flag, so leaving Duck Clicker signed out
//  does not touch Bookworm, Pitwall, or the menu. The menu's sign-out
//  (see index.html) is the only one that ends the real session
//  everywhere, via CloudSync.signOutEverywhere().
// -------------------------------------------------------------------
(function (global) {
  const SUPABASE_URL = 'https://jfdpliogytcysqwaeted.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmZHBsaW9neXRjeXNxd2FldGVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTAxODYsImV4cCI6MjEwMzM4NjE4Nn0.xGJdKDDsWK-92bvFSXDQnQXVWehkHd2mgAiB5Gv_HIE';

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let session = null;
  let ready = false;
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

  sb.auth.getSession().then(({ data }) => { session = data.session; ready = true; notify(); });
  sb.auth.onAuthStateChange((_event, s) => { session = s; ready = true; notify(); });

  global.CloudSync = {
    // fn is called immediately with the current session (or null) once known, then again on every change
    subscribe(fn) { listeners.push(fn); if (ready) fn(session); },
    getSession() { return session; },
    requestCode(email) {
      return sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    },
    verifyCode(email, token) { return sb.auth.verifyOtp({ email, token, type: 'email' }); },
    signOutEverywhere() { return sb.auth.signOut(); },

    isOptedOut,
    setOptOut,
    isWidgetHidden,
    setWidgetHidden,
    // true if there's a real session AND this specific game hasn't been locally opted out
    isGameActive(gameId) { return !!session && !isOptedOut(gameId); },

    async pushSave(gameId, data) {
      if (!this.isGameActive(gameId)) return;
      const { error } = await sb.from('game_saves').upsert({
        user_id: session.user.id,
        game_id: gameId,
        data,
        updated_at: new Date().toISOString(),
      });
      if (error) console.warn('cloud save failed:', error.message);
    },
    async pullSave(gameId) {
      if (!session) return null;
      const { data } = await sb.from('game_saves')
        .select('data').eq('user_id', session.user.id).eq('game_id', gameId).maybeSingle();
      return data ? data.data : null;
    },
  };
})(window);
