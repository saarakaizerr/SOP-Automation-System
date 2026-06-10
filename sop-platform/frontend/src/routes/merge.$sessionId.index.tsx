import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchMergeSession, fetchSOP, sopKeys } from '../api/client'
import { ProtectedRoute } from '../components/ProtectedRoute'
import { PageLoader, PageError } from '../components/PageLoader'
import type { MergeStepDecision } from '../api/types'

export const Route = createFileRoute('/merge/$sessionId/')({
  component: () => (
    <ProtectedRoute requiredRole="editor">
      <DiffReviewPage />
    </ProtectedRoute>
  ),
})

const STATUS_COLORS: Record<string, string> = {
  unchanged: 'border-default bg-page',
  changed:   'border-yellow-500/30 bg-yellow-500/10',
  added:     'border-green-500/30 bg-green-500/10',
  removed:   'border-red-500/30 bg-red-500/10',
}

const STATUS_BADGE: Record<string, string> = {
  unchanged: 'bg-raised text-muted',
  changed:   'bg-yellow-500/15 text-yellow-600',
  added:     'bg-green-500/15 text-green-600',
  removed:   'bg-red-500/15 text-red-600',
}

type Decision = 'accept_updated' | 'keep_base' | 'include' | 'exclude'
type Filter = 'changes' | 'all' | 'added' | 'removed' | 'changed'

