import { useState, useEffect, useCallback } from 'react'

function buildTree(files) {
  const root = {}
  files.forEach(path => {
    const parts = path.split('/')
    let node = root
    parts.forEach((part, i) => {
      if (!node[part]) node[part] = i === parts.length - 1 ? null : {}
      if (i < parts.length - 1) node = node[part]
    })
  })
  return root
}

function TreeNode({ name, node, depth, agentBase, activeFile, onFileSelect, path }) {
  const [open, setOpen] = useState(depth < 2)
  const isDir = node !== null && typeof node === 'object'
  const fullPath = path ? `${path}/${name}` : name
  const isActive = activeFile === fullPath

  const baseRow = {
    display: 'flex', alignItems: 'center', gap: '6px',
    width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
    height: '28px', paddingRight: '12px',
    paddingLeft: `${12 + depth * 14}px`,
    fontSize: '13px', fontFamily: 'Inter, sans-serif',
    transition: 'background 0.1s, color 0.1s',
    background: 'transparent',
    borderLeft: '2px solid transparent',
  }

  if (isDir) {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          style={{ ...baseRow, color: '#3F3F46' }}
          onMouseEnter={e => e.currentTarget.style.background = '#F4F4F5'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{
            fontSize: '8px', flexShrink: 0, color: '#A1A1AA',
            transition: 'transform 0.15s', display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)'
          }}>▶</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '400' }}>
            {name}
          </span>
        </button>
        {open && (
          <div>
            {Object.entries(node).sort(([, a], [, b]) => {
              const aDir = a !== null && typeof a === 'object'
              const bDir = b !== null && typeof b === 'object'
              return bDir - aDir
            }).map(([childName, childNode]) => (
              <TreeNode key={childName} name={childName} node={childNode}
                depth={depth + 1} agentBase={agentBase} activeFile={activeFile}
                onFileSelect={onFileSelect} path={fullPath} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={() => onFileSelect(fullPath)}
      style={{
        ...baseRow,
        color: isActive ? '#0A0A0A' : '#71717A',
        background: isActive ? '#F4F4F5' : 'transparent',
        fontWeight: isActive ? '500' : '400',
        borderLeft: isActive ? '2px solid #0A0A0A' : '2px solid transparent',
      }}
      onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = '#F4F4F5'; e.currentTarget.style.color = '#0A0A0A' } }}
      onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#71717A' } }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    </button>
  )
}

export default function FileExplorer({ agentBase, activeFile, onFileSelect, refreshKey }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tree, setTree] = useState({})

  const fetchFiles = useCallback(async () => {
    if (!agentBase) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${agentBase}/list-files`)
      const data = await res.json()
      setFiles(data.files || [])
      setTree(buildTree(data.files || []))
    } catch {
      setError('Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [agentBase])

  useEffect(() => { fetchFiles() }, [fetchFiles, refreshKey])

  return (
    <aside style={{ width: '220px', minWidth: '220px', height: '100%', display: 'flex', flexDirection: 'column', background: '#FFFFFF', borderRight: '1px solid #D4D4D8' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: '36px', borderBottom: '1px solid #D4D4D8', flexShrink: 0 }}>
        <span style={{ fontSize: '11px', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
          Explorer
        </span>
        <button
          onClick={fetchFiles}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#A1A1AA', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#0A0A0A'}
          onMouseLeave={e => e.currentTarget.style.color = '#A1A1AA'}
          title="Refresh"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      {/* File Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '64px' }}>
            <div className="animate-spin" style={{ width: '14px', height: '14px', border: '1.5px solid #D4D4D8', borderTopColor: '#0A0A0A', borderRadius: '50%' }} />
          </div>
        ) : error ? (
          <div style={{ padding: '12px', fontSize: '12px', color: '#DC2626' }}>{error}</div>
        ) : (
          Object.entries(tree).sort(([, a], [, b]) => {
            const aDir = a !== null && typeof a === 'object'
            const bDir = b !== null && typeof b === 'object'
            return bDir - aDir
          }).map(([name, node]) => (
            <TreeNode key={name} name={name} node={node}
              depth={0} agentBase={agentBase} activeFile={activeFile}
              onFileSelect={onFileSelect} path="" />
          ))
        )}
      </div>

      {/* Footer */}
      {!loading && files.length > 0 && (
        <div style={{ padding: '5px 12px', borderTop: '1px solid #D4D4D8', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', color: '#A1A1AA' }}>{files.length} files</span>
        </div>
      )}
    </aside>
  )
}
