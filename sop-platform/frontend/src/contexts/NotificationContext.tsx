import { createContext, useContext, useState, useCallback, useEffect } from 'react'

export type NotifType = 'upload' | 'complete' | 'error'

export interface AppNotification {
  id: string
  type: NotifType
  title: string
  body: string
  timestamp: Date
  read: boolean
  sop_id?: string
}

interface NotificationContextValue {
  notifications: AppNotification[]
  unreadCount: number
  addNotification: (type: NotifType, title: string, body: string, sop_id?: string) => void
  markAllRead: () => void
  clearAll: () => void
  dismissOne: (id: string) => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

function playDing() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1046, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.6)
    osc.onended = () => ctx.close()
  } catch {}
}

const STORAGE_KEY = 'sop_notifications'

function loadFromStorage(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as (Omit<AppNotification, 'timestamp'> & { timestamp: string })[]
    return parsed.map(n => ({ ...n, timestamp: new Date(n.timestamp) }))
  } catch {
    return []
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadFromStorage)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications))
  }, [notifications])

  const purgeOld = useCallback(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    setNotifications(prev => prev.filter(n => n.timestamp.getTime() > cutoff))
  }, [])

  useEffect(() => {
    purgeOld()
    const interval = setInterval(purgeOld, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [purgeOld])

  const addNotification = useCallback((type: NotifType, title: string, body: string, sop_id?: string) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const notif: AppNotification = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      title,
      body,
      timestamp: new Date(),
      read: false,
      ...(sop_id ? { sop_id } : {}),
    }
    setNotifications(prev => [notif, ...prev].filter(n => n.timestamp.getTime() > cutoff).slice(0, 50))
    playDing()
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  const clearAll = useCallback(() => setNotifications([]), [])

  const dismissOne = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, addNotification, markAllRead, clearAll, dismissOne }}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider')
  return ctx
}
