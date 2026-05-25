import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { sopKeys, fetchSOP } from '../api/client'
import type { SOPListItem } from '../api/types'
import { useAuthContext } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationContext'

// Requires Realtime enabled for 'pipeline_runs' in Supabase dashboard
// (Database → Replication → pipeline_runs). 15s polling is the active fallback.
export function useRealtimePipeline(sops: SOPListItem[]) {
  const qc = useQueryClient()
  const { appUser } = useAuthContext()
  const { addNotification } = useNotifications()
  const sopsRef = useRef(sops)
  const notifiedRef = useRef<Set<string>>(new Set())

  useEffect(() => { sopsRef.current = sops }, [sops])

  useEffect(() => {
    const channel = supabase
      .channel('pipeline-runs-changes')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'pipeline_runs' },
        async (payload: { new: Record<string, unknown> }) => {
          const sopId = String(payload.new.sop_id)
          const status = String(payload.new.status)
          const sop = sopsRef.current.find(s => s.id === sopId)
          let title = sop?.process_name || sop?.title
          if (!title) {
            try {
              const detail = await fetchSOP(sopId)
              title = detail.process_name || detail.title
            } catch {}
          }
          const label = title || 'New recording'

          if (status === 'awaiting_approval') {
            toast.info('New video ready to initialize', { description: label, duration: 8000 })
            addNotification('upload', label, 'Ready to initialize', sopId)
          } else {
            toast.info('Processing started', { description: label, duration: 6000 })
            addNotification('upload', label, 'Processing started', sopId)
          }
          qc.invalidateQueries({ queryKey: sopKeys.all })
        }
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'pipeline_runs' },
        async (payload: { new: Record<string, unknown> }) => {
          const sopId = String(payload.new.sop_id)
          const sop = sopsRef.current.find(s => s.id === sopId)
          let resolvedTitle = sop?.process_name || sop?.title
          if (!resolvedTitle) {
            try {
              const detail = await fetchSOP(sopId)
              resolvedTitle = detail.process_name || detail.title
            } catch {}
          }
          const title = resolvedTitle || 'Recording'
          const newStatus = payload.new.status

          if (newStatus === 'completed') {
            const key = `${sopId}:completed`
            if (!notifiedRef.current.has(key)) {
              notifiedRef.current.add(key)
              toast.success('SOP ready for review', { description: title, duration: 8000 })
              addNotification('complete', title, 'SOP ready for review', sopId)
            }
          } else if (newStatus === 'failed') {
            const key = `${sopId}:failed`
            if (!notifiedRef.current.has(key) && (appUser?.role === 'admin' || appUser?.role === 'editor')) {
              notifiedRef.current.add(key)
              const errMsg = payload.new.error_message
              const desc = `${title}${errMsg ? ` — ${errMsg}` : ' — check n8n logs'}`
              toast.error('Processing failed', { description: desc, duration: Infinity })
              addNotification('error', title, `Processing failed${errMsg ? ` — ${errMsg}` : ' — check n8n logs'}`, sopId)
            }
          }
          qc.invalidateQueries({ queryKey: sopKeys.all })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [qc, appUser?.role, addNotification])
}
