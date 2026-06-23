(function () {
  'use strict';

  var form = document.getElementById('workflowForm');
  var feedback = document.getElementById('formFeedback');
  var submitBtn = document.getElementById('saveBtn');
  var optionCards = document.querySelectorAll('.workflow-card');
  var selectedInput = document.getElementById('selectedWorkflow');

  if (!form) return;

  function showFeedback(message, type) {
    feedback.textContent = message;
    feedback.className = type || '';
  }

  function clearFeedback() {
    feedback.textContent = '';
    feedback.className = '';
  }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.textContent = isLoading ? 'Saving\u2026' : 'Next Step';
  }

  // Card selection
  optionCards.forEach(function (card) {
    card.addEventListener('click', function () {
      optionCards.forEach(function (c) { c.classList.remove('selected'); });
      card.classList.add('selected');
      selectedInput.value = card.getAttribute('data-value');
      clearFeedback();
    });
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearFeedback();

    var workflow = selectedInput.value;
    if (!workflow) {
      showFeedback('Please select a business workflow model.', 'error');
      return;
    }

    setLoading(true);
    showFeedback('Saving your selection\u2026', 'loading');

    try {
      var response = await fetch('/api/v2/onboarding/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: workflow })
      });

      var data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Server error: ' + response.status);
      }

      if (!data.success) {
        throw new Error(data.error || data.message || 'Unknown error');
      }

      showFeedback('Workflow saved!', 'success');

      setTimeout(function () {
        window.location.href = '/onboarding/step3';
      }, 800);

    } catch (err) {
      showFeedback(err.message || 'Failed to save. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  });

})();
