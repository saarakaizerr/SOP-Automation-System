import { useState, useRef, useEffect } from 'react'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useAuthContext } from '../contexts/AuthContext'
import { useTheme, type Theme } from '../contexts/ThemeContext'
import { useNotifications, type AppNotification } from '../contexts/NotificationContext'

const ROLE_CONFIG: Record<'viewer' | 'editor' | 'admin', { label: string; classes: string; dot: string }> = {
  viewer: { label: 'Viewer', classes: 'bg-raised text-muted',              dot: 'bg-slate-400' },
  editor: { label: 'Editor', classes: 'bg-blue-500/10 text-blue-400',      dot: 'bg-blue-400' },
  admin:  { label: 'Admin',  classes: 'bg-violet-500/10 text-violet-400',  dot: 'bg-violet-400' },
}

const AVATAR_GRADIENTS = [
  'from-violet-500 to-indigo-500',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-rose-500 to-pink-500',
  'from-amber-500 to-orange-500',
]
function avatarGradient(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}

function SunIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="5" />
      <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
}
function SlateIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 010 18" fill="currentColor" fillOpacity="0.3" stroke="none" />
    </svg>
  )
}

const THEMES: { value: Theme; label: string; Icon: () => JSX.Element }[] = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark',  label: 'Dark',  Icon: MoonIcon },
  { value: 'gray',  label: 'Gray',  Icon: SlateIcon },
]

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const state = useRouterState()
  const active = state.location.pathname.startsWith(to)
  return (
    <Link
      to={to}
      className={clsx(
        'relative text-sm font-medium px-1 py-0.5 transition-colors duration-150',
        active ? 'text-default' : 'text-muted hover:text-secondary',
      )}
    >
      {children}
      <span
        className={clsx(
          'absolute -bottom-[18px] left-0 right-0 h-0.5 rounded-full transition-all duration-200',
          active ? 'bg-violet-500 opacity-100 scale-x-100' : 'bg-violet-500 opacity-0 scale-x-0',
        )}
      />
    </Link>
  )
}

const NOTIF_ICON: Record<AppNotification['type'], { icon: string; bg: string; text: string }> = {
  upload:   { icon: '📤', bg: 'bg-violet-500/10', text: 'text-violet-400' },
  complete: { icon: '✅', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  error:    { icon: '❌', bg: 'bg-red-500/10',     text: 'text-red-400' },
}

function timeAgo(date: Date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return date.toLocaleDateString()
}

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications()

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleOpen() {
    setOpen(v => !v)
    if (!open) markAllRead()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        title="Notifications"
        className={clsx(
          'relative w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150',
          open ? 'bg-violet-500/15 text-violet-400' : 'text-muted hover:text-secondary hover:bg-raised',
        )}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-violet-500 text-white text-[8px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-3 w-80 z-50 bg-card border border-default rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-subtle">
            <span className="text-sm font-semibold text-default">Notifications</span>
            {notifications.length > 0 && (
              <button onClick={clearAll} className="text-[11px] text-muted hover:text-red-400 transition-colors">
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted gap-2">
                <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <span className="text-xs">No notifications yet</span>
              </div>
            ) : (
              notifications.map(n => {
                const cfg = NOTIF_ICON[n.type]
                return (
                  <div key={n.id} className={clsx('flex items-start gap-3 px-4 py-3 border-b border-subtle/50 last:border-0', !n.read && 'bg-violet-500/5')}>
                    <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm', cfg.bg)}>
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={clsx('text-xs font-semibold', cfg.text)}>{n.title}</p>
                      <p className="text-xs text-muted truncate mt-0.5">{n.body}</p>
                      <p className="text-[10px] text-muted/60 mt-1">{timeAgo(n.timestamp)}</p>
                    </div>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0 mt-1.5" />}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function UserMenu({ name, email, role, onSignOut }: { name: string; email?: string; role: 'viewer' | 'editor' | 'admin'; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const grad = avatarGradient(name)
  const cfg = ROLE_CONFIG[role]

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2.5 pl-4 border-l border-subtle group"
      >
        <div className={clsx(
          'w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-xs font-bold',
          'ring-2 ring-transparent group-hover:ring-violet-500/40 transition-all duration-200',
          grad,
        )}>
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="hidden sm:block text-left">
          <p className="text-xs font-semibold text-default leading-none">{name}</p>
          <p className={clsx('text-[10px] mt-0.5 font-medium', cfg.classes.split(' ').find(c => c.startsWith('text-')))}>{cfg.label}</p>
        </div>
        <svg
          className={clsx('w-3.5 h-3.5 text-muted transition-transform duration-200', open && 'rotate-180')}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-3 w-64 z-50 bg-card border border-default rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
          {/* User info header */}
          <div className="px-4 py-4 border-b border-subtle">
            <div className="flex items-center gap-3">
              <div className={clsx('w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-base font-bold shadow-md', grad)}>
                {name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-default truncate">{name}</p>
                {email && <p className="text-xs text-muted truncate mt-0.5">{email}</p>}
                <span className={clsx('inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium mt-1.5', cfg.classes)}>
                  <span className={clsx('w-1.5 h-1.5 rounded-full', cfg.dot)} />
                  {cfg.label}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-2">
            <button
              onClick={() => { setOpen(false); onSignOut() }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 rounded-xl transition-colors group"
            >
              <svg className="w-4 h-4 shrink-0 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const { isAuthenticated, appUser, signOut } = useAuthContext()
  const { theme, setTheme } = useTheme()

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-40 border-b border-subtle bg-card/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">

            {/* Logo */}
            <Link to="/dashboard" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-md shadow-violet-500/25 group-hover:shadow-violet-500/40 group-hover:scale-105 transition-all duration-200">
                <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <span className="text-sm font-bold text-default tracking-tight group-hover:text-violet-400 transition-colors duration-200">SOP Platform</span>
            </Link>

            {isAuthenticated && appUser ? (
              <div className="flex items-center gap-5">
                {/* Nav links */}
                <nav className="flex items-center gap-6">
                  <NavLink to="/dashboard">Dashboard</NavLink>
                  {appUser.role === 'admin' && (
                    <NavLink to="/settings">Settings</NavLink>
                  )}
                </nav>

                {/* Theme toggle + bell in one pill */}
                <div className="flex items-center bg-raised border border-subtle rounded-lg p-0.5 gap-0.5">
                  {THEMES.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      title={label}
                      className={clsx(
                        'w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150',
                        theme === value
                          ? 'bg-card text-default shadow-sm'
                          : 'text-muted hover:text-secondary',
                      )}
                    >
                      <Icon />
                    </button>
                  ))}
                  <div className="w-px h-4 bg-subtle mx-0.5" />
                  <NotificationBell />
                </div>

                {/* User menu */}
                <UserMenu
                  name={appUser.name}
                  email={appUser.email}
                  role={appUser.role}
                  onSignOut={() => void signOut()}
                />
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}
