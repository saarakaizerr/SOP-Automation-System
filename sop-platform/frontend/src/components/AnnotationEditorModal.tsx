import { useState, useRef, useEffect } from 'react'
import { Stage, Layer, Shape, Text, Group, Rect, Transformer } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type Konva from 'konva'
import { useQueryClient } from '@tanstack/react-query'
import type { StepCallout, CalloutPatchItem, HighlightBox } from '../api/types'
import { patchCallouts, renderAnnotated, sopKeys, addCallout, patchHighlightBoxes, deleteCallout } from '../api/client'

type EditorMode = 'move' | 'add' | 'draw'

interface Props {
  sopId: string
  stepId: string
  stepTitle: string
  stepNumber: number
  screenshotUrl: string
  callouts: StepCallout[]
  highlight_boxes: HighlightBox[]
  onClose: () => void
}

interface LocalCallout extends StepCallout {
  x_px: number   // live-editing position in original image pixels
  y_px: number
}

interface LocalBox {
  id: string
  x_px: number
  y_px: number
  w_px: number
  h_px: number
  color: 'yellow' | 'red' | 'green' | 'blue'
}

interface NaturalDims { w: number; h: number }

interface StageDimensions { width: number; height: number }

const BOX_COLORS = {
  yellow: { fill: 'transparent', stroke: 'rgba(234,179,8,1.0)'  },
  red:    { fill: 'transparent', stroke: 'rgba(220,38,38,1.0)'  },
  green:  { fill: 'transparent', stroke: 'rgba(22,163,74,1.0)'  },
  blue:   { fill: 'transparent', stroke: 'rgba(59,130,246,1.0)' },
}

function dotColor(c: LocalCallout): string {
  if (c.was_repositioned) return '#3b82f6'
  if (c.confidence === 'ocr_exact' || c.confidence === 'ocr_fuzzy') return '#10b981'
  return '#f59e0b'
}

function confidenceLabel(c: LocalCallout): string {
  if (c.was_repositioned) return 'repositioned'
  if (c.confidence === 'ocr_exact') return 'ocr_exact'
  if (c.confidence === 'ocr_fuzzy') return 'ocr_fuzzy'
  return 'gemini'
}

