import { useState } from 'react'
import clsx from 'clsx'
import { useSOPStore } from '../hooks/useSOPStore'
import type { SOPStep, SOPSection } from '../api/types'

interface Props {
  steps: SOPStep[]
  sections: SOPSection[]
  sopId: string
}

type Filter = 'all' | 'pending' | 'approved'

export function StepSidebar({ steps, sections, sopId }: Props) {
  const { selectedStepId, setSelectedStep } = useSOPStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const visibleSections = sections.filter(s => !s.section_key.startsWith('_'))

  const currentIndex = steps.findIndex(s => s.id === selectedStepId)
  const canPrev = currentIndex > 0
  const canNext = currentIndex >= 0 && currentIndex < steps.length - 1

  const goPrev = () => { if (canPrev) setSelectedStep(steps[currentIndex - 1].id) }
  const goNext = () => { if (canNext) setSelectedStep(steps[currentIndex + 1].id) }

  const approvedCount = steps.filter(s => s.is_approved).length
  const pendingCount = steps.length - approvedCount
  const pct = steps.length > 0 ? Math.round((approvedCount / steps.length) * 100) : 0

  const filtered = steps.filter(step => {
    const matchesSearch = !search || step.title.toLowerCase().includes(search.toLowerCase())
    const matchesFilter =
      filter === 'all' ||
      (filter === 'approved' && step.is_approved) ||
      (filter === 'pending' && !step.is_approved)
    return matchesSearch && matchesFilter
  })

  return (
    <aside className="w-full shrink-0 overflow-hidden flex flex-col gap-2">
      {/* ── Procedure Steps card ── */}
      <div className="bg-card rounded-xl shadow-sm border border-subtle overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-subtle bg-blue-500/10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <svg viewBox="0 0 14 14" fill="currentColor" className="w-3.5 h-3.5 text-blue-500">
                <path fillRule="evenodd" d="M2 2a1 1 0 011-1h8a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V2zm2 1v1h6V3H4zm0 3v1h6V6H4zm0 3v1h4V9H4z" clipRule="evenodd"/>
              </svg>
              <span className="text-xs font-bold text-blue-500 uppercase tracking-wide">
                Procedure Steps
              </span>
            </div>
            <span className="text-xs bg-blue-600 text-white font-bold rounded-full px-2 py-0.5">
              {steps.length}
            </span>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-blue-500/15 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-blue-400 shrink-0">{approvedCount}/{steps.length}</span>
          </div>
        </div>

        {/* Search input */}
        <div className="px-3 pt-2.5 pb-1">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search steps…"
              className="w-full text-xs bg-page text-secondary border border-default rounded-lg pl-7 pr-2 py-1.5 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 placeholder:text-muted"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-secondary"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-3 pb-2">
          {([['all', 'All', steps.length], ['pending', 'Pending', pendingCount], ['approved', 'Done', approvedCount]] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={clsx(
                'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium transition-all',
                filter === key
                  ? key === 'approved'
                    ? 'bg-green-500/15 border-green-500/30 text-green-600'
                    : key === 'pending'
                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-600'
                    : 'bg-blue-500/15 border-blue-500/30 text-blue-600'
                  : 'border-transparent text-muted hover:text-secondary hover:bg-raised',
              )}
            >
              {label}
              <span className={clsx(
                'text-[10px] font-bold px-1 py-0 rounded-full',
                filter === key
                  ? key === 'approved' ? 'bg-green-500/20' : key === 'pending' ? 'bg-amber-500/20' : 'bg-blue-500/20'
                  : 'bg-raised',
              )}>
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Steps list */}
        <ul className="overflow-y-auto max-h-[40vh]">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center">
              <p className="text-xs text-muted">No steps match</p>
            </li>
          ) : filtered.map((step) => {
            const isActive = step.id === selectedStepId
            return (
              <li key={step.id}>
                <button
                  onClick={() => setSelectedStep(step.id)}
                  className={clsx(
                    'w-full text-left px-3 py-2.5 border-l-[3px] flex items-center gap-2.5 transition-all',
                    isActive
                      ? 'bg-blue-500/10 border-blue-500'
                      : 'border-transparent hover:bg-raised hover:border-blue-200',
                  )}
                >
                  <span
                    className={clsx(
                      'shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                      isActive
                        ? 'bg-blue-600 text-white'
                        : step.is_approved
                        ? 'bg-green-500/10 text-green-600'
                        : 'bg-raised text-muted',
                    )}
                  >
                    {step.is_approved && !isActive ? (
                      <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
                        <path fillRule="evenodd" d="M9.707 3.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L5 6.586l3.293-3.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                      </svg>
                    ) : (
                      step.sequence
                    )}
                  </span>
                  <span className={clsx(
                    'truncate leading-snug text-xs',
                    isActive ? 'text-blue-600 font-semibold' : 'text-secondary',
                  )}>
                    {step.title}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {/* Navigation buttons */}
        <div className="px-3 py-2 border-t border-subtle bg-page/60 flex items-center gap-2">
          <button
            onClick={goPrev}
            disabled={!canPrev}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-default text-xs text-muted hover:bg-raised hover:text-blue-600 hover:border-blue-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
            </svg>
            Prev
          </button>
          <button
            onClick={goNext}
            disabled={!canNext}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-default text-xs text-muted hover:bg-raised hover:text-blue-600 hover:border-blue-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            Next
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Sections card ── */}
      {visibleSections.length > 0 && (
        <div className="bg-card rounded-xl shadow-sm border border-subtle overflow-hidden">
          <div className="px-4 py-3 border-b border-subtle bg-violet-500/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <svg viewBox="0 0 14 14" fill="currentColor" className="w-3.5 h-3.5 text-violet-500">
                  <path d="M1 2a1 1 0 011-1h10a1 1 0 010 2H2a1 1 0 01-1-1zm0 4a1 1 0 011-1h10a1 1 0 010 2H2a1 1 0 01-1-1zm0 4a1 1 0 011-1h6a1 1 0 010 2H2a1 1 0 01-1-1z"/>
                </svg>
                <span className="text-xs font-bold text-violet-500 uppercase tracking-wide">
                  Sections
                </span>
              </div>
              <span className="text-xs bg-violet-600 text-white font-bold rounded-full px-2 py-0.5">
                {visibleSections.length}
              </span>
            </div>
          </div>
          <ul className="py-1 overflow-y-auto max-h-[30vh]">
            {visibleSections.map((sec) => (
              <li key={sec.id}>
                <a
                  href={`/sop/${sopId}/overview#section-${sec.section_key}`}
                  className="flex items-center gap-2 px-4 py-2 text-xs text-muted hover:bg-violet-500/10 hover:text-violet-500 transition-colors group border-l-[3px] border-transparent hover:border-violet-400"
                >
                  <svg viewBox="0 0 8 8" fill="currentColor" className="w-1.5 h-1.5 text-violet-300 group-hover:text-violet-500 shrink-0">
                    <circle cx="4" cy="4" r="4"/>
                  </svg>
                  {sec.section_title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
