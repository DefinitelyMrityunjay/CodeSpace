import { useState, useEffect } from 'react'

const LANGUAGE_MAP = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  css: 'css', html: 'html', json: 'json', md: 'markdown',
  py: 'python', sh: 'bash', yml: 'yaml', yaml: 'yaml',
}

function getLanguage(filename) {
  const ext = filename.split('.').pop()?.toLowerCase()
  return LANGUAGE_MAP[ext] || 'plaintext'
}

export default function FileViewer({ agentBase, filePath }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!agentBase || !filePath) return
    const fetchFile = async () => {
      setLoading(true)
      setError(null)
      setContent(null)
      try {
        const res = await fetch(`${agentBase}/read-files?files=${encodeURIComponent(filePath)}`)
        const data = await res.json()
        const fileData = data.files?.[0]
        if (fileData) {
          const fileContent = Object.values(fileData)[0]
          setContent(fileContent)
        } else {
          setError('File not found or empty')
        }
      } catch {
        setError('Failed to load file')
      } finally {
        setLoading(false)
      }
    }
    fetchFile()
  }, [agentBase, filePath])

  if (!filePath) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D4D4D8" strokeWidth="1">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <p style={{ fontSize: '13px', fontWeight: '400', color: '#A1A1AA' }}>Select a file from the explorer</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'stretch', height: '36px', background: '#FAFAFA', borderBottom: '1px solid #D4D4D8', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '0 16px', background: '#FFFFFF',
          borderRight: '1px solid #D4D4D8', borderTop: '2px solid #0A0A0A'
        }}>
          <span style={{ fontSize: '12px', fontWeight: '400', fontFamily: 'IBM Plex Mono, monospace', color: '#0A0A0A' }}>
            {filePath.split('/').pop()}
          </span>
          <span style={{ fontSize: '11px', color: '#A1A1AA', fontFamily: 'IBM Plex Mono, monospace' }}>
            {getLanguage(filePath)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative', background: '#FAFAFA' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="animate-spin" style={{ width: '16px', height: '16px', border: '1.5px solid #D4D4D8', borderTopColor: '#0A0A0A', borderRadius: '50%' }} />
          </div>
        )}
        {error && (
          <div style={{ padding: '24px', fontSize: '13px', color: '#DC2626' }}>{error}</div>
        )}
        {content !== null && !loading && (
          <pre style={{
            padding: '16px', fontSize: '13px', lineHeight: '1.65',
            color: '#0A0A0A', fontFamily: 'IBM Plex Mono, monospace',
            margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word'
          }}>
            <code>{content}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
