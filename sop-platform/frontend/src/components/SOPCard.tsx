import { useState, useRef, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { SOPListItem, SOPStatus, SOPTag } from '../api/types'
import { deleteSOP, updateSOPTags, startPipeline, pausePipeline, resumePipeline, sopKeys } from '../api/client'
import { useAuthContext } from '../contexts/AuthContext'

interface Props { sop: SOPListItem }

const TAG_COLOR_MAP: Record<string, string> = {
  blue:   'bg-blue-500/12 text-blue-600 border-blue-500/30',
  purple: 'bg-purple-500/12 text-purple-600 border-purple-500/30',
  green:  'bg-green-500/12 text-green-600 border-green-500/30',
  orange: 'bg-orange-500/12 text-orange-600 border-orange-500/30',
  pink:   'bg-pink-500/12 text-pink-600 border-pink-500/30',
  teal:   'bg-teal-500/12 text-teal-600 border-teal-500/30',
  indigo: 'bg-indigo-500/12 text-indigo-600 border-indigo-500/30',
  rose:   'bg-rose-500/12 text-rose-600 border-rose-500/30',
  amber:  'bg-amber-500/12 text-amber-600 border-amber-500/30',
  cyan:   'bg-cyan-500/12 text-cyan-600 border-cyan-500/30',
}
const TAG_DOT_MAP: Record<string, string> = {
  blue: 'bg-blue-500', purple: 'bg-purple-500', green: 'bg-green-500',
  orange: 'bg-orange-500', pink: 'bg-pink-500', teal: 'bg-teal-500',
  indigo: 'bg-indigo-500', rose: 'bg-rose-500', amber: 'bg-amber-500', cyan: 'bg-cyan-500',
}
const TAG_COLOR_KEYS = Object.keys(TAG_COLOR_MAP)
function tagClasses(color: string) { return TAG_COLOR_MAP[color] ?? TAG_COLOR_MAP.blue }
function nextColor(current: string) {
  const idx = TAG_COLOR_KEYS.indexOf(current)
  return TAG_COLOR_KEYS[(idx + 1) % TAG_COLOR_KEYS.length]
}

const statusConfig: Record<SOPStatus, {
  label: string
  heroBg: string
  borderLeft: string
  badge: string
  dot: string
  hoverShadow: string
  hoverBorder: string
  progressBar: string
}> = {
  uploaded: {
    label: 'Ready to Process',
    heroBg: 'from-indigo-500/10 to-violet-500/5',
    borderLeft: 'border-l-indigo-400',
    badge: 'bg-indigo-500/12 text-indigo-600 border-indigo-500/25',
    dot: 'bg-indigo-400',
    hoverShadow: 'hover:shadow-indigo-500/15',
    hoverBorder: 'hover:border-indigo-500/40',
    progressBar: 'from-indigo-400 to-violet-400',
  },
  processing: {
    label: 'In Processing',
    heroBg: 'from-violet-500/12 to-indigo-500/6',
    borderLeft: 'border-l-violet-500',
    badge: 'bg-violet-500/15 text-violet-600 border-violet-500/30',
    dot: 'bg-violet-500 animate-pulse',
    hoverShadow: 'hover:shadow-violet-500/15',
    hoverBorder: 'hover:border-violet-500/40',
    progressBar: 'from-violet-500 to-indigo-400',
  },
  draft: {
    label: 'Draft',
    heroBg: 'from-amber-500/12 to-orange-500/6',
    borderLeft: 'border-l-amber-500',
    badge: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    dot: 'bg-amber-500',
    hoverShadow: 'hover:shadow-amber-500/15',
    hoverBorder: 'hover:border-amber-500/30',
    progressBar: 'from-amber-500 to-orange-400',
  },
  in_review: {
    label: 'In Review',
    heroBg: 'from-blue-500/12 to-cyan-500/6',
    borderLeft: 'border-l-blue-500',
    badge: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
    dot: 'bg-blue-500',
    hoverShadow: 'hover:shadow-blue-500/15',
    hoverBorder: 'hover:border-blue-500/40',
    progressBar: 'from-blue-500 to-cyan-400',
  },
  published: {
    label: 'Published',
    heroBg: 'from-emerald-500/12 to-teal-500/6',
    borderLeft: 'border-l-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
    dot: 'bg-emerald-500',
    hoverShadow: 'hover:shadow-emerald-500/15',
    hoverBorder: 'hover:border-emerald-500/40',
    progressBar: 'from-emerald-500 to-teal-400',
  },
  archived: {
    label: 'Archived',
    heroBg: 'from-gray-500/8 to-gray-600/4',
    borderLeft: 'border-l-gray-400',
    badge: 'bg-raised text-muted border-default',
    dot: 'bg-gray-400',
    hoverShadow: 'hover:shadow-gray-400/10',
    hoverBorder: 'hover:border-gray-400/20',
    progressBar: 'from-gray-400 to-gray-500',
  },
}

const AVATAR_GRADIENTS = [
  'from-violet-500 to-indigo-600', 'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',  'from-teal-500 to-green-600',
  'from-indigo-500 to-purple-600', 'from-pink-500 to-rose-600',
  'from-cyan-500 to-blue-600',     'from-orange-500 to-red-600',
]
function avatarGrad(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}

const PIPELINE_STAGES = [
  'queued', 'transcribing', 'detecting_screenshare', 'extracting_frames', 'deduplicating',
  'classifying_frames', 'generating_annotations', 'extracting_clips', 'generating_sections',
]

// Groups stages by workflow so the timer resets once per workflow, not per stage
const STAGE_WORKFLOW: Record<string, number> = {
  queued:                 1, // WF0 — ingest & transcription
  transcribing:           1,
  detecting_screenshare:  2, // WF2 — frame extraction
  extracting_frames:      2,
  deduplicating:          2,
  classifying_frames:     2, // WF2 sets this at end; WF3c picks up from here
  generating_annotations: 3, // WF3c — annotation
  extracting_clips:       4, // WF4 — clips
  generating_sections:    5, // WF5b — SOP content
}

const STAGE_LABELS: Record<string, string> = {
  queued:                 'Waiting to start…',
  transcribing:           'Transcribing audio',
  detecting_screenshare:  'Analysing screen recording',
  extracting_frames:      'Capturing screenshots',
  deduplicating:          'Capturing & filtering screenshots',
  classifying_frames:     'Filtering screenshots',
  generating_annotations: 'Generating callouts',
  extracting_clips:       'Creating video clips',
  generating_sections:    'Writing SOP content',
}

function formatElapsed(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function Initials({ name }: { name: string }) {
  const words = name.trim().split(/\s+/).filter(w => /[a-zA-Z0-9]/.test(w[0]))
  const letters = words.length >= 2
    ? `${words[0][0]}${words[1][0]}`
    : name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2)
  return <>{letters.toUpperCase()}</>
}

function formatDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function SOPCard({ sop }: Props) {
  const navigate = useNavigate()
  const { appUser } = useAuthContext()
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addingTag, setAddingTag] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tagColor, setTagColor] = useState('blue')
  const tagInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const cfg = statusConfig[sop.status] ?? statusConfig.draft
  const grad = avatarGrad(sop.id)
  const canEdit = appUser?.role === 'editor' || appUser?.role === 'admin'
  const tags: SOPTag[] = sop.tags || []

  const TERMINAL_STATUSES = ['completed', 'failed', 'awaiting_approval', 'paused']
  const isPipelineRunning = Boolean(sop.pipeline_status && !TERMINAL_STATUSES.includes(sop.pipeline_status))
  const isPaused = sop.pipeline_status === 'paused'

  // When paused, pipeline_stage holds the pre-pause status for display + % calculation
  const displayStatus = isPaused ? (sop.pipeline_stage ?? '') : (sop.pipeline_status ?? '')
  const pipelineIdx = PIPELINE_STAGES.indexOf(displayStatus)
  const pipelinePct = pipelineIdx < 0 ? 5 : Math.round(((pipelineIdx + 1) / PIPELINE_STAGES.length) * 100)
  const ringCirc = 2 * Math.PI * 21
  const ringOffset = ringCirc * (1 - pipelinePct / 100)
  const stageLabel = STAGE_LABELS[displayStatus] ?? displayStatus.replace(/_/g, ' ')

  const [elapsed, setElapsed] = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wfStartRef = useRef<number>(Date.now())

  const currentWorkflow = STAGE_WORKFLOW[sop.pipeline_status ?? ''] ?? null
  const storageKey = `wf_timer_${sop.id}`

  useEffect(() => {
    if (!isPipelineRunning) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      if (!isPaused) sessionStorage.removeItem(storageKey) // keep stored time while paused
      return
    }

    // Restore or initialise the per-workflow start time
    const stored = sessionStorage.getItem(storageKey)
    const parsed = stored ? (JSON.parse(stored) as { workflow: number; startTime: number }) : null

    let startTime: number
    if (parsed && parsed.workflow === currentWorkflow) {
      // Same workflow as before (or after a refresh) — resume from stored start
      startTime = parsed.startTime
    } else {
      // New workflow started — reset
      startTime = Date.now()
      sessionStorage.setItem(storageKey, JSON.stringify({ workflow: currentWorkflow, startTime }))
    }

    wfStartRef.current = startTime
    setElapsed(Math.floor((Date.now() - startTime) / 1000))

    if (tickRef.current) clearInterval(tickRef.current)
    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - wfStartRef.current) / 1000))
    }, 1000)
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }
  }, [isPipelineRunning, isPaused, currentWorkflow, storageKey])

  const cleanTitle = sop.title.replace(/\b\d{8}\s+\d{6}\b/g, '').replace(/\s{2,}/g, ' ').trim()
  const displayName = sop.process_name || cleanTitle

  const deleteMutation = useMutation({
    mutationFn: () => deleteSOP(sop.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: sopKeys.all }),
  })
  const tagMutation = useMutation({
    mutationFn: (newTags: SOPTag[]) => updateSOPTags(sop.id, newTags),
    onSuccess: () => qc.invalidateQueries({ queryKey: sopKeys.all }),
  })
  const startMutation = useMutation({
    mutationFn: () => startPipeline(sop.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: sopKeys.all }),
  })
  const pauseMutation = useMutation({
    mutationFn: () => pausePipeline(sop.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: sopKeys.all }),
  })
  const resumeMutation = useMutation({
    mutationFn: () => resumePipeline(sop.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: sopKeys.all }),
  })

  function removeTag(name: string, e: React.MouseEvent) {
    e.stopPropagation()
    tagMutation.mutate(tags.filter(t => t.name !== name))
  }
  function cycleColor(name: string, e: React.MouseEvent) {
    e.stopPropagation()
    tagMutation.mutate(tags.map(t => t.name === name ? { ...t, color: nextColor(t.color) } : t))
  }
  function commitTag() {
    const val = tagInput.trim()
    if (val && !tags.find(t => t.name === val)) {
      tagMutation.mutate([...tags, { name: val, color: tagColor }])
    }
    setTagInput(''); setTagColor('blue'); setAddingTag(false)
  }
  function openTagInput(e: React.MouseEvent) {
    e.stopPropagation(); setAddingTag(true)
    setTimeout(() => tagInputRef.current?.focus(), 0)
  }
  function openCard() {
    navigate({ to: '/sop/$id/procedure', params: { id: sop.id } })
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard() } }}
      className={clsx(
        'group relative bg-card rounded-2xl border border-subtle cursor-pointer',
        'hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 overflow-hidden',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        'flex flex-col h-full w-full border-l-4',
        cfg.borderLeft, cfg.hoverBorder, cfg.hoverShadow,
      )}
    >
      {/* ── Pipeline progress strip (top edge, visible for processing/paused SOPs) ── */}
      {(isPipelineRunning || isPaused) && (
        <div className={clsx('h-0.5 w-full shrink-0', isPaused ? 'bg-amber-500/15' : 'bg-violet-500/15')}>
          <div
            className={clsx('h-full bg-gradient-to-r transition-all duration-700 ease-out', isPaused ? 'from-amber-400 to-orange-400' : cfg.progressBar)}
            style={{ width: `${pipelinePct}%` }}
          />
        </div>
      )}

      {/* ── Header (coloured hero gradient background) ─────────────────────── */}
      <div className={clsx(
        'px-5 pt-4 pb-3 flex items-start gap-3 bg-gradient-to-br shrink-0',
        cfg.heroBg,
      )}>
        {/* Avatar / pipeline ring */}
        {(isPipelineRunning || isPaused) ? (
          <div className="shrink-0 flex flex-col items-center gap-0.5 mt-0.5">
            <div className="relative w-12 h-12">
              <svg
                className="absolute inset-0 w-12 h-12 -rotate-90"
                viewBox="0 0 48 48"
                style={{ filter: isPaused ? 'drop-shadow(0 0 5px rgba(245,158,11,0.5))' : 'drop-shadow(0 0 5px rgba(139,92,246,0.5))' }}
              >
                <circle cx="24" cy="24" r="21" fill="none" strokeWidth="4" stroke={isPaused ? 'rgba(245,158,11,0.15)' : 'rgba(139,92,246,0.15)'} />
                <circle
                  cx="24" cy="24" r="21" fill="none" strokeWidth="4" stroke={isPaused ? 'url(#ring-grad-paused)' : 'url(#ring-grad)'}
                  strokeDasharray={ringCirc} strokeDashoffset={ringOffset}
                  strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.7s ease' }}
                />
                <defs>
                  <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#8b5cf6" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                  <linearGradient id="ring-grad-paused" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#f97316" />
                  </linearGradient>
                </defs>
              </svg>
              <div className={clsx(
                'absolute top-1 left-1 w-10 h-10 rounded-full flex items-center justify-center',
                'text-white text-xs font-bold bg-gradient-to-br shadow-md', grad,
              )}>
                <Initials name={displayName} />
              </div>
            </div>
            <span className={clsx('text-[9px] font-medium text-center leading-tight tabular-nums', isPaused ? 'text-amber-500' : 'text-violet-600')}>
              {pipelinePct}%
            </span>
          </div>
        ) : (
          <div className={clsx(
            'shrink-0 w-10 h-10 rounded-full flex items-center justify-center mt-0.5',
            'text-white text-xs font-bold shadow-md bg-gradient-to-br',
            'transition-transform duration-200 group-hover:scale-105', grad,
          )}>
            <Initials name={displayName} />
          </div>
        )}

        {/* Title + status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-default leading-snug line-clamp-2 flex-1">
              {displayName}
            </h3>
            <span className={clsx(
              'text-xs font-medium px-2.5 py-1 rounded-full border flex items-center gap-1.5 shrink-0 whitespace-nowrap',
              cfg.badge,
            )}>
              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
              {cfg.label}
            </span>
          </div>
          {sop.client_name && (
            <p className="text-xs text-muted mt-1 truncate">{sop.client_name}</p>
          )}
        </div>

        {/* Chevron */}
        <svg
          className="shrink-0 w-4 h-4 text-muted opacity-30 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all mt-1"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* ── Processing info row ──────────────────────────────────────────────── */}
      {isPipelineRunning && (
        <div className="px-4 py-2 flex items-center justify-between bg-violet-500/5 border-b border-violet-500/10 shrink-0 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <svg className="w-3 h-3 text-violet-500 shrink-0 animate-spin" style={{ animationDuration: '3s' }} fill="none" viewBox="0 0 24 24">
              <path stroke="currentColor" strokeWidth={2} strokeLinecap="round" d="M12 3a9 9 0 100 18A9 9 0 0012 3z" opacity={0.25}/>
              <path stroke="currentColor" strokeWidth={2} strokeLinecap="round" d="M12 3a9 9 0 019 9"/>
            </svg>
            <span className="text-[11px] text-violet-600 font-semibold shrink-0 tabular-nums">{pipelinePct}%</span>
            <span className="text-[11px] text-violet-500/70 truncate">{stageLabel}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sop.pipeline_started_at && (
              <div className="flex items-center gap-1">
                <svg className="w-3 h-3 text-violet-400/70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="9"/><path strokeLinecap="round" d="M12 7v5l3 3"/>
                </svg>
                <span className="text-[11px] text-violet-400 font-mono tabular-nums">{formatElapsed(elapsed)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Paused state row ─────────────────────────────────────────────────── */}
      {isPaused && (
        <div className="px-4 py-2 flex items-center justify-between bg-amber-500/5 border-b border-amber-500/15 shrink-0 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <svg className="w-3 h-3 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
            <span className="text-[11px] text-amber-600 font-semibold shrink-0">Paused</span>
            <span className="text-[11px] text-amber-500/70 truncate">{stageLabel}</span>
          </div>
          {canEdit && (
            <button
              onClick={e => { e.stopPropagation(); resumeMutation.mutate() }}
              disabled={resumeMutation.isPending}
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 bg-amber-500 text-white rounded-md hover:bg-amber-400 active:scale-95 transition-all disabled:opacity-60 shrink-0"
            >
              {resumeMutation.isPending ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5 3l14 9-14 9V3z"/>
                </svg>
              )}
              {resumeMutation.isPending ? 'Resuming…' : 'Resume'}
            </button>
          )}
        </div>
      )}

      {/* ── Tags — flex-1 fills remaining space so footer border-t stays aligned ── */}
      <div className="flex-1 px-5 py-2" onClick={e => e.stopPropagation()}>
        {(tags.length > 0 || canEdit) && (
          <div className="flex flex-wrap gap-1.5 items-center">
            {tags.map(tag => (
              <span
                key={tag.name}
                className={clsx('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium', tagClasses(tag.color))}
              >
                {canEdit && (
                  <button
                    title="Change colour"
                    onClick={e => cycleColor(tag.name, e)}
                    className={clsx('w-2.5 h-2.5 rounded-full shrink-0 hover:scale-125 transition-transform', TAG_DOT_MAP[tag.color] ?? 'bg-blue-400')}
                  />
                )}
                {tag.name}
                {canEdit && (
                  <button onClick={e => removeTag(tag.name, e)} className="opacity-40 hover:opacity-100 leading-none ml-0.5 transition-opacity">×</button>
                )}
              </span>
            ))}

            {canEdit && (
              addingTag ? (
                <div
                  className="w-full mt-1 p-3 bg-raised border border-default rounded-xl shadow-lg"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="mb-2.5">
                    <span className={clsx('inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium', tagClasses(tagColor))}>
                      <span className={clsx('w-2 h-2 rounded-full', TAG_DOT_MAP[tagColor])} />
                      {tagInput.trim() || 'preview'}
                    </span>
                  </div>
                  <input
                    ref={tagInputRef}
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitTag() }
                      if (e.key === 'Escape') { setAddingTag(false); setTagInput(''); setTagColor('blue') }
                    }}
                    placeholder="Tag name…"
                    className="w-full text-xs px-2.5 py-1.5 border border-default rounded-lg outline-none focus:border-blue-400 mb-2.5 bg-transparent text-default"
                  />
                  <div className="flex gap-1.5 mb-3">
                    {TAG_COLOR_KEYS.map(c => (
                      <button
                        key={c}
                        onClick={e => { e.stopPropagation(); setTagColor(c) }}
                        title={c}
                        className={clsx('w-5 h-5 rounded-full transition-all hover:scale-110', TAG_DOT_MAP[c], tagColor === c ? 'ring-2 ring-offset-1 ring-current scale-110' : 'opacity-50 hover:opacity-100')}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={e => { e.stopPropagation(); commitTag() }}
                      disabled={!tagInput.trim()}
                      className="flex-1 text-xs py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium transition-colors"
                    >Add tag</button>
                    <button
                      onClick={e => { e.stopPropagation(); setAddingTag(false); setTagInput(''); setTagColor('blue') }}
                      className="text-xs px-3 py-1.5 border border-default rounded-lg text-muted hover:bg-raised transition-colors"
                    >Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={openTagInput}
                  className="text-xs px-2.5 py-1 border border-dashed border-default rounded-full text-muted hover:border-blue-400/50 hover:text-blue-400 transition-all"
                >
                  + Add tag
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* ── Footer — shrink-0 + border-t ensures consistent alignment across rows ── */}
      <div className="shrink-0 px-5 pb-4 pt-3 border-t border-subtle" onClick={e => e.stopPropagation()}>
        {sop.status === 'uploaded' && canEdit && (
          <div className="mb-3">
            <button
              onClick={e => { e.stopPropagation(); startMutation.mutate() }}
              disabled={startMutation.isPending}
              className="w-full flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-500 active:scale-95 transition-all disabled:opacity-60"
            >
              {startMutation.isPending ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                </svg>
              )}
              {startMutation.isPending ? 'Starting pipeline…' : 'Start Processing'}
            </button>
          </div>
        )}

        {sop.pipeline_status === 'failed' && (
          <div className="mb-3 flex items-start gap-2 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
            <svg className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="min-w-0">
              <p className="text-xs text-red-500 font-medium">Pipeline failed</p>
              {sop.pipeline_error && (
                <p className="text-[11px] text-red-400/80 mt-0.5 line-clamp-2 break-words">{sop.pipeline_error}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          {!confirming ? (
            <>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  {sop.step_count} {sop.step_count === 1 ? 'step' : 'steps'}
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {formatDate(sop.meeting_date ?? sop.created_at)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={e => { e.stopPropagation(); openCard() }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 active:scale-95 transition-all font-medium"
                >
                  Open
                  <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
                {canEdit && (
                  <div ref={menuRef} className="relative">
                    <button
                      onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
                      className="w-7 h-7 flex items-center justify-center border border-default rounded-lg text-muted hover:bg-raised active:scale-95 transition-all"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>
                    {menuOpen && (
                      <div
                        className="absolute right-0 bottom-full mb-1.5 z-20 bg-card border border-default rounded-xl shadow-xl overflow-hidden min-w-[140px]"
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={e => { e.stopPropagation(); setMenuOpen(false); setConfirming(true) }}
                          className="w-full text-left text-xs px-3 py-2.5 text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete SOP
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="min-w-0">
                {(isPipelineRunning || isPaused) ? (
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <span className="text-xs text-amber-600 font-medium">Pipeline is running — delete will stop it</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted">Delete this SOP?</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={e => { e.stopPropagation(); setConfirming(false) }}
                  className="text-xs px-2.5 py-1.5 border border-default rounded-lg text-muted hover:bg-raised transition-colors"
                >Cancel</button>
                <button
                  onClick={e => { e.stopPropagation(); deleteMutation.mutate() }}
                  disabled={deleteMutation.isPending}
                  className="text-xs px-2.5 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 active:scale-95 transition-all font-medium disabled:opacity-60"
                >
                  {deleteMutation.isPending ? 'Deleting…' : (isPipelineRunning || isPaused) ? 'Stop & Delete' : 'Delete'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
