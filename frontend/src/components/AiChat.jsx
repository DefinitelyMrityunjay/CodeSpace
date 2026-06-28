import { useState, useRef, useEffect, useCallback } from 'react'

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '10px 12px' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: '5px', height: '5px', borderRadius: '50%', background: '#D4D4D8',
          animation: 'typing-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`
        }} />
      ))}
    </div>
  )
}

function ActivityLog({ lines }) {
  if (!lines.length) return null
  return (
    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #F4F4F5' }}>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', gap: '6px', padding: '1px 0' }}>
          <span style={{ fontSize: '11px', color: '#A1A1AA', fontFamily: 'IBM Plex Mono, monospace', flexShrink: 0 }}>
            {line.type === 'reading' ? 'r:' : line.type === 'updating' ? 'w:' : line.type === 'success' ? 'ok:' : '—'}
          </span>
          <span style={{ fontSize: '11px', color: '#A1A1AA', fontFamily: 'IBM Plex Mono, monospace', wordBreak: 'break-all', lineHeight: '1.5' }}>
            {line.text}
          </span>
        </div>
      ))}
    </div>
  )
}

function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className="animate-fadeIn" style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{ maxWidth: '88%' }}>
        <div style={{
          padding: '8px 12px',
          fontSize: '14px', lineHeight: '1.6',
          color: '#0A0A0A', fontWeight: isUser ? '400' : '300',
          background: isUser ? '#F4F4F5' : 'transparent',
        }}>
          {msg.content}
        </div>
        {msg.activity && msg.activity.length > 0 && (
          <ActivityLog lines={msg.activity} />
        )}
        <div style={{ fontSize: '11px', marginTop: '4px', color: '#A1A1AA', textAlign: isUser ? 'right' : 'left' }}>
          {new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

function parseActivityLine(line) {
  if (!line.trim()) return null
  if (line.startsWith('Reading files')) return { type: 'reading', text: line }
  if (line.startsWith('Updating files')) return { type: 'updating', text: line }
  if (line.toLowerCase().includes('success')) return { type: 'success', text: line }
  return { type: 'info', text: line }
}

export default function AiChat({ sandboxId, onFilesChanged }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hi! I can modify your sandbox project. Describe what you want to build or change, and I\'ll update the code for you.',
      activity: [],
      time: Date.now()
    }
  ])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming || !sandboxId) return

    setInput('')
    setStreaming(true)

    const userMsg = { role: 'user', content: text, activity: [], time: Date.now() }
    setMessages(prev => [...prev, userMsg])

    const aiMsgId = Date.now() + 1
    setMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', content: '', activity: [], time: Date.now(), pending: true }])

    let aiContent = ''
    let activityLines = []

    try {
      const response = await fetch('/api/ai/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text, projectId: sandboxId })
      })

      if (!response.ok) throw new Error(`Server error: ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const updateMsg = () => {
        setMessages(prev => prev.map(m =>
          m.id === aiMsgId
            ? { ...m, content: aiContent || '…', activity: [...activityLines], pending: !aiContent }
            : m
        ))
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.trim()) continue
          const parsed = parseActivityLine(line)
          if (parsed) {
            activityLines = [...activityLines, parsed]
            if (parsed.type === 'info' && line.length > 30) {
              aiContent = line
            }
          }
          updateMsg()
        }
      }

      if (!aiContent) {
        const updates = activityLines.filter(l => l.type === 'success')
        aiContent = updates.length
          ? 'Done! Files have been updated successfully.'
          : 'Changes applied to your project.'
      }

      setMessages(prev => prev.map(m =>
        m.id === aiMsgId
          ? { ...m, content: aiContent, activity: activityLines, pending: false }
          : m
      ))

      onFilesChanged?.()
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === aiMsgId
          ? { ...m, content: `Error: ${err.message}`, activity: activityLines, pending: false }
          : m
      ))
    } finally {
      setStreaming(false)
    }
  }, [input, streaming, sandboxId, onFilesChanged])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const isActive = input.trim() && sandboxId && !streaming

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#FFFFFF', borderLeft: '1px solid #D4D4D8' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: '48px', borderBottom: '1px solid #D4D4D8', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: '14px', fontWeight: '600', color: '#0A0A0A', lineHeight: '1.3' }}>AI Assistant</h2>
          <p style={{ fontSize: '11px', fontWeight: '400', color: '#71717A' }}>Powered by Gemini</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16A34A', flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color: '#71717A' }}>Active</span>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {messages.map((msg, i) => (
          <div key={msg.id || i}>
            {msg.pending && !msg.content ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ border: '1px solid #D4D4D8' }}>
                  <TypingIndicator />
                  {msg.activity && msg.activity.length > 0 && (
                    <div style={{ padding: '0 12px 10px' }}>
                      <ActivityLog lines={msg.activity} />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <Message msg={msg} />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid #D4D4D8' }}>
        <div
          style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', border: '1px solid #D4D4D8', padding: '8px 12px', transition: 'border-color 0.15s' }}
          onFocusCapture={e => e.currentTarget.style.borderColor = '#0A0A0A'}
          onBlurCapture={e => e.currentTarget.style.borderColor = '#D4D4D8'}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={sandboxId ? 'Describe what you want to build…' : 'Create a sandbox first…'}
            disabled={!sandboxId || streaming}
            rows={1}
            style={{
              flex: 1, resize: 'none', fontSize: '14px', outline: 'none',
              background: 'transparent', color: '#0A0A0A', caretColor: '#0A0A0A',
              maxHeight: '120px', lineHeight: '1.5', fontFamily: 'inherit',
              fontWeight: '300', border: 'none'
            }}
            onInput={e => {
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!isActive}
            style={{
              flexShrink: 0, width: '32px', height: '32px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isActive ? '#0A0A0A' : 'transparent',
              color: isActive ? '#FAFAFA' : '#D4D4D8',
              border: '1px solid ' + (isActive ? '#0A0A0A' : '#D4D4D8'),
              cursor: isActive ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s'
            }}
          >
            {streaming ? (
              <div className="animate-spin" style={{ width: '12px', height: '12px', border: '1.5px solid #D4D4D8', borderTopColor: '#71717A', borderRadius: '50%' }} />
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
        <p style={{ fontSize: '11px', marginTop: '6px', textAlign: 'center', color: '#A1A1AA' }}>
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}
