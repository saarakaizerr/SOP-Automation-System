import { createFileRoute, useParams } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { fetchSOP, fetchProcessMap, saveProcessMap, uploadProcessMapImage, createStep, sopKeys } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import type { ProcessMapLane, ProcessMapAssignment, SOPStep, ProcessMapConfig } from '../api/types'
import { InlineLoader } from '../components/PageLoader'

export const Route = createFileRoute('/sop/$id/processmap')({
  component: ProcessMapPage,
})

// ── Colour palette for lanes ──────────────────────────────────────────────────
const LANE_COLORS = [
  '#3B82F6', // blue
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
]

// ── SVG swim-lane generator ───────────────────────────────────────────────────
function generateSwimlane(
  lanes: ProcessMapLane[],
  assignments: ProcessMapAssignment[],
  steps: SOPStep[],
): string {
  if (!lanes.length || !assignments.length) return ''

  const LANE_W = 220
  const ROW_H = 90
  const BOX_W = 180
  const BOX_H = 54
  const HEADER_H = 52
  const MARGIN = 16
  const START_H = 64   // vertical space reserved for Start node
  const END_H = 64     // vertical space reserved for End node

  const W = MARGIN + lanes.length * LANE_W + MARGIN
  const H = MARGIN + HEADER_H + START_H + assignments.length * ROW_H + END_H + MARGIN

  const laneIndex: Record<string, number> = {}
  lanes.forEach((l, i) => { laneIndex[l.id] = i })

  const stepById: Record<string, SOPStep> = {}
  steps.forEach(s => { stepById[s.id] = s })

  // cy is offset by START_H so step rows sit below the Start node
  const boxCenter = (assignIdx: number, laneId: string) => {
    const li = laneIndex[laneId] ?? 0
    return {
      cx: MARGIN + li * LANE_W + LANE_W / 2,
      cy: MARGIN + HEADER_H + START_H + assignIdx * ROW_H + ROW_H / 2,
    }
  }

  const arrowhead = (x: number, y: number) =>
    `<polygon points="${x - 5},${y} ${x + 5},${y} ${x},${y + 8}" fill="#94A3B8"/>`

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif">`

  // Background
  svg += `<rect width="${W}" height="${H}" fill="#F8FAFC" rx="8"/>`

  // Lane column backgrounds + headers
  lanes.forEach((lane, i) => {
    const lx = MARGIN + i * LANE_W
    const isEven = i % 2 === 0
    svg += `<rect x="${lx}" y="${MARGIN}" width="${LANE_W}" height="${H - MARGIN * 2}" fill="${isEven ? '#FFFFFF' : '#F1F5F9'}" rx="0"/>`
    svg += `<rect x="${lx}" y="${MARGIN}" width="${LANE_W}" height="${HEADER_H}" fill="${lane.color}" rx="0"/>`
    svg += `<text x="${lx + LANE_W / 2}" y="${MARGIN + HEADER_H / 2 + 5}" text-anchor="middle" font-size="13" font-weight="600" fill="#FFFFFF">${escapeXml(lane.name)}</text>`
    if (i > 0) {
      svg += `<line x1="${lx}" y1="${MARGIN}" x2="${lx}" y2="${H - MARGIN}" stroke="#CBD5E1" stroke-width="1"/>`
    }
  })

  // Outer border
  svg += `<rect x="${MARGIN}" y="${MARGIN}" width="${W - MARGIN * 2}" height="${H - MARGIN * 2}" fill="none" stroke="#CBD5E1" stroke-width="1.5" rx="4"/>`

  // ── Start node ──────────────────────────────────────────────────────────────
  const firstLaneIdx = laneIndex[assignments[0].lane_id] ?? 0
  const startCx = MARGIN + firstLaneIdx * LANE_W + LANE_W / 2
  const startCy = MARGIN + HEADER_H + START_H / 2
  svg += `<ellipse cx="${startCx}" cy="${startCy}" rx="44" ry="20" fill="#22C55E" stroke="#15803D" stroke-width="2"/>`
  svg += `<text x="${startCx}" y="${startCy + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="#FFFFFF">Start</text>`
  // Arrow: Start → first step
  const firstStep = boxCenter(0, assignments[0].lane_id)
  const startArrowY2 = firstStep.cy - BOX_H / 2 - 8
  svg += `<line x1="${startCx}" y1="${startCy + 20}" x2="${startCx}" y2="${startArrowY2}" stroke="#94A3B8" stroke-width="1.5"/>`
  svg += arrowhead(startCx, startArrowY2)

  // ── Step arrows (behind boxes) ──────────────────────────────────────────────
  assignments.forEach((asgn, i) => {
    if (i >= assignments.length - 1) return
    const from = boxCenter(i, asgn.lane_id)
    const to = boxCenter(i + 1, assignments[i + 1].lane_id)

    const decisionHH = BOX_H / 2 + 4
    const x1 = from.cx
    const y1 = asgn.is_decision ? from.cy + decisionHH : from.cy + BOX_H / 2
    const x2 = to.cx
    const y2 = assignments[i + 1].is_decision
      ? to.cy - (BOX_H / 2 + 4) - 8
      : to.cy - BOX_H / 2 - 8

    if (Math.abs(x1 - x2) < 4) {
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2 + 6}" stroke="#94A3B8" stroke-width="1.5"/>`
    } else {
      const midY = from.cy + ROW_H / 2
      svg += `<polyline points="${x1},${y1} ${x1},${midY} ${x2},${midY} ${x2},${y2 + 6}" stroke="#94A3B8" stroke-width="1.5" fill="none"/>`
    }
    svg += arrowhead(x2, y2 + 6)

    // "Yes" label on downward connector from a decision node
    if (asgn.is_decision) {
      const labelX = x1 + 6
      const labelY = y1 + (y2 - y1) / 2
      svg += `<text x="${labelX}" y="${labelY}" font-size="10" fill="#22C55E" font-weight="600">Yes</text>`
    }
  })

  // ── Step boxes ──────────────────────────────────────────────────────────────
  assignments.forEach((asgn, i) => {
    const { cx, cy } = boxCenter(i, asgn.lane_id)
    const x = cx - BOX_W / 2
    const y = cy - BOX_H / 2
    const step = stepById[asgn.step_id]
    const seqNum = step ? step.sequence : i + 1
    const title = step ? step.title : 'Unknown step'
    const lane = lanes.find(l => l.id === asgn.lane_id)
    const color = lane?.color ?? '#6B7280'

    if (asgn.is_decision) {
      const hw = BOX_W / 2
      const hh = BOX_H / 2 + 4
      svg += `<polygon points="${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}" fill="#FFFBEB" stroke="${color}" stroke-width="2"/>`
      svg += `<text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="10" fill="#92400E">${seqNum}. ${escapeXml(truncate(title, 24))}</text>`
      svg += `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="9" fill="#92400E" opacity="0.7">Decision</text>`

      // "No" branch — stays inside SVG right margin
      const noTargetIdx = asgn.no_target_step_id
        ? assignments.findIndex(a => a.step_id === asgn.no_target_step_id)
        : -1
      const noLabel = `<text x="${cx + hw + 6}" y="${cy - 5}" font-size="10" fill="#EF4444" font-weight="600">No</text>`
      if (noTargetIdx >= 0) {
        const target = boxCenter(noTargetIdx, assignments[noTargetIdx].lane_id)
        // Route: right of diamond → right rail (inside SVG) → target row → into target box right side
        const rail = W - MARGIN - 8
        const targetEntryX = target.cx + BOX_W / 2
        svg += `<polyline points="${cx + hw},${cy} ${rail},${cy} ${rail},${target.cy} ${targetEntryX + 6},${target.cy}" stroke="#EF4444" stroke-width="1.5" stroke-dasharray="5,3" fill="none"/>`
        // Arrowhead pointing LEFT into target box
        svg += `<polygon points="${targetEntryX + 8},${target.cy - 5} ${targetEntryX},${target.cy} ${targetEntryX + 8},${target.cy + 5}" fill="#EF4444"/>`
        svg += noLabel
      } else {
        // No target — stub with vertical terminator bar
        const noX1 = cx + hw
        const noX2 = Math.min(W - MARGIN - 10, noX1 + 52)
        svg += `<line x1="${noX1}" y1="${cy}" x2="${noX2}" y2="${cy}" stroke="#EF4444" stroke-width="1.5" stroke-dasharray="4,3"/>`
        svg += `<line x1="${noX2}" y1="${cy - 7}" x2="${noX2}" y2="${cy + 7}" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round"/>`
        svg += noLabel
      }
    } else {
      svg += `<rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="8" fill="#FFFFFF" stroke="${color}" stroke-width="2" filter="url(#shadow)"/>`
      svg += `<circle cx="${x + 18}" cy="${cy}" r="12" fill="${color}"/>`
      svg += `<text x="${x + 18}" y="${cy + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#FFFFFF">${seqNum}</text>`
      const lines = wrapText(title, 22)
      const startY = cy - (lines.length - 1) * 7
      lines.forEach((line, li) => {
        svg += `<text x="${x + 36}" y="${startY + li * 14}" font-size="11" fill="#1E293B">${escapeXml(line)}</text>`
      })
    }
  })

  // ── End node ────────────────────────────────────────────────────────────────
  const lastAsgn = assignments[assignments.length - 1]
  const lastLaneIdx = laneIndex[lastAsgn.lane_id] ?? 0
  const endCx = MARGIN + lastLaneIdx * LANE_W + LANE_W / 2
  const endCy = MARGIN + HEADER_H + START_H + assignments.length * ROW_H + END_H / 2
  const lastStep = boxCenter(assignments.length - 1, lastAsgn.lane_id)
  const lastBottomY = lastAsgn.is_decision ? lastStep.cy + BOX_H / 2 + 4 : lastStep.cy + BOX_H / 2
  svg += `<line x1="${endCx}" y1="${lastBottomY}" x2="${endCx}" y2="${endCy - 20}" stroke="#94A3B8" stroke-width="1.5"/>`
  svg += arrowhead(endCx, endCy - 22)
  svg += `<ellipse cx="${endCx}" cy="${endCy}" rx="40" ry="20" fill="#EF4444" stroke="#B91C1C" stroke-width="2"/>`
  svg += `<text x="${endCx}" y="${endCy + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="#FFFFFF">End</text>`

  svg += `<defs><filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.08"/></filter></defs>`
  svg += `</svg>`
  return svg
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars) {
      if (current) lines.push(current.trim())
      current = w
    } else {
      current = (current + ' ' + w).trim()
    }
    if (lines.length >= 2) break
  }
  if (current && lines.length < 2) lines.push(current.trim())
  if (lines.length === 2 && lines[1].length > maxChars) lines[1] = lines[1].slice(0, maxChars - 1) + '…'
  return lines
}

