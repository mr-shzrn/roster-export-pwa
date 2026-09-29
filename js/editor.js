/**
 * Read-only review table shown between parsing and export, so Shaz can
 * confirm the parse looks right before generating the styled export. Purely
 * a display of the parsed data object — never mutates it, and has no inputs
 * of any kind; deliberately not wired to layout.js's markup at all, so
 * review ergonomics and the printable layout can differ.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  function field(value) {
    return el('span', { class: 'field-value' }, [value || '—']);
  }

  function legRow(leg) {
    const depDisplay = [leg.dep_stn, leg.dep_time].filter(Boolean).join(' ');
    const arrDisplay = [leg.arr_stn, leg.arr_time].filter(Boolean).join(' ');

    return el('tr', {}, [
      el('td', {}, [field(leg.item)]),
      el('td', {}, [field(depDisplay)]),
      el('td', {}, [field(arrDisplay)]),
      el('td', {}, [field(leg.work_type)]),
      el('td', {}, [field(leg.duty_code)]),
      el('td', {}, [field(leg.ac_type)]),
      el('td', {}, [field(leg.hotel)]),
    ]);
  }

  function dayHeadingContent(day) {
    return [
      el('strong', {}, [`${day.date} (${day.day})`]),
      ' — ',
      el('span', { class: 'day-item' }, [day.item || '']),
      day.duty_start ? ` duty ${day.duty_start}–${day.duty_end || ''}` : '',
      day.duty_hours ? ` (${day.duty_hours})` : '',
    ];
  }

  function dayBlock(day) {
    if (!day.legs.length) {
      // Nothing to expand (day off, etc.) — a plain, non-collapsible row.
      return el('div', { class: 'day-block' }, [
        el('div', { class: 'day-heading' }, dayHeadingContent(day)),
      ]);
    }

    const table = el('table', { class: 'leg-table' }, [
      el('thead', {}, [el('tr', {}, [
        'Item', 'Dep', 'Arr', 'Type', 'Code', 'A/C', 'Hotel',
      ].map((h) => el('th', {}, [h])))]),
      el('tbody', {}, day.legs.map((leg) => legRow(leg))),
    ]);

    // <details>/<summary> — collapsed by default, natively keyboard-accessible
    // (Tab to focus, Enter/Space to toggle), no custom JS needed.
    return el('details', { class: 'day-block' }, [
      el('summary', { class: 'day-heading' }, dayHeadingContent(day)),
      table,
    ]);
  }

  function buildSummary(data) {
    const dayCount = data.duty_days.length;
    const crew = data.crew_info || {};
    const who = [crew.rank, crew.name].filter(Boolean).join(' ') || 'Crew roster';
    return el('div', { class: 'review-summary' }, [
      el('div', { class: 'review-summary-name' }, [who]),
      el('div', { class: 'review-summary-meta' }, [
        `${data.month_year || ''} · ${dayCount} duty day${dayCount === 1 ? '' : 's'}`,
      ]),
    ]);
  }

  /** container: a DOM element. data: parse_styled_roster() output — read-only, never modified. */
  function renderEditor(container, data) {
    container.innerHTML = '';

    container.appendChild(buildSummary(data));

    if (data.warnings && data.warnings.length) {
      container.appendChild(el('div', { class: 'warnings' }, [
        el('strong', {}, ['Warnings — please check: ']),
        el('ul', {}, data.warnings.map((w) => el('li', {}, [w]))),
      ]));
    }

    const days = el('div', { class: 'day-list' }, data.duty_days.map(dayBlock));
    container.appendChild(days);
  }

  ns.editor = { renderEditor };
})(window.RosterPWA);
