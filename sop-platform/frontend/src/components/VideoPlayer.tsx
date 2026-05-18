import { useEffect, useRef } from 'react'
import videojs from 'video.js'
import type Player from 'video.js/dist/types/player'
import 'video.js/dist/video-js.css'
import type { SOPStep } from '../api/types'
import { useSOPStore } from '../hooks/useSOPStore'

interface Props {
  step: SOPStep | null
  sopVideoUrl: string | null
  playerRef: React.MutableRefObject<Player | null>
  onTimeUpdate: (time: number) => void
}

export function VideoPlayer({ step, sopVideoUrl, playerRef, onTimeUpdate }: Props) {
  const { videoMode, setVideoMode } = useSOPStore()
  const videoElRef = useRef<HTMLVideoElement>(null)

  const clipUrl = step?.clips?.[0]?.clip_url ?? null
  const hasFullVideo = !!sopVideoUrl
  const currentSrc = videoMode === 'clip' ? clipUrl : sopVideoUrl

  // Initialise Video.js once on mount
  // <video> element is always in DOM so videojs() always finds videoElRef.current
  useEffect(() => {
    if (!videoElRef.current) return

    const player = videojs(videoElRef.current, {
      controls: true,
      preload: 'auto',
      fill: true,
    })

    playerRef.current = player

    player.on('timeupdate', () => {
      onTimeUpdate(player.currentTime() ?? 0)
    })

    return () => {
      player.dispose()
      playerRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Swap source only when it actually changes — prevents unnecessary restarts
  useEffect(() => {
    if (!playerRef.current || !currentSrc) return
    const existingSrc = playerRef.current.currentSrc()
    if (existingSrc === currentSrc) return
    playerRef.current.src([{ src: currentSrc, type: 'video/mp4' }])
    if (videoMode === 'clip') {
      playerRef.current.play()?.catch(() => {/* autoplay may be blocked by browser */})
    }
  }, [currentSrc, videoMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // On step change in full video mode — seek to step start
  useEffect(() => {
    if (!playerRef.current || videoMode !== 'full' || !step) return
    playerRef.current.currentTime(step.timestamp_start)
  }, [step?.id, videoMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const renderFallback = () => {
    const imgUrl = step?.annotated_screenshot_url ?? step?.screenshot_url ?? null
    if (imgUrl) {
      return (
        <div className="relative">
          <img src={imgUrl} className="w-full rounded" alt="Screenshot" />
          {videoMode === 'clip' && (
            <span className="absolute top-2 right-2 bg-raised text-muted text-xs px-2 py-1 rounded-full border border-default">
              No clip for this step
            </span>
          )}
        </div>
      )
    }
    return (
      <div className="bg-raised rounded-lg p-8 border border-dashed border-gray-300 text-center">
        <p className="text-sm text-muted">Screenshot available after pipeline processing</p>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-lg shadow-sm border border-subtle overflow-hidden shrink-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-subtle bg-page">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">
          {videoMode === 'clip' ? 'Step Clip' : 'Full Recording'}
        </span>
        {/* Pill toggle */}
        <div className="flex items-center bg-raised border border-default rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => setVideoMode('clip')}
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md font-medium transition-all ${
              videoMode === 'clip'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-muted hover:text-secondary'
            }`}
          >
            <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
              <path d="M2 2a1 1 0 00-1 1v6a1 1 0 001 1h6a1 1 0 001-1V3a1 1 0 00-1-1H2zm7.5 1.5l2-1.5v8l-2-1.5V3.5z"/>
            </svg>
            Clip
          </button>
          <button
            onClick={() => setVideoMode('full')}
            disabled={!hasFullVideo}
            title={!hasFullVideo ? 'Full video not available' : undefined}
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              videoMode === 'full'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-muted hover:text-secondary'
            }`}
          >
            <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
              <path d="M2 2a1 1 0 00-1 1v6a1 1 0 001 1h8a1 1 0 001-1V3a1 1 0 00-1-1H2zm7.5 1.5l1.5-1v7l-1.5-1V3.5z"/>
            </svg>
            Full
          </button>
        </div>
      </div>
      <div className="p-3">
        {/* Fixed height so transcript panel gets enough space below */}
        <div
          className={currentSrc ? 'w-full bg-black' : 'hidden'}
          style={{ height: '220px' }}
        >
          <div data-vjs-player style={{ width: '100%', height: '100%' }}>
            <video ref={videoElRef} className="video-js vjs-big-play-centered" />
          </div>
        </div>
        {!currentSrc && renderFallback()}
      </div>
    </div>
  )
}
