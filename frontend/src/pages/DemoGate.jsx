import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

export default function DemoGate() {
  const { user, loading, startDemo } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/book" replace />

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await startDemo({ name: name.trim(), mobile: mobile.trim() })
      navigate('/book')
    } catch (err) {
      setError(err.message || 'Could not start demo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="mark">K</div>
        <h1>Lab Software Demo</h1>
        <p className="tagline">
          Try booking and printing with sample catalog data. This demo is separate from any live lab.
        </p>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="field" style={{ marginBottom: '0.85rem' }}>
          <label htmlFor="demo-name">Your name (optional)</label>
          <input
            id="demo-name"
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Aman"
            autoComplete="name"
          />
        </div>
        <div className="field">
          <label htmlFor="demo-mobile">Mobile number *</label>
          <input
            id="demo-mobile"
            className="field-input"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="10-digit mobile"
            inputMode="tel"
            autoComplete="tel"
            required
            autoFocus
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || mobile.trim().length < 10}>
          {busy ? 'Starting…' : 'Start demo'}
        </button>
      </form>
    </div>
  )
}
