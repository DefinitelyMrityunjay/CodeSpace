import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { io } from 'socket.io-client'

export default function Terminal({ sandboxId }) {
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const fitAddonRef = useRef(null)
  const socketRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)

  const initTerminal = useCallback(() => {
    if (!containerRef.current || termRef.current) return

    const term = new XTerm({
      theme: {
        background: '#0A0A0A',
        foreground: '#FAFAFA',
        cursor: '#FAFAFA',
        cursorAccent: '#0A0A0A',
        selectionBackground: 'rgba(255,255,255,0.15)',
        black: '#1C1C1E',
        red: '#DC2626',
        green: '#16A34A',
        yellow: '#CA8A04',
        blue: '#2563EB',
        magenta: '#7C3AED',
        cyan: '#0891B2',
        white: '#FAFAFA',
        brightBlack: '#52525B',
        brightRed: '#EF4444',
        brightGreen: '#22C55E',
        brightYellow: '#EAB308',
        brightBlue: '#3B82F6',
        brightMagenta: '#8B5CF6',
        brightCyan: '#06B6D4',
        brightWhite: '#FAFAFA',
      },
      fontFamily: '"IBM Plex Mono", "JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon

    term.writeln('\x1b[2mSandbox Terminal — connecting…\x1b[0m')
    term.writeln('')

    return term
  }, [])

  const connectSocket = useCallback((term) => {
    if (!sandboxId || !term) return

    const port = import.meta.env.VITE_SUBDOMAIN_PORT
    const agentHost = `http://${sandboxId}.agent.lvh.me${port ? `:${port}` : ''}`

    try {
      const socket = io(agentHost, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      })

      socketRef.current = socket

      socket.on('connect', () => {
        setConnected(true)
        setError(null)
        term.writeln('\x1b[32mConnected to sandbox shell\x1b[0m')
        term.writeln('')
      })

      socket.on('disconnect', () => {
        setConnected(false)
        term.writeln('\r\n\x1b[33mDisconnected. Reconnecting…\x1b[0m')
      })

      socket.on('connect_error', (err) => {
        setConnected(false)
        setError('Connection failed')
        term.writeln(`\r\n\x1b[31mConnection error: ${err.message}\x1b[0m`)
      })

      socket.on('terminal-output', (data) => {
        term.write(data)
      })

      term.onData((data) => {
        socket.emit('terminal-input', data)
      })

    } catch (err) {
      setError(err.message)
    }
  }, [sandboxId])

  useEffect(() => {
    const term = initTerminal()
    if (term) connectSocket(term)

    return () => {
      if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null }
      if (termRef.current) { termRef.current.dispose(); termRef.current = null }
    }
  }, [initTerminal, connectSocket])

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit() } catch (_) {}
      }
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0A0A0A' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: '32px', background: '#0A0A0A', borderBottom: '1px solid #1C1C1E', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#52525B" strokeWidth="2">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span style={{ fontSize: '12px', fontWeight: '400', color: '#52525B', fontFamily: 'IBM Plex Mono, monospace' }}>Terminal</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {error && (
            <span style={{ fontSize: '11px', color: '#DC2626', fontFamily: 'IBM Plex Mono, monospace' }}>{error}</span>
          )}
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: connected ? '#16A34A' : '#DC2626', flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color: '#52525B' }}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  )
}
