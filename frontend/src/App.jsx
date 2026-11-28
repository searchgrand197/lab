import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Settings from './pages/Settings'
import { AuthProvider, useAuth } from './AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'
import DemoGate from './pages/DemoGate'
import Patients from './pages/Patients'
import BookTest from './pages/BookTest'
import Doctors from './pages/Doctors'
import Categories from './pages/Categories'
import Packages from './pages/Packages'
import Tests from './pages/Tests'
import Reports from './pages/Reports'
import { isDemoMode, routerBasename } from './demo'
import './App.css'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="login-page"><div className="login-card">Loading…</div></div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter basename={routerBasename}>
          <Routes>
            <Route path="/login" element={isDemoMode ? <DemoGate /> : <Login />} />
            <Route path="/login/" element={isDemoMode ? <DemoGate /> : <Login />} />
            <Route
              element={
                <Protected>
                  <Layout />
                </Protected>
              }
            >
              <Route path="/" element={<Navigate to="/book" replace />} />
              <Route path="/patients" element={<Patients />} />
              <Route path="/patients/" element={<Patients />} />
              <Route path="/book" element={<BookTest />} />
              <Route path="/book/" element={<BookTest />} />
              <Route path="/doctors" element={<Doctors />} />
              <Route path="/doctors/" element={<Doctors />} />
              <Route path="/packages" element={<Packages />} />
              <Route path="/packages/" element={<Packages />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/categories/" element={<Categories />} />
              <Route path="/tests" element={<Tests />} />
              <Route path="/tests/" element={<Tests />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/reports/" element={<Reports />} />
              {!isDemoMode ? (
                <>
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/settings/" element={<Settings />} />
                </>
              ) : null}
            </Route>
            <Route path="*" element={<Navigate to="/book" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}
