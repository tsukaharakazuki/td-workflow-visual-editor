import { useEffect, useRef } from 'react'
import { History, X } from 'lucide-react'
import { RELEASE_LOG } from '../releaseLog'

export function ReleaseLogDialog({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="release-log-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) onClose()
      }}
    >
      <div className="release-log-panel" role="dialog" aria-modal="true" aria-label="Release log" ref={panelRef}>
        <header>
          <span><History size={17} /></span>
          <div>
            <p>Release log</p>
            <h2>{RELEASE_LOG.length} 件の更新</h2>
          </div>
          <button className="icon-button" type="button" aria-label="閉じる" ref={closeRef} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="release-log-scroll">
          {RELEASE_LOG.length === 0 ? (
            <p className="release-log-empty">まだ記録がありません。</p>
          ) : RELEASE_LOG.map((entry) => (
            <article key={`${entry.at}:${entry.summary}`}>
              <time dateTime={entry.at.replace(' ', 'T')}>{entry.at}</time>
              <p>{entry.summary}</p>
              {entry.details && entry.details.length > 0 && (
                <ul>{entry.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
