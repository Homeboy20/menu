/* Self-hosted SVG icon helper */
(function (global) {
  function icon(name, size = 20) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons/sprite.svg#icon-' + name + '"/></svg>';
  }

  function normalizeSvg(svgEl, iconName) {
    if (!svgEl) return;
    if (!svgEl.getAttribute('viewBox')) svgEl.setAttribute('viewBox', '0 0 24 24');
    if (!svgEl.getAttribute('fill')) svgEl.setAttribute('fill', 'none');
    if (!svgEl.getAttribute('stroke')) svgEl.setAttribute('stroke', 'currentColor');
    if (!svgEl.getAttribute('stroke-width')) svgEl.setAttribute('stroke-width', '2');
    if (!svgEl.getAttribute('width')) svgEl.setAttribute('width', '1em');
    if (!svgEl.getAttribute('height')) svgEl.setAttribute('height', '1em');
    svgEl.setAttribute('aria-hidden', 'true');

    var name = iconName || svgEl.getAttribute('data-icon') || '';
    if (!name) {
      var txt = (svgEl.textContent || '').trim();
      if (/^[a-zA-Z0-9_]+$/.test(txt)) name = txt;
    }
    if (!name) return;

    svgEl.setAttribute('data-icon', name);
    svgEl.innerHTML = '<use href="/icons/sprite.svg#icon-' + name + '"/>';
  }

  function spanToSvg(span) {
    if (!span) return;
    var name = (span.getAttribute('data-icon') || span.textContent || '').trim();
    if (!name || /</.test(name)) return;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    // Copy attributes to preserve sizing classes and hooks.
    for (var i = 0; i < span.attributes.length; i += 1) {
      var a = span.attributes[i];
      svg.setAttribute(a.name, a.value);
    }

    normalizeSvg(svg, name);
    span.replaceWith(svg);
  }

  function hydrate(root) {
    var scope = root || document;

    var spans = scope.querySelectorAll('span.material-symbols-outlined, span.material-icons');
    spans.forEach(spanToSvg);

    var svgs = scope.querySelectorAll('svg.material-symbols-outlined, svg.material-icons');
    svgs.forEach(function (el) { normalizeSvg(el); });
  }

  // Export helper API.
  global.icon = icon;
  global.hydrateIcons = hydrate;
  global.setIcon = function (el, name) { normalizeSvg(el, name); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { hydrate(document); });
  } else {
    hydrate(document);
  }

  // Keep dynamic UI icon swaps working when code sets textContent/innerHTML later.
  var observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      if (record.type === 'childList') {
        record.addedNodes.forEach(function (node) {
          if (!node || node.nodeType !== 1) return;
          if (node.matches && (node.matches('span.material-symbols-outlined') || node.matches('span.material-icons'))) {
            spanToSvg(node);
            return;
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('span.material-symbols-outlined, span.material-icons').forEach(spanToSvg);
            node.querySelectorAll('svg.material-symbols-outlined, svg.material-icons').forEach(function (el) { normalizeSvg(el); });
          }
        });
      }

      if (record.type === 'characterData') {
        var parent = record.target && record.target.parentElement;
        if (parent && parent.matches && (parent.matches('svg.material-symbols-outlined') || parent.matches('svg.material-icons'))) {
          normalizeSvg(parent);
        }
      }
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
})(window);
