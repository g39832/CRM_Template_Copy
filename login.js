document.addEventListener("DOMContentLoaded", () => {

  const loginForm = document.getElementById("loginForm");
  const passwordInput = document.getElementById("password");
  const showResetBtn = document.getElementById("showReset");
  const resetSection = document.getElementById("resetSection");
  const changePasswordBtn = document.getElementById("changePasswordBtn");

  if (!loginForm) {
    console.error("loginForm not found in HTML.");
    return;
  }

  // Hide reset section initially
  if (resetSection) {
    resetSection.style.display = "none";
  }

  async function readErrorMessage(response, fallback) {
    try {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        return data?.error || data?.message || fallback;
      }

      const text = await response.text();
      return text.trim() || fallback;
    } catch (err) {
      console.warn("Failed to read error response:", err);
      return fallback;
    }
  }

  // =========================
  // LOGIN
  // =========================
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const password = passwordInput.value.trim();

    if (!password) {
      alert("Please enter your password.");
      return;
    }

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, `Server error: ${response.status}`));
      }

      const data = await response.json();

      if (data.success) {
        window.location.href = "main.html";
      } else {
        alert(data.message || "Incorrect password.");
        passwordInput.value = "";
        passwordInput.focus();
      }

    } catch (error) {
      console.error("Login error:", error);
      alert("Login failed. Make sure the server is running.");
    }
  });

  // =========================
  // TOGGLE RESET SECTION
  // =========================
  if (showResetBtn && resetSection) {
    showResetBtn.addEventListener("click", () => {
      resetSection.style.display =
        resetSection.style.display === "none" ? "block" : "none";
    });
  }

  // =========================
  // CHANGE PASSWORD
  // =========================
  if (changePasswordBtn) {
    changePasswordBtn.addEventListener("click", async () => {

      const currentPassword = document.getElementById("currentPassword").value;
      const newPassword = document.getElementById("newPassword").value;

      if (!newPassword || newPassword.length < 4) {
        alert("New password must be at least 4 characters.");
        return;
      }

      try {
        const response = await fetch("/api/change-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            currentPassword,
            newPassword
          })
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, `Server error: ${response.status}`));
        }

        const data = await response.json();

        if (data.success) {
          alert("Password changed successfully!");
          resetSection.style.display = "none";
          document.getElementById("currentPassword").value = "";
          document.getElementById("newPassword").value = "";
        } else {
          alert(data.message || "Password change failed.");
        }

      } catch (error) {
        console.error("Change password error:", error);
        alert("Password change failed. Make sure the server is running.");
      }

    });
  }

});
