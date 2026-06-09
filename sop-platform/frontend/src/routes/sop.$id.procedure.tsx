import { createFileRoute, useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback, useRef } from 'react'
import { useSOPStore } from '../hooks/useSOPStore'
import { useStepSync } from '../hooks/useStepSync'
import { useAuth } from '../hooks/useAuth'
import { StepSidebar } from '../components/StepSidebar'
import { StepCard } from '../components/StepCard'
import { VideoPlayer } from '../components/VideoPlayer'
import { TranscriptPanel } from '../components/TranscriptPanel'
import { SOPPageHeader } from '../components/SOPPageHeader'
import { fetchSOP, fetchTranscript, trackView, sopKeys, renderAnnotated } from '../api/client'

export const Route = createFileRoute('/sop/$id/procedure')({
  component: ProcedurePage,
})

function ProcedurePage() {
  const { id } = useParams({ from: '/sop/$id/procedure' })

  const { data: sop } = useQuery({
    queryKey: sopKeys.detail(id),
    queryFn: () => fetchSOP(id),
  })

  const { data: transcriptLines = [] } = useQuery({
    queryKey: sopKeys.transcript(id),
    queryFn: () => fetchTranscript(id),
    enabled: !!sop,
  })

  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const autoRenderFired = useRef(false)

  const { selectedStepId, setSelectedStep } = useSOPStore()
  const { playerRef, handleTimeUpdate, seekTo } = useStepSync(sop?.steps ?? [])

  const steps = sop?.steps ?? []
  const currentIndex = steps.findIndex(s => s.id === selectedStepId)
  const selectedStep = currentIndex >= 0 ? steps[currentIndex] : null

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) setSelectedStep(steps[currentIndex - 1].id)
  }, [currentIndex, steps, setSelectedStep])

  const goToNext = useCallback(() => {
    if (currentIndex < steps.length - 1) setSelectedStep(steps[currentIndex + 1].id)
  }, [currentIndex, steps, setSelectedStep])

  function handleStepDeleted(deletedId: string) {
    const idx = steps.findIndex(s => s.id === deletedId)
    const next = steps[idx + 1] ?? steps[idx - 1] ?? null
    setSelectedStep(next?.id ?? null)
  }

  // Keyboard arrow navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        goToNext()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        goToPrev()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goToPrev, goToNext])

  useEffect(() => {
    const key = `sop_viewed_${id}`
    if (!sessionStorage.getItem(key)) {
      trackView(id).catch(() => {})
      sessionStorage.setItem(key, '1')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (sop && !selectedStepId && sop.steps.length > 0) {
      setSelectedStep(sop.steps[0].id)
    }
  }, [sop, selectedStepId, setSelectedStep])

  // Auto-render annotated screenshots for steps that have callouts but no overlay image yet.
  // On first load after CALLOUT_RENDER_VERSION bump, re-renders ALL steps to pick up visual fixes.
  const CALLOUT_RENDER_VERSION = 'v2'
  useEffect(() => {
    if (!sop || autoRenderFired.current) return
    const role = appUser?.role
    if (role !== 'editor' && role !== 'admin') return

    const versionKey = `callout_rv_${id}`
    const isVersionCurrent = localStorage.getItem(versionKey) === CALLOUT_RENDER_VERSION
    const pending = isVersionCurrent
      ? sop.steps.filter(s => s.callouts.length > 0 && !s.annotated_screenshot_url)
      : sop.steps.filter(s => s.callouts.length > 0)
    if (!isVersionCurrent) localStorage.setItem(versionKey, CALLOUT_RENDER_VERSION)

    if (pending.length === 0) return

    autoRenderFired.current = true
    Promise.all(pending.map(s => renderAnnotated(s.id).catch(() => null))).then(results => {
      if (results.some(Boolean)) {
        queryClient.invalidateQueries({ queryKey: sopKeys.detail(id) })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sop, appUser, id, queryClient])

  if (!sop) return null

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] px-6 py-4">
      <SOPPageHeader sop={sop} />

      <div className="grid grid-cols-[220px_1fr_320px] gap-4 flex-1 min-h-0">
        {/* Left: Steps + Sections sidebar */}
        <div className="overflow-y-auto">
          <StepSidebar steps={sop.steps} sections={sop.sections} sopId={id} />
        </div>

        {/* Center: Video + Transcript */}
        <div className="flex flex-col min-h-0 gap-3 overflow-hidden">
          <VideoPlayer
            step={selectedStep}
            sopVideoUrl={sop.video_url ?? null}
            playerRef={playerRef}
            onTimeUpdate={handleTimeUpdate}
          />
          <div className="flex-1 min-h-0 rounded-lg shadow-sm border border-subtle overflow-hidden">
            <TranscriptPanel lines={transcriptLines} onSeek={seekTo} />
          </div>
        </div>

        {/* Right: Step detail card */}
        <div className="min-h-0 overflow-hidden">
          <StepCard
            step={selectedStep}
            transcriptLines={transcriptLines}
            onSeek={seekTo}
            onDelete={handleStepDeleted}
            onPrev={goToPrev}
            onNext={goToNext}
            currentIndex={currentIndex >= 0 ? currentIndex : undefined}
            totalSteps={steps.length}
          />
        </div>
      </div>
    </div>
  )
}
