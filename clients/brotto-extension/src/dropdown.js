// dropdown.js — the Ink & Rule dropdown, shared by sidepanel.html and
// welcome.html. Settings is the canonical instance; the wizard's provider
// picker is the same component, not a second copy. The value host is always
// the element the caller already reads — a real <select> or a free-text
// <input> — so choosing an option writes `host.value` and fires that
// element's own event, and every existing listener keeps working.
//
// Selection is carried by a check glyph and by aria-selected, never by
// colour: the system is monochrome, so a tint is not a channel.

const DROPDOWNS = [];
// Set while choose() pushes a value into its host. The model host is an
// <input>, so writing it emits an `input` event, and the model list's own
// "user is typing, offer suggestions" handler would immediately reopen what
// was just closed.
let dropdownWriting = false;

function attachDropdown({ root, trigger, list, getOptions, getValue, setValue, editable }) {
  let active = -1;

  function paint() {
    const value = getValue();
    list.textContent = '';
    const options = getOptions();
    sync();
    options.forEach((opt, i) => {
      const selected = opt.value === value;
      const row = document.createElement('li');
      row.className = 'dd-option';
      row.id = `${list.id}-opt-${i}`;
      row.dataset.value = opt.value;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
      const check = document.createElement('span');
      check.className = 'dd-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = selected ? '✓' : '';
      const label = document.createElement('span');
      label.className = 'dd-option-label';
      label.textContent = opt.label;
      row.appendChild(check);
      row.appendChild(label);
      row.addEventListener('click', () => choose(i));
      list.appendChild(row);
    });
    active = -1;
  }

  // The box shows the host's current value. Nothing else writes that text, so
  // a value set straight on the host — hydrate, a save handler, a restored
  // config — has to be pushed into the label by hand. The editable instance
  // has no .dd-value child (the input IS the box) and is a no-op here.
  function sync() {
    const slot = trigger.querySelector('.dd-value');
    if (!slot) return;
    const row = getOptions().find((o) => o.value === getValue());
    slot.textContent = row ? row.label : (getValue() || '—');
  }

  function setActive(i) {
    const rows = list.children;
    if (active >= 0 && rows[active]) rows[active].classList.remove('active');
    active = i;
    if (!rows[active]) return;
    rows[active].classList.add('active');
    // The DOM focus stays on the trigger so Tab keeps working and Escape has
    // somewhere to go; aria-activedescendant is what a screen reader reads.
    trigger.setAttribute('aria-activedescendant', rows[active].id);
    if (rows[active].scrollIntoView) rows[active].scrollIntoView({ block: 'nearest' });
  }

  function move(delta) {
    const n = list.children.length;
    if (!n) return;
    const from = active < 0 ? (delta > 0 ? -1 : 0) : active;
    setActive((from + delta + n) % n);
  }

  function open() {
    for (const other of DROPDOWNS) if (other !== api) other.close();
    paint();
    list.hidden = false;
    root.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    const current = getOptions().findIndex((o) => o.value === getValue());
    if (current >= 0) setActive(current);
  }

  function close() {
    list.hidden = true;
    root.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function choose(i) {
    const row = list.children[i];
    if (!row) return;
    const value = row.dataset.value;
    close();
    dropdownWriting = true;
    try {
      setValue(value);
    } finally {
      dropdownWriting = false;
    }
    // The trigger's label was last painted by open() — from the value *before*
    // this choice. Nothing between here and the next open re-reads it, so the
    // box kept naming the provider the user had just replaced. One sync per
    // component covers every host, which is why it lives here and not in the
    // caller's change handler.
    sync();
  }

  trigger.addEventListener('click', () => (list.hidden ? open() : close()));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !list.hidden) {
      // Close without selecting. The value host is untouched, so a select
      // stays where it was and a typed model id survives.
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') { close(); return; }
    // Space only means "select" on a closed-over-a-value control. On the model
    // box it is a character, and swallowing it would make half of every model
    // id untypeable the moment the list is open.
    if (editable && e.key === ' ') return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { open(); return; }
      if (e.key === 'Enter' || e.key === ' ') { choose(active); return; }
      move(e.key === 'ArrowDown' ? 1 : -1);
    }
  });
  // Keep the pointer from moving focus off the trigger on press, which would
  // blur it and let a second dropdown open.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) close();
  });

  const api = { open, close, paint, sync, isOpen: () => !list.hidden };
  DROPDOWNS.push(api);
  return api;
}
