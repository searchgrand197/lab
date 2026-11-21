import { useEffect, useMemo, useRef, useState } from 'react'
import { LabAPI } from '../api'

const PRESETS = [
  { value: 'A4', label: 'A4 — 210 × 297 mm', width: 210, height: 297 },
  { value: 'A5', label: 'A5 — 148 × 210 mm', width: 148, height: 210 },
  { value: 'Letter', label: 'Letter — 216 × 279 mm', width: 215.9, height: 279.4 },
  { value: 'Custom', label: 'Custom size', width: null, height: null },
]

const blank = {
  page_preset: 'A4',
  page_width_mm: 210,
  page_height_mm: 297,
  margin_left_mm: 12,
  margin_right_mm: 12,
  header_height_mm: 18,
  footer_height_mm: 16,
  show_lab_title: true,
  show_patient_header: true,
  show_background_on_pdf: true,
  show_background_on_qr: true,
  public_base_url: '',
  suggested_public_base_url: '',
  background_image_url: '',
  background_image_name: '',
  has_background: false,
}

export default function Settings() {
  const [form, setForm] = useState(blank)
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [clearBackground, setClearBackground] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // Remember last custom plate so switching A4 → Custom does not wipe saved sizes.
  const customSizeRef = useRef({ width: 186, height: 246 })

  useEffect(() => {
    LabAPI.printSettings()
      .then((data) => {
        setForm({ ...blank, ...data })
        if (data.page_preset === 'Custom' || data.page_width_mm || data.page_height_mm) {
          customSizeRef.current = {
            width: Number(data.page_width_mm) || customSizeRef.current.width,
            height: Number(data.page_height_mm) || customSizeRef.current.height,
          }
        }
        setPreviewUrl(data.background_image_url || '')
        setClearBackground(false)
        setFile(null)
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    if (!file) return undefined
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const contentHeight = useMemo(() => {
    const page = Number(form.page_height_mm) || 0
    const header = Number(form.header_height_mm) || 0
    const footer = Number(form.footer_height_mm) || 0
    return Math.max(page - header - footer, 0)
  }, [form.page_height_mm, form.header_height_mm, form.footer_height_mm])

  function setField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'page_width_mm' || key === 'page_height_mm') {
        next.page_preset = 'Custom'
        customSizeRef.current = {
          width: Number(key === 'page_width_mm' ? value : next.page_width_mm) || customSizeRef.current.width,
          height: Number(key === 'page_height_mm' ? value : next.page_height_mm) || customSizeRef.current.height,
        }
      }
      return next
    })
    setMessage('')
    setError('')
  }

  function onPresetChange(preset) {
    const found = PRESETS.find((p) => p.value === preset)
    setForm((prev) => {
      if (prev.page_preset === 'Custom') {
        customSizeRef.current = {
          width: Number(prev.page_width_mm) || customSizeRef.current.width,
          height: Number(prev.page_height_mm) || customSizeRef.current.height,
        }
      }
      if (preset === 'Custom') {
        return {
          ...prev,
          page_preset: 'Custom',
          page_width_mm: customSizeRef.current.width,
          page_height_mm: customSizeRef.current.height,
        }
      }
      return {
        ...prev,
        page_preset: preset,
        page_width_mm: found?.width ?? prev.page_width_mm,
        page_height_mm: found?.height ?? prev.page_height_mm,
      }
    })
    setMessage('')
    setError('')
  }

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const payload = {
        page_preset: form.page_preset,
        page_width_mm: form.page_width_mm,
        page_height_mm: form.page_height_mm,
        margin_left_mm: form.margin_left_mm,
        margin_right_mm: form.margin_right_mm,
        header_height_mm: form.header_height_mm,
        footer_height_mm: form.footer_height_mm,
        show_lab_title: form.show_lab_title,
        show_patient_header: form.show_patient_header,
        show_background_on_pdf: form.show_background_on_pdf,
        show_background_on_qr: form.show_background_on_qr,
        public_base_url: form.public_base_url || '',
        clear_background: clearBackground,
      }
      const data = await LabAPI.savePrintSettings(payload, clearBackground ? null : file)
      setForm({ ...blank, ...data })
      setPreviewUrl(data.background_image_url || '')
      setFile(null)
      setFileInputKey((k) => k + 1)
      setClearBackground(false)
      setMessage(
        `Saved on server: ${data.page_width_mm} × ${data.page_height_mm} mm`
        + ` (${data.page_preset})`
        + (data.has_background ? ' · background stored' : ''),
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page settings-page">
      <div className="toolbar">
        <div>
          <h2 className="panel-title" style={{ margin: 0 }}>Print Settings</h2>
          <p className="result-toolbar-meta">
            Set page size, letterhead background, and header / footer bands for report PDFs.
          </p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {message ? <div className="success-banner">{message}</div> : null}

      <form className="settings-layout" onSubmit={onSubmit}>
        <section className="panel settings-panel">
          <h3 className="section-label">Page dimensions</h3>
          <p className="settings-help">
            Saved on the server (not in the browser). Print uses this width × height from the top-left of an A4 sheet.
            Remaining A4 area stays blank (no stretch). Choose <strong>Custom size</strong> for letterhead plates like 186 × 246 mm.
          </p>
          <div className="form-grid form-grid-4">
            <div className="field span-2">
              <label>Page size</label>
              <select
                className="field-input"
                value={form.page_preset}
                onChange={(e) => onPresetChange(e.target.value)}
              >
                {PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Width (mm)</label>
              <input
                className="field-input"
                type="number"
                min="80"
                step="0.1"
                value={form.page_width_mm}
                disabled={form.page_preset !== 'Custom'}
                onChange={(e) => setField('page_width_mm', e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Height (mm)</label>
              <input
                className="field-input"
                type="number"
                min="80"
                step="0.1"
                value={form.page_height_mm}
                disabled={form.page_preset !== 'Custom'}
                onChange={(e) => setField('page_height_mm', e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Left margin (mm)</label>
              <input
                className="field-input"
                type="number"
                min="0"
                step="0.1"
                value={form.margin_left_mm}
                onChange={(e) => setField('margin_left_mm', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Right margin (mm)</label>
              <input
                className="field-input"
                type="number"
                min="0"
                step="0.1"
                value={form.margin_right_mm}
                onChange={(e) => setField('margin_right_mm', e.target.value)}
              />
            </div>
          </div>

          <h3 className="section-label" style={{ marginTop: '1.2rem' }}>Header & footer bands</h3>
          <p className="settings-help">
            Content is printed only between these bands. Use larger header / footer values when your
            background letterhead has logos or signatures in those areas.
          </p>
          <div className="form-grid form-grid-4">
            <div className="field">
              <label>Header height (mm)</label>
              <input
                className="field-input"
                type="number"
                min="0"
                step="0.1"
                value={form.header_height_mm}
                onChange={(e) => setField('header_height_mm', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Footer height (mm)</label>
              <input
                className="field-input"
                type="number"
                min="0"
                step="0.1"
                value={form.footer_height_mm}
                onChange={(e) => setField('footer_height_mm', e.target.value)}
              />
            </div>
            <div className="field span-2">
              <label>Usable content height</label>
              <input className="field-input" value={`${contentHeight.toFixed(1)} mm`} readOnly />
            </div>
          </div>

          <h3 className="section-label" style={{ marginTop: '1.2rem' }}>QR / mobile report</h3>
          <p className="settings-help">
            QR codes open the report on a phone. Leave blank to auto-use this PC’s Wi‑Fi IP.
            Run Django as <code>python manage.py runserver 0.0.0.0:8000</code>, keep phone on the same Wi‑Fi, then reprint the PDF.
            {form.suggested_public_base_url ? (
              <> Suggested: <strong>{form.suggested_public_base_url}</strong></>
            ) : null}
          </p>
          <div className="form-grid form-grid-4">
            <div className="field span-4">
              <label>Public base URL for QR codes</label>
              <input
                className="field-input"
                type="url"
                placeholder={form.suggested_public_base_url || 'http://192.168.1.10:8000'}
                value={form.public_base_url || ''}
                onChange={(e) => setField('public_base_url', e.target.value)}
              />
            </div>
          </div>

          <h3 className="section-label" style={{ marginTop: '1.2rem' }}>Background page</h3>
          <div className="field" style={{ marginBottom: '0.85rem' }}>
            <label>Letterhead / background image</label>
            <input
              key={fileInputKey}
              className="field-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                setClearBackground(false)
                setFile(e.target.files?.[0] || null)
              }}
            />
            {form.has_background && form.background_image_name && !clearBackground && !file ? (
              <p className="settings-help" style={{ marginTop: '0.4rem', marginBottom: 0 }}>
                Stored on server: <strong>{form.background_image_name}</strong>
              </p>
            ) : null}
            {file ? (
              <p className="settings-help" style={{ marginTop: '0.4rem', marginBottom: 0 }}>
                Ready to save: <strong>{file.name}</strong>
              </p>
            ) : null}
          </div>

          <ul className="settings-options">
            <li className="settings-option">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.show_lab_title}
                  onChange={(e) => setField('show_lab_title', e.target.checked)}
                />
                <span>Show lab title in content</span>
              </label>
            </li>
            <li className="settings-option">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.show_patient_header}
                  onChange={(e) => setField('show_patient_header', e.target.checked)}
                />
                <span>Show patient header box</span>
              </label>
            </li>
            <li className="settings-option">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.show_background_on_pdf !== false}
                  onChange={(e) => setField('show_background_on_pdf', e.target.checked)}
                />
                <span>Show background on software PDF</span>
              </label>
              <p className="settings-help">Turn off for a plain PDF from Print / Download inside the software.</p>
            </li>
            <li className="settings-option">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.show_background_on_qr !== false}
                  onChange={(e) => setField('show_background_on_qr', e.target.checked)}
                />
                <span>Show background on QR mobile report</span>
              </label>
              <p className="settings-help">Turn off for a plain report when opened from the QR code.</p>
            </li>
            {(form.has_background || previewUrl) && !file ? (
              <li className="settings-option">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={clearBackground}
                    onChange={(e) => {
                      const on = e.target.checked
                      setClearBackground(on)
                      if (on) {
                        setFile(null)
                        setPreviewUrl('')
                      } else {
                        setPreviewUrl(form.background_image_url || '')
                      }
                    }}
                  />
                  <span>Remove current background</span>
                </label>
              </li>
            ) : null}
          </ul>

          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save print settings'}
            </button>
          </div>
        </section>

        <aside className="panel settings-preview-panel">
          <h3 className="section-label">Page preview</h3>
          <div
            className="print-page-preview"
            style={{
              aspectRatio: `${Math.max(Number(form.page_width_mm) || 210, 1)} / ${Math.max(Number(form.page_height_mm) || 297, 1)}`,
            }}
          >
            {previewUrl && !clearBackground ? (
              <img src={previewUrl} alt="Background preview" className="print-page-bg" />
            ) : (
              <div className="print-page-bg placeholder">No background</div>
            )}
            <div
              className="print-band header"
              style={{ height: `${(Number(form.header_height_mm) / Math.max(Number(form.page_height_mm), 1)) * 100}%` }}
            >
              Header
            </div>
            <div
              className="print-band content"
              style={{
                top: `${(Number(form.header_height_mm) / Math.max(Number(form.page_height_mm), 1)) * 100}%`,
                height: `${(contentHeight / Math.max(Number(form.page_height_mm), 1)) * 100}%`,
                left: `${(Number(form.margin_left_mm) / Math.max(Number(form.page_width_mm), 1)) * 100}%`,
                right: `${(Number(form.margin_right_mm) / Math.max(Number(form.page_width_mm), 1)) * 100}%`,
              }}
            >
              Report content prints here
            </div>
            <div
              className="print-band footer"
              style={{ height: `${(Number(form.footer_height_mm) / Math.max(Number(form.page_height_mm), 1)) * 100}%` }}
            >
              Footer
            </div>
          </div>
          <p className="settings-help">
            Upload a full-page letterhead image. Increase header and footer heights until content sits
            cleanly between the printed letterhead areas.
          </p>
        </aside>
      </form>
    </div>
  )
}
