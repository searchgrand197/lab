import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LabAPI } from '../api'
import GreenLoader from '../components/GreenLoader'
import Pagination from '../components/Pagination'

const blank = { name: '', specialization: '', phone: '', is_active: true, is_default: false }
const PAGE_SIZE = 50

export default function Doctors() {
  const [doctors, setDoctors] = useState([])
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function applyList(data) {
    setDoctors(data.results || [])
    setCount(data.count || 0)
    setTotalPages(data.total_pages || 0)
    if (data.page) setPage(data.page)
  }

  async function refresh(nextPage = page) {
    setLoading(true)
    try {
      const data = await LabAPI.doctors({ q, page: nextPage, page_size: PAGE_SIZE })
      applyList(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
  }, [q])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      LabAPI.doctors({ q, page, page_size: PAGE_SIZE })
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
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function openAdd() {
    setEditingId(null)
    setForm(blank)
    setError('')
    setOpen(true)
  }

  function edit(doctor) {
    setEditingId(doctor.id)
    setForm({
      name: doctor.name || '',
      specialization: doctor.specialization || '',
      phone: doctor.phone || '',
      is_active: doctor.is_active,
      is_default: !!doctor.is_default,
    })
    setError('')
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setEditingId(null)
    setForm(blank)
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      if (editingId) await LabAPI.updateDoctor(editingId, form)
      else await LabAPI.createDoctor(form)
      close()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(doctor) {
    if (!window.confirm(`Delete ${doctor.name}?`)) return
    setError('')
    try {
      await LabAPI.deleteDoctor(doctor.id)
      if (editingId === doctor.id) close()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function move(index, direction) {
    const next = index + direction
    if (next < 0 || next >= doctors.length) return
    const ordered = doctors.map((d) => d.id)
    ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
    setBusy(true)
    setError('')
    try {
      await LabAPI.reorderDoctors(ordered)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function setDefault(doctor) {
    setBusy(true)
    setError('')
    try {
      await LabAPI.updateDoctor(doctor.id, { ...doctor, is_default: true, is_active: true })
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <h2 className="panel-title" style={{ margin: 0 }}>Doctors</h2>
        <div className="search-box" style={{ flex: 1, maxWidth: 320 }}>
          <input
            className="field-input"
            placeholder="Search doctors…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="button" onClick={openAdd}>Add new doctor</button>
      </div>
      <p className="settings-help">Use ↑ ↓ to change sequence on this page. Set one default doctor for Book Test.</p>
      {!open && error ? <div className="error-banner">{error}</div> : null}
      <Pagination
        page={page}
        totalPages={totalPages}
        count={count}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        label="doctors"
        loading={loading}
      />
      <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
        {loading ? (
          <GreenLoader label="Loading doctors…" />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th className="sr">Order</th>
                <th>Name</th>
                <th>Specialization</th>
                <th>Phone</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {doctors.map((d, index) => (
                <tr key={d.id} className={d.is_default ? 'row-default' : ''}>
                  <td className="sr">
                    <div className="order-controls">
                      <button className="btn btn-secondary btn-sm" type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label="Move up">↑</button>
                      <span>{(page - 1) * PAGE_SIZE + index + 1}</span>
                      <button className="btn btn-secondary btn-sm" type="button" disabled={busy || index === doctors.length - 1} onClick={() => move(index, 1)} aria-label="Move down">↓</button>
                    </div>
                  </td>
                  <td>
                    <strong>{d.name}</strong>
                    {d.is_default ? <span className="badge default-badge">Default</span> : null}
                  </td>
                  <td>{d.specialization || '—'}</td>
                  <td>{d.phone || '—'}</td>
                  <td><span className="badge">{d.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="row-actions">
                      {!d.is_default ? (
                        <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => setDefault(d)}>Set default</button>
                      ) : null}
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => edit(d)}>Edit</button>
                      <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(d)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!doctors.length ? <tr><td colSpan={6} className="empty">No doctors yet.</td></tr> : null}
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
        label="doctors"
        loading={loading}
      />

      {open ? createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={close}>
          <div className="modal-window modal-form" onClick={(e) => e.stopPropagation()}>
            <header className="modal-titlebar">
              <div>
                <h2>{editingId ? 'Edit doctor' : 'Add new doctor'}</h2>
                <p>Name, specialization, phone, and default</p>
              </div>
              <button className="modal-close" type="button" onClick={close} aria-label="Close">×</button>
            </header>
            <form onSubmit={onSubmit} className="modal-form-body">
              {error ? <div className="error-banner">{error}</div> : null}
              <div className="field" style={{ marginBottom: '0.75rem' }}>
                <label>Name</label>
                <input className="field-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: '0.75rem' }}>
                <label>Specialization</label>
                <input className="field-input" value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: '0.75rem' }}>
                <label>Phone</label>
                <input className="field-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <label className="check-row" style={{ marginBottom: '0.55rem' }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                <span>Active</span>
              </label>
              <label className="check-row" style={{ marginBottom: '0.75rem' }}>
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                <span>Default doctor on Book Test</span>
              </label>
              <div className="form-actions">
                <button className="btn btn-secondary" type="button" onClick={close}>Cancel</button>
                <button className="btn btn-primary" type="submit">{editingId ? 'Update doctor' : 'Save doctor'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
