import { createFileRoute, useParams } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useCallback, useRef } from 'react'
import { fetchSOP, sopKeys, setProjectCode, createSection, updateSection, deleteSection } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import type { SOPSection } from '../api/types'

export const Route = createFileRoute('/sop/$id/overview')({
  component: OverviewPage,
})

// ── Section icons ─────────────────────────────────────────────────────────────
const SECTION_ICONS: Record<string, JSX.Element> = {
  purpose: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
    </svg>
  ),
  inputs: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
    </svg>
  ),
  process_summary: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
    </svg>
  ),
  outputs: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293 9.707a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L3.586 14H1a1 1 0 110-2h11.586l-1.293-1.293a1 1 0 011.414-1.414l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L12.414 16H1a1 1 0 110-2h2.586l-1.293-1.293z" clipRule="evenodd"/>
    </svg>
  ),
  risks: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
    </svg>
  ),
  training_prereqs: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z"/>
    </svg>
  ),
  software_access: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd"/>
    </svg>
  ),
  comm_matrix_infomate: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"/>
    </svg>
  ),
  comm_matrix_client: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clipRule="evenodd"/>
    </svg>
  ),
  quality_params: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
    </svg>
  ),
  quality_sampling: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/>
    </svg>
  ),
  sow: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd"/>
    </svg>
  ),
  baseline_target: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z" clipRule="evenodd"/>
    </svg>
  ),
  challenges: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
    </svg>
  ),
  improvements: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd"/>
    </svg>
  ),
}

const SECTION_COLORS: Record<string, { bg: string; icon: string; border: string; activeBorder: string }> = {
  purpose:              { bg: 'bg-blue-500/10',    icon: 'text-blue-500',    border: 'border-blue-500/20',    activeBorder: 'border-l-blue-500' },
  inputs:               { bg: 'bg-emerald-500/10', icon: 'text-emerald-500', border: 'border-emerald-500/20', activeBorder: 'border-l-emerald-500' },
  process_summary:      { bg: 'bg-indigo-500/10',  icon: 'text-indigo-500',  border: 'border-indigo-500/20',  activeBorder: 'border-l-indigo-500' },
  outputs:              { bg: 'bg-teal-500/10',    icon: 'text-teal-500',    border: 'border-teal-500/20',    activeBorder: 'border-l-teal-500' },
  risks:                { bg: 'bg-red-500/10',     icon: 'text-red-500',     border: 'border-red-500/20',     activeBorder: 'border-l-red-500' },
  training_prereqs:     { bg: 'bg-amber-500/10',   icon: 'text-amber-500',   border: 'border-amber-500/20',   activeBorder: 'border-l-amber-500' },
  software_access:      { bg: 'bg-violet-500/10',  icon: 'text-violet-500',  border: 'border-violet-500/20',  activeBorder: 'border-l-violet-500' },
  comm_matrix_infomate: { bg: 'bg-cyan-500/10',    icon: 'text-cyan-500',    border: 'border-cyan-500/20',    activeBorder: 'border-l-cyan-500' },
  comm_matrix_client:   { bg: 'bg-sky-500/10',     icon: 'text-sky-500',     border: 'border-sky-500/20',     activeBorder: 'border-l-sky-500' },
  quality_params:       { bg: 'bg-purple-500/10',  icon: 'text-purple-500',  border: 'border-purple-500/20',  activeBorder: 'border-l-purple-500' },
  quality_sampling:     { bg: 'bg-fuchsia-500/10', icon: 'text-fuchsia-500', border: 'border-fuchsia-500/20', activeBorder: 'border-l-fuchsia-500' },
  sow:                  { bg: 'bg-orange-500/10',  icon: 'text-orange-500',  border: 'border-orange-500/20',  activeBorder: 'border-l-orange-500' },
  baseline_target:      { bg: 'bg-lime-500/10',    icon: 'text-lime-600',    border: 'border-lime-500/20',    activeBorder: 'border-l-lime-500' },
  challenges:           { bg: 'bg-rose-500/10',    icon: 'text-rose-500',    border: 'border-rose-500/20',    activeBorder: 'border-l-rose-500' },
  improvements:         { bg: 'bg-green-500/10',   icon: 'text-green-500',   border: 'border-green-500/20',   activeBorder: 'border-l-green-500' },
}

const DEFAULT_COLOR = { bg: 'bg-raised', icon: 'text-muted', border: 'border-subtle', activeBorder: 'border-l-default' }