// ── Wizard steps ──────────────────────────────────────────────────────────────

function LaneEditor({
  lanes,
  onChange,
}: {
  lanes: ProcessMapLane[]
  onChange: (lanes: ProcessMapLane[]) => void
}) {
  const add = () => {
    const id = `lane-${Date.now()}`
    const color = LANE_COLORS[lanes.length % LANE_COLORS.length]
    onChange([...lanes, { id, name: '', color }])
  }

  const update = (idx: number, patch: Partial<ProcessMapLane>) => {
    const next = lanes.map((l, i) => (i === idx ? { ...l, ...patch } : l))
    onChange(next)
  }

  const remove = (idx: number) => onChange(lanes.filter((_, i) => i !== idx))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-default">Define Swim Lanes</h2>
          <p className="text-sm text-muted mt-0.5">Add a lane for each role involved in this process (e.g. "Manager", "Processor", "QC Team")</p>
        </div>
        <button
          onClick={add}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/>
          </svg>
          Add Lane
        </button>
      </div>

      {lanes.length === 0 && (
        <div className="border-2 border-dashed border-default rounded-xl py-12 text-center">
          <svg viewBox="0 0 48 48" fill="none" className="w-12 h-12 mx-auto mb-3 text-gray-300">
            <rect x="4" y="8" width="12" height="32" rx="2" fill="currentColor" opacity="0.4"/>
            <rect x="18" y="8" width="12" height="32" rx="2" fill="currentColor" opacity="0.6"/>
            <rect x="32" y="8" width="12" height="32" rx="2" fill="currentColor" opacity="0.4"/>
          </svg>
          <p className="text-muted text-sm">No lanes yet — click "Add Lane" to get started</p>
        </div>
      )}

      <div className="space-y-3">
        {lanes.map((lane, i) => (
          <div key={lane.id} className="flex items-center gap-3 bg-card border border-default rounded-xl px-4 py-3 shadow-sm">
            {/* Drag handle visual */}
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-300 shrink-0">
              <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0 .001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"/>
            </svg>

            {/* Color swatch picker */}
            <div className="flex gap-1.5 shrink-0">
              {LANE_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => update(i, { color: c })}
                  style={{ background: c }}
                  className={`w-5 h-5 rounded-full transition-transform ${lane.color === c ? 'ring-2 ring-offset-1 ring-gray-900 scale-110' : 'hover:scale-110'}`}
                />
              ))}
            </div>

            {/* Lane name */}
            <input
              value={lane.name}
              onChange={e => update(i, { name: e.target.value })}
              placeholder={`Lane ${i + 1} name (e.g. "Processor")`}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted text-secondary"
            />

            {/* Delete */}
            <button
              onClick={() => remove(i)}
              className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
              </svg>
            </button>
          </div>
        ))}
      </div>

      {lanes.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
          </svg>
          Click a colour swatch to change a lane's colour in the diagram
        </div>
      )}
    </div>
  )
}

