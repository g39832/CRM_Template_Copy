(function () {
  'use strict';

  var form = document.getElementById('companyProfileForm');
  var feedback = document.getElementById('formFeedback');
  var submitBtn = document.getElementById('saveBtn');

  if (!form) return;

  function showFeedback(message, type) {
    feedback.textContent = message;
    feedback.className = type;
  }

  function clearFeedback() {
    feedback.textContent = '';
    feedback.className = '';
  }

  function setFieldError(fieldId, message) {
    var group = document.getElementById('fg-' + fieldId);
    var errorEl = document.getElementById('err-' + fieldId);
    if (!group || !errorEl) return;
    group.classList.toggle('has-error', Boolean(message));
    errorEl.textContent = message || '';
  }

  function clearAllErrors() {
    document.querySelectorAll('.form-group.has-error').forEach(function (el) {
      el.classList.remove('has-error');
    });
    document.querySelectorAll('.field-error').forEach(function (el) {
      el.textContent = '';
    });
  }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.textContent = isLoading ? 'Saving\u2026' : 'Save & Continue';
  }

  function validateField(fieldId, value) {
    switch (fieldId) {
      case 'companyName':
        if (!value.trim()) return 'Company name is required.';
        if (value.trim().length > 200) return 'Company name is too long.';
        return null;
      case 'tagline':
        if (value && value.length > 300) return 'Tagline is too long.';
        return null;
      case 'description':
        if (value && value.length > 5000) return 'Description is too long.';
        return null;
      case 'contactEmail':
        if (!value.trim()) return 'Contact email is required.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
          return 'Enter a valid email address.';
        }
        return null;
      default:
        return null;
    }
  }

  form.querySelectorAll('input, textarea').forEach(function (el) {
    el.addEventListener('blur', function () {
      var msg = validateField(el.id, el.value);
      setFieldError(el.id, msg);
    });
    el.addEventListener('input', function () {
      setFieldError(el.id, null);
    });
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearFeedback();
    clearAllErrors();

    var fields = ['companyName', 'tagline', 'description', 'contactEmail'];
    var values = {};
    var hasError = false;

    fields.forEach(function (fieldId) {
      var el = document.getElementById(fieldId);
      var val = el ? el.value : '';
      values[fieldId] = val;
      var msg = validateField(fieldId, val);
      if (msg) {
        setFieldError(fieldId, msg);
        hasError = true;
      }
    });

    if (hasError) {
      showFeedback('Please fix the highlighted fields before continuing.', 'error');
      return;
    }

    setLoading(true);
    showFeedback('Saving your company profile\u2026', 'loading');

    try {
      var response = await fetch('/api/v2/onboarding/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: values.companyName.trim(),
          tagline: values.tagline.trim(),
          description: values.description.trim(),
          contactEmail: values.contactEmail.trim()
        })
      });

      var data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Server error: ' + response.status);
      }

      if (!data.success) {
        throw new Error(data.error || data.message || 'Unknown error');
      }

      showFeedback('Company profile saved!', 'success');

      setTimeout(function () {
        window.location.href = '/onboarding/step2';
      }, 800);

    } catch (err) {
      showFeedback(err.message || 'Failed to save. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  });

})();
