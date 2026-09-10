import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

/** Which kind of graph node a filter can narrow. */
export type GraphNodeKind = 'task' | 'table'

export interface GraphFilterGroup {
  id: string
  label: string
  appliesTo: GraphNodeKind | 'both'
  options: string[]
}

export type GraphFilterSelection = Record<string, string[]>

export const UNSPECIFIED = '未指定'

/**
 * A node passes a group when nothing is picked there, when the group does not
 * describe that kind of node, or when the node's value is among the picks.
 */
export function passesGraphFilters(
  groups: readonly GraphFilterGroup[],
  selection: GraphFilterSelection,
  kind: GraphNodeKind,
  values: Readonly<Record<string, string>>,
): boolean {
  return groups.every((group) => {
    const picked = selection[group.id]
    if (!picked || picked.length === 0) return true
    if (group.appliesTo !== 'both' && group.appliesTo !== kind) return true
    return picked.includes(values[group.id] ?? UNSPECIFIED)
  })
}

export function countSelectedFilters(selection: GraphFilterSelection): number {
  return Object.values(selection).reduce((total, values) => total + values.length, 0)
}

export function GraphFilterBar({
  groups,
  selection,
  onChange,
}: {
  groups: readonly GraphFilterGroup[]
  selection: GraphFilterSelection
  onChange: (selection: GraphFilterSelection) => void
}) {
  const [openId, setOpenId] = useState<string>()
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openId) return
    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpenId(undefined)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(undefined)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [openId])

  if (groups.length === 0) return null

  const toggle = (groupId: string, option: string) => {
    const picked = selection[groupId] ?? []
    const next = picked.includes(option)
      ? picked.filter((value) => value !== option)
      : [...picked, option]
    const updated = { ...selection }
    if (next.length === 0) delete updated[groupId]
    else updated[groupId] = next
    onChange(updated)
  }

  const selectedCount = countSelectedFilters(selection)

  return (
    <div className="graph-filter-strip" ref={barRef} aria-label="グラフの絞り込み">
      {groups.map((group) => {
        const picked = selection[group.id] ?? []
        const open = openId === group.id
        return (
          <div className="graph-filter" key={group.id}>
            <button
              className={`graph-filter-chip ${picked.length > 0 ? 'is-active' : ''}`}
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? undefined : group.id)}
            >
              {group.label}
              {picked.length > 0 && <small>{picked.length}</small>}
              <ChevronDown size={12} className={open ? 'is-open' : ''} />
            </button>
            {open && (
              <div className="graph-filter-menu" role="dialog" aria-label={`${group.label}で絞り込む`}>
                {group.options.map((option) => (
                  <label key={option}>
                    <input
                      type="checkbox"
                      checked={picked.includes(option)}
                      onChange={() => toggle(group.id, option)}
                    />
                    <span title={option}>{option}</span>
                  </label>
                ))}
                {picked.length > 0 && (
                  <button
                    className="graph-filter-clear"
                    type="button"
                    onClick={() => {
                      const updated = { ...selection }
                      delete updated[group.id]
                      onChange(updated)
                    }}
                  >
                    この条件を外す
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
      {selectedCount > 0 && (
        <button className="graph-filter-reset" type="button" onClick={() => onChange({})}>
          <X size={12} /> 絞り込みを解除（{selectedCount}）
        </button>
      )}
    </div>
  )
}