function StepAssigner({
  lanes,
  assignments,
  steps,
  onChange,
  onAddStep,
}: {
  lanes: ProcessMapLane[]
  assignments: ProcessMapAssignment[]
  steps: SOPStep[]
  onChange: (a: ProcessMapAssignment[]) => void
  onAddStep: (title: string) => Promise<void>
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [addingStep, setAddingStep] = useState(false)
  const [newStepTitle, setNewStepTitle] = useState('')
  const [addPending, setAddPending] = useState(false)

  const update = (idx: number, patch: Partial<ProcessMapAssignment>) => {
    onChange(assignments.map((a, i) => (i === idx ? { ...a, ...patch } : a)))
  }

  const excludedSteps = steps.filter(s => !assignments.find(a => a.step_id === s.id))

  async function submitNewStep() {
    const title = newStepTitle.trim()
    if (!title) return
    setAddPending(true)
    try {
      await onAddStep(title)
      setNewStepTitle('')
      setAddingStep(false)
    } finally {
      setAddPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-default">Assign Steps to Lanes</h2>
        <p className="text-sm text-muted mt-0.5">Drag to reorder. Assign each step to a lane and optionally mark decision points.</p>
      </div>

      <div className="space-y-2">
        {assignments.map((asgn, i) => {
          const step = steps.find(s => s.id === asgn.step_id)
          if (!step) return null
          const selectedLane = lanes.find(l => l.id === asgn.lane_id)

          return (
            <div
              key={asgn.step_id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => { e.preventDefault(); setDragOverIdx(i) }}
              onDrop={() => {
                if (dragIdx === null || dragIdx === i) return
                const next = [...assignments]
                const [moved] = next.splice(dragIdx, 1)
                next.splice(i, 0, moved)
                onChange(next)
                setDragIdx(null); setDragOverIdx(null)
              }}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
              className={`flex items-center gap-3 bg-card border rounded-xl px-4 py-3 shadow-sm transition-colors ${
                dragOverIdx === i ? 'border-blue-400 bg-blue-500/10' : 'border-default hover:border-default'
              }`}
            >
              {/* Drag handle */}
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-300 shrink-0 cursor-grab active:cursor-grabbing">
                <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0 .001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"/>
              </svg>

              {/* Step number badge */}
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ background: selectedLane?.color ?? '#9CA3AF' }}
              >
                {step.sequence}
              </span>

              {/* Step title */}
              <span className="flex-1 text-sm text-secondary min-w-0 truncate">{step.title}</span>

              {/* Decision toggle */}
              <label className="flex items-center gap-1.5 text-xs text-muted shrink-0 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={asgn.is_decision}
                  onChange={e => update(i, { is_decision: e.target.checked, no_target_step_id: null })}
                  className="w-3.5 h-3.5 accent-amber-500"
                />
                Decision
              </label>

              {/* No branch target — only visible when is_decision */}
              {asgn.is_decision && (
                <select
                  value={asgn.no_target_step_id ?? ''}
                  onChange={e => update(i, { no_target_step_id: e.target.value || null })}
                  className="text-xs border border-red-300 rounded-lg px-2 py-1.5 bg-card text-red-600 shrink-0 focus:outline-none focus:ring-2 focus:ring-red-400 max-w-[130px]"
                  title="No branch goes to…"
                >
                  <option value="">No → (unset)</option>
                  {assignments
                    .filter((_, j) => j !== i)
                    .map(a => {
                      const s = steps.find(st => st.id === a.step_id)
                      return s ? (
                        <option key={s.id} value={s.id}>No → Step {s.sequence}</option>
                      ) : null
                    })}
                </select>
              )}

              {/* Lane selector */}
              <select
                value={asgn.lane_id}
                onChange={e => update(i, { lane_id: e.target.value })}
                className="text-sm border border-default rounded-lg px-2 py-1.5 bg-card text-secondary shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {lanes.map(l => (
                  <option key={l.id} value={l.id}>{l.name || `Lane ${lanes.indexOf(l) + 1}`}</option>
                ))}
              </select>

              {/* Remove from diagram */}
              <button
                onClick={() => onChange(assignments.filter((_, j) => j !== i))}
                title="Remove from diagram"
                className="text-gray-300 hover:text-red-400 transition-colors shrink-0 ml-1"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </button>
            </div>
          )
        })}
      </div>

      {excludedSteps.length > 0 && (
        <div className="mt-4 pt-4 border-t border-subtle">
          <p className="text-xs text-muted mb-2">Excluded from diagram</p>
          {excludedSteps.map(s => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2 bg-page rounded-lg text-sm text-muted mb-1">
              <span className="flex-1">{s.sequence}. {s.title}</span>
              <button
                onClick={() => onChange([...assignments, { step_id: s.id, lane_id: lanes[0]?.id ?? '', is_decision: false }])}
                className="text-xs text-blue-500 hover:text-blue-700 font-medium"
              >+ Add back</button>
            </div>
          ))}
        </div>
      )}

      {/* Add new step */}
      <div className="pt-3 border-t border-subtle">
        {addingStep ? (
          <div className="flex items-center gap-2 bg-card border border-blue-500/30 rounded-xl px-4 py-3 shadow-sm">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-500 shrink-0">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/>
            </svg>
            <input
              autoFocus
              value={newStepTitle}
              onChange={e => setNewStepTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submitNewStep()
                if (e.key === 'Escape') { setAddingStep(false); setNewStepTitle('') }
              }}
              placeholder="Step title…"
              className="flex-1 text-sm bg-transparent outline-none text-default placeholder:text-muted"
            />
            <button
              onClick={submitNewStep}
              disabled={!newStepTitle.trim() || addPending}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >{addPending ? 'Adding…' : 'Add'}</button>
            <button
              onClick={() => { setAddingStep(false); setNewStepTitle('') }}
              className="text-xs px-2.5 py-1.5 bg-raised text-muted rounded-lg border border-subtle hover:bg-card transition-colors"
            >Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setAddingStep(true)}
            className="flex items-center gap-2 text-sm text-blue-500 hover:text-blue-600 font-medium transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/>
            </svg>
            Add new step
          </button>
        )}
      </div>
    </div>
  )
}

