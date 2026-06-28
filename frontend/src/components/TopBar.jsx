export default function TopBar({ sandboxId, activeTab, onTabChange, status }) {
  const shortId = sandboxId ? sandboxId.slice(0, 8) + '…' : ''

  const statusConfig = {
    ready: { color: '#16A34A', label: 'Ready' },
    loading: { color: '#CA8A04', label: 'Working…' },
    error: { color: '#DC2626', label: 'Error' },
  }
  const s = statusConfig[status] || statusConfig.ready

  return (
    <header style={{
      height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px', background: '#FFFFFF', borderBottom: '1px solid #D4D4D8',
      flexShrink: 0
    }}>

      {/* Left — Logo + sandbox ID */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="0" y="0" width="6" height="6" fill="#0A0A0A" />
            <rect x="10" y="0" width="6" height="6" fill="#0A0A0A" opacity="0.25" />
            <rect x="0" y="10" width="6" height="6" fill="#0A0A0A" opacity="0.25" />
            <rect x="10" y="10" width="6" height="6" fill="#0A0A0A" />
          </svg>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#0A0A0A', letterSpacing: '-0.01em' }}>
            Sandbox IDE
          </span>
        </div>
        {sandboxId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 8px', background: '#F4F4F5', border: '1px solid #D4D4D8' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace', color: '#71717A' }}>
              {shortId}
            </span>
          </div>
        )}
      </div>

      {/* Center — Tab switcher */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {[
          { id: 'preview', label: 'Preview' },
          { id: 'files', label: 'Files' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              height: '32px', padding: '0 20px',
              background: activeTab === tab.id ? '#0A0A0A' : 'transparent',
              color: activeTab === tab.id ? '#FAFAFA' : '#71717A',
              border: '1px solid ' + (activeTab === tab.id ? '#0A0A0A' : 'transparent'),
              fontSize: '13px', fontWeight: activeTab === tab.id ? '500' : '400',
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s'
            }}
            onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.color = '#0A0A0A' }}
            onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.color = '#71717A' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Right — status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {status === 'loading' ? (
          <div className="animate-spin" style={{ width: '10px', height: '10px', border: '1.5px solid #D4D4D8', borderTopColor: '#CA8A04', borderRadius: '50%' }} />
        ) : (
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.color, flexShrink: 0 }} />
        )}
        <span style={{ fontSize: '12px', fontWeight: '400', color: '#71717A' }}>
          {s.label}
        </span>
      </div>
    </header>
  )
}
