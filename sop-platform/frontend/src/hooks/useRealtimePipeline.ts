import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { sopKeys } from '../api/client'
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

  useEffect(() => { sopsRef.current = sops }, [sops])

  useEffect(() => {
    const channel = supabase
      .channel('pipeline-runs-changes')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'pipeline_runs' },
        (payload: { new: Record<string, unknown> }) => {
          const sopId = String(payload.new.sop_id)
          const sop = sopsRef.current.find(s => s.id === sopId)
          const title = sop?.process_name || sop?.title || 'New recording'
          toast.info('Processing started', { description: title, duration: 6000 })
          addNotification('upload', 'New video processing started', title)
          qc.invalidateQueries({ queryKey: sopKeys.all })
        }
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'pipeline_runs' },
        (payload: { new: Record<string, unknown> }) => {
          const sopId = String(payload.new.sop_id)
          const sop = sopsRef.current.find(s => s.id === sopId)
          const title = sop?.process_name || sop?.title || 'Recording'
          const newStatus = payload.new.status

          if (newStatus === 'completed') {
            toast.success('SOP ready for review', { description: title, duration: 8000 })
            addNotification('complete', 'SOP ready for review', title)
          } else if (newStatus === 'failed') {
            if (appUser?.role === 'admin' || appUser?.role === 'editor') {
              const errMsg = payload.new.error_message
              const desc = `${title}${errMsg ? ` — ${errMsg}` : ' — check n8n logs'}`
              toast.error('Processing failed', { description: desc, duration: Infinity })
              addNotification('error', 'Processing failed', desc)
            }
          }
          qc.invalidateQueries({ queryKey: sopKeys.all })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [qc, appUser?.role, addNotification])
}
