import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LabAPI } from '../api'

/** Format a numeric string in Indian style: 198000 → 1,98,000 */
function formatIndianNumber(raw) {
  if (raw == null) return ''
  const str = String(raw).trim()
  if (!str) return ''
  const cleaned = str.replace(/,/g, '')
  const match = cleaned.match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) return str

  const sign = match[1]
  let intPart = match[2]
  const decPart = match[3]
  // Keep leading zeros only if the whole integer is zeros
  intPart = intPart.replace(/^0+(?=\d)/, '') || '0'

  let formatted
  if (intPart.length <= 3) {
    formatted = intPart
  } else {
    const last3 = intPart.slice(-3)
    let rest = intPart.slice(0, -3)
    const groups = []
    while (rest.length > 2) {
      groups.unshift(rest.slice(-2))
      rest = rest.slice(0, -2)
    }
    if (rest) groups.unshift(rest)
    formatted = `${groups.join(',')},${last3}`
  }
  return `${sign}${formatted}${decPart != null ? `.${decPart}` : ''}`
}

function valuesFromBooking(detail) {
  const next = {}
  ;(detail?.tests || []).forEach((entry) => {
    ;(entry.results || []).forEach((r) => {
      next[r.id] = formatIndianNumber(r.value || '')
    })
  })
  return next
}

