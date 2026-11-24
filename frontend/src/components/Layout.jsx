import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

const links = [
  { to: '/book', label: 'Book Test', short: 'B' },
  { to: '/patients', label: 'All Patients', short: 'P' },
  { to: '/packages', label: 'Package', short: 'Pk' },
  { to: '/tests', label: 'Test', short: 'T' },
  { to: '/categories', label: 'Category', short: 'C' },
  { to: '/doctors', label: 'Doctor', short: 'D' },
  { to: '/reports', label: 'Reports', short: 'R' },
  { to: '/settings', label: 'Settings', short: 'S' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="app-shell">
      <aside className="sidebar auto-hide" aria-label="Main navigation">
        <div className="sidebar-brand" title="Khalsa Clinical Laboratory">K</div>
        <p className="sidebar-lab">Khalsa Lab</p>
        <nav className="sidebar-nav">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              title={link.label}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={(event) => {
                if (link.to !== '/book') return
                event.preventDefault()
                const onBook = location.pathname === '/book' || location.pathname === '/book/'
                navigate('/book', {
                  replace: onBook,
                  state: { fresh: Date.now() },
                })
              }}
            >
              <span className="nav-short">{link.short}</span>
              <span className="nav-label">{link.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-user" title={user?.username}>{user?.username?.[0]?.toUpperCase() || 'U'}</span>
          <span className="nav-label sidebar-user-name">{user?.username}</span>
          <button
            className="sidebar-logout"
            type="button"
            title="Logout"
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
          >
            <span className="nav-short">↩</span>
            <span className="nav-label">Logout</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <main className="content page-enter no-topbar">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
