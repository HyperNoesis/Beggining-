/**
 * Picks the real auth backend based on js/config.js. This is the only file
 * that decides local-vs-cloud — every page just calls window.VS.auth.*
 * the same way regardless of which one is active.
 */
(function () {
  const cfg = window.VS && window.VS.config;
  const useSupabase = cfg && cfg.supabaseUrl && cfg.supabaseAnonKey;

  const provider = useSupabase
    ? new window.VS.SupabaseAuthProvider(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : new window.VS.LocalAuthProvider();

  async function requireAuth(redirectTo = 'auth.html') {
    const user = await provider.getCurrentUser();
    if (!user) {
      window.location.href = redirectTo;
      return null;
    }
    return user;
  }

  window.VS = window.VS || {};
  window.VS.auth = {
    signUp: (...a) => provider.signUp(...a),
    signIn: (...a) => provider.signIn(...a),
    signOut: (...a) => provider.signOut(...a),
    getCurrentUser: (...a) => provider.getCurrentUser(...a),
    updateProfile: (...a) => provider.updateProfile(...a),
    updatePassword: (...a) => provider.updatePassword(...a),
    resetPassword: (...a) => provider.resetPassword(...a),
    deleteAccount: (...a) => provider.deleteAccount(...a),
    requireAuth,
    mode: useSupabase ? 'supabase' : 'local'
  };
})();
