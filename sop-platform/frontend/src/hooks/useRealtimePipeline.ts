import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { sopKeys, fetchSOP } from '../api/client'
import type { SOPListItem } from '../api/types'
import { useAuthContext } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationContext'

// Requires Realtime enabled for 'pipeline_runs' in Supabase dashboard
// (Database → Replication → pipeline_runs).
export function useRealtimePipeline() {
  const qc = useQueryClient()
  const { appUser } = useAuthContext()
  const { addNotification } = useNotifications()
  const notifiedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    async function resolveTitle(sopId: string): Promise<string> {
      const list = qc.getQueryData<SOPListItem[]>(sopKeys.all) ?? []
      const sop = list.find(s => s.id === sopId)
      let title = sop?.process_name || sop?.title
      if (!title) {
        try {
          const detail = await fetchSOP(sopId)
          title = detail.process_name || detail.title
        } catch {}
      }
      return title || 'Recording'
    }

    const channel = supabase
      .channel('pipeline-runs-changes')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'pipeline_runs' },
        async (payload: { new: Record<string, unknown> }) => {
          const sopId = String(payload.new.sop_id)
          const status = String(payload.new.status)
          const label = await resolveTitle(sopId)

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
          const newStatus = payload.new.status

          if (newStatus === 'completed') {
            const key = `${sopId}:completed`
            if (!notifiedRef.current.has(key)) {
              notifiedRef.current.add(key)
              const title = await resolveTitle(sopId)
              toast.success('SOP ready for review', { description: title, duration: 8000 })
              addNotification('complete', title, 'SOP ready for review', sopId)
            }
          } else if (newStatus === 'failed') {
            const key = `${sopId}:failed`
            if (!notifiedRef.current.has(key) && (appUser?.role === 'admin' || appUser?.role === 'editor')) {
              notifiedRef.current.add(key)
              const title = await resolveTitle(sopId)
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
