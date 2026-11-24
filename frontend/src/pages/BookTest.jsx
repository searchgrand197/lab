import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LabAPI } from '../api'
import ReportModal from '../components/ReportModal'

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Format a Date / ISO string as local `YYYY-MM-DDTHH:mm` for datetime-local inputs. */
function toLocalInput(value = new Date()) {
  if (value == null || value === '') return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) {
    const raw = String(value).trim().replace(' ', 'T')
    return raw.length >= 16 ? raw.slice(0, 16) : raw
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function nowLocal() {
  return toLocalInput(new Date())
}

const PATIENT_TITLES = ['', 'Mr.', 'Mrs.', 'Ms.', 'Miss', 'Master', 'Dr.', 'Baby', 'B/O', 'Smt.', 'Shri']

function doctorMatchKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^\s*(dr\.?|doctor)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function doctorMatchesQuery(doctor, query) {
  const q = doctorMatchKey(query)
  if (!q) return false
  const name = doctorMatchKey(doctor.name)
  const raw = String(doctor.name || '').toLowerCase()
  return name.includes(q) || raw.includes(String(query).trim().toLowerCase())
}

function blankForm() {
  const now = nowLocal()
  return {
    patient_id: null,
    title: '',
    name: '',
    age: '',
    gender: 'M',
    mobile: '',
    dob: '',
    doctor_id: '',
    referral_source: 'Direct',
    remarks: '',
    room_no: '',
    report_no: '',
    test_date: now,
    next_due_date: '',
    sample_collected_at: now,
    sample_received_at: now,
    report_ready_at: '',
    sample_collected_by: '',
    sample_delivered_to: '',
  }
}

const AUTOSAVE_KEY = 'khalsa-book-autosave'

export default function BookTest() {
  const [form, setForm] = useState(() => blankForm())
  const [doctors, setDoctors] = useState([])
  const [packages, setPackages] = useState([])
  const [catalog, setCatalog] = useState([])
  const [selectedPackages, setSelectedPackages] = useState(new Set())
  const [selectedTests, setSelectedTests] = useState(new Set())
  const [testFilter, setTestFilter] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('')
  const [busy, setBusy] = useState(false)
  const [bookingId, setBookingId] = useState(null)
  const [doctorQuery, setDoctorQuery] = useState('')
  const [doctorFocused, setDoctorFocused] = useState(false)
  const [debouncedDoctorQuery, setDebouncedDoctorQuery] = useState('')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const draftIdRef = useRef(null)
  const creatingRef = useRef(false)
  const restoredRef = useRef(false)
  const latestRef = useRef({ form: blankForm(), tests: [] })
  latestRef.current = { form, tests: [...selectedTests] }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDoctorQuery(doctorQuery), 180)
    return () => clearTimeout(timer)
  }, [doctorQuery])

  const selectedDoctor = doctors.find((d) => String(d.id) === String(form.doctor_id))
  const doctorMatches = useMemo(() => {
    const q = debouncedDoctorQuery.trim()
    if (!doctorFocused || !q) return []
    return doctors
      .filter((d) => d.is_active !== false && doctorMatchesQuery(d, q))
      .slice(0, 12)
  }, [doctors, debouncedDoctorQuery, doctorFocused])

  useEffect(() => {
    let cancelled = false
    async function loadLists() {
      const errors = []
      try {
        const d = await LabAPI.doctors({ all: true, select: true })
        if (!cancelled) {
          setDoctors(d.results || [])
        }
      } catch (err) {
        errors.push(err.message)
      }
      try {
        const p = await LabAPI.packages()
        if (!cancelled) {
          setPackages((p.results || []).filter((pkg) => pkg.is_active !== false))
        }
      } catch (err) {
        errors.push(err.message)
      }
      try {
        const c = await LabAPI.catalog()
        if (!cancelled) setCatalog(c.categories || [])
      } catch (err) {
        errors.push(err.message)
      }
      if (!cancelled && errors.length) setError(errors[0])
    }
    loadLists()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (restoredRef.current || params.get('patient')) return
    restoredRef.current = true
    const now = nowLocal()
    try {
      const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null')
      if (!saved) {
        setForm((f) => ({
          ...f,
          test_date: now,
          sample_collected_at: now,
          sample_received_at: now,
        }))
        return
      }
      if (saved.form) {
        // Keep patient/test draft, but always use current local clock for new booking times.
        setForm({
          ...saved.form,
          test_date: now,
          sample_collected_at: now,
          sample_received_at: now,
          report_ready_at: saved.form.report_ready_at ? toLocalInput(saved.form.report_ready_at) : '',
          next_due_date: saved.form.next_due_date || '',
          dob: saved.form.dob || '',
        })
      } else {
        setForm((f) => ({
          ...f,
          test_date: now,
          sample_collected_at: now,
          sample_received_at: now,
        }))
      }
      if (saved.query) setQuery(saved.query)
      if (Array.isArray(saved.selectedTests)) setSelectedTests(new Set(saved.selectedTests))
      if (Array.isArray(saved.selectedPackages)) setSelectedPackages(new Set(saved.selectedPackages))
      if (saved.draftId) {
        draftIdRef.current = saved.draftId
      }
    } catch {
      setForm((f) => ({
        ...f,
        test_date: now,
        sample_collected_at: now,
        sample_received_at: now,
      }))
    }
  }, [params])

  useEffect(() => {
    localStorage.setItem(
      AUTOSAVE_KEY,
      JSON.stringify({
        form,
        query,
        selectedTests: [...selectedTests],
        selectedPackages: [...selectedPackages],
        draftId: draftIdRef.current,
      }),
    )
  }, [form, query, selectedTests, selectedPackages, saveState])

  useEffect(() => {
    if (!form.name.trim() || bookingId) return undefined
    const handle = setTimeout(async () => {
      if (creatingRef.current) return
      setSaveState('Saving…')
      const body = {
        ...form,
        status: 'draft',
        test_ids: [...selectedTests],
        age: form.age || null,
        doctor_id: form.doctor_id || null,
      }
      ;['dob', 'next_due_date', 'test_date', 'sample_collected_at', 'sample_received_at', 'report_ready_at'].forEach((key) => {
        if (!body[key]) body[key] = null
      })
      try {
        if (!draftIdRef.current) {
          creatingRef.current = true
          const booking = await LabAPI.createBooking(body)
          draftIdRef.current = booking.id
          creatingRef.current = false
          const latest = latestRef.current
          if (latest.form !== form || latest.tests.join() !== [...selectedTests].join()) {
            const follow = {
              ...latest.form,
              status: 'draft',
              test_ids: latest.tests,
              age: latest.form.age || null,
              doctor_id: latest.form.doctor_id || null,
            }
            await LabAPI.updateBooking(booking.id, { action: 'autosave', ...follow })
          }
        } else {
          await LabAPI.updateBooking(draftIdRef.current, { action: 'autosave', ...body })
        }
        setSaveState('Saved')
      } catch (err) {
        creatingRef.current = false
        setSaveState(err.message || 'Save failed')
      }
    }, 700)
    return () => clearTimeout(handle)
  }, [form, selectedTests, bookingId])

  useEffect(() => {
    const patientId = params.get('patient')
    if (!patientId) return
    LabAPI.patient(patientId)
      .then((p) => applyPatient(p))
      .catch(() => {})
  }, [params])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const t = setTimeout(() => {
      LabAPI.patients(query, { page: 1, page_size: 25 })
        .then((data) => setResults(data.results || []))
        .catch(() => setResults([]))
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  function applyPatient(p) {
    setForm((f) => ({
      ...f,
      patient_id: p.id,
      title: p.title || '',
      name: p.name || '',
      age: p.age ?? '',
      gender: p.gender || 'M',
      mobile: p.mobile || '',
      dob: p.dob || '',
      remarks: p.remarks || '',
    }))
    setQuery(p.display_name || p.name)
    setResults([])
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function togglePackage(pkg) {
    setSelectedPackages((prev) => {
      const next = new Set(prev)
      const adding = !next.has(pkg.id)
      if (adding) next.add(pkg.id)
      else next.delete(pkg.id)

      setSelectedTests((testsPrev) => {
        const testsNext = new Set(testsPrev)
        if (adding) {
          ;(pkg.test_ids || []).forEach((id) => testsNext.add(id))
        } else {
          const stillCovered = new Set()
          packages.forEach((p) => {
            if (p.id !== pkg.id && next.has(p.id)) {
              ;(p.test_ids || []).forEach((id) => stillCovered.add(id))
            }
          })
          ;(pkg.test_ids || []).forEach((id) => {
            if (!stillCovered.has(id)) testsNext.delete(id)
          })
        }
        return testsNext
      })
      return next
    })
  }

  function toggleTest(testId) {
    setSelectedTests((prev) => {
      const next = new Set(prev)
      if (next.has(testId)) next.delete(testId)
      else next.add(testId)
      return next
    })
  }

  const flatTests = useMemo(() => {
    const list = []
    catalog.forEach((c) => {
      ;(c.tests || []).forEach((t) => list.push({ ...t, category_name: c.name }))
    })
    return list
  }, [catalog])

  const filteredTests = useMemo(() => {
    const q = testFilter.trim().toLowerCase()
    if (!q) return flatTests
    return flatTests.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.category_name || '').toLowerCase().includes(q),
    )
  }, [flatTests, testFilter])

  const selectedTestObjects = useMemo(
    () => flatTests.filter((t) => selectedTests.has(t.id)),
    [flatTests, selectedTests],
  )

  async function onSubmit(e) {
    e.preventDefault()
    if (!form.doctor_id) {
      setError('Ref By (Doctor) is required.')
      return
    }
    if (!selectedTests.size) {
      setError('Select at least one test or package.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const body = { ...form, status: 'draft', test_ids: [...selectedTests] }
      if (!body.age) body.age = null
      ;['dob', 'next_due_date', 'test_date', 'sample_collected_at', 'sample_received_at', 'report_ready_at'].forEach((k) => {
        if (!body[k]) body[k] = null
      })
      let id = draftIdRef.current
      if (id) {
        await LabAPI.updateBooking(id, { action: 'autosave', ...body })
      } else {
        const booking = await LabAPI.createBooking(body)
        id = booking.id
      }
      draftIdRef.current = id
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({
          form,
          query,
          selectedTests: [...selectedTests],
          selectedPackages: [...selectedPackages],
          draftId: id,
        }),
      )
      setBookingId(id)
    } catch (err) {
      setError(err.message || 'Could not create booking')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="selected-dock" aria-live="polite">
        <div className="selected-dock-meta">
          <strong>Selected tests</strong>
          <span className="badge">{selectedTestObjects.length}</span>
          {saveState ? <span className="autosave-state">{saveState}</span> : null}
        </div>
        <div className="selected-chips">
          {selectedTestObjects.map((test) => (
            <button
              key={test.id}
              type="button"
              className="selected-chip"
              title="Remove test"
              onClick={() => toggleTest(test.id)}
            >
              {test.name}
              <span aria-hidden="true">×</span>
            </button>
          ))}
          {!selectedTestObjects.length ? (
            <span className="selected-hint">Choose a package or tests on the right. They appear here.</span>
          ) : null}
        </div>
        <button className="btn btn-primary" type="submit" form="book-form" disabled={busy || !selectedTestObjects.length}>
          {busy ? 'Saving…' : 'Next: Fill results'}
        </button>
      </div>

      <div className="book-split">
        <div className="panel book-left">
          <div className="toolbar">
            <h2 className="panel-title" style={{ margin: 0 }}>Book Test</h2>
            <div className="search-box">
              <input
                className="field-input"
                placeholder="Find existing patient…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {results.length ? (
                <div className="search-results">
                  {results.map((p) => (
                    <button key={p.id} type="button" onClick={() => applyPatient(p)}>
                      <strong>{p.display_name || p.name}</strong>
                      <span className="meta">{p.mobile || 'No mobile'} · {p.age ?? '—'} yrs</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          <form id="book-form" onSubmit={onSubmit} className="book-form compact-form">
            <section className="form-section">
              <h3 className="section-label">Patient Information</h3>
              <div className="form-grid form-grid-4">
                <div className="field">
                  <label>Title</label>
                  <select
                    className="field-input"
                    value={form.title}
                    onChange={(e) => {
                      const title = e.target.value
                      const nextGender =
                        title === 'Mrs.' || title === 'Ms.' || title === 'Miss' || title === 'Smt.'
                          ? 'F'
                          : title === 'Mr.' || title === 'Master' || title === 'Shri'
                            ? 'M'
                            : form.gender
                      setForm((f) => ({ ...f, title, gender: nextGender }))
                    }}
                  >
                    {PATIENT_TITLES.map((t) => (
                      <option key={t || 'none'} value={t}>{t || 'None'}</option>
                    ))}
                  </select>
                </div>
                <div className="field span-2">
                  <label>Name</label>
                  <input className="field-input" required value={form.name} onChange={(e) => setField('name', e.target.value)} />
                </div>
                <div className="field">
                  <label>Age</label>
                  <input className="field-input" type="number" value={form.age} onChange={(e) => setField('age', e.target.value)} />
                </div>
                <div className="field">
                  <label>Gender</label>
                  <div className="gender-group compact">
                    {[['M', 'Male'], ['F', 'Female'], ['O', 'Other']].map(([v, l]) => (
                      <label key={v}>
                        <input type="radio" checked={form.gender === v} onChange={() => setField('gender', v)} /> {l}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>Mobile No</label>
                  <input className="field-input" value={form.mobile} onChange={(e) => setField('mobile', e.target.value)} />
                </div>
                <div className="field">
                  <label>DOB</label>
                  <input className="field-input" type="date" value={form.dob} onChange={(e) => setField('dob', e.target.value)} />
                </div>
                <div className="field">
                  <label>Ref By (Doctor) *</label>
                  <div className="search-box doctor-search">
                    <input
                      className="field-input"
                      placeholder="Type doctor name…"
                      value={doctorFocused ? doctorQuery : (selectedDoctor?.name || '')}
                      onFocus={() => {
                        setDoctorFocused(true)
                        setDoctorQuery(selectedDoctor?.name || doctorQuery)
                      }}
                      onBlur={() => setDoctorFocused(false)}
                      onChange={(e) => {
                        setDoctorQuery(e.target.value)
                        if (form.doctor_id) setField('doctor_id', '')
                      }}
                      autoComplete="off"
                    />
                    {doctorFocused && debouncedDoctorQuery.trim() ? (
                      <div className="search-results">
                        {doctorMatches.length ? doctorMatches.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setField('doctor_id', String(d.id))
                              setDoctorQuery(d.name)
                              setDoctorFocused(false)
                            }}
                          >
                            <strong>{d.name}</strong>
                            {d.specialization ? <span className="meta">{d.specialization}</span> : null}
                          </button>
                        )) : (
                          <div className="doctor-search-empty">No doctor found</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="field">
                  <label>Referral Source</label>
                  <select className="field-input" value={form.referral_source} onChange={(e) => setField('referral_source', e.target.value)}>
                    {['Direct', 'Hospital', 'Camp', 'Other'].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field span-4">
                  <label>Remarks</label>
                  <input className="field-input" value={form.remarks} onChange={(e) => setField('remarks', e.target.value)} placeholder="Optional remarks" />
                </div>
              </div>
            </section>

            <section className="form-section">
              <h3 className="section-label">Sample & Report Details</h3>
              <div className="form-grid form-grid-4">
                {[
                  ['room_no', 'Room No', 'text'],
                  ['report_no', 'Report No', 'text'],
                  ['test_date', 'Test Date', 'datetime-local'],
                  ['next_due_date', 'Next Due Date', 'date'],
                  ['sample_collected_at', 'Sample Collection', 'datetime-local'],
                  ['sample_received_at', 'Sample Received', 'datetime-local'],
                  ['report_ready_at', 'Report Ready', 'datetime-local'],
                  ['sample_collected_by', 'Collected By', 'text'],
                  ['sample_delivered_to', 'Delivered To', 'text'],
                ].map(([key, label, type]) => (
                  <div className="field" key={key}>
                    <label>{label}</label>
                    <input className="field-input" type={type} value={form[key]} onChange={(e) => setField(key, e.target.value)} placeholder={key === 'report_no' ? 'Auto if blank' : ''} />
                  </div>
                ))}
              </div>
            </section>

            <div className="form-actions">
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate('/patients')}>Cancel</button>
            </div>
          </form>
        </div>

        <aside className="panel book-right">
          <div className="dual-lists">
            <section className="select-pane">
              <div className="select-pane-head">
                <h3>Packages list</h3>
                <span className="badge">{packages.length}</span>
              </div>
              <div className="select-pane-body">
                {packages.map((pkg) => (
                  <label key={pkg.id} className={`select-row ${selectedPackages.has(pkg.id) ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedPackages.has(pkg.id)}
                      onChange={() => togglePackage(pkg)}
                    />
                    <span>
                      <strong>{pkg.name}</strong>
                      <em>{pkg.test_count} tests · ₹{pkg.price}</em>
                    </span>
                  </label>
                ))}
                {!packages.length ? <p className="empty">No packages yet.</p> : null}
              </div>
            </section>

            <section className="select-pane">
              <div className="select-pane-head">
                <h3>Test list</h3>
                <span className="badge">{selectedTests.size}</span>
              </div>
              <input
                className="field-input test-filter"
                placeholder="Filter tests…"
                value={testFilter}
                onChange={(e) => setTestFilter(e.target.value)}
              />
              <div className="select-pane-body">
                {filteredTests.map((test) => (
                  <label key={test.id} className={`select-row ${selectedTests.has(test.id) ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedTests.has(test.id)}
                      onChange={() => toggleTest(test.id)}
                    />
                    <span>
                      <strong>{test.name}</strong>
                      <em>{test.category_name} · ₹{test.price}</em>
                    </span>
                  </label>
                ))}
                {!filteredTests.length ? <p className="empty">No tests found.</p> : null}
              </div>
            </section>
          </div>
        </aside>
      </div>

      {bookingId ? (
        <ReportModal
          bookingId={bookingId}
          onClose={() => {
            setBookingId(null)
          }}
          onCommitted={() => {
            draftIdRef.current = null
            localStorage.removeItem(AUTOSAVE_KEY)
            setSelectedTests(new Set())
            setSelectedPackages(new Set())
            setQuery('')
            setResults([])
            setTestFilter('')
            setDoctorQuery('')
            setDoctorFocused(false)
            setSaveState('')
            setError('')
            setForm(blankForm())
            setBookingId(null)
          }}
        />
      ) : null}
    </>
  )
}