function DiffReviewPage() {
  const { sessionId } = Route.useParams()
  const navigate = useNavigate()
  const listRef = useRef<HTMLDivElement>(null)

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ['merge-session', sessionId],
    queryFn: () => fetchMergeSession(sessionId),
  })

  const { data: baseSop } = useQuery({
    queryKey: session ? sopKeys.detail(session.base_sop_id) : ['noop'],
    queryFn: () => fetchSOP(session!.base_sop_id),
    enabled: !!session,
  })

  const { data: updatedSop } = useQuery({
    queryKey: session ? sopKeys.detail(session.updated_sop_id) : ['noop'],
    queryFn: () => fetchSOP(session!.updated_sop_id),
    enabled: !!session,
  })

  const [decisions, setDecisions] = useState<Record<number, Decision>>(() => {
    const stored = sessionStorage.getItem(`merge-decisions-${sessionId}`)
    return stored ? JSON.parse(stored) : {}
  })

  const [filter, setFilter] = useState<Filter>('changes')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 10

  useEffect(() => {
    if (!session || Object.keys(decisions).length > 0) return
    const initial: Record<number, Decision> = {}
    // Only auto-accept unchanged steps — added/removed/changed require manual review
    session.matches.forEach((m, i) => {
      if (m.status === 'unchanged') initial[i] = 'accept_updated'
    })
    setDecisions(initial)
  }, [session])

  useEffect(() => {
    if (Object.keys(decisions).length > 0)
      sessionStorage.setItem(`merge-decisions-${sessionId}`, JSON.stringify(decisions))
  }, [decisions, sessionId])

  const stepById: Record<string, { title: string; description: string | null }> = {}
  baseSop?.steps.forEach(s => { stepById[s.id] = s })
  updatedSop?.steps.forEach(s => { stepById[s.id] = s })

  const changedUnresolved = session?.matches
    .filter((m, i) => m.status !== 'unchanged' && decisions[i] === undefined)
    .length ?? 0

  const buildFinalSteps = (): MergeStepDecision[] => {
    if (!session) return []
    const steps: MergeStepDecision[] = []
    session.matches.forEach((m, i) => {
      const decision = decisions[i]
      if (m.status === 'unchanged' && m.updated_step_id) {
        steps.push({ step_id: m.updated_step_id, source: 'updated' })
      } else if (m.status === 'changed') {
        if (decision === 'keep_base' && m.base_step_id) {
          steps.push({ step_id: m.base_step_id, source: 'base' })
        } else if (m.updated_step_id) {
          steps.push({ step_id: m.updated_step_id, source: 'updated' })
        }
      } else if (m.status === 'added' && decision === 'include' && m.updated_step_id) {
        steps.push({ step_id: m.updated_step_id, source: 'updated' })
      } else if (m.status === 'removed' && decision === 'include' && m.base_step_id) {
        steps.push({ step_id: m.base_step_id, source: 'base' })
      }
    })
    return steps
  }

  const canProceed = changedUnresolved === 0

  const counts = session ? {
    added:     session.matches.filter(m => m.status === 'added').length,
    removed:   session.matches.filter(m => m.status === 'removed').length,
    changed:   session.matches.filter(m => m.status === 'changed').length,
    unchanged: session.matches.filter(m => m.status === 'unchanged').length,
    total:     session.matches.length,
  } : { added: 0, removed: 0, changed: 0, unchanged: 0, total: 0 }

  const changesCount = counts.added + counts.removed + counts.changed

  const visibleIndices = session?.matches
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => {
      if (filter === 'all') return true
      if (filter === 'changes') return m.status !== 'unchanged'
      return m.status === filter
    }) ?? []

  const totalPages = Math.ceil(visibleIndices.length / PAGE_SIZE)
  const pagedIndices = visibleIndices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const toggleExpand = useCallback((i: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }, [])

  function jumpToNext() {
    if (!session) return
    const nextIdx = visibleIndices.find(({ m }) => m.status === 'changed')?.i
      ?? visibleIndices[0]?.i
    if (nextIdx === undefined) return
    const el = document.getElementById(`step-card-${nextIdx}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function batchDecide(status: 'added' | 'removed' | 'changed', dec: Decision) {
    if (!session) return
    setDecisions(prev => {
      const next = { ...prev }
      session.matches.forEach((m, i) => { if (m.status === status) next[i] = dec })
      return next
    })
  }

  if (sessionLoading) return <PageLoader label="Loading diff…" />
  if (!session) return <PageError message="Session not found or has expired." />

  const FILTER_TABS: { key: Filter; label: string; count: number }[] = [
    { key: 'changes', label: 'Changes only', count: changesCount },
    { key: 'all',     label: 'All steps',    count: counts.total },
    { key: 'added',   label: 'Added',        count: counts.added },
    { key: 'removed', label: 'Removed',      count: counts.removed },
    { key: 'changed', label: 'Modified',     count: counts.changed },
  ]

  return (
    <div className="max-w-4xl mx-auto py-8 pb-28 space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/merge" search={{ tab: 'groups' }} className="flex items-center gap-1.5 text-sm text-muted hover:text-gray-800 bg-card border border-default hover:border-default px-3 py-1.5 rounded-lg transition-colors shadow-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Back
        </Link>
        <h1 className="text-2xl font-bold text-default">Review Changes</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-card rounded-xl border border-subtle p-4">
          <p className="text-xs font-medium text-muted uppercase mb-1">Original</p>
          <p className="font-medium text-secondary truncate">{baseSop?.title}</p>
          <p className="text-xs text-muted">{baseSop?.meeting_date}</p>
        </div>
        <div className="bg-card rounded-xl border border-subtle p-4">
          <p className="text-xs font-medium text-muted uppercase mb-1">Updated</p>
          <p className="font-medium text-secondary truncate">{updatedSop?.title}</p>
          <p className="text-xs text-muted">{updatedSop?.meeting_date}</p>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setFilter(tab.key); setPage(0) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === tab.key
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-card border-default text-muted hover:border-purple-400 hover:text-purple-500'
            }`}
          >
            {tab.label}
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
              filter === tab.key ? 'bg-white/20 text-white' : 'bg-raised text-muted'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Batch actions */}
      {(counts.added > 0 || counts.removed > 0 || counts.changed > 0) && (
        <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-raised border border-default">
          <span className="text-xs text-muted self-center mr-1">Batch:</span>
          {counts.added > 0 && (
            <>
              <button onClick={() => batchDecide('added', 'include')} className="text-xs px-2.5 py-1 rounded-lg border border-green-500/30 text-green-600 hover:bg-green-500/10 transition-colors font-medium">
                Include all added ({counts.added})
              </button>
              <button onClick={() => batchDecide('added', 'exclude')} className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors font-medium">
                Exclude all added
              </button>
            </>
          )}
          {counts.removed > 0 && (
            <>
              <button onClick={() => batchDecide('removed', 'include')} className="text-xs px-2.5 py-1 rounded-lg border border-green-500/30 text-green-600 hover:bg-green-500/10 transition-colors font-medium">
                Include all removed ({counts.removed})
              </button>
              <button onClick={() => batchDecide('removed', 'exclude')} className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors font-medium">
                Exclude all removed
              </button>
            </>
          )}
          {counts.changed > 0 && (
            <button onClick={() => batchDecide('changed', 'accept_updated')} className="text-xs px-2.5 py-1 rounded-lg border border-yellow-500/30 text-yellow-600 hover:bg-yellow-500/10 transition-colors font-medium">
              Accept all modified ({counts.changed})
            </button>
          )}
        </div>
      )}

      {visibleIndices.length === 0 && (
        <div className="text-center py-12 text-muted text-sm">No steps match this filter.</div>
      )}

      <div ref={listRef} className="space-y-2">
        {pagedIndices.map(({ m: match, i }) => {
          const baseStep    = match.base_step_id    ? stepById[match.base_step_id]    : null
          const updatedStep = match.updated_step_id ? stepById[match.updated_step_id] : null
          const decision    = decisions[i]
          const isOpen      = expanded.has(i)
          const stepTitle   = match.status === 'removed' ? baseStep?.title : updatedStep?.title

          return (
            <div id={`step-card-${i}`} key={i} className={`rounded-xl border transition-all ${STATUS_COLORS[match.status]}`}>

              {/* Row — always visible */}
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none" onClick={() => toggleExpand(i)}>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[match.status]}`}>
                  {match.status}
                </span>
                <span className="text-sm font-medium text-secondary flex-1">{stepTitle}</span>

                <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                  {match.status === 'changed' && (
                    <>
                      <button onClick={() => setDecisions(prev => ({ ...prev, [i]: 'accept_updated' }))}
                        className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${decision === 'accept_updated' ? 'bg-green-600 text-white border-green-600' : 'border-default text-muted hover:border-green-400 hover:text-green-600'}`}>
                        Accept updated
                      </button>
                      <button onClick={() => setDecisions(prev => ({ ...prev, [i]: 'keep_base' }))}
                        className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${decision === 'keep_base' ? 'bg-amber-500 text-white border-amber-500' : 'border-default text-muted hover:border-amber-400 hover:text-amber-600'}`}>
                        Keep original
                      </button>
                    </>
                  )}
                  {(match.status === 'added' || match.status === 'removed') && (
                    <>
                      <button onClick={() => setDecisions(prev => ({ ...prev, [i]: 'include' }))}
                        className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${decision === 'include' ? 'bg-blue-600 text-white border-blue-600' : 'border-default text-muted hover:border-blue-400 hover:text-blue-600'}`}>
                        Include
                      </button>
                      <button onClick={() => setDecisions(prev => ({ ...prev, [i]: 'exclude' }))}
                        className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${decision === 'exclude' ? 'bg-red-500 text-white border-red-500' : 'border-default text-muted hover:border-red-400 hover:text-red-500'}`}>
                        Exclude
                      </button>
                    </>
                  )}
                </div>

                <svg className={`w-3.5 h-3.5 text-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-white/5 space-y-3">
                  {match.status === 'changed' && (
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-red-600">Original</p>
                        <p className="text-sm font-medium text-secondary">{baseStep?.title}</p>
                        <p className="text-xs text-muted leading-relaxed">{baseStep?.description}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-green-600">Updated</p>
                        <p className="text-sm font-medium text-secondary">{updatedStep?.title}</p>
                        <p className="text-xs text-muted leading-relaxed">{updatedStep?.description}</p>
                      </div>
                    </div>
                  )}
                  {match.status === 'added' && updatedStep?.description && (
                    <p className="text-xs text-muted leading-relaxed mt-2">{updatedStep.description}</p>
                  )}
                  {match.status === 'removed' && baseStep?.description && (
                    <p className="text-xs text-muted leading-relaxed mt-2">{baseStep.description}</p>
                  )}
                  {match.status === 'unchanged' && updatedStep?.description && (
                    <p className="text-xs text-muted leading-relaxed mt-2">{updatedStep.description}</p>
                  )}

                  {/* Context hint */}
                  {match.status === 'added' && (
                    <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/15">
                      <svg className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <p className="text-xs text-blue-600 leading-relaxed">This step only exists in the <strong>updated SOP</strong>. Include it if this new step should be part of the merged procedure.</p>
                    </div>
                  )}
                  {match.status === 'removed' && (
                    <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
                      <svg className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      <p className="text-xs text-amber-600 leading-relaxed">This step only exists in the <strong>original SOP</strong> — it was removed in the updated version. Include it if it's still relevant, or exclude if the updated process no longer needs it.</p>
                    </div>
                  )}
                  {match.status === 'changed' && (
                    <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/15">
                      <svg className="w-3.5 h-3.5 text-yellow-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      <p className="text-xs text-yellow-700 leading-relaxed">This step was <strong>modified</strong> between versions. Accept the updated version if the changes are correct, or keep the original if you prefer the previous wording.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, visibleIndices.length)} of {visibleIndices.length} steps
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setPage(p => p - 1); listRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
              disabled={page === 0}
              className="px-3 py-1.5 text-xs border border-default rounded-lg text-muted hover:bg-raised disabled:opacity-30 transition-colors"
            >
              ← Prev
            </button>
            {Array.from({ length: totalPages }, (_, p) => (
              <button
                key={p}
                onClick={() => { setPage(p); listRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
                className={`w-7 h-7 text-xs rounded-lg border font-medium transition-colors ${p === page ? 'bg-purple-600 text-white border-purple-600' : 'border-default text-muted hover:bg-raised'}`}
              >
                {p + 1}
              </button>
            ))}
            <button
              onClick={() => { setPage(p => p + 1); listRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
              disabled={page === totalPages - 1}
              className="px-3 py-1.5 text-xs border border-default rounded-lg text-muted hover:bg-raised disabled:opacity-30 transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-default bg-card/95 backdrop-blur-sm shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted shrink-0">
              <span className="font-semibold text-default">{changesCount - changedUnresolved}</span>
              <span>of</span>
              <span className="font-semibold text-default">{changesCount}</span>
              <span>decided</span>
            </div>
            <div className="w-32 h-1.5 bg-raised rounded-full overflow-hidden hidden sm:block">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-300"
                style={{ width: changesCount > 0 ? `${((changesCount - changedUnresolved) / changesCount) * 100}%` : '0%' }}
              />
            </div>
            {counts.unchanged > 0 && (
              <span className="text-xs text-muted hidden md:block">{counts.unchanged} unchanged auto-accepted</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {changesCount > 0 && (
              <button
                onClick={jumpToNext}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-500 border border-purple-500/30 rounded-lg hover:bg-purple-500/10 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                Jump to next
              </button>
            )}
            {changedUnresolved > 0 && (
              <p className="text-xs text-amber-600 hidden sm:block">{changedUnresolved} need decision</p>
            )}
            <button
              onClick={() => {
                sessionStorage.setItem(`merge-steps-${sessionId}`, JSON.stringify(buildFinalSteps()))
                navigate({ to: '/merge/$sessionId/preview', params: { sessionId } })
              }}
              disabled={!canProceed}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-purple-600 rounded-xl hover:bg-purple-700 disabled:opacity-40 transition-colors"
            >
              Next: Preview
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
