import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LabAPI } from '../api'

const blank = { name: '', description: '' }

export default function Categories() {
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const data = await LabAPI.categories()
    setCategories(data.results || [])
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

  function openAdd() {
    setEditingId(null)
    setForm(blank)
    setError('')
    setOpen(true)
  }

  function edit(category) {
    setEditingId(category.id)
    setForm({ name: category.name || '', description: category.description || '' })
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
      if (editingId) await LabAPI.updateCategory(editingId, form)
      else await LabAPI.createCategory(form)
      close()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(category) {
    if (!window.confirm(`Delete category “${category.name}”?`)) return
    setError('')
    try {
      await LabAPI.deleteCategory(category.id)
      if (editingId === category.id) close()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function move(index, direction) {
    const next = index + direction
    if (next < 0 || next >= categories.length) return
    const ordered = categories.map((c) => c.id)
    ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
    setBusy(true)
    setError('')
    try {
      const data = await LabAPI.reorderCategories(ordered)
      setCategories(data.results || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <h2 className="panel-title" style={{ margin: 0 }}>Categories</h2>
        <button className="btn btn-primary" type="button" onClick={openAdd}>Add new category</button>
      </div>
      <p className="settings-help">Use ↑ ↓ to change category sequence (used in Book Test / catalog).</p>
      {!open && error ? <div className="error-banner">{error}</div> : null}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th className="sr">Order</th><th>Name</th><th>Tests</th><th>Description</th><th></th></tr>
          </thead>
          <tbody>
            {categories.map((c, index) => (
              <tr key={c.id}>
                <td className="sr">
                  <div className="order-controls">
                    <button className="btn btn-secondary btn-sm" type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label="Move up">↑</button>
                    <button className="btn btn-secondary btn-sm" type="button" disabled={busy || index === categories.length - 1} onClick={() => move(index, 1)} aria-label="Move down">↓</button>
                  </div>
                </td>
                <td><strong>{c.name}</strong></td>
                <td><span className="badge">{c.test_count}</span></td>
                <td>{c.description || '—'}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => edit(c)}>Edit</button>
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(c)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {!categories.length ? <tr><td colSpan={5} className="empty">No categories yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {open ? createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={close}>
          <div className="modal-window modal-form" onClick={(e) => e.stopPropagation()}>
            <header className="modal-titlebar">
              <div>
                <h2>{editingId ? 'Edit category' : 'Add new category'}</h2>
                <p>Name and description</p>
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
                <label>Description</label>
                <textarea className="field-input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="form-actions">
                <button className="btn btn-secondary" type="button" onClick={close}>Cancel</button>
                <button className="btn btn-primary" type="submit">{editingId ? 'Update category' : 'Save category'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
