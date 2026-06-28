import { useRef, useState, useEffect, useCallback } from 'react'

const RETRY_DELAYS = [2000, 4000, 8000, 16000]

export default function PreviewFrame({ previewUrl }) {
  const iframeRef = useRef(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef(null)

  const scheduleRetry = useCallback(() => {
    const attempt = retryCountRef.current
    const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]
    retryTimerRef.current = setTimeout(() => {
      retryCountRef.current += 1
      setErrored(false)
      setLoading(true)
      setRefreshKey(k => k + 1)
    }, delay)
  }, [])

  useEffect(() => {
    retryCountRef.current = 0
    clearTimeout(retryTimerRef.current)
    setErrored(false)
    setLoading(true)
    setRefreshKey(k => k + 1)
    return () => clearTimeout(retryTimerRef.current)
  }, [previewUrl])

  const handleLoad = () => {
    retryCountRef.current = 0
    setLoading(false)
    setErrored(false)
  }

  const handleError = useCallback(() => {
    setLoading(false)
    setErrored(true)
    scheduleRetry()
  }, [scheduleRetry])

  const handleRefresh = () => {
    clearTimeout(retryTimerRef.current)
    retryCountRef.current = 0
    setErrored(false)
    setLoading(true)
    setRefreshKey(k => k + 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', height: '36px', background: '#FFFFFF', borderBottom: '1px solid #D4D4D8', flexShrink: 0 }}>

        {/* URL bar */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', height: '24px', padding: '0 10px', border: '1px solid #D4D4D8', gap: '8px' }}>
          {loading && (
            <div className="animate-spin" style={{ width: '10px', height: '10px', border: '1.5px solid #D4D4D8', borderTopColor: '#0A0A0A', borderRadius: '50%', flexShrink: 0 }} />
          )}
          <span style={{ fontSize: '11px', color: '#71717A', fontFamily: 'IBM Plex Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {previewUrl}
          </span>
        </div>

        {/* Refresh */}
        <button
          onClick={handleRefresh}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#A1A1AA', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#0A0A0A'}
          onMouseLeave={e => e.currentTarget.style.color = '#A1A1AA'}
          title="Refresh preview"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>

        {/* Open in new tab */}
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#A1A1AA', display: 'flex', alignItems: 'center', transition: 'color 0.15s', textDecoration: 'none' }}
          onMouseEnter={e => e.currentTarget.style.color = '#0A0A0A'}
          onMouseLeave={e => e.currentTarget.style.color = '#A1A1AA'}
          title="Open in new tab"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>

      {/* iFrame */}
      <div style={{ flex: 1, position: 'relative' }}>
        {errored && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', background: '#FAFAFA', zIndex: 10 }}>
            <p style={{ fontSize: '13px', fontWeight: '300', color: '#71717A' }}>
              Sandbox preview is starting up…
            </p>
            <div className="animate-spin" style={{ width: '16px', height: '16px', border: '1.5px solid #D4D4D8', borderTopColor: '#0A0A0A', borderRadius: '50%' }} />
          </div>
        )}
        <iframe
          key={refreshKey}
          ref={iframeRef}
          src={previewUrl}
          style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
          title="Sandbox Preview"
          onLoad={handleLoad}
          onError={handleError}
        />
      </div>
    </div>
  )
}
