import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { fetchMergeGroups, compareSops, fetchMergeSession, fetchSOPs, sopKeys, createProcessGroup, deleteProcessGroup, renameSOP, deleteSOP } from '../api/client'
import { InlineLoader } from '../components/PageLoader'

export const Route = createFileRoute('/merge/')({
  component: MergePage,
})

type Tab = 'merged' | 'groups'

function MergePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('tab') === 'groups' ? 'groups' : 'merged'
  })

  // Create Group modal state
  const [showModal, setShowModal] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [selectedSopIds, setSelectedSopIds] = useState<string[]>([])
  const [sopSearch, setSopSearch] = useState('')
  const [comparingCode, setComparingCode] = useState<string | null>(null)
  const [pollingSessionId, setPollingSessionId] = useState<string | null>(null)
  const [confirmDeleteCode, setConfirmDeleteCode] = useState<string | null>(null)
  const [confirmDeleteSopId, setConfirmDeleteSopId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ['merge-groups'],
    queryFn: fetchMergeGroups,
  })

  const { data: allSops } = useQuery({
    queryKey: sopKeys.all,
    queryFn: fetchSOPs,
  })

  const mergedSops = (allSops ?? []).filter(s => s.is_merged)
  const recordings = (allSops ?? []).filter(s => !s.is_merged)
  const totalRecordingsInGroups = (groups ?? []).reduce((sum, g) => sum + g.sops.filter(s => !s.is_merged).length, 0)

  const filteredRecordings = recordings.filter(s =>
    s.title.toLowerCase().includes(sopSearch.toLowerCase())
  )

  // Poll session while status is "comparing"; navigate when "reviewing"
  const { data: polledSession } = useQuery({
    queryKey: ['merge-session-poll', pollingSessionId],
    queryFn: () => fetchMergeSession(pollingSessionId!),
    enabled: !!pollingSessionId,
    refetchInterval: (query) => (query.state.data?.status === 'comparing' ? 3000 : false),
    gcTime: 0,
  })

  useEffect(() => {
    if (polledSession?.status === 'reviewing' && pollingSessionId) {
      const id = pollingSessionId
      setComparingCode(null)
      setPollingSessionId(null)
      navigate({ to: '/merge/$sessionId', params: { sessionId: id } })
    }
  }, [polledSession?.status, pollingSessionId, navigate])

  const compareMutation = useMutation({
    mutationFn: ({ base, updated, code }: { base: string; updated: string; code: string }) => {
      setComparingCode(code)
      return compareSops(base, updated)
    },
    onSuccess: (session) => {
      if (!session) return
      if (session.status === 'reviewing') {
        setComparingCode(null)
        navigate({ to: '/merge/$sessionId', params: { sessionId: session.session_id } })
      } else {
        // status === "comparing" — Gemini running in background, start polling
        setPollingSessionId(session.session_id)
      }
    },
    onError: () => setComparingCode(null),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameSOP(id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sopKeys.all })
      queryClient.invalidateQueries({ queryKey: ['merge-groups'] })
      setRenamingId(null)
      setRenameValue('')
    },
  })

  function startRename(id: string, currentTitle: string) {
    setRenamingId(id)
    setRenameValue(currentTitle)
  }

  function submitRename(id: string) {
    const trimmed = renameValue.trim()
    if (trimmed) renameMutation.mutate({ id, title: trimmed })
  }

  const deleteGroupMutation = useMutation({
    mutationFn: (code: string) => deleteProcessGroup(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merge-groups'] })
      queryClient.invalidateQueries({ queryKey: sopKeys.all })
      setConfirmDeleteCode(null)
    },
  })

  const deleteSopMutation = useMutation({
    mutationFn: (id: string) => deleteSOP(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sopKeys.all })
      queryClient.invalidateQueries({ queryKey: ['merge-groups'] })
      setConfirmDeleteSopId(null)
    },
  })

  const createGroupMutation = useMutation({
    mutationFn: () => createProcessGroup({ name: groupName.trim(), sop_ids: selectedSopIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merge-groups'] })
      setShowModal(false)
      setGroupName('')
      setSelectedSopIds([])
      setSopSearch('')
      setTab('groups')
    },
  })

  function closeModal() {
    setShowModal(false)
    setGroupName('')
    setSelectedSopIds([])
    setSopSearch('')
  }

  function toggleSop(id: string) {
    setSelectedSopIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/dashboard"
          className="flex items-center gap-1.5 text-sm text-muted hover:text-gray-800 bg-card border border-default hover:border-default px-3 py-1.5 rounded-lg transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-default">Merge SOPs</h1>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card rounded-xl border border-subtle p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-default">{mergedSops.length}</p>
            <p className="text-xs text-muted">Merged SOPs</p>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-subtle p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-default">{groups?.length ?? 0}</p>
            <p className="text-xs text-muted">Source Groups</p>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-subtle p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-raised flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-default">{totalRecordingsInGroups}</p>
            <p className="text-xs text-muted">Recordings</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-card border border-subtle rounded-2xl shadow-sm overflow-hidden">
        <div className="flex border-b border-subtle">
          <button
            onClick={() => setTab('merged')}
            className={`flex items-center gap-2 px-6 py-3.5 text-sm font-semibold transition-colors ${
              tab === 'merged'
                ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-500/10'
                : 'text-muted hover:text-secondary hover:bg-raised'
            }`}
          >
            Merged SOPs
            {mergedSops.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === 'merged' ? 'bg-purple-500/10 text-purple-500' : 'bg-raised text-muted'}`}>
                {mergedSops.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('groups')}
            className={`flex items-center gap-2 px-6 py-3.5 text-sm font-semibold transition-colors ${
              tab === 'groups'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-500/10'
                : 'text-muted hover:text-secondary hover:bg-raised'
            }`}
          >
            Source Groups
            {(groups?.length ?? 0) > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === 'groups' ? 'bg-blue-500/15 text-blue-500' : 'bg-raised text-muted'}`}>
                {groups!.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab: Merged SOPs */}
        {tab === 'merged' && (
          <div className="p-5 min-h-64">
            {mergedSops.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-52 text-center">
                <div className="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-purple-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" clipRule="evenodd" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-muted">No merged SOPs yet</p>
                <p className="text-xs text-muted mt-1 max-w-xs">Create a source group and compare two recordings to get started.</p>
                <button onClick={() => setTab('groups')} className="mt-4 text-xs px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition-colors">
                  Go to Source Groups
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {mergedSops.map(sop => (
                  <div key={sop.id} className="group relative flex items-stretch gap-0 rounded-xl border border-subtle hover:border-purple-500/30 hover:shadow-md hover:shadow-purple-500/10 transition-all duration-200 overflow-hidden bg-card">
                    {/* Left accent bar */}
                    <div className="w-1 shrink-0 bg-purple-500/40 group-hover:bg-purple-500 transition-colors" />

                    <div className="flex items-center gap-4 p-4 flex-1 min-w-0">
                      {/* Icon */}
                      <div className="shrink-0 w-10 h-10 rounded-xl bg-purple-500/10 group-hover:bg-purple-500/15 flex items-center justify-center transition-colors">
                        <svg className="w-5 h-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" clipRule="evenodd" />
                        </svg>
                      </div>

                      {/* Title + meta */}
                      <div className="flex-1 min-w-0">
                        {renamingId === sop.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') submitRename(sop.id); if (e.key === 'Escape') setRenamingId(null) }}
                              className="flex-1 px-2 py-1 text-sm border border-purple-500/40 rounded-lg bg-raised text-default focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                            />
                            <button onClick={() => submitRename(sop.id)} disabled={renameMutation.isPending} className="text-xs px-2.5 py-1 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 disabled:opacity-50">Save</button>
                            <button onClick={() => setRenamingId(null)} className="text-xs px-2.5 py-1 bg-raised text-muted rounded-lg font-semibold hover:bg-card border border-subtle">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-default truncate">{sop.title}</p>
                            <button
                              onClick={() => startRename(sop.id, sop.title)}
                              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-muted hover:text-purple-500 shrink-0"
                              title="Rename"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-xs text-muted bg-raised px-2 py-0.5 rounded-full border border-subtle">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                            {sop.step_count} steps
                          </span>
                          {sop.meeting_date && (
                            <span className="text-xs text-muted">{sop.meeting_date}</span>
                          )}
                          {sop.project_code && (
                            <span className="font-mono text-xs text-purple-500 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-full">{sop.project_code}</span>
                          )}
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full capitalize ${
                            sop.status === 'published' ? 'bg-green-500/10 text-green-600'
                            : sop.status === 'draft' ? 'bg-raised text-muted border border-subtle'
                            : 'bg-blue-500/10 text-blue-500'
                          }`}>{sop.status}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="shrink-0 flex items-center gap-2">
                        {confirmDeleteSopId === sop.id ? (
                          <div className="flex items-center gap-1.5 bg-red-500/5 border border-red-500/20 rounded-lg px-2.5 py-1.5">
                            <span className="text-xs text-red-500 font-medium">Delete?</span>
                            <button
                              onClick={() => deleteSopMutation.mutate(sop.id)}
                              disabled={deleteSopMutation.isPending}
                              className="text-xs px-2 py-0.5 bg-red-600 text-white font-semibold rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >{deleteSopMutation.isPending ? '…' : 'Yes'}</button>
                            <button
                              onClick={() => setConfirmDeleteSopId(null)}
                              className="text-xs px-2 py-0.5 bg-raised text-muted font-semibold rounded hover:bg-card border border-subtle transition-colors"
                            >No</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteSopId(sop.id)}
                            className="p-2 text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete merged SOP"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                        <Link
                          to="/sop/$id/procedure"
                          params={{ id: sop.id }}
                          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 active:scale-95 transition-all shadow-sm shadow-purple-500/20"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          Open
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Source Groups */}
        {tab === 'groups' && (
          <div className="p-5 min-h-64 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">
                Groups of recordings of the same process. Create a group, then compare and merge.
              </p>
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Group
              </button>
            </div>

            {groupsLoading ? (
              <InlineLoader label="Loading groups…" />
            ) :!groups?.length ? (
              <div className="flex flex-col items-center justify-center h-44 text-center">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/15 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-muted">No source groups yet</p>
                <p className="text-xs text-muted mt-1 max-w-xs">Click "New Group" to create one and select which recordings belong together.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map(group => (
                  <div key={group.project_code} className="rounded-xl border border-subtle overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-page border-b border-subtle">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-secondary truncate">
                              {group.name ?? group.project_code}
                            </span>
                            {group.sops.filter(s => !s.is_merged).length === 2 && (
                              <span className="text-xs text-green-600 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full font-medium shrink-0">
                                Ready
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-xs text-blue-500 mt-0.5 block">{group.project_code}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-2">
                        <span className="text-xs text-muted">{group.sops.filter(s => !s.is_merged).length} recordings</span>
                        {confirmDeleteCode === group.project_code ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-red-600 font-medium">Delete?</span>
                            <button
                              onClick={() => deleteGroupMutation.mutate(group.project_code)}
                              disabled={deleteGroupMutation.isPending}
                              className="text-xs px-2 py-0.5 bg-red-600 text-white rounded font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                              {deleteGroupMutation.isPending ? '…' : 'Yes'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteCode(null)}
                              className="text-xs px-2 py-0.5 bg-raised text-muted rounded font-semibold hover:bg-card border border-subtle transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteCode(group.project_code)}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                            title="Delete group"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    {(() => {
                      const sources = group.sops.filter(s => !s.is_merged)
                      const mergedOutputs = group.sops.filter(s => s.is_merged)
                      return (
                        <>
                          <div className="divide-y divide-subtle">
                            {sources.map((sop, idx) => (
                              <div key={sop.id} className="flex items-center gap-3 px-4 py-2.5">
                                <span className="w-5 h-5 rounded-full bg-raised text-muted text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                                {renamingId === sop.id ? (
                                  <div className="flex items-center gap-2 flex-1">
                                    <input
                                      autoFocus
                                      value={renameValue}
                                      onChange={e => setRenameValue(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter') submitRename(sop.id); if (e.key === 'Escape') setRenamingId(null) }}
                                      className="flex-1 px-2 py-0.5 text-sm border border-blue-500/40 rounded bg-raised text-default focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                    />
                                    <button onClick={() => submitRename(sop.id)} disabled={renameMutation.isPending} className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 disabled:opacity-50">Save</button>
                                    <button onClick={() => setRenamingId(null)} className="text-xs px-2 py-0.5 bg-raised text-muted rounded hover:bg-card border border-subtle">✕</button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 flex-1 min-w-0 group">
                                    <span className="flex-1 text-sm text-secondary truncate">{sop.title}</span>
                                    <button onClick={() => startRename(sop.id, sop.title)} className="opacity-20 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-gray-500 shrink-0">
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                    </button>
                                  </div>
                                )}
                                {sop.meeting_date && renamingId !== sop.id && <span className="text-xs text-muted shrink-0">{sop.meeting_date}</span>}
                              </div>
                            ))}
                          </div>

                          {mergedOutputs.length > 0 && (
                            <div className="border-t border-subtle bg-purple-500/10">
                              <p className="px-4 pt-2.5 pb-1 text-xs font-semibold text-purple-500 uppercase tracking-wide">Merged Output</p>
                              {mergedOutputs.map(sop => (
                                <div key={sop.id} className="flex items-center gap-3 px-4 py-2 pb-2.5">
                                  <div className="w-5 h-5 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
                                    <svg className="w-3 h-3 text-purple-500" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" clipRule="evenodd" />
                                    </svg>
                                  </div>
                                  {renamingId === sop.id ? (
                                    <div className="flex items-center gap-2 flex-1">
                                      <input
                                        autoFocus
                                        value={renameValue}
                                        onChange={e => setRenameValue(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') submitRename(sop.id); if (e.key === 'Escape') setRenamingId(null) }}
                                        className="flex-1 px-2 py-0.5 text-sm border border-purple-500/40 rounded bg-raised text-default focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                                      />
                                      <button onClick={() => submitRename(sop.id)} disabled={renameMutation.isPending} className="text-xs px-2 py-0.5 bg-purple-600 text-white rounded font-semibold hover:bg-purple-700 disabled:opacity-50">Save</button>
                                      <button onClick={() => setRenamingId(null)} className="text-xs px-2 py-0.5 bg-raised text-muted rounded hover:bg-card border border-subtle">✕</button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 flex-1 min-w-0 group">
                                      <span className="flex-1 text-sm text-purple-700 font-medium truncate">{sop.title}</span>
                                      <button onClick={() => startRename(sop.id, sop.title)} className="opacity-20 group-hover:opacity-100 transition-opacity text-purple-300 hover:text-purple-500 shrink-0">
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                      </button>
                                    </div>
                                  )}
                                  {sop.meeting_date && renamingId !== sop.id && <span className="text-xs text-purple-400 shrink-0">{sop.meeting_date}</span>}
                                  {renamingId !== sop.id && (
                                    <div className="shrink-0 flex items-center gap-1.5">
                                      {confirmDeleteSopId === sop.id ? (
                                        <>
                                          <span className="text-xs text-muted">Delete?</span>
                                          <button
                                            onClick={() => deleteSopMutation.mutate(sop.id)}
                                            disabled={deleteSopMutation.isPending}
                                            className="text-xs px-2 py-0.5 bg-red-600 text-white font-semibold rounded hover:bg-red-700 disabled:opacity-50"
                                          >Yes</button>
                                          <button
                                            onClick={() => setConfirmDeleteSopId(null)}
                                            className="text-xs px-2 py-0.5 bg-raised text-muted rounded hover:bg-card border border-subtle"
                                          >No</button>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => setConfirmDeleteSopId(sop.id)}
                                            className="p-1 text-purple-300 hover:text-red-500 transition-colors"
                                            title="Delete"
                                          >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                          </button>
                                          <Link
                                            to="/sop/$id/procedure"
                                            params={{ id: sop.id }}
                                            className="text-xs font-semibold text-purple-600 hover:text-purple-800 underline underline-offset-2"
                                          >
                                            Open
                                          </Link>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="px-4 py-3 bg-page border-t border-subtle space-y-2">
                            {sources.length === 2 ? (
                              <>
                                {mergedOutputs.length === 0 && (
                                  <button
                                    onClick={() => compareMutation.mutate({ base: sources[0].id, updated: sources[1].id, code: group.project_code })}
                                    disabled={compareMutation.isPending}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-colors"
                                  >
                                    {comparingCode === group.project_code ? (
                                      <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Analysing…</>
                                    ) : 'Compare & Merge'}
                                  </button>
                                )}
                                {mergedOutputs.length > 0 && (
                                  <button
                                    onClick={() => compareMutation.mutate({ base: sources[0].id, updated: sources[1].id, code: group.project_code })}
                                    disabled={compareMutation.isPending}
                                    className="w-full text-xs text-muted hover:text-purple-600 py-1 transition-colors disabled:opacity-50"
                                  >
                                    {comparingCode === group.project_code ? 'Analysing…' : '↺ Run a new comparison'}
                                  </button>
                                )}
                              </>
                            ) : (
                              <p className="text-xs text-amber-600 text-center py-1">
                                {sources.length} recordings — select any 2 from their Overview tab to initiate a pairwise merge.
                              </p>
                            )}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                ))}
              </div>
            )}

            {compareMutation.isError && (
              <p className="text-sm text-red-500 bg-red-500/10 rounded-xl px-4 py-3">
                {(compareMutation.error as Error).message}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Create Group Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-lg space-y-5 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-default">Create Process Group</h2>
              <button onClick={closeModal} className="text-muted hover:text-secondary">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Group name */}
            <div>
              <label className="text-xs font-semibold text-muted mb-1.5 block">Group Name</label>
              <input
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="e.g. New Aged Debtor Report"
                className="w-full px-3 py-2 border border-default rounded-lg text-sm text-default bg-raised focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-muted mt-1.5">
                A code will be auto-assigned — e.g. <span className="font-mono text-blue-600">GRP-001</span>
              </p>
            </div>

            {/* SOP multi-select */}
            <div>
              <label className="text-xs font-semibold text-muted mb-1.5 block">
                Select Recordings
                <span className="text-muted font-normal ml-1">(minimum 2)</span>
              </label>
              <input
                value={sopSearch}
                onChange={e => setSopSearch(e.target.value)}
                placeholder="Search recordings…"
                className="w-full px-3 py-2 border border-default rounded-lg text-sm text-default bg-raised mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="max-h-56 overflow-y-auto space-y-1 border border-subtle rounded-xl p-2">
                {filteredRecordings.length === 0 ? (
                  <p className="text-xs text-muted text-center py-4">No recordings found</p>
                ) : filteredRecordings.map(sop => {
                  const checked = selectedSopIds.includes(sop.id)
                  return (
                    <label
                      key={sop.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        checked ? 'bg-blue-500/10 border border-blue-500/30' : 'hover:bg-raised border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSop(sop.id)}
                        className="accent-blue-600 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-secondary truncate">{sop.title}</p>
                        <p className="text-xs text-muted">{sop.meeting_date ?? '—'}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
              {selectedSopIds.length > 0 && (
                <p className="text-xs text-blue-600 mt-1.5 font-medium">{selectedSopIds.length} selected</p>
              )}
            </div>

            {createGroupMutation.isError && (
              <p className="text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
                {(createGroupMutation.error as Error).message}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={closeModal}
                className="flex-1 px-4 py-2 text-sm text-muted border border-default rounded-xl hover:bg-raised transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => createGroupMutation.mutate()}
                disabled={!groupName.trim() || selectedSopIds.length < 2 || createGroupMutation.isPending}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                {createGroupMutation.isPending ? 'Creating…' : 'Create Group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
