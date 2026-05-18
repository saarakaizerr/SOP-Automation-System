import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SOPStep, TranscriptLine } from '../api/types'
import { useAuth } from '../hooks/useAuth'
import { approveStep, renameStep, updateSubSteps, updateStepDescription, deleteStep, sopKeys } from '../api/client'
import { CalloutList } from './CalloutList'
import { DiscussionCard } from './DiscussionCard'
import { ScreenshotModal } from './ScreenshotModal'
import { AnnotationEditorModal } from './AnnotationEditorModal'

interface Props {
  step: SOPStep | null
  transcriptLines: TranscriptLine[]
  onSeek: (seconds: number) => void
  onDelete?: (stepId: string) => void
  onPrev?: () => void
  onNext?: () => void
  currentIndex?: number
  totalSteps?: number
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

function getKTLines(step: SOPStep, lines: TranscriptLine[]): TranscriptLine[] {
  const end = step.timestamp_end ?? Infinity
  const inRange = lines.filter(l => l.timestamp_sec >= step.timestamp_start && l.timestamp_sec <= end)
  if (inRange.length > 0) return inRange.slice(0, 3)
  const nearest = [...lines].sort((a, b) =>
    Math.abs(a.timestamp_sec - step.timestamp_start) - Math.abs(b.timestamp_sec - step.timestamp_start)
  )[0]
  return nearest ? [nearest] : []
}

function Section({ icon, label, children, accent = 'gray' }: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  accent?: 'gray' | 'blue' | 'violet' | 'amber' | 'green'
}) {
  const accentMap = {
    gray:   'text-muted bg-raised',
    blue:   'text-blue-500 bg-blue-500/10',
    violet: 'text-violet-500 bg-violet-500/10',
    amber:  'text-amber-500 bg-amber-500/10',
    green:  'text-green-500 bg-green-500/10',
  }
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${accentMap[accent]}`}>
          {icon}
        </span>
        <h4 className="text-xs font-semibold text-muted uppercase tracking-wide">{label}</h4>
      </div>
      {children}
    </div>
  )
}

export function StepCard({ step, transcriptLines, onSeek, onDelete, onPrev, onNext, currentIndex, totalSteps }: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [renamingTitle, setRenamingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [editingSubSteps, setEditingSubSteps] = useState(false)
  const [subStepInputs, setSubStepInputs] = useState<string[]>([])
  const [editingDesc, setEditingDesc] = useState(false)
  const [descInput, setDescInput] = useState('')
  const descRef = useRef<HTMLTextAreaElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { appUser } = useAuth()
  const qc = useQueryClient()
  const canEdit = appUser?.role === 'editor' || appUser?.role === 'admin'

  const updateCache = (updated: SOPStep | null) => {
    if (!updated) return
    qc.setQueryData<any>(sopKeys.detail(updated.sop_id), (old: any) =>
      old ? { ...old, steps: old.steps.map((s: SOPStep) => s.id === updated.id ? updated : s) } : old
    )
  }

  const subStepsMutation = useMutation({
    mutationFn: (items: string[]) => updateSubSteps(step!.id, items),
    onSuccess: (u) => { updateCache(u); setEditingSubSteps(false) },
  })
  const renameMutation = useMutation({
    mutationFn: (title: string) => renameStep(step!.id, title),
    onSuccess: (u) => { updateCache(u); setRenamingTitle(false) },
  })
  const descMutation = useMutation({
    mutationFn: (desc: string) => updateStepDescription(step!.id, desc),
    onSuccess: (u) => { updateCache(u); setEditingDesc(false) },
  })
  const approveMutation = useMutation({
    mutationFn: () => approveStep(step!.id),
    onSuccess: (u) => {
      updateCache(u)
      if (u) qc.invalidateQueries({ queryKey: sopKeys.metrics(u.sop_id) })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteStep(step!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sopKeys.detail(step!.sop_id) })
      onDelete?.(step!.id)
      setConfirmDelete(false)
    },
  })

  useEffect(() => {
    if (renamingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [renamingTitle])

  useEffect(() => {
    if (editingDesc && descRef.current) {
      descRef.current.focus()
      descRef.current.setSelectionRange(descRef.current.value.length, descRef.current.value.length)
    }
  }, [editingDesc])

  // Reset editing states when step changes
  useEffect(() => {
    setRenamingTitle(false)
    setEditingDesc(false)
    setEditingSubSteps(false)
    setConfirmDelete(false)
  }, [step?.id])

  if (!step) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted bg-card rounded-xl border border-subtle shadow-sm p-8">
        <svg viewBox="0 0 48 48" fill="none" className="w-12 h-12">
          <rect x="8" y="8" width="32" height="32" rx="6" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
          <path d="M16 22h16M16 28h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
        </svg>
        <div>
          <p className="text-sm font-medium text-muted">No step selected</p>
          <p className="text-xs mt-0.5">Click a step in the sidebar to view details</p>
        </div>
      </div>
    )
  }

  const cacheBuster = step.updated_at ? `&_t=${new Date(step.updated_at).getTime()}` : ''
  const screenshotUrl = step.annotated_screenshot_url
    ? `${step.annotated_screenshot_url}${cacheBuster}`
    : step.screenshot_url
  const subSteps = Array.isArray(step.sub_steps) ? (step.sub_steps as string[]) : []
  const ktLines = getKTLines(step, transcriptLines)

  return (
    <div className="bg-card rounded-xl shadow-sm border border-subtle overflow-y-auto h-full flex flex-col">
      {/* ── Step header ──────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2.5 border-b border-subtle shrink-0">
        {/* Navigation row */}
        {totalSteps !== undefined && currentIndex !== undefined && (
          <div className="flex items-center justify-between mb-2.5">
            <button
              onClick={onPrev}
              disabled={currentIndex <= 0}
              className="flex items-center gap-1 text-xs text-muted hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded-lg hover:bg-blue-500/10"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
              </svg>
              Prev
            </button>
            <span className="text-xs text-muted font-medium">
              Step <span className="text-default font-semibold">{currentIndex + 1}</span> of {totalSteps}
            </span>
            <button
              onClick={onNext}
              disabled={currentIndex >= totalSteps - 1}
              className="flex items-center gap-1 text-xs text-muted hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded-lg hover:bg-blue-500/10"
            >
              Next
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        )}

        <div className="flex items-start gap-3">
          {/* Number badge */}
          <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shadow-sm ${
            step.is_approved ? 'bg-green-500 text-white' : 'bg-blue-600 text-white'
          }`}>
            {step.is_approved
              ? <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M12.5 4.5a1 1 0 00-1.414-1.414L6 8.172 4.914 7.086A1 1 0 103.5 8.5l2 2a1 1 0 001.414 0l6-6z" clipRule="evenodd"/></svg>
              : step.sequence
            }
          </span>

          <div className="flex-1 min-w-0">
            {renamingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  ref={titleInputRef}
                  value={titleInput}
                  onChange={e => setTitleInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') renameMutation.mutate(titleInput.trim())
                    if (e.key === 'Escape') setRenamingTitle(false)
                  }}
                  className="flex-1 text-sm font-semibold bg-input text-default border border-violet-300 rounded-lg px-2.5 py-1 outline-none focus:ring-1 focus:ring-violet-400/50"
                />
                <button
                  onClick={() => renameMutation.mutate(titleInput.trim())}
                  disabled={renameMutation.isPending || !titleInput.trim()}
                  className="text-xs px-2.5 py-1 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 font-medium"
                >
                  {renameMutation.isPending ? '…' : 'Save'}
                </button>
                <button onClick={() => setRenamingTitle(false)} className="text-xs px-2 py-1 border border-default rounded-lg text-muted hover:bg-raised">✕</button>
              </div>
            ) : (
              <div className="flex items-start gap-1.5">
                <h2 className="text-sm font-semibold text-default leading-snug">{step.title}</h2>
                {canEdit && (
                  <button
                    onClick={() => { setTitleInput(step.title); setRenamingTitle(true) }}
                    className="mt-0.5 shrink-0 text-gray-300 hover:text-violet-500 transition-colors"
                    title="Rename step"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Timestamp chip */}
            <button
              onClick={() => onSeek(step.timestamp_start)}
              className="mt-1.5 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium bg-blue-500/10 px-2 py-0.5 rounded-full hover:bg-blue-500/15 transition-colors"
            >
              <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5">
                <path d="M6 0a6 6 0 110 12A6 6 0 016 0zm0 1.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM5.25 3.75a.75.75 0 011.5 0V6h1.5a.75.75 0 010 1.5H6a.75.75 0 01-.75-.75V3.75z"/>
              </svg>
              Play from {formatTime(step.timestamp_start)}
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

        {/* Description */}
        <div>
          {editingDesc ? (
            <div className="space-y-2">
              <textarea
                ref={descRef}
                value={descInput}
                onChange={e => setDescInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') setEditingDesc(false)
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) descMutation.mutate(descInput.trim())
                }}
                rows={4}
                placeholder="Describe this step…"
                className="w-full text-sm bg-input text-secondary border border-violet-300 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-violet-400/50 resize-none leading-relaxed"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => descMutation.mutate(descInput.trim())}
                  disabled={descMutation.isPending}
                  className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 font-medium"
                >
                  {descMutation.isPending ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingDesc(false)} className="text-xs px-3 py-1.5 border border-default rounded-lg text-muted hover:bg-raised">Cancel</button>
                <span className="text-[10px] text-muted ml-auto">Ctrl+Enter to save</span>
              </div>
            </div>
          ) : step.description ? (
            <div className="group relative">
              <p className="text-sm text-secondary leading-relaxed">{step.description}</p>
              {canEdit && (
                <button
                  onClick={() => { setDescInput(step.description ?? ''); setEditingDesc(true) }}
                  className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-violet-500 transition-all"
                  title="Edit description"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                  </svg>
                </button>
              )}
            </div>
          ) : canEdit ? (
            <button
              onClick={() => { setDescInput(''); setEditingDesc(true) }}
              className="text-xs text-muted hover:text-violet-500 flex items-center gap-1 transition-colors border border-dashed border-default rounded-lg px-3 py-2 w-full"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
              Add description…
            </button>
          ) : null}
        </div>

        {/* Screenshot */}
        {screenshotUrl && (
          <div className="rounded-lg overflow-hidden border border-default shadow-sm">
            <div className="relative group cursor-pointer bg-raised" onClick={() => setModalOpen(true)}>
              <img
                src={screenshotUrl}
                alt={`Step ${step.sequence} screenshot`}
                className="w-full object-contain"
                style={{ maxHeight: '160px', display: 'block' }}
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M7 11a4 4 0 100-8 4 4 0 000 8zm0-1.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/>
                    <path d="M13.5 13.5l-2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Expand
                </span>
              </div>
            </div>
            {canEdit && (
              <div className="px-3 py-1.5 bg-page border-t border-subtle flex justify-end">
                <button
                  onClick={() => setEditorOpen(true)}
                  className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                  </svg>
                  Edit Callouts
                </button>
              </div>
            )}
          </div>
        )}

        {/* Sub-steps */}
        {(subSteps.length > 0 || canEdit) && (
          <Section
            accent="blue"
            label="Sub-steps"
            icon={<svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3"><path d="M2 2h8a1 1 0 010 2H2a1 1 0 010-2zm0 4h8a1 1 0 010 2H2a1 1 0 010-2zm0 4h5a1 1 0 010 2H2a1 1 0 010-2z"/></svg>}
          >
            {editingSubSteps ? (
              <div className="space-y-2">
                {subStepInputs.map((val, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted w-4 shrink-0 text-right">{i + 1}.</span>
                    <input
                      value={val}
                      onChange={e => setSubStepInputs(prev => prev.map((s, idx) => idx === i ? e.target.value : s))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); setSubStepInputs(prev => [...prev.slice(0, i + 1), '', ...prev.slice(i + 1)]) }
                        if (e.key === 'Backspace' && !val && subStepInputs.length > 1) { e.preventDefault(); setSubStepInputs(prev => prev.filter((_, idx) => idx !== i)) }
                      }}
                      className="flex-1 text-sm bg-input text-secondary border border-default rounded-lg px-2.5 py-1 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30"
                      placeholder={`Sub-step ${i + 1}`}
                      autoFocus={i === subStepInputs.length - 1 && val === ''}
                    />
                    <button onClick={() => setSubStepInputs(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-300 hover:text-red-400 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
                <button onClick={() => setSubStepInputs(prev => [...prev, ''])} className="text-xs text-violet-600 hover:text-violet-700 flex items-center gap-1 mt-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                  Add sub-step
                </button>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => subStepsMutation.mutate(subStepInputs)} disabled={subStepsMutation.isPending} className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 font-medium">
                    {subStepsMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingSubSteps(false)} className="text-xs px-3 py-1.5 border border-default rounded-lg text-muted hover:bg-raised">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="relative">
                {canEdit && subSteps.length > 0 && (
                  <button
                    onClick={() => { setSubStepInputs([...subSteps]); setEditingSubSteps(true) }}
                    className="absolute top-0 right-0 text-gray-300 hover:text-violet-500 transition-colors"
                    title="Edit sub-steps"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                  </button>
                )}
                {subSteps.length > 0 ? (
                  <ol className="space-y-1.5">
                    {subSteps.map((s, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-secondary">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-blue-500/10 text-blue-500 text-xs font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
                        <span className="leading-snug pt-0.5">{s}</span>
                      </li>
                    ))}
                  </ol>
                ) : canEdit ? (
                  <button
                    onClick={() => { setSubStepInputs(['']); setEditingSubSteps(true) }}
                    className="text-xs text-muted hover:text-violet-500 flex items-center gap-1 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                    Add sub-steps
                  </button>
                ) : null}
              </div>
            )}
          </Section>
        )}

        {/* KT session quotes */}
        {ktLines.length > 0 && (
          <Section
            accent="amber"
            label="From the KT Session"
            icon={<svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3"><path d="M10 1H2a1 1 0 00-1 1v6a1 1 0 001 1h1v2l3-2h4a1 1 0 001-1V2a1 1 0 00-1-1z"/></svg>}
          >
            <div className="space-y-2.5 bg-amber-500/10 rounded-xl p-3 border border-amber-500/20">
              {ktLines.map(l => (
                <div key={l.id} className="flex items-start gap-2">
                  <span className="text-amber-300 text-lg leading-none mt-0.5 shrink-0">"</span>
                  <div>
                    <p className="text-sm text-secondary leading-snug italic">{l.content}</p>
                    <p className="text-xs text-amber-600 font-medium mt-0.5">{l.speaker}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Callouts */}
        {step.callouts.length > 0 && (
          <Section
            accent="violet"
            label="Callouts"
            icon={<svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M6 4v3M6 8.5v.5"/></svg>}
          >
            <CalloutList callouts={step.callouts} />
          </Section>
        )}

        {/* Discussions */}
        {step.discussions.length > 0 && (
          <Section
            accent="gray"
            label="Discussion"
            icon={<svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3"><path d="M10 1H2a1 1 0 00-1 1v5a1 1 0 001 1h1v2l2.5-2H10a1 1 0 001-1V2a1 1 0 00-1-1z"/></svg>}
          >
            <div className="space-y-2">
              {step.discussions.map(d => <DiscussionCard key={d.id} discussion={d} />)}
            </div>
          </Section>
        )}
      </div>

      {/* ── Footer: approve + delete ─────────────────────────────── */}
      {canEdit && (
        <div className="px-4 py-2.5 border-t border-subtle bg-page shrink-0 space-y-2">
          {/* Approve button */}
          <button
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending || deleteMutation.isPending}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ${
              step.is_approved
                ? 'bg-green-500/10 border border-green-500/30 text-green-600 hover:bg-green-500/15'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {approveMutation.isPending ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor" className={`w-4 h-4 ${step.is_approved ? 'text-green-600' : 'text-white'}`}>
                <path fillRule="evenodd" d="M12.5 4.5a1 1 0 00-1.414-1.414L6 8.172 4.914 7.086A1 1 0 103.5 8.5l2 2a1 1 0 001.414 0l6-6z" clipRule="evenodd"/>
              </svg>
            )}
            {step.is_approved ? 'Approved' : 'Mark as Approved'}
          </button>

          {/* Delete — confirm inline */}
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-xs text-red-600 font-medium">Delete this step?</span>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-all"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-default text-muted hover:bg-raised transition-all"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-1.5 rounded-xl text-xs font-medium border border-default text-muted hover:border-red-500/30 hover:text-red-500 hover:bg-red-500/10 transition-all"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H3a1 1 0 000 2h.09l.676 7.44A2 2 0 005.76 15h4.48a2 2 0 001.994-1.56L12.91 6H13a1 1 0 100-2h-2V3a1 1 0 00-1-1H6zm1 2h2V3H7v1zm-1.91 2h7.82l-.637 7H5.727L5.09 6z" clipRule="evenodd"/>
              </svg>
              Delete step
            </button>
          )}
        </div>
      )}

      {/* Modals */}
      {modalOpen && screenshotUrl && (
        <ScreenshotModal src={screenshotUrl} alt={`Step ${step.sequence} screenshot`} onClose={() => setModalOpen(false)} />
      )}
      {editorOpen && canEdit && (step.screenshot_url || screenshotUrl) && (
        <AnnotationEditorModal
          sopId={step.sop_id}
          stepId={step.id}
          stepTitle={step.title}
          stepNumber={step.sequence}
          screenshotUrl={step.screenshot_url ?? screenshotUrl!}
          callouts={step.callouts}
          highlight_boxes={step.highlight_boxes || []}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  )
}
