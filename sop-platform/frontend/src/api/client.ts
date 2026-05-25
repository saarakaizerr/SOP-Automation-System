import type { SOPListItem, SOPDetail, SOPStep, TranscriptLine, SOPSection, WatchlistItem, AppUser, UserCreateInput, UserUpdateInput, CalloutPatchItem, StepCallout, SOPMetrics, LikeResponse, SOPTag, HighlightBox, ProcessMapConfig, CombineExportRequest, MergeSession, MergeStepDecision, MergeGroup, ProcessGroupResponse, CreateProcessGroupInput } from './types'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: HeadersInit = {}
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }
  return headers
}

export async function fetchAPI<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

async function mutateAPI<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T | null> {
  const headers = await getAuthHeaders()
  if (body !== undefined) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`)
  }
  if (res.status === 204) return null
  return res.json() as Promise<T>
}

export const fetchSOPs = () => fetchAPI<SOPListItem[]>('/api/sops')
export const syncSharePoint = () => mutateAPI<{ ok: boolean }>('/api/pipeline/sync-sharepoint', 'POST')
export const fetchSOP = (id: string) => fetchAPI<SOPDetail>(`/api/sops/${id}`)
export const fetchSteps = (id: string) => fetchAPI<SOPStep[]>(`/api/sops/${id}/steps`)
export const fetchTranscript = (id: string, speaker?: string) => {
  const params = speaker ? `?speaker=${encodeURIComponent(speaker)}` : ''
  return fetchAPI<TranscriptLine[]>(`/api/sops/${id}/transcript${params}`)
}
export const fetchSections = (id: string) => fetchAPI<SOPSection[]>(`/api/sops/${id}/sections`)
export const fetchWatchlist = (id: string) => fetchAPI<WatchlistItem[]>(`/api/sops/${id}/watchlist`)

export interface ExportResponse {
  download_url: string
  filename: string
  format: string
}

export async function exportSOP(id: string, format: 'docx' | 'pdf'): Promise<ExportResponse> {
  const headers = await getAuthHeaders()

  // Start async export job — returns immediately with export_id
  const startRes = await fetch(`${API_BASE}/api/sops/${id}/export?format=${format}`, {
    method: 'POST',
    headers,
  })
  if (!startRes.ok) {
    throw new Error(`Export failed: ${startRes.status} ${startRes.statusText}`)
  }
  const { export_id } = await startRes.json() as { export_id: string }

  // Poll until done (max 10 minutes, every 4s)
  for (let i = 0; i < 150; i++) {
    await new Promise(resolve => setTimeout(resolve, 4000))
    const pollRes = await fetch(`${API_BASE}/api/exports/${export_id}`, { headers })
    if (!pollRes.ok) throw new Error('Failed to check export status')
    const job = await pollRes.json() as { status: string; download_url: string; filename: string; format: string; error: string | null }
    if (job.status === 'done') return { download_url: job.download_url, filename: job.filename, format: job.format }
    if (job.status === 'error') throw new Error(job.error ?? 'Export failed')
  }
  throw new Error('Export timed out — please try again')
}

export interface RenderAnnotatedResponse {
  annotated_screenshot_url: string
}

export async function patchCallouts(
  stepId: string,
  items: CalloutPatchItem[],
): Promise<StepCallout[]> {
  const result = await mutateAPI<StepCallout[]>(`/api/steps/${stepId}/callouts`, 'PATCH', items)
  if (result === null) throw new Error('Unexpected empty response from PATCH callouts')
  return result
}

export async function renderAnnotated(stepId: string): Promise<RenderAnnotatedResponse> {
  const result = await mutateAPI<RenderAnnotatedResponse>(
    `/api/steps/${stepId}/render-annotated`, 'POST'
  )
  if (result === null) throw new Error('Unexpected empty response from POST render-annotated')
  return result
}

export const addCallout = (stepId: string, body: { callout_number: number; label: string; target_x: number; target_y: number }) =>
  mutateAPI<StepCallout>(`/api/steps/${stepId}/callouts`, 'POST', body)

export const deleteCallout = (stepId: string, calloutId: string) =>
  mutateAPI<null>(`/api/steps/${stepId}/callouts/${calloutId}`, 'DELETE')

export const patchHighlightBoxes = (stepId: string, boxes: HighlightBox[]) =>
  mutateAPI<SOPStep>(`/api/steps/${stepId}/highlight-boxes`, 'PATCH', boxes)

export const approveStep = (stepId: string) => mutateAPI<SOPStep>(`/api/steps/${stepId}/approve`, 'PATCH')
export const deleteStep = (stepId: string) => mutateAPI<null>(`/api/steps/${stepId}`, 'DELETE')
export const createStep = (sopId: string, title: string) => mutateAPI<SOPStep>(`/api/sops/${sopId}/steps`, 'POST', { title })
export const updateSOPStatus = (sopId: string, status: string) => mutateAPI<null>(`/api/sops/${sopId}/status`, 'PATCH', { status })
export const renameStep = (stepId: string, title: string) => mutateAPI<SOPStep>(`/api/steps/${stepId}/rename`, 'PATCH', { title })
export const updateStepDescription = (stepId: string, description: string) => mutateAPI<SOPStep>(`/api/steps/${stepId}/description`, 'PATCH', { description })
export const updateSubSteps = (stepId: string, sub_steps: string[]) => mutateAPI<SOPStep>(`/api/steps/${stepId}/sub-steps`, 'PATCH', { sub_steps })
export const fetchMetrics = (id: string) => fetchAPI<SOPMetrics>(`/api/sops/${id}/metrics`)
export const trackView = (id: string) => mutateAPI<null>(`/api/sops/${id}/view`, 'POST')
export const toggleLike = (id: string) => mutateAPI<LikeResponse>(`/api/sops/${id}/like`, 'POST')
export const deleteSOP = (id: string) => mutateAPI<null>(`/api/sops/${id}`, 'DELETE')
export const renameSOP = (id: string, title: string) =>
  mutateAPI<{ id: string; title: string }>(`/api/sops/${id}/rename`, 'PATCH', { title })

export const startPipeline = (id: string) =>
  mutateAPI<{ ok: boolean }>(`/api/sops/${id}/start-pipeline`, 'POST')
export const updateSOPTags = (id: string, tags: SOPTag[]) =>
  mutateAPI<SOPListItem>(`/api/sops/${id}/tags`, 'PATCH', { tags })

export const fetchProcessMap = (id: string) =>
  fetchAPI<{ process_map_config: ProcessMapConfig | null }>(`/api/sops/${id}/process-map`)

export const saveProcessMap = (id: string, config: ProcessMapConfig) =>
  mutateAPI<{ process_map_config: ProcessMapConfig }>(`/api/sops/${id}/process-map`, 'PATCH', config)

export const uploadProcessMapImage = async (id: string, file: File): Promise<{ confirmed_url: string; confirmed_at: string }> => {
  const headers = await getAuthHeaders() as Record<string, string>
  const { 'Content-Type': _ct, ...headersWithoutContentType } = headers
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/api/sops/${id}/process-map/upload`, {
    method: 'POST',
    headers: headersWithoutContentType,
    body: form,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  return res.json()
}

// ── User management (admin only) ──────────────────────────────────────────────
export const fetchUsers = () => fetchAPI<AppUser[]>('/api/users')
export const createUser = (data: UserCreateInput) => mutateAPI<AppUser>('/api/users', 'POST', data)
export const updateUser = (id: string, data: UserUpdateInput) => mutateAPI<AppUser>(`/api/users/${id}`, 'PATCH', data)
export const deleteUser = (id: string) => mutateAPI<null>(`/api/users/${id}`, 'DELETE')

export const setProjectCode = (sopId: string, projectCode: string | null) =>
  mutateAPI<{ sop_id: string; project_code: string | null }>(
    `/api/sops/${sopId}/project-code`, 'PATCH', { project_code: projectCode }
  )

export const fetchMergeGroups = () =>
  fetchAPI<MergeGroup[]>('/api/merge/groups')

export const createProcessGroup = (body: CreateProcessGroupInput) =>
  mutateAPI<ProcessGroupResponse>('/api/merge/process-groups', 'POST', body)

export const deleteProcessGroup = (code: string) =>
  mutateAPI<null>(`/api/merge/process-groups/${encodeURIComponent(code)}`, 'DELETE')

export const compareSops = (baseSopId: string, updatedSopId: string) =>
  mutateAPI<MergeSession>('/api/merge/compare', 'POST', {
    base_sop_id: baseSopId,
    updated_sop_id: updatedSopId,
  })

export const fetchMergeSession = (sessionId: string) =>
  fetchAPI<MergeSession>(`/api/merge/sessions/${sessionId}`)

export const finalizeMerge = (sessionId: string, steps: MergeStepDecision[]) =>
  mutateAPI<{ merged_sop_id: string }>(
    `/api/merge/sessions/${sessionId}/finalize`, 'POST', { steps }
  )

export const exportCombinedSOPs = async (
  body: CombineExportRequest,
  format: 'docx' | 'pdf',
): Promise<ExportResponse> => {
  const headers = await getAuthHeaders() as Record<string, string>
  headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_BASE}/api/sops/combine/export?format=${format}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Export failed: ${res.status}`)
  return res.json()
}

export const userKeys = {
  all: ['users'] as const,
  detail: (id: string) => ['users', id] as const,
}

export const sopKeys = {
  all: ['sops'] as const,
  detail: (id: string) => ['sops', id] as const,
  steps: (id: string) => ['sops', id, 'steps'] as const,
  transcript: (id: string) => ['sops', id, 'transcript'] as const,
  sections: (id: string) => ['sops', id, 'sections'] as const,
  watchlist: (id: string) => ['sops', id, 'watchlist'] as const,
  metrics: (id: string) => ['sops', id, 'metrics'] as const,
  processMap: (id: string) => ['sops', id, 'process-map'] as const,
}
