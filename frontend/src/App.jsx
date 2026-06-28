import { useState, useRef, useCallback, useEffect } from 'react'
import SplashScreen from './components/SplashScreen'
import TopBar from './components/TopBar'
import FileExplorer from './components/FileExplorer'
import PreviewFrame from './components/PreviewFrame'
import FileViewer from './components/FileViewer'
import Terminal from './components/Terminal'
import AiChat from './components/AiChat'

const SESSION_KEY = 'codespace_sandbox_id'

function buildSandboxUrls(sandboxId) {
  const port = import.meta.env.VITE_SUBDOMAIN_PORT
  const p = port ? `:${port}` : ''
  return {
    sandboxId,
    agentBase: `http://${sandboxId}.agent.lvh.me${p}`,
    previewUrl: `http://${sandboxId}.preview.lvh.me${p}`,
  }
}

export default function App() {
  const [sandbox, setSandbox] = useState(null)
  const [status, setStatus] = useState('ready')

  const [activeTab, setActiveTab] = useState('preview')
  const [activeFile, setActiveFile] = useState(null)
  const [fileRefreshKey, setFileRefreshKey] = useState(0)

  const [terminalHeight, setTerminalHeight] = useState(220)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)

  // Restore sandbox from sessionStorage if the agent is still alive
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (!saved) return
    const { agentBase } = buildSandboxUrls(saved)
    fetch(`${agentBase}/list-files`, { signal: AbortSignal.timeout(4000) })
      .then(r => { if (r.ok) setSandbox(buildSandboxUrls(saved)) })
      .catch(() => sessionStorage.removeItem(SESSION_KEY))
  }, [])

  // Stop sandbox on page unload (best-effort)
  useEffect(() => {
    const handleUnload = () => {
      const saved = sessionStorage.getItem(SESSION_KEY)
      if (!saved) return
      const blob = new Blob([JSON.stringify({ sandboxId: saved })], { type: 'application/json' })
      navigator.sendBeacon('/api/sandbox/stop', blob)
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [])

  const handleSandboxCreated = useCallback((data) => {
    sessionStorage.setItem(SESSION_KEY, data.sandboxId)
    setSandbox(buildSandboxUrls(data.sandboxId))
    setStatus('ready')
  }, [])

  const handleFilesChanged = useCallback(() => {
    setFileRefreshKey(k => k + 1)
  }, [])

  const handleFileSelect = useCallback((path) => {
    setActiveFile(path)
    setActiveTab('files')
  }, [])

  const handleDragStart = (e) => {
    isDragging.current = true
    dragStartY.current = e.clientY
    dragStartH.current = terminalHeight

    const onMove = (ev) => {
      if (!isDragging.current) return
      const delta = dragStartY.current - ev.clientY
      const newH = Math.min(Math.max(dragStartH.current + delta, 80), 500)
      setTerminalHeight(newH)
    }
    const onUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (!sandbox) {
    return <SplashScreen onSandboxCreated={handleSandboxCreated} />
  }

  const { sandboxId, previewUrl, agentBase } = sandbox

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', background: '#FAFAFA' }}>

      <TopBar
        sandboxId={sandboxId}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        status={status}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        <FileExplorer
          agentBase={agentBase}
          activeFile={activeFile}
          onFileSelect={handleFileSelect}
          refreshKey={fileRefreshKey}
        />

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activeTab === 'preview' ? (
              <PreviewFrame previewUrl={previewUrl} />
            ) : (
              <FileViewer agentBase={agentBase} filePath={activeFile} />
            )}
          </div>

          {/* Drag handle */}
          <div
            style={{ height: '5px', background: '#F4F4F5', borderTop: '1px solid #D4D4D8', borderBottom: '1px solid #D4D4D8', cursor: 'row-resize', flexShrink: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseDown={handleDragStart}
            title="Drag to resize terminal"
          >
            <div style={{ width: '32px', height: '1px', background: '#D4D4D8' }} />
          </div>

          <div style={{ height: `${terminalHeight}px`, flexShrink: 0, overflow: 'hidden' }}>
            <Terminal sandboxId={sandboxId} />
          </div>
        </div>

        <div style={{ width: '340px', flexShrink: 0, overflow: 'hidden' }}>
          <AiChat
            sandboxId={sandboxId}
            onFilesChanged={handleFilesChanged}
          />
        </div>
      </div>
    </div>
  )
}
