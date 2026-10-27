/**
 * Loads the Supabase SDK ONLY when real accounts are configured (js/config.js).
 * Local-account mode (the default) never touches the network for this: before this loader existed,
 * every page blocked on a third-party download (unpkg) that a local-only app does not use at all.
 * Must run right after config.js, before js/auth.js.
 */
(function () {
  var c = window.VS && window.VS.config;
  if (c && c.supabaseUrl && c.supabaseAnonKey) {
    document.write('<script src="https://unpkg.com/@supabase/supabase-js@2.57.4"><\/script>');
  }
})();
