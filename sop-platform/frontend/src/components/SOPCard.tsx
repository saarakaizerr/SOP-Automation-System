import { useState, useRef, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { SOPListItem, SOPStatus, SOPTag } from '../api/types'
import { deleteSOP, updateSOPTags, sopKeys } from '../api/client'
import { useAuthContext } from '../contexts/AuthContext'

interface Props { sop: SOPListItem }

const TAG_COLOR_MAP: Record<string, string> = {
  blue:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
  purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  green:  'bg-green-500/10 text-green-400 border-green-500/20',
  orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  pink:   'bg-pink-500/10 text-pink-400 border-pink-500/20',
  teal:   'bg-teal-500/10 text-teal-400 border-teal-500/20',
  indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  rose:   'bg-rose-500/10 text-rose-400 border-rose-500/20',
  amber:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
  cyan:   'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
}
const TAG_DOT_MAP: Record<string, string> = {
  blue: 'bg-blue-400', purple: 'bg-purple-400', green: 'bg-green-400',
  orange: 'bg-orange-400', pink: 'bg-pink-400', teal: 'bg-teal-400',
  indigo: 'bg-indigo-400', rose: 'bg-rose-400', amber: 'bg-amber-400', cyan: 'bg-cyan-400',
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
}> = {
  processing: {
    label: 'In Processing',
    heroBg: 'bg-gradient-to-br from-violet-500/15 to-indigo-500/8',
    borderLeft: 'border-l-violet-500',
    badge: 'bg-violet-500/15 text-violet-400 border-violet-500/25',
    dot: 'bg-violet-400 animate-pulse',
    hoverShadow: 'hover:shadow-violet-500/15',
    hoverBorder: 'hover:border-violet-500/40',
  },
  draft: {
    label: 'Draft',
    heroBg: 'bg-gradient-to-br from-amber-500/10 to-orange-500/5',
    borderLeft: 'border-l-amber-500',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    dot: 'bg-amber-400',
    hoverShadow: 'hover:shadow-amber-400/10',
    hoverBorder: 'hover:border-amber-400/30',
  },
  in_review: {
    label: 'In Review',
    heroBg: 'bg-gradient-to-br from-blue-500/15 to-cyan-500/8',
    borderLeft: 'border-l-blue-500',
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    dot: 'bg-blue-400',
    hoverShadow: 'hover:shadow-blue-500/15',
    hoverBorder: 'hover:border-blue-500/40',
  },
  published: {
    label: 'Published',
    heroBg: 'bg-gradient-to-br from-emerald-500/15 to-teal-500/8',
    borderLeft: 'border-l-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    dot: 'bg-emerald-400',
    hoverShadow: 'hover:shadow-emerald-500/15',
    hoverBorder: 'hover:border-emerald-500/40',
  },
  archived: {
    label: 'Archived',
    heroBg: 'bg-gradient-to-br from-gray-500/10 to-gray-600/5',
    borderLeft: 'border-l-gray-500',
    badge: 'bg-raised text-muted border-default',
    dot: 'bg-gray-400',
    hoverShadow: 'hover:shadow-gray-400/10',
    hoverBorder: 'hover:border-gray-400/20',
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
  'transcribing', 'detecting_screenshare', 'extracting_frames', 'deduplicating',
  'classifying_frames', 'generating_annotations', 'extracting_clips', 'generating_sections',
]

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

  const isPipelineRunning = sop.pipeline_status
    && sop.pipeline_status !== 'completed'
    && sop.pipeline_status !== 'failed'

  const pipelineIdx = PIPELINE_STAGES.indexOf(sop.pipeline_status ?? '')
  const pipelinePct = pipelineIdx < 0 ? 5 : Math.round(((pipelineIdx + 1) / PIPELINE_STAGES.length) * 100)
  const ringCirc = 2 * Math.PI * 21
  const ringOffset = ringCirc * (1 - pipelinePct / 100)

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
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-4 flex items-start gap-3">
        {isPipelineRunning ? (
          <div className="relative shrink-0 w-12 h-12 mt-0.5">
            <svg className="absolute inset-0 w-12 h-12 -rotate-90" viewBox="0 0 48 48"
              style={{ filter: 'drop-shadow(0 0 5px rgba(139,92,246,0.5))' }}>
              <circle cx="24" cy="24" r="21" fill="none" strokeWidth="4" stroke="rgba(139,92,246,0.15)" />
              <circle cx="24" cy="24" r="21" fill="none" strokeWidth="4" stroke="url(#ring-grad)"
                strokeDasharray={ringCirc} strokeDashoffset={ringOffset}
                strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.7s ease' }} />
              <defs>
                <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#6366f1" />
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
        ) : (
          <div className={clsx(
            'shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
            'text-white text-xs font-bold shadow-md bg-gradient-to-br mt-0.5',
            'transition-transform duration-200 group-hover:scale-105', grad,
          )}>
            <Initials name={displayName} />
          </div>
        )}
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
        <svg
          className="shrink-0 w-4 h-4 text-muted opacity-30 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all mt-1"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* ── Footer ────────────────────────────────────────────── */}
      <div className="mt-auto px-5 pb-4 pt-3 border-t border-subtle" onClick={e => e.stopPropagation()}>
        {sop.pipeline_status === 'failed' && (
          <div className="mb-3 flex items-center gap-2 text-xs text-red-500 font-medium bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            Pipeline failed — please re-process
          </div>
        )}

        {/* Tags */}
        {(tags.length > 0 || canEdit) && (
          <div className="flex flex-wrap gap-1.5 items-center mb-3">
            {tags.map(tag => (
              <span key={tag.name}
                className={clsx('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium', tagClasses(tag.color))}>
                {canEdit && (
                  <button title="Change colour" onClick={e => cycleColor(tag.name, e)}
                    className={clsx('w-2.5 h-2.5 rounded-full shrink-0 hover:scale-125 transition-transform', TAG_DOT_MAP[tag.color] ?? 'bg-blue-400')} />
                )}
                {tag.name}
                {canEdit && (
                  <button onClick={e => removeTag(tag.name, e)} className="opacity-40 hover:opacity-100 leading-none ml-0.5 transition-opacity">×</button>
                )}
              </span>
            ))}
            {canEdit && (
              addingTag ? (
                <div className="w-full mt-1 p-3 bg-raised border border-default rounded-xl shadow-lg" onClick={e => e.stopPropagation()}>
                  <div className="mb-2.5">
                    <span className={clsx('inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium', tagClasses(tagColor))}>
                      <span className={clsx('w-2 h-2 rounded-full', TAG_DOT_MAP[tagColor])} />
                      {tagInput.trim() || 'preview'}
                    </span>
                  </div>
                  <input ref={tagInputRef} value={tagInput}
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
                      <button key={c} onClick={e => { e.stopPropagation(); setTagColor(c) }} title={c}
                        className={clsx('w-5 h-5 rounded-full transition-all hover:scale-110', TAG_DOT_MAP[c], tagColor === c ? 'ring-2 ring-offset-1 ring-current scale-110' : 'opacity-50 hover:opacity-100')} />
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={e => { e.stopPropagation(); commitTag() }} disabled={!tagInput.trim()}
                      className="flex-1 text-xs py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium transition-colors">Add tag</button>
                    <button onClick={e => { e.stopPropagation(); setAddingTag(false); setTagInput(''); setTagColor('blue') }}
                      className="text-xs px-3 py-1.5 border border-default rounded-lg text-muted hover:bg-raised transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={openTagInput}
                  className="text-xs px-2.5 py-1 border border-dashed border-default rounded-full text-muted hover:border-blue-400/50 hover:text-blue-400 transition-all">
                  + Add tag
                </button>
              )
            )}
          </div>
        )}

        {/* Meta + actions */}
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
                {sop.meeting_date && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {formatDate(sop.meeting_date)}
                  </span>
                )}
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
                      <div className="absolute right-0 bottom-full mb-1.5 z-20 bg-card border border-default rounded-xl shadow-xl overflow-hidden min-w-[140px]"
                        onClick={e => e.stopPropagation()}>
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
              <span className="text-xs text-muted">Delete this SOP?</span>
              <div className="flex items-center gap-1.5">
                <button onClick={e => { e.stopPropagation(); setConfirming(false) }}
                  className="text-xs px-2.5 py-1.5 border border-default rounded-lg text-muted hover:bg-raised transition-colors">Cancel</button>
                <button onClick={e => { e.stopPropagation(); deleteMutation.mutate() }}
                  disabled={deleteMutation.isPending}
                  className="text-xs px-2.5 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 active:scale-95 transition-all font-medium disabled:opacity-60">
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
