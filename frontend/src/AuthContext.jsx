import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { AuthAPI } from './api'

const defaultAuth = {
  user: null,
  loading: true,
  async login() {
    throw new Error('Auth is not ready')
  },
  async logout() {},
}

const AuthContext = createContext(defaultAuth)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    AuthAPI.me()
      .then((data) => {
        if (!cancelled) setUser(data.authenticated ? data.user : null)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      async login(username, password) {
        const data = await AuthAPI.login(username, password)
        setUser(data.user)
        return data.user
      },
      async logout() {
        await AuthAPI.logout()
        setUser(null)
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext) || defaultAuth
}
