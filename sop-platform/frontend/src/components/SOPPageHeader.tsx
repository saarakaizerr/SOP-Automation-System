import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SOPDetail } from '../api/types'
import { exportSOP, updateSOPStatus, fetchMetrics, toggleLike, sopKeys } from '../api/client'
import { useAuth } from '../hooks/useAuth'

interface Props {
  sop: SOPDetail
}

const STATUS_STYLES: Record<string, string> = {
  published:   'bg-green-500/10 text-green-600 border-green-500/30',
  draft:       'bg-amber-500/10 text-amber-600 border-amber-500/30',
  in_review:   'bg-blue-500/10 text-blue-600 border-blue-500/30',
  processing:  'bg-purple-500/10 text-purple-600 border-purple-500/30',
  archived:    'bg-raised text-muted border-default',
}

const ALL_STATUSES = ['draft', 'in_review', 'published', 'archived'] as const

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function SOPPageHeader({ sop }: Props) {
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const { appUser } = useAuth()
  const canChangeStatus = appUser?.role === 'editor' || appUser?.role === 'admin'
  const qc = useQueryClient()

  // Engagement metrics — views + likes for all roles
  const { data: metrics } = useQuery({
    queryKey: sopKeys.metrics(sop.id),
    queryFn: () => fetchMetrics(sop.id),
  })

  const likeMutation = useMutation({
    mutationFn: () => toggleLike(sop.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: sopKeys.metrics(sop.id) }),
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateSOPStatus(sop.id, status),
    onSuccess: (_, status) => {
      qc.invalidateQueries({ queryKey: sopKeys.detail(sop.id) })
      showToast(`Status updated to ${status.replace('_', ' ')}`)
      setStatusOpen(false)
    },
    onError: () => showToast('Failed to update status', 'err'),
  })

  function showToast(msg: string, type: 'ok' | 'err' = 'ok', duration = 2800) {
    setToast({ msg, type })
    if (duration > 0) setTimeout(() => setToast(null), duration)
  }

  async function handleExport(format: 'docx' | 'pdf') {
    setExporting(format)
    showToast('Generating document — this may take a minute…', 'ok', 0)
    try {
      const { download_url, filename } = await exportSOP(sop.id, format)
      const a = document.createElement('a')
      a.href = download_url
      a.download = filename
      a.click()
      showToast('Download started!')
    } catch {
      showToast('Export failed — please try again', 'err')
    } finally {
      setExporting(null)
    }
  }

  function handleShare() {
    navigator.clipboard.writeText(window.location.href)
    showToast('Link copied to clipboard!')
  }

  const dateStr = sop.meeting_date ? formatDate(sop.meeting_date) : formatDate(sop.updated_at)
  const statusLabel = sop.status.replace('_', ' ')
  const statusStyle = STATUS_STYLES[sop.status] ?? STATUS_STYLES.draft
  const approvedCount = sop.steps.filter(s => s.is_approved).length
  const totalSteps = sop.steps.length
  const approvalPct = totalSteps > 0 ? Math.round((approvedCount / totalSteps) * 100) : 0

  return (
    <div className="shrink-0 mb-3">
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-page border border-default rounded-lg">

        {/* Left: status + meta + engagement */}
        <div className="flex items-center gap-3 flex-wrap min-w-0">

          {/* Status badge — dropdown for editor/admin */}
          {canChangeStatus ? (
            <div className="relative">
              <button
                onClick={() => setStatusOpen(o => !o)}
                className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md border capitalize transition-all hover:opacity-80 ${statusStyle}`}
              >
                {statusLabel}
                <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 opacity-60">
                  <path d="M2 4l4 4 4-4"/>
                </svg>
              </button>
              {statusOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-default rounded-lg shadow-lg py-1 min-w-[130px]">
                    {ALL_STATUSES.map(s => (
                      <button
                        key={s}
                        onClick={() => statusMutation.mutate(s)}
                        disabled={s === sop.status || statusMutation.isPending}
                        className={`w-full text-left px-3 py-1.5 text-xs capitalize transition-colors ${
                          s === sop.status ? 'text-muted cursor-default' : 'text-secondary hover:bg-raised'
                        }`}
                      >
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${
                          s === 'published' ? 'bg-green-500' :
                          s === 'draft' ? 'bg-amber-500' :
                          s === 'in_review' ? 'bg-blue-500' : 'bg-gray-400'
                        }`} />
                        {s.replace('_', ' ')}
                        {s === sop.status && ' ✓'}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-md border capitalize ${statusStyle}`}>
              {statusLabel}
            </span>
          )}

          <span className="text-gray-300 text-xs">|</span>

          {/* Date */}
          {dateStr && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-muted shrink-0">
                <path fillRule="evenodd" d="M5 1a1 1 0 00-1 1v1H3a2 2 0 00-2 2v9a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2h-1V2a1 1 0 10-2 0v1H5V2a1 1 0 00-1-1zM3 7h10v7H3V7z" clipRule="evenodd"/>
              </svg>
              {dateStr}
            </span>
          )}

          {/* Client */}
          {sop.client_name && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-muted shrink-0">
                <path d="M8 8a3 3 0 100-6 3 3 0 000 6zM2 13a6 6 0 0112 0H2z"/>
              </svg>
              {sop.client_name}
            </span>
          )}

          {/* Steps approved — editors/admins only */}
          {canChangeStatus && totalSteps > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-muted shrink-0">
                <path fillRule="evenodd" d="M12.5 4.5a1 1 0 00-1.414-1.414L6 8.172 4.914 7.086A1 1 0 103.5 8.5l2 2a1 1 0 001.414 0l6-6z" clipRule="evenodd"/>
              </svg>
              {approvedCount}/{totalSteps} approved
              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${approvalPct === 100 ? 'bg-green-500' : 'bg-blue-400'}`}
                  style={{ width: `${approvalPct}%` }} />
              </div>
            </span>
          )}

          <span className="text-gray-300 text-xs">|</span>

          {/* Views */}
          <span className="flex items-center gap-1 text-xs text-muted">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-muted shrink-0">
              <path d="M8 10a2 2 0 100-4 2 2 0 000 4z"/>
              <path fillRule="evenodd" d="M.458 8C1.732 4.943 5.522 2 8 2s6.268 2.943 7.542 6c-1.274 3.057-5.064 6-7.542 6S1.732 11.057.458 8zM12 8a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
            </svg>
            {metrics?.view_count ?? 0} views
          </span>

          {/* Like button — interactive for all */}
          <button
            onClick={() => likeMutation.mutate()}
            disabled={likeMutation.isPending}
            className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border transition-all active:scale-95 ${
              metrics?.user_liked
                ? 'bg-red-500/10 border-red-500/30 text-red-600 hover:bg-red-500/15'
                : 'bg-card border-default text-muted hover:bg-raised hover:border-red-500/30 hover:text-red-500'
            }`}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 transition-transform ${metrics?.user_liked ? 'scale-110 text-red-500' : 'text-muted'}`}>
              <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd"/>
            </svg>
            {metrics?.like_count ?? 0}
          </button>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => handleExport('docx')}
            disabled={exporting !== null}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-default rounded-md text-muted hover:bg-raised hover:border-default hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {exporting === 'docx' ? (
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-blue-500">
                <path d="M8 1a1 1 0 011 1v5.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 011.414-1.414L7 7.586V2a1 1 0 011-1z"/>
                <path d="M2 11a1 1 0 011-1h10a1 1 0 110 2H3a1 1 0 01-1-1z"/>
              </svg>
            )}
            {exporting === 'docx' ? 'Generating…' : 'DOCX'}
          </button>

          <button
            onClick={() => handleExport('pdf')}
            disabled={exporting !== null}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-red-500/10 border border-red-500/30 rounded-md text-red-600 hover:bg-red-500/15 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {exporting === 'pdf' ? (
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H4zm1 3a1 1 0 000 2h6a1 1 0 100-2H5zm0 3a1 1 0 100 2h4a1 1 0 100-2H5z" clipRule="evenodd"/>
              </svg>
            )}
            {exporting === 'pdf' ? 'Generating…' : 'PDF'}
          </button>

          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-default rounded-md text-muted hover:bg-raised hover:border-default hover:shadow-sm transition-all"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-muted">
              <path fillRule="evenodd" d="M13 4a3 3 0 11-1.36 5.66l-4.38 2.56a3 3 0 110-1.99l4.38-2.56A3 3 0 0113 4z" clipRule="evenodd"/>
            </svg>
            Share
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${
          toast.type === 'err' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
        }`}>
          {toast.type === 'ok'
            ? <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-green-400"><path fillRule="evenodd" d="M12.5 4.5a1 1 0 00-1.414-1.414L6 8.172 4.914 7.086A1 1 0 103.5 8.5l2 2a1 1 0 001.414 0l6-6z" clipRule="evenodd"/></svg>
            : <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-red-300"><path fillRule="evenodd" d="M8 1a7 7 0 110 14A7 7 0 018 1zm-.75 3.75a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zM8 11a1 1 0 110 2 1 1 0 010-2z" clipRule="evenodd"/></svg>
          }
          {toast.msg}
        </div>
      )}
    </div>
  )
}
