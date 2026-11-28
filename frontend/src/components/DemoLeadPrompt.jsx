import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'

const DELAY_MS = 5000
const DISMISS_KEY = 'khalsa-demo-lead-dismissed'

export default function DemoLeadPrompt() {
  const { user, isDemo, saveDemoLead } = useAuth()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isDemo || !user || user.lead_captured || user.mobile) return undefined
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return undefined
    } catch {
      /* ignore */
    }
    const timer = window.setTimeout(() => setOpen(true), DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [isDemo, user])

  if (!open) return null

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await saveDemoLead({ name: name.trim(), mobile: mobile.trim() })
      setOpen(false)
    } catch (err) {
      setError(err.message || 'Could not save details')
    } finally {
      setBusy(false)
    }
  }

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <form className="modal-window modal-form patient-modal" onSubmit={onSubmit} onClick={(e) => e.stopPropagation()}>
        <header className="modal-titlebar">
          <div>
            <h2>Quick intro</h2>
            <p>Share your name and mobile so we can follow up. You can keep using the demo either way.</p>
          </div>
          <button className="modal-close" type="button" onClick={dismiss} aria-label="Close">×</button>
        </header>
        <div className="modal-form-body">
          {error ? <div className="error-banner">{error}</div> : null}
          <div className="field">
            <label htmlFor="demo-lead-name">Name</label>
            <input
              id="demo-lead-name"
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="demo-lead-mobile">Mobile number *</label>
            <input
              id="demo-lead-mobile"
              className="field-input"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="10-digit mobile"
              inputMode="tel"
              autoComplete="tel"
              required
            />
          </div>
          <div className="form-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" type="button" onClick={dismiss}>
              Later
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy || mobile.trim().length < 10}>
              {busy ? 'Saving…' : 'Submit'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