function parseNumber(raw) {
  if (raw == null || raw === '') return null
  const cleaned = String(raw).replace(/,/g, '').trim()
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

const WIDAL_ROWS = [
  'SALMONELLA TYPHI O',
  'SALMONELLA TYPHI H',
  'SALMONELLA PARATYPHI (AH)',
  'SALMONELLA PARATYPHI (BH)',
]
const WIDAL_COLS = ['1/20', '1/40', '1/80', '1/160', '1/320']
const WIDAL_RESULT = 'RESULT'

function isWidalTest(test) {
  if (!test) return false
  if (test.layout === 'widal_matrix') return true
  const name = String(test.name || '').trim().toLowerCase()
  return name === 'widal test' || name === 'widal'
}

function widalCellName(row, col) {
  return `${row} @ ${col}`
}

function cycleAgglutination(current) {
  const v = String(current || '').trim()
  if (v === '+') return '-'
  if (v === '-') return ''
  return '+'
}

function normalizeParamName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** True for any Hb entry field — Female, Male, or generic (not MCH / MCHC / A1c). */
function isHaemoglobinParam(name) {
  const n = normalizeParamName(name)
  if (/mchc|mch\b|a1c|glycosylated|mean cell|corpuscular/.test(n)) return false
  // Same trigger for "Haemoglobin (Female)", "Haemoglobin (Male)", "HAEMOGLOBIN (Hb)", etc.
  return (
    /\bhaemoglobin\b/.test(n)
    || /\bhemoglobin\b/.test(n)
    || /(^|\s)hb(\s|$)/.test(n)
  )
}

/** Map CBC parameter → derived key from Hb. */
function cbcDerivedKey(name) {
  const n = normalizeParamName(name)
  if (/\bmcv\b|mean cell volume/.test(n)) return 'mcv'
  if (/\bmchc\b|corpuscular hb conc|mean corpuscular hb/.test(n)) return 'mchc'
  if (/\bmch\b|mean cell haemoglobin|mean cell hemoglobin/.test(n)) return 'mch'
  if (/packed cell volume|\bpcv\b|hematocrit|haematocrit/.test(n)) return 'pcv'
  if (/red blood cells|\brbc count\b|\brbc\b/.test(n) && !/width|absolute|nucleated/.test(n)) return 'rbc'
  return null
}

/**
 * Rule-of-three CBC estimates from Hb (g/dL), matching common lab software:
 *   PCV = Hb × 3
 *   RBC = Hb ÷ 3
 *   MCV = (PCV ÷ RBC) × 10
 *   MCH = (Hb ÷ RBC) × 10
 *   MCHC = (Hb ÷ PCV) × 100
 * Example: Hb 14 → RBC 4.67, PCV 42.00, MCV 89.94, MCH 29.98, MCHC 33.33
 */
function calcCbcFromHb(hb) {
  if (hb == null || !Number.isFinite(hb) || hb <= 0) return null
  // Round PCV/RBC first (same as common lab software), then derive indices.
  const pcv = Number((hb * 3).toFixed(2))
  const rbc = Number((hb / 3).toFixed(2))
  if (rbc <= 0 || pcv <= 0) return null
  return {
    rbc: rbc.toFixed(2),
    pcv: pcv.toFixed(2),
    mcv: ((pcv / rbc) * 10).toFixed(2),
    mch: ((hb / rbc) * 10).toFixed(2),
    mchc: ((hb / pcv) * 100).toFixed(2),
  }
}

function dlcPercentKey(name) {
  const n = normalizeParamName(name)
  if (/absolute/.test(n)) return null
  if (/neutrophil/.test(n)) return 'neutrophils'
  if (/lymphocyte/.test(n)) return 'lymphocytes'
  if (/monocyte/.test(n)) return 'monocytes'
  if (/eosinophil/.test(n)) return 'eosinophils'
  if (/basophil/.test(n)) return 'basophils'
  return null
}

function dlcAbsoluteKey(name) {
  const n = normalizeParamName(name)
  if (!/absolute/.test(n)) return null
  if (/neutrophil/.test(n)) return 'neutrophils'
  if (/lymphocyte/.test(n)) return 'lymphocytes'
  if (/monocyte/.test(n)) return 'monocytes'
  if (/eosinophil/.test(n)) return 'eosinophils'
  if (/basophil/.test(n)) return 'basophils'
  return null
}

function isWbcParam(name) {
  const n = normalizeParamName(name)
  return /total leucocytes|wbc count|(^|\s)wbc(\s|$)|(^|\s)tlc(\s|$)/.test(n)
}

/** Lab-style 2-digit DLC percent: 50, 20, 18, 12, 00 */
function formatDlcPercent(n) {
  const v = Math.max(0, Math.round(Number(n) || 0))
  return String(v).padStart(2, '0')
}

/**
 * After Neutrophils + Lymphocytes are entered, fill the rest to total 100%:
 *   Basophils = 0
 *   of remainder: Monocytes 60%, Eosinophils 40%
 * Example: N=50, L=20 → M=18, E=12, B=00
 */
function calcDlcRemainder(neutrophils, lymphocytes) {
  if (neutrophils == null || lymphocytes == null) return null
  if (!Number.isFinite(neutrophils) || !Number.isFinite(lymphocytes)) return null
  const rem = Math.round(100 - neutrophils - lymphocytes)
  if (rem < 0) return null
  const monocytes = Math.round(rem * 0.6)
  const eosinophils = rem - monocytes
  return {
    monocytes: formatDlcPercent(monocytes),
    eosinophils: formatDlcPercent(eosinophils),
    basophils: formatDlcPercent(0),
  }
}

/**
 * CBC autofill:
 * - Hb (Female or Male): RBC / PCV / MCV / MCH / MCHC (+ mirror generic Hb)
 * - Neutrophils + Lymphocytes: Monocytes / Eosinophils / Basophils (sum 100)
 * - WBC + DLC %: Absolute counts
 */
function applyCbcAutofill(results, values, changedId, rawValue) {
  const list = results || []
  const changed = list.find((r) => r.id === changedId)
  let next = { ...values, [changedId]: rawValue }
  if (!changed) return next

  // --- Haemoglobin → red-cell indices (same for Female & Male) ---
  if (isHaemoglobinParam(changed.name)) {
    const changedNorm = normalizeParamName(changed.name)
    const isGenderSpecific = /\bfemale\b|\bmale\b/.test(changedNorm)
    list.forEach((r) => {
      if (r.id === changedId || !isHaemoglobinParam(r.name)) return
      const n = normalizeParamName(r.name)
      const otherIsGender = /\bfemale\b|\bmale\b/.test(n)
      if (isGenderSpecific && !otherIsGender) next[r.id] = rawValue
    })
    const derived = calcCbcFromHb(parseNumber(rawValue))
    if (derived) {
      list.forEach((r) => {
        const key = cbcDerivedKey(r.name)
        if (!key || !derived[key]) return
        next[r.id] = formatIndianNumber(derived[key])
      })
    }
  }

  // --- DLC: N + L filled → auto M / E / B ---
  const byDlc = {}
  list.forEach((r) => {
    const key = dlcPercentKey(r.name)
    if (key) byDlc[key] = r
  })
  const nVal = byDlc.neutrophils
    ? parseNumber(byDlc.neutrophils.id === changedId ? rawValue : next[byDlc.neutrophils.id])
    : null
  const lVal = byDlc.lymphocytes
    ? parseNumber(byDlc.lymphocytes.id === changedId ? rawValue : next[byDlc.lymphocytes.id])
    : null
  const dlcRest = calcDlcRemainder(nVal, lVal)
  if (dlcRest) {
    ;['monocytes', 'eosinophils', 'basophils'].forEach((key) => {
      const row = byDlc[key]
      if (!row) return
      next[row.id] = dlcRest[key]
    })
  }

  // --- Absolute counts from WBC × % ---
  const wbcRow = list.find((r) => isWbcParam(r.name))
  const wbc = wbcRow
    ? parseNumber(wbcRow.id === changedId ? rawValue : next[wbcRow.id])
    : null
  if (wbc != null && wbc > 0) {
    const pct = {
      neutrophils: nVal,
      lymphocytes: lVal,
      monocytes: byDlc.monocytes ? parseNumber(next[byDlc.monocytes.id]) : null,
      eosinophils: byDlc.eosinophils ? parseNumber(next[byDlc.eosinophils.id]) : null,
      basophils: byDlc.basophils ? parseNumber(next[byDlc.basophils.id]) : null,
    }
    list.forEach((r) => {
      const key = dlcAbsoluteKey(r.name)
      if (!key || pct[key] == null) return
      next[r.id] = formatIndianNumber(String(Math.round((wbc * pct[key]) / 100)))
    })
  }

  return next
}

/** Returns 'in' | 'high' | 'low' | null when range cannot be compared. */
function evaluateResultRange(value, referenceRange) {
  const num = parseNumber(value)
  if (num == null) return null
  const range = String(referenceRange || '').trim()
  if (!range) return null

  const between = range.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)/i)
  if (between) {
    const low = parseNumber(between[1])
    const high = parseNumber(between[2])
    if (low == null || high == null) return null
    const min = Math.min(low, high)
    const max = Math.max(low, high)
    if (num < min) return 'low'
    if (num > max) return 'high'
    return 'in'
  }

  const less = range.match(/[<≤]\s*(-?\d+(?:\.\d+)?)/)
  if (less) {
    const limit = parseNumber(less[1])
    if (limit == null) return null
    return num < limit ? 'in' : 'high'
  }

  const greaterEq = range.match(/≥\s*(-?\d+(?:\.\d+)?)/)
  if (greaterEq) {
    const limit = parseNumber(greaterEq[1])
    if (limit == null) return null
    return num >= limit ? 'in' : 'low'
  }

  const greater = range.match(/>\s*(-?\d+(?:\.\d+)?)/)
  if (greater) {
    const limit = parseNumber(greater[1])
    if (limit == null) return null
    return num > limit ? 'in' : 'low'
  }

  const upto = range.match(/(?:upto|up to)\s*(-?\d+(?:\.\d+)?)/i)
  if (upto) {
    const limit = parseNumber(upto[1])
    if (limit == null) return null
    return num <= limit ? 'in' : 'high'
  }

  return null
}

