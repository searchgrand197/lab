function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

let cachedCsrf = null

async function ensureCsrf(force = false) {
  if (!force && (cachedCsrf || getCookie('csrftoken'))) {
    cachedCsrf = cachedCsrf || getCookie('csrftoken')
    return cachedCsrf
  }
  const res = await fetch('/api/csrf/', { credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  cachedCsrf = data.csrfToken || getCookie('csrftoken')
  return cachedCsrf
}

export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const headers = { ...(options.headers || {}) }

  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = await ensureCsrf()
    if (csrf) headers['X-CSRFToken'] = csrf
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }
  }

  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers,
    body:
      options.body && typeof options.body === 'object' && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body,
  })

  if (res.status === 204) return null

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/pdf')) {
    if (!res.ok) throw new Error('PDF request failed')
    return res.blob()
  }

  const data = contentType.includes('application/json') ? await res.json().catch(() => null) : null
  if (!res.ok) {
    if (res.status === 403 && method !== 'GET' && method !== 'HEAD' && !options._csrfRetried) {
      cachedCsrf = null
      await ensureCsrf(true)
      return api(path, { ...options, _csrfRetried: true })
    }
    if (res.status === 403) {
      cachedCsrf = null
      throw new Error((data && data.error) || 'Session expired or blocked (403). Try again. Please log in again.')
    }
    throw new Error((data && data.error) || `Request failed (${res.status})`)
  }
  return data
}

export const AuthAPI = {
  me: () => api('/api/me/'),
  login: async (username, password) => {
    cachedCsrf = null
    const data = await api('/api/login/', { method: 'POST', body: { username, password } })
    await ensureCsrf()
    return data
  },
  logout: () => api('/api/logout/', { method: 'POST', body: {} }),
}

function listParams(q = '', opts = {}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (opts.all) params.set('all', '1')
  if (opts.select) params.set('select', '1')
  if (opts.page) params.set('page', String(opts.page))
  if (opts.page_size) params.set('page_size', String(opts.page_size))
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  return params
}

export const LabAPI = {
  patients: (q = '', opts = {}) => api(`/api/patients/?${listParams(q, opts)}`),
  patient: (id) => api(`/api/patients/${id}/`),
  createPatient: (payload) => api('/api/patients/', { method: 'POST', body: payload }),
  updatePatient: (id, payload) => api(`/api/patients/${id}/`, { method: 'PUT', body: payload }),
  deletePatient: (id) => api(`/api/patients/${id}/`, { method: 'DELETE' }),
  doctors: (opts = {}) => api(`/api/doctors/?${listParams(opts.q || '', opts)}`),
  createDoctor: (payload) => api('/api/doctors/', { method: 'POST', body: payload }),
  updateDoctor: (id, payload) => api(`/api/doctors/${id}/`, { method: 'PUT', body: payload }),
  deleteDoctor: (id) => api(`/api/doctors/${id}/`, { method: 'DELETE' }),
  reorderDoctors: (orderedIds) => api('/api/doctors/reorder/', { method: 'POST', body: { ordered_ids: orderedIds } }),
  categories: () => api('/api/categories/'),
  createCategory: (payload) => api('/api/categories/', { method: 'POST', body: payload }),
  updateCategory: (id, payload) => api(`/api/categories/${id}/`, { method: 'PUT', body: payload }),
  deleteCategory: (id) => api(`/api/categories/${id}/`, { method: 'DELETE' }),
  reorderCategories: (orderedIds) => api('/api/categories/reorder/', { method: 'POST', body: { ordered_ids: orderedIds } }),
  catalog: () => api('/api/catalog/'),
  packages: () => api('/api/packages/'),
  createPackage: (payload) => api('/api/packages/', { method: 'POST', body: payload }),
  updatePackage: (id, payload) => api(`/api/packages/${id}/`, { method: 'PUT', body: payload }),
  deletePackage: (id) => api(`/api/packages/${id}/`, { method: 'DELETE' }),
  tests: () => api('/api/tests/'),
  createTest: (payload) => api('/api/tests/', { method: 'POST', body: payload }),
  updateTest: (id, payload) => api(`/api/tests/${id}/`, { method: 'PUT', body: payload }),
  deleteTest: (id) => api(`/api/tests/${id}/`, { method: 'DELETE' }),
  reorderTests: (orderedIds) => api('/api/tests/reorder/', { method: 'POST', body: { ordered_ids: orderedIds } }),
  bookings: (q = '', filters = {}) => api(`/api/bookings/?${listParams(q, filters)}`),
  createBooking: (payload) => api('/api/bookings/', { method: 'POST', body: payload }),
  booking: (id, testId) =>
    api(testId ? `/api/bookings/${id}/?test=${testId}` : `/api/bookings/${id}/`),
  updateBooking: (id, payload) => api(`/api/bookings/${id}/`, { method: 'POST', body: payload }),
  deleteBooking: (id, deletionReason) =>
    api(`/api/bookings/${id}/`, {
      method: 'DELETE',
      body: { deletion_reason: deletionReason },
    }),
  pdfUrl: (id) => `/api/bookings/${id}/report.pdf`,
  printUrl: (id) => `/api/bookings/${id}/print/`,
  printSettings: () => api('/api/settings/print/'),
  savePrintSettings: (payload, file) => {
    const body = new FormData()
    const keys = [
      'page_preset',
      'page_width_mm',
      'page_height_mm',
      'margin_left_mm',
      'margin_right_mm',
      'header_height_mm',
      'footer_height_mm',
      'show_lab_title',
      'show_patient_header',
      'show_background_on_pdf',
      'show_background_on_qr',
      'public_base_url',
      'clear_background',
    ]
    keys.forEach((key) => {
      const value = payload?.[key]
      if (value === undefined || value === null) return
      body.append(key, typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value))
    })
    if (file) body.append('background_image', file)
    return api('/api/settings/print/', { method: 'POST', body })
  },
}
