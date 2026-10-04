document.addEventListener("DOMContentLoaded", () => {
  const googleBtn = document.getElementById("google-signin-btn");
  const feedback = document.getElementById("loginFeedback");

  function showFeedback(message, type) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = "feedback show " + (type || "");
  }

  const params = new URLSearchParams(window.location.search);
  const authError = params.get("error");
  if (authError) {
    // Surface the real reason instead of a generic message — the callback
    // page passes back exactly why it failed (e.g. "no_session" means
    // Google/Supabase never handed back a session; anything else is the
    // actual error from finishing sign-in server-side).
    const friendly = authError === "no_session"
      ? "Google didn't return a session — please try signing in again."
      : authError;
    showFeedback("Sign-in failed: " + friendly, "error");
    // Drop the error from the URL so a refresh/retry doesn't keep showing it.
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const config = window.__AUTH_CONFIG__ || {};
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    showFeedback(
      "Google sign-in isn't configured yet. Set SUPABASE_URL and SUPABASE_ANON_KEY, and enable the Google provider in Supabase Auth settings.",
      "error"
    );
    if (googleBtn) googleBtn.disabled = true;
    return;
  }

  if (!window.supabase || !window.supabase.createClient) {
    showFeedback("Could not load the sign-in library. Check your connection and reload.", "error");
    if (googleBtn) googleBtn.disabled = true;
    return;
  }

  const authClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      googleBtn.disabled = true;
      showFeedback("", "");
      try {
        const { error } = await authClient.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin + "/auth/callback" }
        });
        if (error) throw error;
        // Browser is being redirected to Google now.
      } catch (err) {
        console.error("Google sign-in error:", err);
        showFeedback(err.message || "Could not start Google sign-in.", "error");
        googleBtn.disabled = false;
      }
    });
  }
});
