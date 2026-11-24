import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { LabAPI } from '../api'
import GreenLoader from '../components/GreenLoader'
import Pagination from '../components/Pagination'
import ReportModal from '../components/ReportModal'

function todayInput() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const TITLES = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Master', 'Dr.', 'Baby', 'B/O', 'Smt.', 'Shri', '']
const PAGE_SIZE = 50
const DELETE_REASONS = [
  'Duplicate report',
  'Wrong patient selected',
  'Entered by mistake',
  'Incorrect test / results',
  'Patient cancelled',
  'Sample rejected / not usable',
  'Other',
]

const blank = {
  title: 'Mr.',
  name: '',
  age: '',
  gender: 'M',
  mobile: '',
  dob: '',
  remarks: '',
  status: 'booked',
  doctor_id: '',
  room_no: '',
  report_no: '',
}

export default function Reports() {
  const [q, setQ] = useState('')
  const [dateFrom, setDateFrom] = useState(todayInput)
  const [dateTo, setDateTo] = useState(todayInput)
  const [bookings, setBookings] = useState([])
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [doctors, setDoctors] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blank)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteOther, setDeleteOther] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  function applyList(data) {
    setBookings(data.results || [])
    setCount(data.count || 0)
    setTotalPages(data.total_pages || 0)
    if (data.page) setPage(data.page)
  }

  function load(query = q, from = dateFrom, to = dateTo, nextPage = page) {
    setLoading(true)
    return LabAPI.bookings(query, {
      from,
      to,
      page: nextPage,
      page_size: PAGE_SIZE,
    })
      .then(applyList)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    LabAPI.doctors({ all: true, select: true })
      .then((data) => setDoctors(data.results || []))
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    setPage(1)
  }, [q, dateFrom, dateTo])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      LabAPI.bookings(q, {
        from: dateFrom,
        to: dateTo,
        page,
        page_size: PAGE_SIZE,
      })
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
  }, [q, dateFrom, dateTo, page])

  async function edit(booking) {
    setError('')
    try {
      const detail = await LabAPI.booking(booking.id)
      const patient = detail.patient || {}
      setEditingId(detail.id)
      setForm({
        title: patient.title || 'Mr.',
        name: patient.name || '',
        age: patient.age ?? '',
        gender: patient.gender || 'M',
        mobile: patient.mobile || '',
        dob: patient.dob || '',
        remarks: detail.remarks || patient.remarks || '',
        status: detail.status || 'booked',
        doctor_id: detail.doctor?.id ? String(detail.doctor.id) : '',
        room_no: detail.room_no || '',
        report_no: detail.report_no || '',
      })
    } catch (err) {
      setError(err.message)
    }
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!editingId) return
    setError('')
    try {
      await LabAPI.updateBooking(editingId, {
        action: 'autosave',
        ...form,
        age: form.age || null,
        dob: form.dob || null,
        doctor_id: form.doctor_id || null,
      })
      setEditingId(null)
      setForm(blank)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  function askDelete(booking) {
    setDeleteTarget(booking)
    setDeleteReason('')
    setDeleteOther('')
    setError('')
  }

  function cancelDelete() {
    setDeleteTarget(null)
    setDeleteReason('')
    setDeleteOther('')
    setDeleteBusy(false)
  }

  function resolvedDeleteReason() {
    if (!deleteReason) return ''
    if (deleteReason === 'Other') {
      const note = deleteOther.trim()
      return note ? `Other: ${note}` : ''
    }
    return deleteReason
  }

  async function confirmDelete(e) {
    e.preventDefault()
    if (!deleteTarget) return
    const reason = resolvedDeleteReason()
    if (!reason) {
      setError(
        deleteReason === 'Other'
          ? 'Please describe the other reason.'
          : 'Please select a reason for deleting this report.',
      )
      return
    }
    setDeleteBusy(true)
    setError('')
    try {
      await LabAPI.deleteBooking(deleteTarget.id, reason)
      if (editingId === deleteTarget.id) setEditingId(null)
      cancelDelete()
      await load()
    } catch (err) {
      setError(err.message)
      setDeleteBusy(false)
    }
  }

  return (
    <>
      <div className="panel">
        <div className="toolbar">
          <div className="search-box">
            <input className="field-input" placeholder="Search report no, patient, mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="date-filter">
            From
            <input className="field-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="date-filter">
            To
            <input className="field-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {dateFrom || dateTo ? (
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setDateFrom(''); setDateTo('') }}>
              Clear dates
            </button>
          ) : null}
          <Link className="btn btn-primary" to="/book" state={{ fresh: Date.now() }}>New report</Link>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        {editingId ? (
          <form onSubmit={onSubmit} className="panel" style={{ marginBottom: '1rem' }}>
            <h3 className="section-label">Edit report {form.report_no}</h3>
            <div className="form-grid">
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
                    setForm({ ...form, title, gender: nextGender })
                  }}
                >
                  {TITLES.map((t) => (
                    <option key={t || 'none'} value={t}>{t || 'None'}</option>
                  ))}
                </select>
              </div>
              <div className="field span-2">
                <label>Patient name</label>
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
              <div className="field span-2">
                <label>Mobile</label>
                <input className="field-input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
              </div>
              <div className="field span-2">
                <label>Doctor</label>
                <select className="field-input" value={form.doctor_id} onChange={(e) => setForm({ ...form, doctor_id: e.target.value })}>
                  <option value="">— None —</option>
                  {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="field span-2">
                <label>Status</label>
                <select className="field-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="booked">Booked</option>
                  <option value="sample_collected">Sample Collected</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div className="field span-2">
                <label>Room</label>
                <input className="field-input" value={form.room_no} onChange={(e) => setForm({ ...form, room_no: e.target.value })} />
              </div>
              <div className="field span-4">
                <label>Remarks</label>
                <input className="field-input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </div>
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setEditingId(null)}>Cancel</button>
              <button className="btn btn-primary" type="submit">Update report</button>
            </div>
          </form>
        ) : null}
        <Pagination
          page={page}
          totalPages={totalPages}
          count={count}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          label="reports"
          loading={loading}
        />
        <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
          {loading ? (
            <GreenLoader label="Loading reports…" />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th className="sr">Sr. No.</th>
                  <th>Report No</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Test Date</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b, index) => (
                  <tr key={b.id}>
                    <td className="sr">{count - ((page - 1) * PAGE_SIZE + index)}</td>
                    <td className="mono"><strong>{b.report_no}</strong></td>
                    <td>
                      {b.patient.display_name || b.patient.name}
                      <span className="sub">{b.patient.mobile || '—'}</span>
                    </td>
                    <td>{b.doctor?.name || '—'}</td>
                    <td className="mono">{b.test_date ? new Date(b.test_date).toLocaleString() : '—'}</td>
                    <td><span className={`badge ${b.status}`}>{b.status_display}</span></td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => edit(b)}>Edit</button>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setActiveId(b.id)}>Results</button>
                        <a className="btn btn-primary btn-sm" href={LabAPI.pdfUrl(b.id)} target="_blank" rel="noreferrer">PDF</a>
                        <button className="btn btn-danger btn-sm" type="button" onClick={() => askDelete(b)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!bookings.length ? <tr><td colSpan={7} className="empty">No reports for this search.</td></tr> : null}
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
          label="reports"
          loading={loading}
        />
      </div>
      {activeId ? (
        <ReportModal
          bookingId={activeId}
          onClose={() => {
            setActiveId(null)
            load(q, dateFrom, dateTo, page).catch((err) => setError(err.message))
          }}
        />
      ) : null}

      {deleteTarget ? createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={cancelDelete}>
          <div className="modal-window modal-form patient-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-titlebar">
              <div>
                <h2>Delete report</h2>
                <p>{deleteTarget.report_no} · why do you want to delete this?</p>
              </div>
              <button className="modal-close" type="button" onClick={cancelDelete} aria-label="Close">×</button>
            </header>
            <form onSubmit={confirmDelete} className="modal-form-body">
              {error ? <div className="error-banner">{error}</div> : null}
              <div className="field">
                <label>Reason for deletion *</label>
                <div className="delete-reason-options" role="radiogroup" aria-label="Deletion reason">
                  {DELETE_REASONS.map((reason) => (
                    <label key={reason} className={`delete-reason-option ${deleteReason === reason ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="delete-reason"
                        value={reason}
                        checked={deleteReason === reason}
                        onChange={() => setDeleteReason(reason)}
                      />
                      <span>{reason}</span>
                    </label>
                  ))}
                </div>
              </div>
              {deleteReason === 'Other' ? (
                <div className="field" style={{ marginTop: '0.75rem' }}>
                  <label>Please specify *</label>
                  <textarea
                    className="field-input"
                    rows={3}
                    required
                    autoFocus
                    placeholder="Describe the reason…"
                    value={deleteOther}
                    onChange={(e) => setDeleteOther(e.target.value)}
                  />
                </div>
              ) : null}
              <p className="settings-help" style={{ marginTop: '0.75rem' }}>
                The report will be removed from this list. Admin can still view it with your reason.
              </p>
              <div className="form-actions">
                <button className="btn btn-secondary" type="button" onClick={cancelDelete} disabled={deleteBusy}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  type="submit"
                  disabled={deleteBusy || !resolvedDeleteReason()}
                >
                  {deleteBusy ? 'Deleting…' : 'Delete report'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
