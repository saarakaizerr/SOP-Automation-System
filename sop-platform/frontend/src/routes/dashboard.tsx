import { useState, useRef, useEffect } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchSOPs, sopKeys } from '../api/client'
import { SOPCard } from '../components/SOPCard'
import { ProtectedRoute } from '../components/ProtectedRoute'
import { useAuth } from '../hooks/useAuth'
import { PageLoader, PageError } from '../components/PageLoader'
import type { SOPListItem, SOPStatus } from '../api/types'
import clsx from 'clsx'

export const Route = createFileRoute('/dashboard')({
  component: () => (
    <ProtectedRoute requiredRole="viewer">
      <Dashboard />
    </ProtectedRoute>
  ),
})

const PAGE_SIZE = 6

// ── Count-up hook ────────────────────────────────────────────
function useCountUp(target: number, duration = 500) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (target === 0) { setCount(0); return }
    const start = Date.now()
    const tick = () => {
      const progress = Math.min((Date.now() - start) / duration, 1)
      setCount(Math.round(progress * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, duration])
  return count
}

// ── Stat card ────────────────────────────────────────────────
interface StatCardProps {
  label: string
  value: number
  icon: React.ReactNode
  accent: string
  active: boolean
  onClick: () => void
}

function StatCard({ label, value, icon, accent, active, onClick }: StatCardProps) {
  const displayed = useCountUp(value)
  return (
    <button
      onClick={onClick}
      className={clsx(
        'group flex items-center gap-3 px-4 py-3 rounded-2xl border text-left',
        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
        active
          ? `${accent} border-transparent shadow-md`
          : 'bg-card border-subtle hover:border-default',
      )}
    >
      <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110', active ? 'bg-white/20' : 'bg-raised')}>
        {icon}
      </div>
      <div>
        <p className={clsx('text-xl font-bold tabular-nums leading-none', active ? 'text-white' : 'text-default')}>{displayed}</p>
        <p className={clsx('text-xs mt-0.5', active ? 'text-white/70' : 'text-muted')}>{label}</p>
      </div>
    </button>
  )
}

// ── Sort dropdown ────────────────────────────────────────────
type SortKey = 'newest' | 'oldest' | 'az' | 'steps'
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'az',     label: 'A → Z' },
  { key: 'steps',  label: 'Most steps' },
]

