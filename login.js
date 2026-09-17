document.addEventListener("DOMContentLoaded", () => {
  const googleBtn = document.getElementById("google-signin-btn");
  const feedback = document.getElementById("loginFeedback");

  function showFeedback(message, type) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = "feedback show " + (type || "");
  }

  // ===== TEMPORARY password fallback =====
  const passwordForm = document.getElementById("passwordLoginForm");
  const passwordInput = document.getElementById("fallback-password");
  const passwordFeedback = document.getElementById("passwordLoginFeedback");
  const passwordBtn = document.getElementById("password-login-btn");
  const showPasswordBtn = document.getElementById("showPasswordFallback");

  if (showPasswordBtn && passwordForm) {
    showPasswordBtn.addEventListener("click", () => {
      const isHidden = passwordForm.style.display === "none";
      passwordForm.style.display = isHidden ? "block" : "none";
      showPasswordBtn.style.display = isHidden ? "none" : "block";
      if (isHidden) passwordInput.focus();
    });
  }

  function showPasswordFeedback(message, type) {
    if (!passwordFeedback) return;
    passwordFeedback.textContent = message;
    passwordFeedback.className = "feedback show " + (type || "");
  }

  if (passwordForm) {
    passwordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      showPasswordFeedback("", "");
      const password = passwordInput.value;
      if (!password) return;

      passwordBtn.disabled = true;
      try {
        const res = await fetch("/api/v2/auth/password-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Incorrect password.");
        }
        window.location.href = "/main";
      } catch (err) {
        console.error("Password login error:", err);
        showPasswordFeedback(err.message || "Login failed.", "error");
        passwordInput.value = "";
        passwordInput.focus();
      } finally {
        passwordBtn.disabled = false;
      }
    });
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("error")) {
    showFeedback("Sign-in failed. Please try again.", "error");
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
