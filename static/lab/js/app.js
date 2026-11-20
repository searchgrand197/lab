(function () {
  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function initPatientSearch() {
    const input = document.getElementById('patient-live-search');
    const results = document.getElementById('patient-search-results');
    if (!input || !results) return;

    const endpoint = input.dataset.endpoint;
    const mode = input.dataset.mode || 'navigate';

    const render = (items) => {
      if (!items.length) {
        results.innerHTML = '<div class="empty" style="padding:0.8rem">No patients found</div>';
        results.classList.add('open');
        return;
      }
      results.innerHTML = items
        .map(
            (p) =>
            `<button type="button" data-id="${p.id}" data-name="${escapeAttr(p.name)}" data-age="${p.age ?? ''}" data-gender="${p.gender}" data-mobile="${escapeAttr(p.mobile || '')}" data-dob="${p.dob || ''}" data-remarks="${escapeAttr(p.remarks || '')}">
              <strong>${escapeHtml(p.name)}</strong>
              <span class="meta">${escapeHtml(p.mobile || 'No mobile')} · ${p.age ?? '—'} yrs · ${p.gender === 'F' ? 'Female' : p.gender === 'M' ? 'Male' : 'Other'}</span>
            </button>`
        )
        .join('');
      results.classList.add('open');
    };

    const search = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 1) {
        results.classList.remove('open');
        results.innerHTML = '';
        return;
      }
      try {
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        render(data.results || []);
      } catch (e) {
        results.classList.remove('open');
      }
    }, 220);

    input.addEventListener('input', search);
    input.addEventListener('focus', () => {
      if (results.innerHTML) results.classList.add('open');
    });

    document.addEventListener('click', (e) => {
      if (!results.contains(e.target) && e.target !== input) {
        results.classList.remove('open');
      }
    });

    results.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      if (mode === 'prefill') {
        prefillPatient(btn.dataset);
        results.classList.remove('open');
        input.value = btn.dataset.name || '';
      } else {
        window.location.href = `/book/?patient=${btn.dataset.id}`;
      }
    });
  }

  function prefillPatient(data) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value || '';
    };
    set('id_patient_id', data.id);
    set('id_name', data.name);
    set('id_age', data.age);
    set('id_mobile', data.mobile);
    set('id_dob', data.dob);
    set('id_remarks', data.remarks);
    const gender = data.gender || 'M';
    document.querySelectorAll('input[name="gender"]').forEach((radio) => {
      radio.checked = radio.value === gender;
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
  }

  document.addEventListener('DOMContentLoaded', initPatientSearch);
})();
