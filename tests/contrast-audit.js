// Contrast audit helpers (used by tests/redesign.spec.js).
//
// Walks every visible element that renders text — including the value /
// placeholder of inputs, selects and textareas — and computes the WCAG
// contrast ratio between its text color and the actual background behind it
// (compositing semi-transparent backgrounds up the ancestor chain). Returns
// the elements below `minRatio`.

async function findLowContrast(page, { minRatio = 3, scope = 'body' } = {}) {
  return page.evaluate(({ minRatio, scope }) => {
    function parse(color) {
      const m = String(color).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    function over(top, bottom) {
      const a = top.a + bottom.a * (1 - top.a);
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
        a
      };
    }
    function luminance(c) {
      const ch = [c.r, c.g, c.b].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }
    function backgroundOf(el) {
      const layers = [];
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg.a > 0) {
          layers.push(bg);
          if (bg.a >= 1) break;
        }
      }
      let result = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      if (result.a < 1) result = over(result, { r: 255, g: 255, b: 255, a: 1 });
      for (let i = layers.length - 1; i >= 0; i--) result = over(layers[i], result);
      return result;
    }
    function visible(el) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      for (let n = el; n; n = n.parentElement) {
        const ps = getComputedStyle(n);
        if (Number(ps.opacity) === 0 || ps.display === 'none') return false;
      }
      return true;
    }
    function describe(el) {
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
        (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
    }

    const root = document.querySelector(scope) || document.body;
    const problems = [];
    const fields = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
    for (const el of root.querySelectorAll('*')) {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'OPTION', 'DATALIST', 'BR', 'IMG'].includes(el.tagName.toUpperCase())) continue;
      const isField = fields.has(el.tagName);
      if (isField && (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'file')) continue;
      let text = '';
      if (isField) {
        text = el.tagName === 'SELECT' ? (el.options[el.selectedIndex] || {}).text || '' : (el.value || el.placeholder || '');
      } else {
        text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      }
      if (!text || !visible(el)) continue;
      const style = getComputedStyle(el);
      let fg = parse(style.webkitTextFillColor && style.webkitTextFillColor !== style.color ? style.webkitTextFillColor : style.color);
      if (isField && !el.value && el.placeholder) {
        const ph = parse(getComputedStyle(el, '::placeholder').color);
        if (ph) fg = ph;
      }
      if (!fg) continue;
      const bg = backgroundOf(el);
      const blended = fg.a < 1 ? over(fg, bg) : fg;
      const l1 = luminance(blended);
      const l2 = luminance(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < minRatio) {
        problems.push(`${describe(el)} "${text.slice(0, 40)}" ratio ${ratio.toFixed(2)} (fg ${style.color} on bg rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}))`);
      }
    }
    return [...new Set(problems)];
  }, { minRatio, scope });
}

module.exports = { findLowContrast };
