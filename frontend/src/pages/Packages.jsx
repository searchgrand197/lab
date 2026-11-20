import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { LabAPI } from '../api'

const blank = { name: '', description: '', price: '0', test_ids: [], is_active: true }

export default function Packages() {
  const [packages, setPackages] = useState([])
  const [tests, setTests] = useState([])
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [open, setOpen] = useState(false)
  const [testFilter, setTestFilter] = useState('')
  const [error, setError] = useState('')

  async function refresh() {
    const [p, t] = await Promise.all([LabAPI.packages(), LabAPI.tests()])
    setPackages(p.results || [])
    setTests((t.results || []).filter((row) => row.is_active !== false))
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const filteredTests = useMemo(() => {
    const q = testFilter.trim().toLowerCase()
    if (!q) return tests
    return tests.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        String(t.category_name || '').toLowerCase().includes(q),
    )
  }, [tests, testFilter])

  function openAdd() {
    setEditingId(null)
    setForm({ ...blank, test_ids: [] })
    setTestFilter('')
    setError('')
    setOpen(true)
  }

  function edit(pkg) {
    setEditingId(pkg.id)
    setForm({
      name: pkg.name || '',
      description: pkg.description || '',
      price: pkg.price || '0',
      test_ids: [...(pkg.test_ids || [])],
      is_active: pkg.is_active !== false,
    })
    setTestFilter('')
    setError('')
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setEditingId(null)
    setForm(blank)
    setTestFilter('')
  }

  function toggleTest(id) {
    setForm((prev) => {
      const has = prev.test_ids.includes(id)
      return {
        ...prev,
        test_ids: has ? prev.test_ids.filter((x) => x !== id) : [...prev.test_ids, id],
      }
    })
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      price: form.price || 0,
      test_ids: form.test_ids,
      is_active: form.is_active,
    }
    try {
      if (editingId) await LabAPI.updatePackage(editingId, body)
      else await LabAPI.createPackage(body)
      close()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(pkg) {
    if (!window.confirm(`Delete package “${pkg.name}”?`)) return
    setError('')
    try {
      await LabAPI.deletePackage(pkg.id)
      if (editingId === pkg.id) close()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <h2 className="panel-title" style={{ margin: 0 }}>Packages</h2>
        <button className="btn btn-primary" type="button" onClick={openAdd}>Add new package</button>
      </div>
      {!open && error ? <div className="error-banner">{error}</div> : null}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Tests</th>
              <th>Price</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => (
              <tr key={pkg.id}>
                <td>
                  <strong>{pkg.name}</strong>
                  {pkg.description ? <span className="sub">{pkg.description}</span> : null}
                </td>
                <td><span className="badge">{pkg.test_count}</span></td>
                <td>₹{pkg.price}</td>
                <td>{pkg.is_active === false ? 'Inactive' : 'Active'}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => edit(pkg)}>Edit</button>
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(pkg)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {!packages.length ? (
              <tr><td colSpan={5} className="empty">No packages yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {open ? createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={close}>
          <div className="modal-window modal-form modal-form-wide" onClick={(e) => e.stopPropagation()}>
            <header className="modal-titlebar">
              <div>
                <h2>{editingId ? 'Edit package' : 'Add new package'}</h2>
                <p>Name, price, and included tests</p>
              </div>
              <button className="modal-close" type="button" onClick={close} aria-label="Close">×</button>
            </header>
            <form onSubmit={onSubmit} className="modal-form-body">
              {error ? <div className="error-banner">{error}</div> : null}
              <div className="form-grid">
                <div className="field span-2">
                  <label>Name</label>
                  <input
                    className="field-input"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="field span-2">
                  <label>Price</label>
                  <input
                    className="field-input"
                    type="number"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                  />
                </div>
                <div className="field span-2">
                  <label>Description</label>
                  <textarea
                    className="field-input"
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
                <div className="field span-2">
                  <label className="check-inline">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    />
                    Active (show in Book Test)
                  </label>
                </div>
              </div>

              <div className="pkg-tests-head">
                <h4 className="section-label" style={{ margin: 0 }}>Included tests</h4>
                <span className="badge">{form.test_ids.length}</span>
              </div>
              <input
                className="field-input test-filter"
                placeholder="Filter tests…"
                value={testFilter}
                onChange={(e) => setTestFilter(e.target.value)}
              />
              <div className="pkg-tests-list">
                {filteredTests.map((test) => {
                  const checked = form.test_ids.includes(test.id)
                  return (
                    <label key={test.id} className={`select-row ${checked ? 'checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTest(test.id)}
                      />
                      <span>
                        <strong>{test.name}</strong>
                        <em>{test.category_name} · ₹{test.price}</em>
                      </span>
                    </label>
                  )
                })}
                {!filteredTests.length ? <p className="empty">No tests found.</p> : null}
              </div>

              <div className="form-actions">
                <button className="btn btn-secondary" type="button" onClick={close}>Cancel</button>
                <button className="btn btn-primary" type="submit">
                  {editingId ? 'Update package' : 'Save package'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
