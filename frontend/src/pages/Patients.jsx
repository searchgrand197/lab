import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { LabAPI } from '../api'
import GreenLoader from '../components/GreenLoader'
import Pagination from '../components/Pagination'

const TITLES = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Master', 'Dr.', 'Baby', 'B/O', 'Smt.', 'Shri', '']
const blank = { title: 'Mr.', name: '', age: '', gender: 'M', mobile: '', dob: '', remarks: '' }
const PAGE_SIZE = 50

export default function Patients() {
  const [q, setQ] = useState('')
  const [patients, setPatients] = useState([])
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  function applyList(data) {
    setPatients(data.results || [])
    setCount(data.count || 0)
    setTotalPages(data.total_pages || 0)
    if (data.page) setPage(data.page)
  }

  useEffect(() => {
    setPage(1)
  }, [q])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      LabAPI.patients(q, { page, page_size: PAGE_SIZE })
        .then((data) => {
          if (!cancelled) applyList(data)
        })
        .catch((err) => {
          if (!cancelled) setError(err.message)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, page])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function refresh() {
    setLoading(true)
    return LabAPI.patients(q, { page, page_size: PAGE_SIZE })
      .then(applyList)
      .finally(() => setLoading(false))
  }

  function openAdd() {
    setEditingId(null)
    setForm(blank)
    setError('')
    setOpen(true)
  }

  function edit(patient) {
    setEditingId(patient.id)
    setForm({
      title: patient.title || 'Mr.',
      name: patient.name || '',
      age: patient.age ?? '',
      gender: patient.gender || 'M',
      mobile: patient.mobile || '',
      dob: patient.dob || '',
      remarks: patient.remarks || '',
    })
    setError('')
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setEditingId(null)
    setForm(blank)
    setError('')
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    const body = { ...form, age: form.age || null, dob: form.dob || null }
    try {
      if (editingId) await LabAPI.updatePatient(editingId, body)
      else await LabAPI.createPatient(body)
      close()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(patient) {
    if (!window.confirm(`Delete ${patient.name}? Their reports will be removed too.`)) return
    setError('')
    try {
      await LabAPI.deletePatient(patient.id)
      if (editingId === patient.id) close()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="search-box" style={{ flex: 1, maxWidth: 360 }}>
          <input
            className="field-input"
            placeholder="Search by name or mobile…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="button" onClick={openAdd}>
          Add patient
        </button>
      </div>
      {!open && error ? <div className="error-banner">{error}</div> : null}
      <Pagination
        page={page}
        totalPages={totalPages}
        count={count}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        label="patients"
        loading={loading}
      />
      <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
        {loading ? (
          <GreenLoader label="Loading patients…" />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Age</th>
                <th>Gender</th>
                <th>Mobile</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.display_name || p.name}</strong></td>
                  <td>{p.age ?? '—'}</td>
                  <td>{p.gender_display}</td>
                  <td>{p.mobile || '—'}</td>
                  <td>{new Date(p.updated_at).toLocaleString()}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/book?patient=${p.id}`)}>Book</button>
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => edit(p)}>Edit</button>
                      <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(p)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!patients.length ? (
                <tr><td colSpan={6} className="empty">No patients yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
      <Pagination
        page={page}
        totalPages={totalPages}
        count={count}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        label="patients"
        loading={loading}
      />

      {open ? createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={close}>
          <div className="modal-window modal-form patient-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-titlebar">
              <div>
                <h2>{editingId ? 'Edit patient' : 'Add patient'}</h2>
                <p>Patient details for booking and reports</p>
              </div>
              <button className="modal-close" type="button" onClick={close} aria-label="Close">×</button>
            </header>
            <form onSubmit={onSubmit} className="modal-form-body">
              {error ? <div className="error-banner">{error}</div> : null}
              <div className="form-grid form-grid-2">
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
                    {TITLES.map((t) => (
                      <option key={t || 'none'} value={t}>{t || 'None'}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Name</label>
                  <input className="field-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="field">
                  <label>Age</label>
                  <input className="field-input" type="number" min="0" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
                </div>
                <div className="field">
                  <label>Gender</label>
                  <select className="field-input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label>Mobile</label>
                  <input className="field-input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
                </div>
                <div className="field">
                  <label>DOB</label>
                  <input className="field-input" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
                </div>
                <div className="field span-2">
                  <label>Remarks</label>
                  <textarea className="field-input" rows={3} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-secondary" type="button" onClick={close}>Cancel</button>
                <button className="btn btn-primary" type="submit">{editingId ? 'Update patient' : 'Save patient'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