export function AnnotationEditorModal({
  sopId, stepId, stepTitle, stepNumber, screenshotUrl, callouts, highlight_boxes, onClose,
}: Props) {
  const qc = useQueryClient()

  const [local, setLocal] = useState<LocalCallout[]>(() =>
    callouts.map((c) => ({ ...c, x_px: c.target_x, y_px: c.target_y })),
  )
  const [boxes, setBoxes] = useState<LocalBox[]>(() =>
    (highlight_boxes || []).map(b => ({ id: b.id, x_px: b.x, y_px: b.y, w_px: b.w, h_px: b.h, color: b.color }))
  )
  const [deletedIds, setDeletedIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const boxRefs = useRef<Map<string, Konva.Rect>>(new Map())
  const transformerRef = useRef<Konva.Transformer>(null)
  const [rerenderUrl, setRerenderUrl] = useState<string | null>(null)

  const [mode, setMode] = useState<EditorMode>('move')
  const [drawColor, setDrawColor] = useState<'yellow' | 'red' | 'green' | 'blue'>('yellow')
  const [drawStart, setDrawStart] = useState<{x: number; y: number} | null>(null)
  const [drawPreview, setDrawPreview] = useState<{x: number; y: number; w: number; h: number} | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)

  // Stage dimensions = rendered img dimensions (not natural — avoids drag offset)
  const [stageDim, setStageDim] = useState<StageDimensions>({ width: 720, height: 450 })
  // Natural image dimensions — needed to convert raw pixel coords → stage pixels
  const [naturalDims, setNaturalDims] = useState<NaturalDims>({ w: 1920, h: 1080 })
  const imgRef = useRef<HTMLImageElement>(null)

  function measureImg() {
    if (imgRef.current) {
      const rect = imgRef.current.getBoundingClientRect()
      setStageDim({ width: rect.width, height: rect.height })
      if (imgRef.current.naturalWidth > 0) {
        setNaturalDims({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight })
      }
    }
  }

  useEffect(() => {
    window.addEventListener('resize', measureImg)
    return () => window.removeEventListener('resize', measureImg)
  }, [])

  useEffect(() => {
    if (!transformerRef.current) return
    if (activeBoxId) {
      const node = boxRefs.current.get(activeBoxId)
      if (node) {
        transformerRef.current.nodes([node])
        transformerRef.current.getLayer()?.batchDraw()
      }
    } else {
      transformerRef.current.nodes([])
      transformerRef.current.getLayer()?.batchDraw()
    }
  }, [activeBoxId])

  // Convert rendered stage pixel → raw pixel coord
  const toNative = (stagePx: number, stageDimension: number, naturalDim: number) =>
    Math.round((stagePx / stageDimension) * naturalDim)

  function handleDragEnd(id: string, e: KonvaEventObject<DragEvent>) {
    const { width, height } = stageDim
    const { w: nw, h: nh } = naturalDims
    const clampedX = Math.max(0, Math.min(width, e.target.x()))
    const clampedY = Math.max(0, Math.min(height, e.target.y()))
    setLocal((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              x_px: toNative(clampedX, width, nw),
              y_px: toNative(clampedY, height, nh),
              was_repositioned: true,
            }
          : c,
      ),
    )
  }

  function removeCallout(id: string) {
    setLocal((prev) => prev.filter((c) => c.id !== id))
    if (!id.startsWith('temp-')) setDeletedIds(prev => [...prev, id])
    if (activeId === id) setActiveId(null)
  }

  function rotateCallout(id: string, delta: number) {
    setLocal(prev => prev.map(c => c.id === id ? { ...c, rotation: ((c.rotation || 0) + delta + 360) % 360 } : c))
  }

  // ── Add mode: click to place callout ──────────────────────────────────────
  function handleStageClick(e: KonvaEventObject<MouseEvent>) {
    if (mode !== 'add') return
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getPointerPosition()
    if (!pos) return
    const { w: nw, h: nh } = naturalDims
    const { width: sw, height: sh } = stageDim
    const x_px = toNative(pos.x, sw, nw)
    const y_px = toNative(pos.y, sh, nh)
    const nextNum = local.length > 0 ? Math.max(...local.map(c => c.callout_number)) + 1 : 1
    const tempId = `temp-${Date.now()}`
    setLocal(prev => [...prev, {
      id: tempId,
      step_id: stepId,
      callout_number: nextNum,
      label: 'Manual callout',
      element_type: null,
      target_x: x_px,
      target_y: y_px,
      confidence: 'gemini_only' as const,
      match_method: 'gemini_coordinates' as unknown as import('../api/types').CalloutMatchMethod,
      ocr_matched_text: null,
      gemini_region_hint: null,
      was_repositioned: true,
      original_x: null,
      original_y: null,
      rotation: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      x_px,
      y_px,
    }])
  }

  // ── Draw mode: drag to create box ─────────────────────────────────────────
  function handleStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    if (mode !== 'draw') return
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    setDrawStart(pos)
    setIsDrawing(true)
    setDrawPreview({ x: pos.x, y: pos.y, w: 0, h: 0 })
  }

  function handleStageMouseMove(e: KonvaEventObject<MouseEvent>) {
    if (!isDrawing || !drawStart) return
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    setDrawPreview({
      x: Math.min(drawStart.x, pos.x),
      y: Math.min(drawStart.y, pos.y),
      w: Math.abs(pos.x - drawStart.x),
      h: Math.abs(pos.y - drawStart.y),
    })
  }

  function handleStageMouseUp(_e: KonvaEventObject<MouseEvent>) {
    if (!isDrawing || !drawPreview || !drawStart) return
    setIsDrawing(false)
    if (drawPreview.w < 10 || drawPreview.h < 10) {
      setDrawStart(null)
      setDrawPreview(null)
      return
    }
    const { w: nw, h: nh } = naturalDims
    const { width: sw, height: sh } = stageDim
    const box: LocalBox = {
      id: `box-${Date.now()}`,
      x_px: toNative(drawPreview.x, sw, nw),
      y_px: toNative(drawPreview.y, sh, nh),
      w_px: toNative(drawPreview.w, sw, nw),
      h_px: toNative(drawPreview.h, sh, nh),
      color: drawColor,
    }
    setBoxes(prev => [...prev, box])
    setDrawStart(null)
    setDrawPreview(null)
  }

  async function handleSave() {
    setSaving(true)
    try {
      // 1. DELETE removed callouts from DB
      for (const id of deletedIds) {
        await deleteCallout(stepId, id)
      }

      // 2. POST new callouts — replace temp IDs with real IDs in local state as we go
      let updatedLocal = [...local]
      const newCallouts = local.filter(c => c.id.startsWith('temp-'))
      for (const nc of newCallouts) {
        const created = await addCallout(stepId, {
          callout_number: nc.callout_number,
          label: nc.label,
          target_x: nc.x_px,
          target_y: nc.y_px,
        })
        if (created) {
          updatedLocal = updatedLocal.map(c => c.id === nc.id ? { ...c, id: created.id } : c)
        }
      }
      setLocal(updatedLocal)

      // 3. PATCH existing callouts (positions + labels + rotation)
      const existingCallouts = updatedLocal.filter(c => !c.id.startsWith('temp-'))
      const payload: CalloutPatchItem[] = existingCallouts.map((c) => ({
        id: c.id,
        target_x: c.x_px,
        target_y: c.y_px,
        was_repositioned: c.was_repositioned,
        label: c.label,
        rotation: c.rotation || 0,
      }))
      await patchCallouts(stepId, payload)

      // 3. PATCH highlight boxes
      await patchHighlightBoxes(stepId, boxes.map(b => ({
        id: b.id,
        x: b.x_px,
        y: b.y_px,
        w: b.w_px,
        h: b.h_px,
        color: b.color,
      })))

      // 4. Re-render annotated PNG automatically
      const res = await renderAnnotated(stepId)
      setRerenderUrl(res.annotated_screenshot_url)

      await qc.invalidateQueries({ queryKey: sopKeys.detail(sopId) })
      onClose()
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }


  const { width: sw, height: sh } = stageDim
  // rerenderUrl already has SAS (applied by API) — just append cache-buster
  const displayUrl = rerenderUrl
    ? `${rerenderUrl}${rerenderUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
    : screenshotUrl
  const allGemini = local.every((c) => c.confidence === 'gemini_only' && !c.was_repositioned)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-slate-800 border border-slate-600 rounded-xl w-[92vw] max-w-[1200px] h-[88vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-700 bg-slate-900 shrink-0">
          <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded">
            STEP {stepNumber}
          </span>
          <h2 className="flex-1 text-sm font-semibold text-slate-100 truncate">{stepTitle}</h2>
          {allGemini && (
            <span className="text-xs bg-yellow-900/60 text-yellow-300 px-2 py-0.5 rounded font-semibold">
              ⚠ gemini_only
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold text-slate-400 border border-slate-600 rounded hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        {/* Mode toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-700 shrink-0">
          {(['move', 'add', 'draw'] as EditorMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                mode === m ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {m === 'move' ? '↕ Move' : m === 'add' ? '+ Callout' : '□ Box'}
            </button>
          ))}
          {mode === 'draw' && (
            <div className="flex items-center gap-1.5 ml-2">
              {(['yellow', 'red', 'green', 'blue'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setDrawColor(c)}
                  className={`w-5 h-5 rounded border-2 transition-all ${drawColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ background: BOX_COLORS[c].fill, outline: `2px solid ${BOX_COLORS[c].stroke}` }}
                />
              ))}
            </div>
          )}
          <span className="text-xs text-slate-500 ml-2">
            {mode === 'move'
              ? 'Drag callouts to reposition'
              : mode === 'add'
              ? 'Click to place callout'
              : 'Drag to draw highlight box'}
          </span>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Canvas area */}
          <div className="flex-1 bg-slate-950 relative flex items-center justify-center overflow-hidden">
            <div className="relative">
              {/* Screenshot img — Konva Stage overlaid at exact rendered size */}
              <img
                ref={imgRef}
                src={displayUrl}
                alt="Step screenshot"
                className="max-h-[70vh] max-w-full object-contain rounded block"
                onLoad={measureImg}
              />
              <Stage
                width={sw}
                height={sh}
                style={{ position: 'absolute', top: 0, left: 0, cursor: mode === 'move' ? 'default' : 'crosshair' }}
                onClick={mode === 'add' ? handleStageClick : (() => { setActiveId(null); setActiveBoxId(null) })}
                onMouseDown={mode === 'draw' ? handleStageMouseDown : undefined}
                onMouseMove={mode === 'draw' ? handleStageMouseMove : undefined}
                onMouseUp={mode === 'draw' ? handleStageMouseUp : undefined}
              >
                <Layer>
                  {/* Highlight boxes */}
                  {boxes.map(box => {
                    const { w: nw, h: nh } = naturalDims
                    const bx = (box.x_px / nw) * sw
                    const by = (box.y_px / nh) * sh
                    const bw = (box.w_px / nw) * sw
                    const bh = (box.h_px / nh) * sh
                    const col = BOX_COLORS[box.color]
                    const isActiveBox = box.id === activeBoxId
                    return (
                      <Rect
                        key={box.id}
                        ref={(node) => { if (node) boxRefs.current.set(box.id, node); else boxRefs.current.delete(box.id) }}
                        x={bx} y={by} width={bw} height={bh}
                        fill={col.fill}
                        stroke={isActiveBox ? 'white' : col.stroke}
                        strokeWidth={isActiveBox ? 2 : 2}
                        draggable={mode === 'move'}
                        onClick={(e) => { e.cancelBubble = true; setActiveBoxId(box.id); setActiveId(null) }}
                        onDragEnd={(e) => {
                          const nx = toNative(e.target.x(), sw, nw)
                          const ny = toNative(e.target.y(), sh, nh)
                          setBoxes(prev => prev.map(b => b.id === box.id ? { ...b, x_px: nx, y_px: ny } : b))
                        }}
                        onTransformEnd={(e) => {
                          const node = e.target
                          const scaleX = node.scaleX()
                          const scaleY = node.scaleY()
                          node.scaleX(1)
                          node.scaleY(1)
                          setBoxes(prev => prev.map(b => b.id === box.id ? {
                            ...b,
                            x_px: toNative(node.x(), sw, nw),
                            y_px: toNative(node.y(), sh, nh),
                            w_px: Math.max(10, toNative(node.width() * scaleX, sw, nw)),
                            h_px: Math.max(10, toNative(node.height() * scaleY, sh, nh)),
                          } : b))
                        }}
                      />
                    )
                  })}
                  <Transformer
                    ref={transformerRef}
                    rotateEnabled={false}
                    boundBoxFunc={(oldBox, newBox) => newBox.width < 10 || newBox.height < 10 ? oldBox : newBox}
                  />
                  {/* Draw preview box */}
                  {drawPreview && drawPreview.w > 5 && drawPreview.h > 5 && (
                    <Rect
                      x={drawPreview.x} y={drawPreview.y}
                      width={drawPreview.w} height={drawPreview.h}
                      fill={BOX_COLORS[drawColor].fill}
                      stroke={BOX_COLORS[drawColor].stroke}
                      strokeWidth={2}
                      dash={[6, 3]}
                    />
                  )}
                  {/* Callouts */}
                  {local.map((c) => {
                    const { w: nw, h: nh } = naturalDims
                    const x = (c.x_px / nw) * sw
                    const y = (c.y_px / nh) * sh
                    const color = dotColor(c)
                    const isActive = c.id === activeId
                    return (
                      <Group
                        key={c.id}
                        x={x}
                        y={y}
                        rotation={c.rotation || 0}
                        draggable={mode === 'move'}
                        onDragEnd={(e) => handleDragEnd(c.id, e)}
                        onClick={(e) => { e.cancelBubble = true; setActiveId(c.id) }}
                      >
                        {/* Pentagon/arrow badge — points right, centred on (0,0) */}
                        {isActive && (
                          <Shape
                            sceneFunc={(ctx, shape) => {
                              ctx.beginPath()
                              ctx.moveTo(-23, -17)
                              ctx.lineTo(11, -17)
                              ctx.lineTo(23, 0)
                              ctx.lineTo(11, 17)
                              ctx.lineTo(-23, 17)
                              ctx.closePath()
                              ctx.fillStrokeShape(shape)
                            }}
                            fill="white"
                            stroke="#3b82f6"
                            strokeWidth={3}
                          />
                        )}
                        <Shape
                          sceneFunc={(ctx, shape) => {
                            const w = 38, h = 28, tip = 13
                            ctx.beginPath()
                            ctx.moveTo(-w / 2,        -h / 2)
                            ctx.lineTo(w / 2 - tip,   -h / 2)
                            ctx.lineTo(w / 2,          0)
                            ctx.lineTo(w / 2 - tip,    h / 2)
                            ctx.lineTo(-w / 2,         h / 2)
                            ctx.closePath()
                            ctx.fillStrokeShape(shape)
                          }}
                          fill={color}
                        />
                        <Text
                          text={String(c.callout_number)}
                          fontSize={12}
                          fontStyle="bold"
                          fill="white"
                          offsetX={7}
                          offsetY={6}
                        />
                      </Group>
                    )
                  })}
                </Layer>
              </Stage>
            </div>
          </div>

          {/* Right panel */}
          <div className="w-72 border-l border-slate-700 bg-slate-900 flex flex-col shrink-0">
            <div className="px-4 py-3 border-b border-slate-700">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Callouts — {local.length}
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {local.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                    activeId === c.id
                      ? 'border-blue-500 bg-slate-800'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                      style={{ background: dotColor(c) }}
                    >
                      {c.callout_number}
                    </span>
                    <input
                      value={c.label}
                      onChange={(e) => {
                        e.stopPropagation()
                        setLocal(prev => prev.map(x => x.id === c.id ? { ...x, label: e.target.value } : x))
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 text-xs font-semibold bg-slate-700 text-slate-100 border border-slate-600 rounded px-1.5 py-0.5 outline-none focus:border-blue-400 min-w-0"
                      placeholder="Label…"
                    />
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                        c.was_repositioned
                          ? 'bg-blue-900/50 text-blue-300'
                          : c.confidence.startsWith('ocr')
                          ? 'bg-emerald-900/50 text-emerald-300'
                          : 'bg-yellow-900/50 text-yellow-300'
                      }`}
                    >
                      {confidenceLabel(c)}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-slate-500">
                    x:{c.x_px}px y:{c.y_px}px
                  </p>
                  <div className="flex gap-1 mt-2 pt-2 border-t border-slate-700 flex-wrap">
                    <button
                      onClick={(e) => { e.stopPropagation(); rotateCallout(c.id, -45) }}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600"
                      title="Rotate -45°"
                    >⟲</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); rotateCallout(c.id, 45) }}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600"
                      title="Rotate +45°"
                    >⟳</button>
                    <span className="text-[10px] text-slate-500 px-1 py-0.5">{Math.round(c.rotation || 0)}°</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeCallout(c.id) }}
                      className="text-[10px] px-2 py-0.5 rounded bg-red-900/40 text-red-400 hover:bg-red-900/70 ml-auto"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Highlight boxes list */}
            {boxes.length > 0 && (
              <div className="px-3 py-2 border-t border-slate-700">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Highlight Boxes — {boxes.length}
                </p>
                <div className="space-y-1">
                  {boxes.map(box => (
                    <div
                      key={box.id}
                      onClick={() => { setActiveBoxId(box.id); setActiveId(null) }}
                      className={`flex items-center gap-2 rounded px-2 py-1.5 border cursor-pointer transition-colors ${
                        activeBoxId === box.id ? 'border-white bg-slate-700' : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                      }`}
                    >
                      <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: BOX_COLORS[box.color].stroke }} />
                      <span className="text-xs text-slate-300 flex-1 capitalize">{box.color}</span>
                      <span className="text-[10px] font-mono text-slate-500">{box.w_px}×{box.h_px}</span>
                      {activeBoxId === box.id && (
                        <span className="text-[10px] text-slate-400">drag handles to resize</span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setBoxes(prev => prev.filter(b => b.id !== box.id)); if (activeBoxId === box.id) setActiveBoxId(null) }}
                        className="text-slate-500 hover:text-red-400 shrink-0"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-slate-700 bg-slate-900 shrink-0 flex items-center gap-4 text-xs text-slate-500">
          <span>Step {stepNumber} · {local.length} callouts · {boxes.length} boxes</span>
          {allGemini && (
            <span className="text-yellow-400">
              ⚠ All positions are Gemini estimates — verify before saving
            </span>
          )}
        </div>

      </div>
    </div>
  )
}
