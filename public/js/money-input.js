// Shared money/quantity input behavior (main page + finance page).
//
// Typing is never reformatted: "1250.50" can be typed straight through,
// the caret never jumps and digits after the decimal are never dropped.
// While the field has focus it shows a plain editable number (no commas,
// no forced ".00"); when it loses focus it is shown formatted
// ("1,250.50"). Code reading these fields parses the text back to a number
// (commas are ignored), so calculations always use real numeric values.
(function () {
  function format(value, decimals) {
    var num = Number(value);
    if (!Number.isFinite(num)) num = 0;
    if (decimals === 'auto') {
      return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
    }
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parse(value) {
    if (value === null || value === undefined) return 0;
    var cleaned = String(value).replace(/[^0-9.-]/g, '');
    var num = Number(cleaned);
    return Number.isFinite(num) ? num : 0;
  }

  // "1,250.00" -> "1250", "1,250.50" -> "1250.50", "1.5" (qty) -> "1.5"
  function toEditable(text, decimals) {
    var raw = String(text || '').trim();
    if (!raw) return '';
    var num = parse(raw);
    if (!Number.isFinite(num)) return raw;
    if (decimals === 'auto') return String(Math.round(num * 10000) / 10000);
    var cents = Math.round(num * 100);
    return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  }

  // Keeps digits, one decimal point, commas (people type "1,250") and — if
  // allowed — a leading minus. Returns the cleaned text and how many
  // characters before the caret were removed, so the caret stays put.
  function sanitize(value, caret, allowNegative) {
    var out = '';
    var removedBeforeCaret = 0;
    var seenDot = false;
    for (var i = 0; i < value.length; i++) {
      var ch = value[i];
      var keep = false;
      if (ch >= '0' && ch <= '9') keep = true;
      else if (ch === ',') keep = true;
      else if (ch === '.' && !seenDot) { keep = true; seenDot = true; }
      else if (ch === '-' && allowNegative && out === '') keep = true;
      if (keep) out += ch;
      else if (i < caret) removedBeforeCaret++;
    }
    return { value: out, caret: caret - removedBeforeCaret };
  }

  function attach(input, options) {
    if (!input || input.dataset.moneyInput === '1') return;
    input.dataset.moneyInput = '1';
    options = options || {};
    var decimals = options.decimals === 'auto' ? 'auto' : 2;
    var allowNegative = Boolean(options.allowNegative);

    if (input.value && input.value.trim() && document.activeElement !== input) {
      input.value = format(parse(input.value), decimals);
    }

    // Focus from a mouse/touch press: the browser places the caret where
    // the user pressed (after the value below is made editable).
    var pointerFocus = false;
    input.addEventListener('pointerdown', function () {
      if (document.activeElement !== input) pointerFocus = true;
    });

    input.addEventListener('focus', function () {
      var byPointer = pointerFocus;
      pointerFocus = false;
      if (input.readOnly) return;
      var editable = toEditable(input.value, decimals);
      if (editable === input.value) return;
      // Tabbing in selects the whole value, and a scripted/autofill focus
      // leaves the caret at the start; in both cases select the new value
      // so typing replaces it instead of appending to it. (A mouse click
      // still puts the caret where it was clicked, after this runs.)
      var start = input.selectionStart;
      var end = input.selectionEnd;
      var selectAll = end === input.value.length || (start === 0 && end === 0);
      input.value = editable;
      if (selectAll && !byPointer) input.select();
    });

    input.addEventListener('input', function () {
      var caret = input.selectionStart == null ? input.value.length : input.selectionStart;
      var result = sanitize(input.value, caret, allowNegative);
      if (result.value === input.value) return;
      input.value = result.value;
      try { input.setSelectionRange(result.caret, result.caret); } catch (e) { /* not focusable */ }
    });

    input.addEventListener('blur', function () {
      var raw = input.value.trim();
      if (!raw || raw === '-' || raw === '.') {
        if (raw) input.value = '';
        return;
      }
      input.value = format(parse(raw), decimals);
    });
  }

  window.crmMoney = { format: format, parse: parse, attach: attach, toEditable: toEditable };
})();
