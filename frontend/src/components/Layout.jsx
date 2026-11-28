import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { isDemoMode } from '../demo'
import DemoLeadPrompt from './DemoLeadPrompt'

const allLinks = [
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
  const links = isDemoMode ? allLinks.filter((link) => link.to !== '/settings') : allLinks
  const displayName = user?.name || user?.mobile || user?.username || 'U'

  return (
    <div className="app-shell">
      <aside className="sidebar auto-hide" aria-label="Main navigation">
        <div className="sidebar-brand" title={isDemoMode ? 'Lab Software Demo' : 'Khalsa Clinical Laboratory'}>
          {isDemoMode ? 'D' : 'K'}
        </div>
        <p className="sidebar-lab">{isDemoMode ? 'Demo Lab' : 'Khalsa Lab'}</p>
        {isDemoMode ? (
          <p className="sidebar-lab" style={{ opacity: 0.75, fontSize: '0.7rem', marginTop: '-0.35rem' }}>
            Separate from live data
          </p>
        ) : null}
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
          <span className="sidebar-user" title={displayName}>{String(displayName)[0]?.toUpperCase() || 'U'}</span>
          <span className="nav-label sidebar-user-name">{displayName}</span>
          <button
            className="sidebar-logout"
            type="button"
            title={isDemoMode ? 'End demo' : 'Logout'}
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
          >
            <span className="nav-short">↩</span>
            <span className="nav-label">{isDemoMode ? 'End demo' : 'Logout'}</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <main className="content page-enter no-topbar">
          <Outlet />
        </main>
      </div>
      {isDemoMode ? <DemoLeadPrompt /> : null}
    </div>
  )
}