function SortDropdown({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const current = SORT_OPTIONS.find(o => o.key === value)!
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-muted bg-card border border-subtle hover:border-default hover:text-secondary px-3 py-1.5 rounded-lg transition-all"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M6 12h12M10 17h4" />
        </svg>
        {current.label}
        <svg className={clsx('w-3 h-3 transition-transform', open && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-default rounded-xl shadow-xl overflow-hidden min-w-[150px]">
          {SORT_OPTIONS.map(o => (
            <button
              key={o.key}
              onClick={() => { onChange(o.key); setOpen(false) }}
              className={clsx(
                'w-full text-left text-xs px-3 py-2 transition-colors',
                o.key === value ? 'bg-blue-500/10 text-blue-400 font-medium' : 'text-secondary hover:bg-raised',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── List row ─────────────────────────────────────────────────
const statusBadge: Record<SOPStatus, { label: string; cls: string; dot: string }> = {
  processing: { label: 'Processing', cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20', dot: 'bg-violet-400 animate-pulse' },
  draft:      { label: 'Draft',      cls: 'bg-raised text-muted border-default',                  dot: 'bg-slate-400' },
  in_review:  { label: 'In Review',  cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20',      dot: 'bg-blue-400' },
  published:  { label: 'Published',  cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400' },
  archived:   { label: 'Archived',   cls: 'bg-raised text-muted border-default',                  dot: 'bg-gray-400' },
}

const avatarGradient: Record<SOPStatus, string> = {
  processing: 'from-violet-500 to-indigo-500',
  draft:      'from-slate-400 to-slate-500',
  in_review:  'from-blue-500 to-cyan-500',
  published:  'from-emerald-500 to-teal-500',
  archived:   'from-gray-400 to-gray-500',
}

function Initials({ name }: { name: string }) {
  const words = name.trim().split(/\s+/).filter(w => /[a-zA-Z0-9]/.test(w[0]))
  const letters = words.length >= 2 ? `${words[0][0]}${words[1][0]}` : name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2)
  return <>{letters.toUpperCase()}</>
}

function formatDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function SOPListRow({ sop, style }: { sop: SOPListItem; style?: React.CSSProperties }) {
  const navigate = useNavigate()
  const cfg = statusBadge[sop.status] ?? statusBadge.draft
  const grad = avatarGradient[sop.status] ?? avatarGradient.draft
  const cleanTitle = sop.title.replace(/\b\d{8}\s+\d{6}\b/g, '').replace(/\s{2,}/g, ' ').trim()
  const displayName = sop.process_name || cleanTitle

  return (
    <div
      style={style}
      onClick={() => navigate({ to: '/sop/$id/procedure', params: { id: sop.id } })}
      className="animate-fade-in-up group flex items-center gap-3 px-4 py-3 bg-card border border-subtle rounded-xl cursor-pointer hover:border-default hover:-translate-y-0.5 hover:shadow-md transition-all duration-150"
    >
      <div className={clsx('shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold bg-gradient-to-br', grad)}>
        <Initials name={displayName} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-default truncate">{displayName}</p>
        {sop.client_name && <p className="text-xs text-muted truncate">{sop.client_name}</p>}
      </div>
      <span className={clsx('hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium shrink-0', cfg.cls)}>
        <span className={clsx('w-1.5 h-1.5 rounded-full', cfg.dot)} />
        {cfg.label}
      </span>
      <div className="hidden md:flex items-center gap-1 text-xs text-muted shrink-0">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        {sop.step_count}
      </div>
      {sop.meeting_date && (
        <span className="hidden lg:block text-xs text-muted shrink-0">{formatDate(sop.meeting_date)}</span>
      )}
      <button
        onClick={e => { e.stopPropagation(); navigate({ to: '/sop/$id/procedure', params: { id: sop.id } }) }}
        className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 active:scale-95 transition-all font-medium shrink-0 opacity-0 group-hover:opacity-100"
      >
        Open
      </button>
    </div>
  )
}

// ── Tag helpers ───────────────────────────────────────────────
const TAG_COLORS = [
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-green-100 text-green-700 border-green-200',
  'bg-orange-100 text-orange-700 border-orange-200',
  'bg-pink-100 text-pink-700 border-pink-200',
  'bg-teal-100 text-teal-700 border-teal-200',
  'bg-indigo-100 text-indigo-700 border-indigo-200',
  'bg-rose-100 text-rose-700 border-rose-200',
  'bg-amber-100 text-amber-700 border-amber-200',
  'bg-cyan-100 text-cyan-700 border-cyan-200',
]
function tagColor(tag: string) {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_COLORS[hash % TAG_COLORS.length]
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)
const shortcutLabel = isMac ? '⌘K' : 'Ctrl K'

// ── Dashboard ────────────────────────────────────────────────
function Dashboard() {
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<SOPStatus | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('newest')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [page, setPage] = useState(1)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { appUser } = useAuth()
  const canMerge = appUser?.role === 'editor' || appUser?.role === 'admin'

  const { data: sops, isLoading, error } = useQuery({
    queryKey: sopKeys.all,
    queryFn: fetchSOPs,
  })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); inputRef.current?.focus() }
      if (e.key === 'Escape' && focused) { handleSearch(''); inputRef.current?.blur() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused])

  if (isLoading) return <PageLoader label="Loading recordings…" />
  if (error) return <PageError message={`Failed to load recordings: ${(error as Error).message}`} />
  if (!sops || sops.length === 0) return <PageError message="No recordings found." />

  const recordings = sops.filter(s => !s.is_merged)
  const allTags = Array.from(new Set(recordings.flatMap(s => (s.tags || []).map(t => t.name)))).sort()

  // Stats
  const stats = {
    total:      recordings.length,
    processing: recordings.filter(s => s.status === 'processing').length,
    draft:      recordings.filter(s => s.status === 'draft').length,
    published:  recordings.filter(s => s.status === 'published').length,
  }

  // Filter
  const filtered = recordings.filter((s) => {
    const q = search.toLowerCase()
    const tagNames = (s.tags || []).map(t => t.name)
    const matchesText = !q || (
      s.title.toLowerCase().includes(q) ||
      (s.client_name ?? '').toLowerCase().includes(q) ||
      (s.process_name ?? '').toLowerCase().includes(q) ||
      tagNames.some(n => n.toLowerCase().includes(q))
    )
    const matchesTags   = selectedTags.length === 0 || selectedTags.every(t => tagNames.includes(t))
    const matchesStatus = !statusFilter || s.status === statusFilter
    return matchesText && matchesTags && matchesStatus
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'az')     return (a.process_name || a.title).localeCompare(b.process_name || b.title)
    if (sortBy === 'steps')  return (b.step_count ?? 0) - (a.step_count ?? 0)
    if (sortBy === 'oldest') return new Date(a.meeting_date ?? 0).getTime() - new Date(b.meeting_date ?? 0).getTime()
    return new Date(b.meeting_date ?? 0).getTime() - new Date(a.meeting_date ?? 0).getTime()
  })

  const totalPages   = Math.ceil(sorted.length / PAGE_SIZE)
  const currentPage  = Math.min(page, totalPages || 1)
  const paginated    = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const isFiltering  = search.trim() !== '' || selectedTags.length > 0 || statusFilter !== null

  function handleSearch(val: string) { setSearch(val); setPage(1) }
  function toggleTag(tag: string) {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
    setPage(1)
  }
  function toggleStatus(s: SOPStatus) {
    setStatusFilter(prev => prev === s ? null : s)
    setPage(1)
  }
  function clearAll() { setSearch(''); setSelectedTags([]); setStatusFilter(null); setPage(1) }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-default">Dashboard</h1>
        {canMerge && (
          <Link
            to="/merge"
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 active:scale-95 transition-all shadow-sm"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" clipRule="evenodd"/>
            </svg>
            Merge SOPs
          </Link>
        )}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total"
          value={stats.total}
          active={statusFilter === null && !isFiltering}
          accent="bg-gradient-to-br from-slate-600 to-slate-700"
          onClick={clearAll}
          icon={
            <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <StatCard
          label="Processing"
          value={stats.processing}
          active={statusFilter === 'processing'}
          accent="bg-gradient-to-br from-violet-600 to-indigo-600"
          onClick={() => toggleStatus('processing')}
          icon={
            <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          }
        />
        <StatCard
          label="Draft"
          value={stats.draft}
          active={statusFilter === 'draft'}
          accent="bg-gradient-to-br from-slate-500 to-slate-600"
          onClick={() => toggleStatus('draft')}
          icon={
            <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          }
        />
        <StatCard
          label="Published"
          value={stats.published}
          active={statusFilter === 'published'}
          accent="bg-gradient-to-br from-emerald-600 to-teal-600"
          onClick={() => toggleStatus('published')}
          icon={
            <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Search + filter panel */}
      <div className={clsx(
        'rounded-2xl border bg-card shadow-sm transition-all duration-200',
        focused ? 'border-blue-500 shadow-blue-500/10 shadow-lg' : 'border-subtle',
      )}>
        <div className="flex items-center px-4 py-3 gap-3">
          <svg className={clsx('w-4 h-4 shrink-0 transition-colors duration-200', focused ? 'text-blue-500' : 'text-muted')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder={`Search ${recordings.length} recording${recordings.length !== 1 ? 's' : ''}…`}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="flex-1 bg-transparent text-sm text-default placeholder:text-muted focus:outline-none"
          />
          <div className="flex items-center gap-2 shrink-0">
            {isFiltering ? (
              <>
                <span className="text-xs text-muted tabular-nums">{filtered.length} / {recordings.length}</span>
                <button
                  onMouseDown={(e) => { e.preventDefault(); clearAll(); inputRef.current?.focus() }}
                  className="flex items-center gap-1 text-xs text-muted hover:text-red-400 bg-raised hover:bg-red-500/10 border border-default hover:border-red-400/30 px-2 py-1 rounded-lg transition-all"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Clear
                </button>
              </>
            ) : (
              <kbd className={clsx('hidden sm:flex items-center gap-0.5 text-[10px] font-medium text-muted bg-raised border border-subtle px-1.5 py-0.5 rounded-md select-none transition-opacity duration-200', focused ? 'opacity-0' : 'opacity-60')}>
                {shortcutLabel}
              </kbd>
            )}
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 border-t border-subtle pt-2.5">
            <span className="text-[11px] font-medium text-muted uppercase tracking-wide mr-1">Tags</span>
            {allTags.map(tag => {
              const active = selectedTags.includes(tag)
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={clsx(
                    'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium transition-all duration-150',
                    active ? tagColor(tag) + ' ring-1 ring-offset-1 ring-current scale-105' : 'bg-raised text-muted border-default hover:text-secondary hover:border-blue-400/40 hover:scale-105',
                  )}
                >
                  {active && (
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {tag}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Results */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-raised border border-subtle flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-secondary mb-1">No recordings found</p>
          <p className="text-xs text-muted mb-4">Try different keywords or remove some filters</p>
          <button onClick={clearAll} className="text-xs font-medium text-blue-500 hover:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 px-4 py-2 rounded-xl transition-all">
            Clear all filters
          </button>
        </div>
      ) : (
        <>
          {/* Controls row */}
          <div className="flex items-center justify-between px-0.5">
            <p className="text-xs text-muted">
              {isFiltering
                ? `${sorted.length} result${sorted.length !== 1 ? 's' : ''}`
                : `${recordings.length} recording${recordings.length !== 1 ? 's' : ''}`
              }
            </p>
            <div className="flex items-center gap-2">
              <SortDropdown value={sortBy} onChange={(k) => { setSortBy(k); setPage(1) }} />
              {/* View toggle */}
              <div className="flex items-center bg-card border border-subtle rounded-lg overflow-hidden">
                <button
                  onClick={() => setView('grid')}
                  title="Grid view"
                  className={clsx('p-1.5 transition-colors', view === 'grid' ? 'bg-blue-600 text-white' : 'text-muted hover:text-secondary hover:bg-raised')}
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => setView('list')}
                  title="List view"
                  className={clsx('p-1.5 transition-colors', view === 'list' ? 'bg-blue-600 text-white' : 'text-muted hover:text-secondary hover:bg-raised')}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {view === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {paginated.map((sop, i) => (
                <div
                  key={sop.id}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <SOPCard sop={sop} />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {paginated.map((sop, i) => (
                <SOPListRow
                  key={sop.id}
                  sop={sop}
                  style={{ animationDelay: `${i * 30}ms` }}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted">
                {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sorted.length)} of {sorted.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-xs rounded-lg border border-default text-muted hover:bg-raised disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >‹ Prev</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={clsx('w-8 h-8 text-xs rounded-lg border transition-colors', n === currentPage ? 'bg-blue-600 border-blue-600 text-white font-semibold' : 'border-default text-muted hover:bg-raised')}
                  >{n}</button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 text-xs rounded-lg border border-default text-muted hover:bg-raised disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >Next ›</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