export default function ReportModal({ bookingId, onClose, onCommitted }) {
  const [catalog, setCatalog] = useState([])
  const [booking, setBooking] = useState(null)
  const [filter, setFilter] = useState('')
  const [values, setValues] = useState({})
  const [status, setStatus] = useState('booked')
  const [openPanels, setOpenPanels] = useState(() => new Set())
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saveHint, setSaveHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const dirtyRef = useRef(false)
  const closingRef = useRef(false)
  const panelRefs = useRef({})
  const bookingRef = useRef(null)
  const saveHintTimer = useRef(null)
  const messageTimer = useRef(null)
  bookingRef.current = booking

  function flashSaveHint(text = 'Saved') {
    setSaveHint(text)
    if (saveHintTimer.current) window.clearTimeout(saveHintTimer.current)
    saveHintTimer.current = window.setTimeout(() => setSaveHint(''), 1400)
  }

  function flashMessage(text) {
    setMessage(text)
    if (messageTimer.current) window.clearTimeout(messageTimer.current)
    messageTimer.current = window.setTimeout(() => setMessage(''), 1800)
  }

  function applyBooking(detail, preferOpenId, { syncValues = true } = {}) {
    setBooking(detail)
    setStatus(detail.status || 'booked')
    if (syncValues) setValues(valuesFromBooking(detail))
    // Keep accordions collapsed by default; only open a panel the user just added.
    if (preferOpenId) {
      setOpenPanels((prev) => new Set(prev).add(Number(preferOpenId)))
    }
  }

  async function load(testId) {
    const [cat, detail] = await Promise.all([
      LabAPI.catalog(),
      LabAPI.booking(bookingId, testId || undefined),
    ])
    setCatalog(cat.categories || [])
    applyBooking(detail, testId)
    return detail
  }

  useEffect(() => {
    load().catch((err) => setError(err.message))
  }, [bookingId])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  function requestClose() {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    window.setTimeout(onClose, 460)
  }

  useEffect(() => {
    if (!dirtyRef.current) return undefined
    const snapshot = values
    const statusSnap = status
    const handle = setTimeout(async () => {
      const tests = bookingRef.current?.tests || []
      if (!tests.length) return
      const isDraft = (bookingRef.current?.status || 'draft') === 'draft'
      try {
        setSaveHint('Saving…')
        for (const entry of tests) {
          const payload = {}
          ;(entry.results || []).forEach((r) => {
            payload[r.id] = snapshot[r.id] ?? ''
          })
          const body = {
            action: 'save_results',
            test_id: entry.test.id,
            results: payload,
          }
          // Keep drafts off the Reports list until Save and Print.
          if (!isDraft) body.status = statusSnap
          else body.status = 'draft'
          await LabAPI.updateBooking(bookingId, body)
        }
        dirtyRef.current = false
        flashSaveHint(isDraft ? 'Draft saved' : 'Saved')
      } catch (err) {
        setSaveHint('')
        setError(err.message)
      }
    }, 500)
    return () => clearTimeout(handle)
  }, [values, status, bookingId])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (saveHintTimer.current) window.clearTimeout(saveHintTimer.current)
      if (messageTimer.current) window.clearTimeout(messageTimer.current)
    }
  }, [onClose])

  function focusNextResultInput(current) {
    const inputs = Array.from(document.querySelectorAll('.report-page input.result-input'))
    const index = inputs.indexOf(current)
    if (index === -1) return
    const next = inputs[index + 1]
    if (!next) return
    next.focus()
    next.select()
  }

  const selectedIds = useMemo(() => new Set(booking?.selected_test_ids || []), [booking])
  const selectedTests = booking?.tests || []

  function scrollToPanel(testId) {
    const node = panelRefs.current[testId]
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function selectTest(testId) {
    setError('')
    setMessage('')
    if (selectedIds.has(testId)) {
      setOpenPanels((prev) => new Set(prev).add(testId))
      scrollToPanel(testId)
      return
    }
    setBusy(true)
    try {
      if (dirtyRef.current && selectedTests.length) {
        dirtyRef.current = false
        const keepDraft = (bookingRef.current?.status || 'draft') === 'draft'
        for (const entry of selectedTests) {
          const payload = {}
          ;(entry.results || []).forEach((r) => {
            payload[r.id] = values[r.id] ?? ''
          })
          await LabAPI.updateBooking(bookingId, {
            action: 'save_results',
            test_id: entry.test.id,
            status: keepDraft ? 'draft' : status,
            results: payload,
          })
        }
      }
      await load(testId)
      requestAnimationFrame(() => scrollToPanel(Number(testId)))
      flashSaveHint('Test added')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function togglePanel(testId) {
    setOpenPanels((prev) => {
      const next = new Set(prev)
      if (next.has(testId)) next.delete(testId)
      else next.add(testId)
      return next
    })
  }

  async function saveAll({ commit = false } = {}) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      let detail = null
      const nextStatus = commit
        ? 'completed'
        : (bookingRef.current?.status || 'draft') === 'draft'
          ? 'draft'
          : status
      for (const entry of selectedTests) {
        const payload = {}
        ;(entry.results || []).forEach((r) => {
          payload[r.id] = values[r.id] ?? ''
        })
        detail = await LabAPI.updateBooking(bookingId, {
          action: 'save_results',
          test_id: entry.test.id,
          status: nextStatus,
          results: payload,
        })
      }
      dirtyRef.current = false
      if (detail) applyBooking(detail, undefined, { syncValues: false })
      if (commit) {
        setStatus('completed')
        flashMessage('Report saved')
        onCommitted?.()
      } else {
        flashMessage('Results saved')
      }
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveAndPrint() {
    const ok = await saveAll({ commit: true })
    if (!ok) return
    // Opens print helper; PDF requests Actual size (PrintScaling=None).
    window.open(LabAPI.printUrl(bookingId), '_blank', 'noopener,noreferrer')
  }

  async function removeTest(testId) {
    setBusy(true)
    setError('')
    try {
      const detail = await LabAPI.updateBooking(bookingId, {
        action: 'remove_test',
        test_id: testId,
      })
      applyBooking(detail)
      setOpenPanels((prev) => {
        const next = new Set(prev)
        next.delete(testId)
        return next
      })
      flashMessage('Test removed from report')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const filteredCatalog = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return catalog
    return catalog
      .map((c) => ({
        ...c,
        tests: (c.tests || []).filter((t) => t.name.toLowerCase().includes(q)),
      }))
      .filter((c) => c.tests.length)
  }, [catalog, filter])

  return createPortal(
    <div className={`report-page ${open ? 'open' : ''}`} role="dialog" aria-modal="true">
      <div className="report-page-inner">
        <header className="modal-titlebar">
          <div className="modal-titlebar-start">
            <button className="btn btn-secondary report-back-btn" type="button" onClick={requestClose}>
              ← Back
            </button>
            <div>
              <h2>Report Entry</h2>
              <p>
                {booking?.report_no} · {booking?.patient?.name} · Age {booking?.patient?.age ?? '—'} ·{' '}
                {booking?.patient?.gender_display}
              </p>
            </div>
          </div>
          <div className="modal-titlebar-actions">
            <button
              className="btn btn-primary report-save-print-btn"
              type="button"
              disabled={busy || !selectedTests.length}
              onClick={saveAndPrint}
            >
              Save and Print
            </button>
          </div>
        </header>

        {error ? <div className="error-banner" style={{ margin: '0.75rem 1rem 0' }}>{error}</div> : null}
        {message ? <div className="success-banner" style={{ margin: '0.75rem 1rem 0' }}>{message}</div> : null}

        <div className="modal-body">
          <aside className="workspace-tests">
            <div className="workspace-tests-head">
              <h3>All Tests</h3>
              <input
                className="field-input"
                placeholder="Filter tests…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="workspace-tests-list">
              {filteredCatalog.map((category) => (
                <details key={category.id} className="workspace-cat" open>
                  <summary>{category.name}</summary>
                  <ul>
                    {category.tests.map((test) => (
                      <li key={test.id}>
                        <button
                          type="button"
                          className={`workspace-test-link ${selectedIds.has(test.id) ? 'selected active' : ''}`}
                          onClick={() => selectTest(test.id)}
                          disabled={busy}
                        >
                          <span className="dot" />
                          <span className="label">{test.name}</span>
                          {selectedIds.has(test.id) ? <span className="pill">On report</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </aside>

          <section className="workspace-editor">
            <div className="result-toolbar">
              <div>
                <h3 className="panel-title result-section-heading" style={{ margin: 0 }}>Selected tests</h3>
                <p className="result-toolbar-meta">
                  {selectedTests.length
                    ? `${selectedTests.length} test${selectedTests.length === 1 ? '' : 's'} · fill every parameter below`
                    : 'No tests on this report yet'}
                  {saveHint ? <span className="autosave-state"> · {saveHint}</span> : null}
                </p>
              </div>
              <div className="field" style={{ minWidth: 180, margin: 0 }}>
                <label>Status</label>
                {status === 'draft' ? (
                  <div className="field-input" style={{ display: 'flex', alignItems: 'center', opacity: 0.85 }}>
                    Draft · not in Reports until Save and Print
                  </div>
                ) : (
                  <select
                    className="field-input"
                    value={status}
                    onChange={(e) => {
                      dirtyRef.current = true
                      setStatus(e.target.value)
                    }}
                  >
                    <option value="booked">Booked</option>
                    <option value="sample_collected">Sample Collected</option>
                    <option value="completed">Completed</option>
                  </select>
                )}
              </div>
            </div>

            {!selectedTests.length ? (
              <div className="workspace-empty">
                <h3>No selected tests</h3>
                <p>Choose a test from the left to add it and fill Result, Unit, and Range.</p>
              </div>
            ) : (
              <div className="result-accordion-list">
                {selectedTests.map((entry) => {
                  const testId = entry.test.id
                  const isOpen = openPanels.has(testId)
                  const filled = (entry.results || []).filter((r) => (values[r.id] || '').trim()).length
                  const total = (entry.results || []).length
                  return (
                    <div
                      key={entry.booking_test_id || testId}
                      className={`result-accordion ${isOpen ? 'open' : ''}`}
                      ref={(node) => {
                        panelRefs.current[testId] = node
                      }}
                    >
                      <button
                        type="button"
                        className="result-accordion-head"
                        onClick={() => togglePanel(testId)}
                        aria-expanded={isOpen}
                      >
                        <span className="result-accordion-chevron" aria-hidden="true">
                          {isOpen ? '▾' : '▸'}
                        </span>
                        <span className="result-accordion-title">
                          <strong>{entry.test.name}</strong>
                          <span>
                            {entry.test.category_name} · ₹{entry.test.price}
                          </span>
                        </span>
                        <span className="result-accordion-fill">{filled}/{total} filled</span>
                      </button>

                      {isOpen ? (
                        <div className="result-accordion-body">
                          {isWidalTest(entry.test) ? (
                            <div className="widal-matrix-wrap">
                              <table className="widal-matrix">
                                <thead>
                                  <tr>
                                    <th className="widal-antigen" />
                                    {WIDAL_COLS.map((col) => (
                                      <th key={col}>{col}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {WIDAL_ROWS.map((row) => (
                                    <tr key={row}>
                                      <td className="widal-antigen"><strong>{row}</strong></td>
                                      {WIDAL_COLS.map((col) => {
                                        const r = (entry.results || []).find(
                                          (x) => x.name === widalCellName(row, col),
                                        )
                                        if (!r) {
                                          return <td key={col} className="widal-cell muted">*</td>
                                        }
                                        const current = values[r.id] ?? ''
                                        return (
                                          <td key={col} className="widal-cell">
                                            <button
                                              type="button"
                                              className={`widal-toggle result-input ${current === '+' ? 'pos' : ''} ${current === '-' ? 'neg' : ''}`}
                                              title="Click to cycle +, −, blank"
                                              disabled={busy}
                                              aria-label={`${row} ${col}`}
                                              onClick={() => {
                                                dirtyRef.current = true
                                                setError('')
                                                setValues((v) => ({
                                                  ...v,
                                                  [r.id]: cycleAgglutination(v[r.id]),
                                                }))
                                              }}
                                            >
                                              {current || '*'}
                                            </button>
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  ))}
                                  <tr className="widal-result-row">
                                    <td className="widal-antigen"><strong>RESULT</strong></td>
                                    <td colSpan={WIDAL_COLS.length}>
                                      {(() => {
                                        const r = (entry.results || []).find((x) => x.name === WIDAL_RESULT)
                                        if (!r) return <span className="muted">RESULT parameter missing — re-seed / refresh test</span>
                                        const current = values[r.id] ?? ''
                                        return (
                                          <input
                                            className="field-input result-input widal-result-input"
                                            value={current}
                                            disabled={busy}
                                            placeholder="e.g. NEGATIVE / POSITIVE"
                                            onChange={(e) => {
                                              dirtyRef.current = true
                                              setError('')
                                              setValues((v) => ({ ...v, [r.id]: e.target.value }))
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key !== 'Enter') return
                                              e.preventDefault()
                                              focusNextResultInput(e.currentTarget)
                                            }}
                                          />
                                        )
                                      })()}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                              <p className="widal-hint">Click a cell to cycle + / − / blank, or type a value. Enter the overall RESULT below.</p>
                            </div>
                          ) : (
                            <div className="table-wrap">
                              <table className="data">
                                <thead>
                                  <tr>
                                    <th>Parameter</th>
                                    <th>Result</th>
                                    <th>Unit</th>
                                    <th className="range-cell">Range</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(entry.results || []).map((r) => {
                                    const current = values[r.id] ?? ''
                                    const rangeState = evaluateResultRange(current, r.reference_range)
                                    const outClass = rangeState === 'high' || rangeState === 'low' ? 'result-out-range' : ''
                                    return (
                                      <tr key={r.id}>
                                        <td><strong>{r.name}</strong></td>
                                        <td>
                                          <div className="result-value-wrap">
                                            <input
                                              className={`field-input result-input ${rangeState === 'in' ? 'result-in-range' : ''} ${outClass}`}
                                              value={current}
                                              inputMode="decimal"
                                              onChange={(e) => {
                                                dirtyRef.current = true
                                                setError('')
                                                const cleaned = e.target.value.replace(/,/g, '')
                                                let next = e.target.value
                                                if (cleaned === '' || cleaned === '-' || /^-?\d+\.$/.test(cleaned)) {
                                                  next = cleaned
                                                } else if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
                                                  next = formatIndianNumber(cleaned)
                                                }
                                                setValues((v) => applyCbcAutofill(entry.results, v, r.id, next))
                                              }}
                                              onBlur={(e) => {
                                                const formatted = formatIndianNumber(e.target.value)
                                                dirtyRef.current = true
                                                setValues((v) => applyCbcAutofill(entry.results, v, r.id, formatted))
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key !== 'Enter') return
                                                e.preventDefault()
                                                const formatted = formatIndianNumber(e.currentTarget.value)
                                                dirtyRef.current = true
                                                setValues((v) => applyCbcAutofill(entry.results, v, r.id, formatted))
                                                focusNextResultInput(e.currentTarget)
                                              }}
                                              placeholder="Enter result"
                                            />
                                            {rangeState === 'high' ? (
                                              <span className="result-flag result-flag-high" title="Above range">↑</span>
                                            ) : null}
                                            {rangeState === 'low' ? (
                                              <span className="result-flag result-flag-low" title="Below range">↓</span>
                                            ) : null}
                                          </div>
                                        </td>
                                        <td>{r.unit || '—'}</td>
                                        <td className="range-cell">{r.reference_range || '—'}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                          <div className="result-accordion-actions">
                            <button
                              className="btn btn-danger btn-sm"
                              type="button"
                              disabled={busy}
                              onClick={() => removeTest(testId)}
                            >
                              Remove test
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}

          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
