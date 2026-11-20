import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LabAPI } from '../api'

const emptyParam = { name: '', unit: '', reference_range: '' }
const blank = { category_id: '', name: '', price: '0', parameters: [{ ...emptyParam }] }

export default function Tests() {
  const [tests, setTests] = useState([])
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const [t, c] = await Promise.all([LabAPI.tests(), LabAPI.categories()])
    setTests(t.results || [])
    setCategories(c.results || [])
    return c.results || []
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

  function setParam(idx, key, value) {
    const parameters = form.parameters.map((row, i) => (i === idx ? { ...row, [key]: value } : row))
    setForm({ ...form, parameters })
  }

  function openAdd() {
    setEditingId(null)
    setForm({
      ...blank,
      category_id: categories[0] ? String(categories[0].id) : '',
      parameters: [{ ...emptyParam }],
    })
    setError('')
    setOpen(true)
  }

  function edit(test) {
    setEditingId(test.id)
    setForm({
      category_id: String(test.category_id),
      name: test.name,
      price: test.price,
      parameters: (test.parameters || []).length
        ? test.parameters.map((p) => ({
          id: p.id,
          name: p.name,
          unit: p.unit || '',
          reference_range: p.reference_range || '',
        }))
        : [{ ...emptyParam }],
    })
    setError('')
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setEditingId(null)
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    const body = {
      ...form,
      category_id: Number(form.category_id),
      price: form.price || 0,
      parameters: form.parameters.filter((p) => p.name.trim()),
    }
    try {
      if (editingId) await LabAPI.updateTest(editingId, body)
      else await LabAPI.createTest(body)
      close()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(test) {
    if (!window.confirm(`Delete test “${test.name}”?`)) return
    setError('')
    try {
      await LabAPI.deleteTest(test.id)
      if (editingId === test.id) close()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const categoryNames = []
  const grouped = tests.reduce((acc, test) => {
    const key = test.category_name
    if (!acc[key]) {
      acc[key] = []
      categoryNames.push(key)
    }
    acc[key].push(test)
    return acc
  }, {})

  async function moveInCategory(list, index, direction) {
    const next = index + direction
    if (next < 0 || next >= list.length) return
    const ordered = list.map((t) => t.id)
    ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
    setBusy(true)
    setError('')
    try {
      const data = await LabAPI.reorderTests(ordered)
      setTests(data.results || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <h2 className="panel-title" style={{ margin: 0 }}>Tests</h2>
        <button className="btn btn-primary" type="button" onClick={openAdd}>Add new test</button>
      </div>
      <p className="settings-help">Use ↑ ↓ inside each category to change test sequence.</p>
      {!open && error ? <div className="error-banner">{error}</div> : null}

      {categoryNames.map((category) => {
        const list = grouped[category] || []
        return (
          <details key={category} open style={{ marginBottom: '0.75rem' }}>
            <summary style={{ fontWeight: 700, color: 'var(--green-900)', marginBottom: '0.5rem' }}>
              {category} <span className="badge">{list.length}</span>
            </summary>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th className="sr">Order</th><th>Test</th><th>Price</th><th>Parameters</th><th></th></tr>
                </thead>
                <tbody>
                  {list.map((t, index) => (
                    <tr key={t.id}>
                      <td className="sr">
                        <div className="order-controls">
                          <button className="btn btn-secondary btn-sm" type="button" disabled={busy || index === 0} onClick={() => moveInCategory(list, index, -1)} aria-label="Move up">↑</button>
                          <button className="btn btn-secondary btn-sm" type="button" disabled={busy || index === list.length - 1} onClick={() => moveInCategory(list, index, 1)} aria-label="Move down">↓</button>
                        </div>
                      </td>
                      <td><strong>{t.name}</strong></td>
                      <td>₹{t.price}</td>
                      <td>{t.parameter_count}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-secondary btn-sm" type="button" onClick={() => edit(t)}>Edit</button>
                          <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(t)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )
      })}
      {!tests.length ? <p className="empty">No tests yet.</p> : null}

      {open ? createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={close}>
          <div className="modal-window modal-form" onClick={(e) => e.stopPropagation()}>
            <header className="modal-titlebar">
              <div>
                <h2>{editingId ? 'Edit test' : 'Add new test'}</h2>
                <p>Category, price, and result parameters</p>
              </div>
              <button className="modal-close" type="button" onClick={close} aria-label="Close">×</button>
            </header>
            <form onSubmit={onSubmit} className="modal-form-body">
              {error ? <div className="error-banner">{error}</div> : null}
              <div className="form-grid">
                <div className="field span-2">
                  <label>Category</label>
                  <select className="field-input" required value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="field span-2">
                  <label>Name</label>
                  <input className="field-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="field span-2">
                  <label>Price</label>
                  <input className="field-input" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                </div>
              </div>
              <h4 className="section-label" style={{ marginTop: '0.85rem' }}>Parameters</h4>
              {form.parameters.map((p, idx) => (
                <div className="form-grid" key={p.id || idx} style={{ marginBottom: '0.4rem' }}>
                  <div className="field span-2">
                    <input className="field-input" placeholder="Parameter" value={p.name} onChange={(e) => setParam(idx, 'name', e.target.value)} />
                  </div>
                  <div className="field span-2">
                    <input className="field-input" placeholder="Unit" value={p.unit} onChange={(e) => setParam(idx, 'unit', e.target.value)} />
                  </div>
                  <div className="field span-2">
                    <input className="field-input" placeholder="Range" value={p.reference_range} onChange={(e) => setParam(idx, 'reference_range', e.target.value)} />
                  </div>
                </div>
              ))}
              <div className="form-actions">
                <button className="btn btn-secondary" type="button" onClick={() => setForm({ ...form, parameters: [...form.parameters, { ...emptyParam }] })}>
                  Add parameter row
                </button>
                <button className="btn btn-secondary" type="button" onClick={close}>Cancel</button>
                <button className="btn btn-primary" type="submit">{editingId ? 'Update test' : 'Save test'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
