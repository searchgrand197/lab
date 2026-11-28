/** True when the SPA is running as the isolated /demo try-out. */
export const isDemoMode =
  import.meta.env.VITE_DEMO === '1'
  || window.location.pathname === '/demo'
  || window.location.pathname.startsWith('/demo/')

export const API_BASE = isDemoMode ? '/demo-api' : '/api'

export const BOOK_AUTOSAVE_KEY = isDemoMode
  ? 'khalsa-demo-book-autosave'
  : 'khalsa-book-autosave'

export const routerBasename = isDemoMode ? '/demo' : undefined