function impactBadge(val: string) {
  const v = val.toLowerCase()
  if (v === 'high')   return 'bg-red-500/10 text-red-600 border border-red-500/30'
  if (v === 'medium') return 'bg-amber-500/10 text-amber-600 border border-amber-500/30'
  if (v === 'low')    return 'bg-green-500/10 text-green-600 border border-green-500/30'
  return 'bg-raised text-muted'
}

function StyledTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return null
  const cols = Object.keys(rows[0])
  return (
    <div className="overflow-x-auto rounded-lg border border-subtle">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-raised border-b border-subtle">
            {cols.map((col) => (
              <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold text-muted uppercase tracking-wide">
                {col.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-raised transition-colors">
              {cols.map((col) => {
                const val = String(row[col] ?? '')
                const isImpact = col.toLowerCase() === 'impact'
                const isFreq = col.toLowerCase() === 'frequency'
                const isAccess = col.toLowerCase() === 'access_level'
                const isOwner = col.toLowerCase() === 'owner'
                return (
                  <td key={col} className="px-4 py-3 text-secondary align-top">
                    {isImpact ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${impactBadge(val)}`}>
                        {val}
                      </span>
                    ) : (isFreq || isAccess || isOwner) ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-raised text-muted border border-subtle">
                        {val}
                      </span>
                    ) : val}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Section card with smooth collapse animation ───────────────────────────────
function SectionCard({
  section,
  isOpen,
  onToggle,
  canEdit,
  onSaveTitle,
  onSaveContent,
  onDelete,
}: {
  section: SOPSection
  isOpen: boolean
  onToggle: () => void
  canEdit: boolean
  onSaveTitle: (id: string, title: string) => Promise<void>
  onSaveContent: (id: string, text: string) => Promise<void>
  onDelete: (id: string) => void
}) {
  const colors = SECTION_COLORS[section.section_key] ?? DEFAULT_COLOR
  const icon = SECTION_ICONS[section.section_key]
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(section.section_title)
  const [editingContent, setEditingContent] = useState(false)
  const [contentInput, setContentInput] = useState(section.content_text ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { setTitleInput(section.section_title) }, [section.section_title])
  useEffect(() => { setContentInput(section.content_text ?? '') }, [section.content_text])

  async function handleSaveTitle() {
    if (!titleInput.trim() || titleInput === section.section_title) { setEditingTitle(false); return }
    setSaving(true)
    await onSaveTitle(section.id, titleInput.trim())
    setSaving(false)
    setEditingTitle(false)
  }

  async function handleSaveContent() {
    setSaving(true)
    await onSaveContent(section.id, contentInput)
    setSaving(false)
    setEditingContent(false)
  }

  return (
    <div
      id={`section-${section.section_key}`}
      className={`rounded-xl border ${colors.border} overflow-hidden shadow-sm transition-shadow hover:shadow-md`}
    >
      {/* Header */}
      <div className={`flex items-center justify-between px-5 py-3.5 ${colors.bg} group`}>
        {editingTitle ? (
          <div className="flex items-center gap-2 flex-1 mr-2">
            <input
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveTitle()
                if (e.key === 'Escape') { setTitleInput(section.section_title); setEditingTitle(false) }
              }}
              className="flex-1 text-sm font-semibold bg-transparent border-b border-default focus:outline-none focus:border-blue-400 text-secondary py-0.5"
              autoFocus
            />
            <button onClick={handleSaveTitle} disabled={saving} className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={() => { setTitleInput(section.section_title); setEditingTitle(false) }} className="text-xs text-muted hover:text-secondary transition-colors">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={onToggle} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
            <span className={`${colors.icon} shrink-0 transition-transform duration-150 group-hover:scale-110`}>{icon}</span>
            <span className="text-sm font-semibold text-secondary truncate">{section.section_title}</span>
          </button>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {canEdit && !editingTitle && (
            <>
              <button
                onClick={e => { e.stopPropagation(); setTitleInput(section.section_title); setEditingTitle(true) }}
                className="p-1 rounded text-muted hover:text-blue-500 hover:bg-blue-500/10 transition-all opacity-0 group-hover:opacity-100"
                title="Rename"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
                </svg>
              </button>
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-red-500 font-medium">Delete?</span>
                  <button onClick={() => onDelete(section.id)} className="text-[10px] px-1.5 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 transition-colors">Yes</button>
                  <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-muted hover:text-secondary transition-colors">No</button>
                </div>
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
                  className="p-1 rounded text-muted hover:text-red-500 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                  title="Delete"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                  </svg>
                </button>
              )}
            </>
          )}
          {!editingTitle && (
            <button onClick={onToggle} className="p-1 ml-1">
              <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 text-muted transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Body — smooth height animation via grid trick */}
      <div className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="px-5 py-4 bg-card">
            {editingContent ? (
              <div className="space-y-2">
                <textarea
                  value={contentInput}
                  onChange={e => setContentInput(e.target.value)}
                  rows={6}
                  className="w-full text-sm text-secondary bg-input border border-default rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400/50 resize-y"
                />
                <div className="flex gap-2">
                  <button onClick={handleSaveContent} disabled={saving} className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => { setContentInput(section.content_text ?? ''); setEditingContent(false) }} className="text-xs text-muted hover:text-secondary transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {section.content_type === 'text' && section.content_text && (
                  <p className="text-sm text-secondary leading-relaxed whitespace-pre-wrap">{section.content_text}</p>
                )}
                {section.content_type === 'list' && Array.isArray(section.content_json) && (
                  <ul className="space-y-2">
                    {(section.content_json as string[]).map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-secondary group/item">
                        <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-full ${colors.bg} ${colors.icon} flex items-center justify-center text-xs font-bold transition-transform duration-150 group-hover/item:scale-110`}>
                          {i + 1}
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                {section.content_type === 'table' && Array.isArray(section.content_json) && section.content_json.length > 0 && (
                  <StyledTable rows={section.content_json as Record<string, unknown>[]} />
                )}
                {!section.content_text && !section.content_json && (
                  <p className="text-sm text-muted italic">No content yet.</p>
                )}
                {canEdit && section.content_type !== 'table' && (
                  <button
                    onClick={() => setEditingContent(true)}
                    className="mt-3 flex items-center gap-1.5 text-xs text-muted hover:text-blue-500 transition-colors"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
                    </svg>
                    Edit content
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Avatar colour palette ─────────────────────────────────────────────────────
const AVATAR_COLORS = [
  { bg: 'bg-blue-500/15',    text: 'text-blue-500',    border: 'border-blue-500/30' },
  { bg: 'bg-violet-500/15',  text: 'text-violet-500',  border: 'border-violet-500/30' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-500', border: 'border-emerald-500/30' },
  { bg: 'bg-orange-500/15',  text: 'text-orange-500',  border: 'border-orange-500/30' },
  { bg: 'bg-rose-500/15',    text: 'text-rose-500',    border: 'border-rose-500/30' },
  { bg: 'bg-cyan-500/15',    text: 'text-cyan-500',    border: 'border-cyan-500/30' },
  { bg: 'bg-amber-500/15',   text: 'text-amber-500',   border: 'border-amber-500/30' },
  { bg: 'bg-indigo-500/15',  text: 'text-indigo-500',  border: 'border-indigo-500/30' },
]

const STATUS_CONFIG: Record<string, { bg: string; text: string; pulse: boolean; label: string }> = {
  draft:       { bg: 'bg-gray-500/10',  text: 'text-gray-400',   pulse: false, label: 'Draft' },
  in_review:   { bg: 'bg-amber-500/10', text: 'text-amber-400',  pulse: true,  label: 'In Review' },
  published:   { bg: 'bg-green-500/10', text: 'text-green-400',  pulse: false, label: 'Published' },
  archived:    { bg: 'bg-red-500/10',   text: 'text-red-400',    pulse: false, label: 'Archived' },
  processing:  { bg: 'bg-blue-500/10',  text: 'text-blue-400',   pulse: true,  label: 'Processing' },
}

function StatCell({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-4 bg-card hover:bg-raised transition-colors cursor-default group">
      <span className="text-2xl font-bold text-default tabular-nums group-hover:scale-105 transition-transform duration-150">
        {value}
      </span>
      <span className="text-[10px] font-semibold text-muted mt-0.5 uppercase tracking-wider">{label}</span>
      {sub && <span className="text-[10px] text-muted mt-0.5">{sub}</span>}
    </div>
  )
}

function SOPDetailsCard({ sop, canEdit }: { sop: any; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [editingCode, setEditingCode] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [showAllParticipants, setShowAllParticipants] = useState(false)

  const projectCodeMutation = useMutation({
    mutationFn: (code: string | null) => setProjectCode(sop.id, code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sopKeys.detail(sop.id) })
      setEditingCode(false)
    },
  })

  const approvedCount = sop.steps.filter((s: any) => s.is_approved).length
  const totalSteps = sop.steps.length
  const approvalPct = totalSteps > 0 ? Math.round((approvedCount / totalSteps) * 100) : 0
  const durationMin = sop.video_duration_sec ? Math.floor(sop.video_duration_sec / 60) : 0
  const durationSec = sop.video_duration_sec ? sop.video_duration_sec % 60 : 0
  const durationStr = sop.video_duration_sec != null ? `${durationMin}m ${String(durationSec).padStart(2, '0')}s` : '—'
  const participants = Array.isArray(sop.meeting_participants) ? sop.meeting_participants as string[] : []
  const MAX_AVATARS = 5
  const visibleAvatars = participants.slice(0, MAX_AVATARS)
  const overflow = participants.length - MAX_AVATARS
  const statusCfg = STATUS_CONFIG[sop.status] ?? STATUS_CONFIG.draft
  const progressColor = approvalPct === 100
    ? '#22c55e'
    : approvalPct >= 50
      ? '#3b82f6'
      : '#a855f7'

  return (
    <div className="bg-card rounded-xl border border-subtle shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-subtle bg-page flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/>
          </svg>
          <span className="text-xs font-semibold text-muted uppercase tracking-wide">SOP Details</span>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${statusCfg.bg} ${statusCfg.text}`}>
          {statusCfg.pulse && (
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${statusCfg.text.replace('text-', 'bg-')}`} />
          )}
          {statusCfg.label.toUpperCase()}
        </span>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 divide-x divide-subtle border-b border-subtle">
        <StatCell label="Steps" value={totalSteps} sub={totalSteps > 0 ? `${approvedCount} approved` : undefined} />
        <StatCell label="Duration" value={durationStr} />
        <StatCell label="Participants" value={participants.length || '—'} />
      </div>

      {/* Approval progress bar */}
      {totalSteps > 0 && (
        <div className="px-5 py-3 border-b border-subtle bg-page/40">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium text-muted">Step approval progress</span>
            <span className="text-[11px] font-bold text-default tabular-nums">{approvalPct}%</span>
          </div>
          <div className="h-2 bg-raised rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${approvalPct}%`, backgroundColor: progressColor }}
            />
          </div>
          <p className="text-[10px] text-muted mt-1.5">
            {approvedCount} of {totalSteps} steps approved
            {approvalPct === 100 && ' ✓'}
          </p>
        </div>
      )}

      {/* Detail rows */}
      <div className="px-5 py-3 space-y-0.5">
        {sop.meeting_date && (
          <div className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-raised transition-colors group">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted shrink-0 group-hover:text-default transition-colors">
              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
            </svg>
            <span className="text-xs text-muted w-24 shrink-0">Meeting date</span>
            <span className="text-sm text-secondary">
              {new Date(sop.meeting_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        )}
        {sop.client_name && (
          <div className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-raised transition-colors group">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted shrink-0 group-hover:text-default transition-colors">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd"/>
            </svg>
            <span className="text-xs text-muted w-24 shrink-0">Client</span>
            <span className="text-sm text-secondary font-medium">{sop.client_name}</span>
          </div>
        )}
        {sop.process_name && (
          <div className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-raised transition-colors group">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted shrink-0 group-hover:text-default transition-colors">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" clipRule="evenodd"/>
            </svg>
            <span className="text-xs text-muted w-24 shrink-0">Process</span>
            <span className="text-sm text-secondary font-medium">{sop.process_name}</span>
          </div>
        )}
        {/* Project Code */}
        <div className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-raised transition-colors group">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted shrink-0 group-hover:text-default transition-colors">
            <path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
          </svg>
          <span className="text-xs text-muted w-24 shrink-0">Project code</span>
          {editingCode ? (
            <div className="flex items-center gap-2">
              <input
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.toUpperCase())}
                onKeyDown={e => {
                  if (e.key === 'Enter') projectCodeMutation.mutate(codeInput || null)
                  if (e.key === 'Escape') setEditingCode(false)
                }}
                className="text-sm bg-input text-secondary border border-default rounded-lg px-3 py-1 w-32 focus:outline-none focus:ring-2 focus:ring-blue-400/50 font-mono"
                placeholder="e.g. GRP-001"
                maxLength={50}
                autoFocus
              />
              <button
                onClick={() => projectCodeMutation.mutate(codeInput || null)}
                disabled={projectCodeMutation.isPending}
                className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >Save</button>
              <button onClick={() => setEditingCode(false)} className="text-xs text-muted hover:text-secondary transition-colors">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {sop.project_code ? (
                <span className="text-sm font-mono font-semibold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
                  {sop.project_code}
                </span>
              ) : (
                <span className="text-sm text-muted">—</span>
              )}
              {canEdit && (
                <button
                  onClick={() => { setCodeInput(sop.project_code || ''); setEditingCode(true) }}
                  className="text-xs text-muted hover:text-blue-500 px-1.5 py-0.5 rounded hover:bg-blue-500/10 transition-all"
                >{sop.project_code ? 'Edit' : 'Set'}</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Participants */}
      {participants.length > 0 && (
        <div className="px-5 py-3.5 border-t border-subtle">
          <div className="flex items-center gap-2 mb-3">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted shrink-0">
              <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"/>
            </svg>
            <span className="text-xs text-muted">Participants</span>
          </div>
          {/* Stacked avatars */}
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {visibleAvatars.map((p, i) => {
                const ac = AVATAR_COLORS[i % AVATAR_COLORS.length]
                return (
                  <div
                    key={p}
                    title={p}
                    className={`w-8 h-8 rounded-full ${ac.bg} border-2 border-card flex items-center justify-center text-[11px] font-bold uppercase cursor-default hover:scale-110 hover:z-10 transition-transform duration-150 ${ac.text}`}
                    style={{ zIndex: MAX_AVATARS - i }}
                  >
                    {p[0]}
                  </div>
                )
              })}
              {overflow > 0 && (
                <button
                  onClick={() => setShowAllParticipants(v => !v)}
                  className="w-8 h-8 rounded-full bg-raised border-2 border-card flex items-center justify-center text-[10px] font-bold text-muted hover:scale-110 hover:bg-card transition-all duration-150"
                  title="Show all participants"
                  style={{ zIndex: 0 }}
                >
                  +{overflow}
                </button>
              )}
            </div>
            {overflow > 0 && (
              <button
                onClick={() => setShowAllParticipants(v => !v)}
                className="text-xs text-muted hover:text-default transition-colors"
              >
                {showAllParticipants ? 'Show less' : `Show all ${participants.length}`}
              </button>
            )}
          </div>
          {/* Expanded name chips */}
          {(showAllParticipants || overflow <= 0) && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {participants.map((p, i) => {
                const ac = AVATAR_COLORS[i % AVATAR_COLORS.length]
                return (
                  <span
                    key={p}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ac.bg} ${ac.text} border ${ac.border}`}
                  >
                    <span className="font-bold">{p[0]}</span>
                    {p}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function OverviewPage() {
  const { id } = useParams({ from: '/sop/$id/overview' })
  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const canEdit = appUser?.role === 'editor' || appUser?.role === 'admin'
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set())
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [addingSection, setAddingSection] = useState(false)
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const newSectionRef = useRef<HTMLInputElement>(null)

  const { data: sop } = useQuery({
    queryKey: sopKeys.detail(id),
    queryFn: () => fetchSOP(id),
  })

  const updateMutation = useMutation({
    mutationFn: ({ sectionId, data }: { sectionId: string; data: { section_title?: string; content_text?: string } }) =>
      updateSection(sectionId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sopKeys.detail(id) }),
  })

  const deleteMutation = useMutation({
    mutationFn: (sectionId: string) => deleteSection(sectionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sopKeys.detail(id) }),
  })

  const createMutation = useMutation({
    mutationFn: (title: string) => createSection(id, { section_title: title, content_type: 'text' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sopKeys.detail(id) })
      setAddingSection(false)
      setNewSectionTitle('')
    },
  })

  async function handleSaveTitle(sectionId: string, title: string) {
    await updateMutation.mutateAsync({ sectionId, data: { section_title: title } })
  }

  async function handleSaveContent(sectionId: string, text: string) {
    await updateMutation.mutateAsync({ sectionId, data: { content_text: text } })
  }

  function handleDelete(sectionId: string) {
    deleteMutation.mutate(sectionId)
  }

  function handleAddSection() {
    if (!newSectionTitle.trim()) return
    createMutation.mutate(newSectionTitle.trim())
  }

  useEffect(() => {
    if (addingSection) newSectionRef.current?.focus()
  }, [addingSection])

  // Scroll to hash section on load
  useEffect(() => {
    if (!sop || sop.sections.length === 0) return
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const el = document.getElementById(hash)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [sop])

  // IntersectionObserver — highlight active TOC item while scrolling
  useEffect(() => {
    if (!sop?.sections.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id.replace('section-', ''))
          }
        })
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    )
    sop.sections.forEach((sec) => {
      const el = document.getElementById(`section-${sec.section_key}`)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [sop?.sections.length])

  const isSectionOpen = useCallback(
    (sectionId: string) => !closedSections.has(sectionId),
    [closedSections],
  )

  const toggleSection = useCallback((sectionId: string) => {
    setClosedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  const allOpen = sop ? sop.sections.every((s) => !closedSections.has(s.id as unknown as string)) : true

  function toggleAll() {
    if (!sop) return
    if (allOpen) {
      setClosedSections(new Set(sop.sections.map((s) => s.id as unknown as string)))
    } else {
      setClosedSections(new Set())
    }
  }

  if (!sop) return null

  return (
    <div className="flex gap-6 items-start">
      {/* ── Main content ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* SOP Details card */}
        <SOPDetailsCard sop={sop} canEdit={canEdit} />

        {/* Sections header + expand/collapse all */}
        {sop.sections.length > 0 && (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">
              {sop.sections.length} section{sop.sections.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={toggleAll}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-default transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                {allOpen
                  ? <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd"/>
                  : <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                }
              </svg>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        )}

        {/* Section cards */}
        {sop.sections.length === 0 ? (
          <div className="text-sm text-muted bg-page rounded-xl p-6 border border-dashed border-default text-center">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-muted mx-auto mb-2">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/>
            </svg>
            No sections generated yet.
          </div>
        ) : (
          <div className="space-y-3">
            {sop.sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                isOpen={isSectionOpen(section.id as unknown as string)}
                onToggle={() => toggleSection(section.id as unknown as string)}
                canEdit={canEdit}
                onSaveTitle={handleSaveTitle}
                onSaveContent={handleSaveContent}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {/* Add section */}
        {canEdit && (
          <div className="pt-1">
            {addingSection ? (
              <div className="flex items-center gap-2 bg-card rounded-xl border border-subtle px-4 py-3 shadow-sm">
                <input
                  ref={newSectionRef}
                  value={newSectionTitle}
                  onChange={e => setNewSectionTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddSection()
                    if (e.key === 'Escape') { setAddingSection(false); setNewSectionTitle('') }
                  }}
                  placeholder="Section title…"
                  className="flex-1 text-sm bg-input border border-default rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-secondary"
                />
                <button
                  onClick={handleAddSection}
                  disabled={!newSectionTitle.trim() || createMutation.isPending}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending ? 'Adding…' : 'Add'}
                </button>
                <button onClick={() => { setAddingSection(false); setNewSectionTitle('') }} className="text-xs text-muted hover:text-secondary transition-colors">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingSection(true)}
                className="flex items-center gap-2 text-xs text-muted hover:text-blue-500 transition-colors px-1"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/>
                </svg>
                Add section
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Sticky TOC sidebar ─────────────────────────────────────────── */}
      {sop.sections.length > 0 && (
        <div className="hidden lg:block w-48 shrink-0">
          <div className="sticky top-4 bg-card rounded-xl border border-subtle shadow-sm overflow-hidden">
            <div className="px-3 py-2.5 border-b border-subtle bg-page">
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">On this page</span>
            </div>
            <nav className="py-2">
              {sop.sections.map((sec) => {
                const colors = SECTION_COLORS[sec.section_key] ?? DEFAULT_COLOR
                const isActive = activeSection === sec.section_key
                return (
                  <a
                    key={sec.id}
                    href={`#section-${sec.section_key}`}
                    onClick={(e) => {
                      e.preventDefault()
                      document.getElementById(`section-${sec.section_key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      setActiveSection(sec.section_key)
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs transition-all duration-150 border-l-2 ${
                      isActive
                        ? `${colors.activeBorder} bg-raised ${colors.icon} font-medium`
                        : 'border-l-transparent text-muted hover:bg-raised hover:text-default'
                    }`}
                  >
                    <span className={`shrink-0 transition-colors duration-150 ${isActive ? colors.icon : 'text-muted'}`}>
                      {SECTION_ICONS[sec.section_key] ?? null}
                    </span>
                    <span className="leading-tight">{sec.section_title}</span>
                  </a>
                )
              })}
            </nav>
          </div>
        </div>
      )}
    </div>
  )
}