function PreviewPane({
  lanes,
  assignments,
  steps,
  isSaving,
  onSave,
}: {
  lanes: ProcessMapLane[]
  assignments: ProcessMapAssignment[]
  steps: SOPStep[]
  isSaving: boolean
  onSave: () => void
}) {
  const svgMarkup = generateSwimlane(lanes, assignments, steps)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-default">Preview & Save</h2>
          <p className="text-sm text-muted mt-0.5">This diagram will be embedded in your DOCX/PDF export.</p>
        </div>
        <button
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
        >
          {isSaving ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Saving…
            </>
          ) : (
            <>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
              Save Process Map
            </>
          )}
        </button>
      </div>

      {svgMarkup ? (
        <div className="bg-card border border-default rounded-xl overflow-auto shadow-sm">
          <div
            className="min-w-max p-4"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        </div>
      ) : (
        <div className="border-2 border-dashed border-default rounded-xl py-16 text-center text-muted text-sm">
          Complete lanes and step assignments to see a preview
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-green-500 inline-block"/>
          Start
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-red-500 inline-block"/>
          End
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded bg-card border-2 inline-block" style={{ borderColor: '#3B82F6' }}/>
          Standard step
        </span>
        <span className="flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" className="w-4 h-4" style={{ color: '#F59E0B' }}>
            <polygon points="8,1 15,8 8,15 1,8" fill="none" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          Decision (Yes ↓ / No →)
        </span>
      </div>
    </div>
  )
}

