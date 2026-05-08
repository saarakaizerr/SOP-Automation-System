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

// ── Stat / filter card ────────────────────────────────────────
interface StatCardProps {
  label: string
  value: number
  icon: React.ReactNode
  accent: string
  iconBg: string
  active: boolean
  onClick: () => void
}

function StatCard({ label, value, icon, accent, iconBg, active, onClick }: StatCardProps) {
  const displayed = useCountUp(value)
  return (
    <button
      onClick={onClick}
      title={`Filter by ${label}`}
      className={clsx(
        'group flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left',
        'transition-all duration-200 hover:-translate-y-1 hover:shadow-xl',
        active
          ? `${accent} border-transparent shadow-lg scale-[1.02]`
          : 'bg-card border-subtle hover:border-default hover:shadow-md',
      )}
    >
      <div className={clsx(
        'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 group-hover:scale-110',
        active ? 'bg-white/20' : iconBg,
      )}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={clsx('text-2xl font-bold tabular-nums leading-none', active ? 'text-white' : 'text-default')}>{displayed}</p>
        <p className={clsx('text-xs mt-1 font-medium', active ? 'text-white/70' : 'text-muted')}>{label}</p>
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
  processing: { label: 'In Processing', cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20', dot: 'bg-violet-400 animate-pulse' },
  draft:      { label: 'Draft',         cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20',    dot: 'bg-amber-400' },
  in_review:  { label: 'In Review',     cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       dot: 'bg-blue-400' },
  published:  { label: 'Published',     cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400' },
  archived:   { label: 'Archived',      cls: 'bg-raised text-muted border-default',                   dot: 'bg-gray-400' },
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

  if (isLoading) return <PageLoader label="Loading SOPs…" />
  if (error) return <PageError message={`Failed to load SOPs: ${(error as Error).message}`} />
  if (!sops || sops.length === 0) return <PageError message="No SOPs found." />

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
          label="Total SOPs"
          value={stats.total}
          active={statusFilter === null && !isFiltering}
          accent="bg-gradient-to-br from-blue-600 to-blue-700"
          iconBg="bg-blue-500/15"
          onClick={clearAll}
          icon={
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m0 0a2.246 2.246 0 00-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0121 12v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6c0-.98.626-1.813 1.5-2.122" />
            </svg>
          }
        />
        <StatCard
          label="In Processing"
          value={stats.processing}
          active={statusFilter === 'processing'}
          accent="bg-gradient-to-br from-violet-600 to-indigo-600"
          iconBg="bg-violet-500/15"
          onClick={() => toggleStatus('processing')}
          icon={
            <div className={clsx(
              'w-5 h-5 rounded-full border-[3px] animate-spin',
              statusFilter === 'processing' ? 'border-white/20 border-t-white' : 'border-violet-400/25 border-t-violet-400',
            )} />
          }
        />
        <StatCard
          label="Draft"
          value={stats.draft}
          active={statusFilter === 'draft'}
          accent="bg-gradient-to-br from-amber-600 to-orange-600"
          iconBg="bg-amber-500/15"
          onClick={() => toggleStatus('draft')}
          icon={
            <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          }
        />
        <StatCard
          label="Published"
          value={stats.published}
          active={statusFilter === 'published'}
          accent="bg-gradient-to-br from-emerald-600 to-teal-600"
          iconBg="bg-emerald-500/15"
          onClick={() => toggleStatus('published')}
          icon={
            <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
            </svg>
          }
        />
      </div>

      {/* Search bar */}
      <div className={clsx(
        'rounded-2xl border bg-card shadow-sm transition-all duration-200',
        focused ? 'border-violet-500 shadow-violet-500/10 shadow-lg' : 'border-subtle',
      )}>
        <div className="flex items-center px-4 py-3 gap-3">
          <svg className={clsx('w-4 h-4 shrink-0 transition-colors duration-200', focused ? 'text-violet-400' : 'text-muted')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search SOP name, tag, or status…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="flex-1 bg-transparent text-sm text-default placeholder:text-muted focus:outline-none"
          />
          <div className="flex items-center gap-2 shrink-0">
            {search ? (
              <button
                onMouseDown={(e) => { e.preventDefault(); handleSearch(''); inputRef.current?.focus() }}
                className="flex items-center gap-1 text-xs text-muted hover:text-red-400 bg-raised hover:bg-red-500/10 border border-default hover:border-red-400/30 px-2 py-1 rounded-lg transition-all"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear
              </button>
            ) : (
              <kbd className={clsx('hidden sm:flex items-center gap-0.5 text-[10px] font-medium text-muted bg-raised border border-subtle px-1.5 py-0.5 rounded-md select-none transition-opacity duration-200', focused ? 'opacity-0' : 'opacity-60')}>
                {shortcutLabel}
              </kbd>
            )}
          </div>
        </div>
      </div>

      {/* Tags + sort + view row */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted shrink-0">Tags:</span>
          <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
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
            {isFiltering && (
              <button onClick={clearAll} className="text-xs text-blue-400 hover:text-blue-300 transition-colors ml-1">
                Clear filters
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SortDropdown value={sortBy} onChange={(k) => { setSortBy(k); setPage(1) }} />
            <div className="flex items-center bg-card border border-subtle rounded-lg overflow-hidden">
              <button onClick={() => setView('grid')} title="Grid view"
                className={clsx('p-1.5 transition-colors', view === 'grid' ? 'bg-blue-600 text-white' : 'text-muted hover:text-secondary hover:bg-raised')}>
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
              <button onClick={() => setView('list')} title="List view"
                className={clsx('p-1.5 transition-colors', view === 'list' ? 'bg-blue-600 text-white' : 'text-muted hover:text-secondary hover:bg-raised')}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-raised border border-subtle flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-secondary mb-1">No SOPs found</p>
          <p className="text-xs text-muted mb-4">Try different keywords or remove some filters</p>
          <button onClick={clearAll} className="text-xs font-medium text-blue-500 hover:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 px-4 py-2 rounded-xl transition-all">
            Clear all filters
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-default">
            {isFiltering
              ? `${sorted.length} SOP${sorted.length !== 1 ? 's' : ''}`
              : `${recordings.length} SOP${recordings.length !== 1 ? 's' : ''}`
            }
          </p>

          {/* Show sort+view here if no tags (otherwise they're in the tags row) */}
          {allTags.length === 0 && (
            <div className="flex items-center justify-end gap-2 -mt-3">
              <SortDropdown value={sortBy} onChange={(k) => { setSortBy(k); setPage(1) }} />
              <div className="flex items-center bg-card border border-subtle rounded-lg overflow-hidden">
                <button onClick={() => setView('grid')} title="Grid view"
                  className={clsx('p-1.5 transition-colors', view === 'grid' ? 'bg-blue-600 text-white' : 'text-muted hover:text-secondary hover:bg-raised')}>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
                <button onClick={() => setView('list')} title="List view"
                  className={clsx('p-1.5 transition-colors', view === 'list' ? 'bg-blue-600 text-white' : 'text-muted hover:text-secondary hover:bg-raised')}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {view === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
              {paginated.map((sop, i) => (
                <div
                  key={sop.id}
                  className="animate-fade-in-up flex h-full"
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