// ── Confirm & Upload pane (step 4) ────────────────────────────────────────────

function ConfirmPane({
  lanes, assignments, steps, sopId, currentConfig, isSaving, onConfirmed,
}: {
  lanes: ProcessMapLane[]
  assignments: ProcessMapAssignment[]
  steps: SOPStep[]
  sopId: string
  currentConfig: ProcessMapConfig | null
  isSaving: boolean
  onConfirmed: (confirmedUrl: string | null, confirmedAt: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const svgMarkup = generateSwimlane(lanes, assignments, steps)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError(null)
    try {
      const result = await uploadProcessMapImage(sopId, file)
      onConfirmed(result.confirmed_url, result.confirmed_at)
    } catch (err: any) {
      setError(err.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-default">Confirm Process Map</h2>
        <p className="text-sm text-muted mt-0.5">
          Review the auto-generated diagram below. Confirm it as-is, or upload a corrected PNG — the confirmed version will be embedded in your DOCX/PDF export.
        </p>
      </div>

      {/* Preview: show uploaded image if confirmed, otherwise auto-generated SVG */}
      <div className="bg-card border border-default rounded-xl overflow-auto shadow-sm">
        {currentConfig?.confirmed_url ? (
          <img src={currentConfig.confirmed_url} alt="Confirmed process map" className="max-w-full p-4" />
        ) : svgMarkup ? (
          <div className="min-w-max p-4" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
        ) : (
          <p className="p-8 text-center text-muted text-sm">No diagram — complete steps 1 and 2 first.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Option A: confirm auto-generated */}
        <button
          onClick={() => onConfirmed(null, new Date().toISOString())}
          disabled={isSaving}
          className="flex flex-col items-center gap-2 p-5 border-2 border-default rounded-xl hover:border-green-400 hover:bg-green-500/10 disabled:opacity-50 transition-colors text-sm text-secondary"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-green-500">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span className="font-medium">Confirm auto-generated</span>
          <span className="text-xs text-muted text-center">Use the diagram above in exports</span>
        </button>

        {/* Option B: upload corrected PNG */}
        <label className="flex flex-col items-center gap-2 p-5 border-2 border-dashed border-default rounded-xl hover:border-blue-400 hover:bg-blue-500/10 transition-colors text-sm text-secondary cursor-pointer">
          {uploading
            ? <svg className="animate-spin w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-blue-400"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
          }
          <span className="font-medium">{uploading ? 'Uploading…' : 'Upload corrected PNG'}</span>
          <span className="text-xs text-muted text-center">Replace with your own diagram</span>
          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFileUpload} disabled={uploading} />
        </label>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {currentConfig?.is_confirmed && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-sm text-green-500">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
          {currentConfig.confirmed_url
            ? `Using uploaded PNG — confirmed ${new Date(currentConfig.confirmed_at!).toLocaleDateString()}`
            : `Using auto-generated diagram — confirmed ${new Date(currentConfig.confirmed_at!).toLocaleDateString()}`
          }
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function ProcessMapPage() {
  const { id } = useParams({ from: '/sop/$id/processmap' })
  const qc = useQueryClient()
  const { appUser } = useAuth()
  const canEdit = appUser?.role === 'editor' || appUser?.role === 'admin'

  const { data: sopData, isLoading: sopLoading } = useQuery({
    queryKey: sopKeys.detail(id),
    queryFn: () => fetchSOP(id),
  })

  const { data: pmData, isLoading: pmLoading } = useQuery({
    queryKey: sopKeys.processMap(id),
    queryFn: () => fetchProcessMap(id),
  })

  const [isEditing, setIsEditing] = useState(false)
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2 | 3>(0)
  const [lanes, setLanes] = useState<ProcessMapLane[]>([])
  const [assignments, setAssignments] = useState<ProcessMapAssignment[]>([])
  const [saved, setSaved] = useState(false)
  const [initialised, setInitialised] = useState(false)

  // Initialise ONCE from existing config or build default assignments from SOP steps
  useEffect(() => {
    if (!sopData || initialised) return
    const existing = pmData?.process_map_config
    if (existing?.lanes?.length) {
      setLanes(existing.lanes)
      setAssignments(existing.assignments ?? [])
    } else {
      const defaultLane: ProcessMapLane = { id: 'lane-default', name: 'Team', color: LANE_COLORS[0] }
      setLanes([defaultLane])
      setAssignments(
        (sopData.steps ?? []).map(s => ({
          step_id: s.id,
          lane_id: 'lane-default',
          is_decision: false,
        }))
      )
    }
    setInitialised(true)
  }, [sopData, pmData, initialised])

  const handleLanesChange = (next: ProcessMapLane[]) => {
    setLanes(next)
    if (next.length === 0) return
    const validIds = new Set(next.map(l => l.id))
    setAssignments(prev =>
      prev.map(a => ({
        ...a,
        lane_id: validIds.has(a.lane_id) ? a.lane_id : next[0].id,
      }))
    )
  }

  const saveMutation = useMutation({
    mutationFn: (confirmOverride?: { is_confirmed: boolean; confirmed_url: string | null; confirmed_at: string }) =>
      saveProcessMap(id, {
        lanes,
        assignments,
        is_confirmed: confirmOverride?.is_confirmed ?? pmData?.process_map_config?.is_confirmed ?? false,
        confirmed_url: confirmOverride?.confirmed_url !== undefined ? confirmOverride.confirmed_url : pmData?.process_map_config?.confirmed_url ?? null,
        confirmed_at: confirmOverride?.confirmed_at ?? pmData?.process_map_config?.confirmed_at ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sopKeys.processMap(id) })
      qc.invalidateQueries({ queryKey: sopKeys.detail(id) })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const handleConfirmed = (confirmedUrl: string | null, confirmedAt: string) => {
    saveMutation.mutate(
      { is_confirmed: true, confirmed_url: confirmedUrl, confirmed_at: confirmedAt },
      { onSuccess: () => setIsEditing(false) }
    )
  }

  async function handleAddStep(title: string) {
    const newStep = await createStep(id, title)
    if (!newStep) return
    // Patch cache in-place so the useEffect (initialised guard) doesn't reset assignments
    qc.setQueryData(sopKeys.detail(id), (old: any) =>
      old ? { ...old, steps: [...(old.steps ?? []), newStep] } : old
    )
    setAssignments(prev => [...prev, { step_id: newStep.id, lane_id: lanes[0]?.id ?? '', is_decision: false }])
  }

  if (sopLoading || pmLoading) {
    return (
      <InlineLoader label="Loading process map…" />
    )
  }

  const steps = sopData?.steps ?? []

  // Viewer: read-only preview only
  if (!canEdit) {
    const svg = generateSwimlane(lanes, assignments, steps)
    return (
      <div className="max-w-4xl space-y-4">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-600">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 shrink-0">
            <path fillRule="evenodd" d="M8 1a7 7 0 110 14A7 7 0 018 1zm-.75 3.75a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5ZM8 11a1 1 0 110 2 1 1 0 010-2z" clipRule="evenodd"/>
          </svg>
          You have view-only access. Contact an editor or admin to modify the process map.
        </div>
        {svg ? (
          <div className="bg-card rounded-xl border border-subtle shadow-sm p-4 overflow-x-auto">
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-subtle shadow-sm p-10 text-center text-muted text-sm">
            No process map configured yet.
          </div>
        )}
      </div>
    )
  }

  const isConfirmed = pmData?.process_map_config?.is_confirmed === true

  // ── Confirmed view ────────────────────────────────────────────────────────────
  if (isConfirmed && !isEditing) {
    const config = pmData!.process_map_config!
    const confirmedAt = config.confirmed_at
      ? new Date(config.confirmed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : null
    const svgMarkup = generateSwimlane(lanes, assignments, steps)

    return (
      <div className="max-w-4xl space-y-4">
        {/* Header bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-500">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-default">
                {config.confirmed_url ? 'Custom diagram confirmed' : 'Auto-generated diagram confirmed'}
              </p>
              {confirmedAt && <p className="text-xs text-muted">Confirmed {confirmedAt} · used in DOCX/PDF exports</p>}
            </div>
          </div>
          <button
            onClick={() => { setIsEditing(true); setWizardStep(0) }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold border border-default text-secondary rounded-xl hover:bg-raised transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
            </svg>
            Edit Process Map
          </button>
        </div>

        {/* Diagram */}
        <div className="bg-card rounded-xl border border-subtle shadow-sm overflow-auto">
          {config.confirmed_url ? (
            <img src={config.confirmed_url} alt="Confirmed process map" className="max-w-full p-4" />
          ) : svgMarkup ? (
            <div className="min-w-max p-4" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
          ) : (
            <p className="p-8 text-center text-muted text-sm">Diagram data unavailable — click Edit to reconfigure.</p>
          )}
        </div>
      </div>
    )
  }

  const canProceed0 = lanes.length > 0 && lanes.every(l => l.name.trim())
  const canProceed1 = assignments.length > 0

  const WIZARD_LABELS = ['1. Define Lanes', '2. Assign Steps', '3. Preview', '4. Confirm']

  return (
    <div className="max-w-4xl space-y-6">
      {/* Back to diagram (only when editing an already-confirmed map) */}
      {isConfirmed && isEditing && (
        <button
          onClick={() => setIsEditing(false)}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-secondary transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
          Back to confirmed diagram
        </button>
      )}

      {/* Wizard progress bar */}
      <div className="bg-card rounded-xl border border-subtle shadow-sm p-5">
        <div className="flex items-center gap-0">
          {WIZARD_LABELS.map((label, i) => (
            <div key={i} className="flex items-center flex-1">
              <button
                onClick={() => {
                  if (i === 0 || (i === 1 && canProceed0) || (i === 2 && canProceed0 && canProceed1) || (i === 3 && canProceed0 && canProceed1)) {
                    setWizardStep(i as 0 | 1 | 2 | 3)
                  }
                }}
                className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                  i === wizardStep
                    ? 'text-blue-600'
                    : i < wizardStep
                    ? 'text-green-600 cursor-pointer hover:text-green-700'
                    : 'text-muted cursor-default'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === wizardStep
                      ? 'bg-blue-600 text-white'
                      : i < wizardStep
                      ? 'bg-green-500 text-white'
                      : 'bg-raised text-muted'
                  }`}
                >
                  {i < wizardStep ? (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z"/>
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
              {i < WIZARD_LABELS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-3 ${i < wizardStep ? 'bg-green-400' : 'bg-raised'}`}/>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Saved banner */}
      {saved && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl px-5 py-3 text-sm text-green-500 font-medium">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
          Process map saved — it will be used in your next DOCX/PDF export.
        </div>
      )}

      {/* Wizard content */}
      <div className="bg-card rounded-xl border border-subtle shadow-sm p-6">
        {wizardStep === 0 && (
          <LaneEditor lanes={lanes} onChange={handleLanesChange} />
        )}
        {wizardStep === 1 && (
          <StepAssigner
            lanes={lanes}
            assignments={assignments}
            steps={steps}
            onChange={setAssignments}
            onAddStep={handleAddStep}
          />
        )}
        {wizardStep === 2 && (
          <PreviewPane
            lanes={lanes}
            assignments={assignments}
            steps={steps}
            isSaving={saveMutation.isPending}
            onSave={() => saveMutation.mutate(undefined)}
          />
        )}
        {wizardStep === 3 && (
          <ConfirmPane
            lanes={lanes}
            assignments={assignments}
            steps={steps}
            sopId={id}
            currentConfig={pmData?.process_map_config ?? null}
            isSaving={saveMutation.isPending}
            onConfirmed={handleConfirmed}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setWizardStep(prev => (prev > 0 ? ((prev - 1) as 0 | 1 | 2 | 3) : prev))}
          disabled={wizardStep === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm text-muted border border-default rounded-xl hover:bg-raised disabled:opacity-40 transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
          Back
        </button>

        {wizardStep < 3 && (
          <button
            onClick={() => setWizardStep((wizardStep + 1) as 1 | 2 | 3)}
            disabled={
              (wizardStep === 0 && !canProceed0) ||
              (wizardStep === 1 && !canProceed1) ||
              (wizardStep === 2 && !canProceed1)
            }
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-sm"
          >
            Next
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
            </svg>
          </button>
        )}
      </div>

      {/* Help tip */}
      {wizardStep === 0 && lanes.length === 0 && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-5 py-4 text-sm text-blue-600">
          <strong>How it works:</strong> A swim-lane diagram shows who does what at each step of the process.
          Each lane represents a role (e.g. "Finance Manager", "Clerk", "QC Team").
          You then assign each SOP step to the role responsible for it.
          The resulting diagram is automatically included in your DOCX/PDF export.
        </div>
      )}
    </div>
  )
}
