import { useState, useEffect } from 'react'

const Spinner = () => (
  <div className="animate-spin" style={{ width: '16px', height: '16px', border: '1.5px solid #D4D4D8', borderTopColor: '#0A0A0A', borderRadius: '50%' }} />
)

export default function SplashScreen({ onSandboxCreated }) {
  const [loading, setLoading] = useState(false)
  const [loadingProjectId, setLoadingProjectId] = useState(null)
  const [error, setError] = useState(null)
  const [dots, setDots] = useState('')
  const [title, setTitle] = useState('')
  const [loadingStep, setLoadingStep] = useState('')

  const [user, setUser] = useState(null)      // null = checking, false = not logged in, obj = logged in
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(true)

  // Check auth state then load projects
  useEffect(() => {
    const init = async () => {
      try {
        const meRes = await fetch('/api/auth/me', { credentials: 'include' })
        if (!meRes.ok) { setUser(false); setProjectsLoading(false); return }
        const me = await meRes.json()
        setUser(me)

        const projRes = await fetch('/api/sandbox/project', { credentials: 'include' })
        if (projRes.ok) {
          const data = await projRes.json()
          setProjects(data.projects || [])
        }
      } catch {
        setUser(false)
      } finally {
        setProjectsLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (!loading) return
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.')
    }, 400)
    return () => clearInterval(interval)
  }, [loading])

  const handleOpenProject = async (projectId) => {
    setLoadingProjectId(projectId)
    setError(null)
    try {
      const sandboxRes = await fetch('/api/sandbox/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId })
      })
      if (!sandboxRes.ok) throw new Error(`Failed to start sandbox (${sandboxRes.status})`)
      const sandboxData = await sandboxRes.json()
      onSandboxCreated(sandboxData)
    } catch (err) {
      setError(err.message || 'Failed to start sandbox')
      setLoadingProjectId(null)
    }
  }

  const handleCreate = async () => {
    const projectTitle = title.trim()
    if (!projectTitle) { setError('Please enter a project name'); return }
    setLoading(true)
    setError(null)
    try {
      setLoadingStep('project')
      const projectRes = await fetch('/api/sandbox/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: projectTitle })
      })
      if (!projectRes.ok) throw new Error(`Failed to create project (${projectRes.status})`)
      const projectData = await projectRes.json()
      const projectId = projectData.project._id

      setLoadingStep('sandbox')
      const sandboxRes = await fetch('/api/sandbox/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId })
      })
      if (!sandboxRes.ok) throw new Error(`Failed to start sandbox (${sandboxRes.status})`)
      const sandboxData = await sandboxRes.json()
      onSandboxCreated(sandboxData)
    } catch (err) {
      setError(err.message || 'Failed to create sandbox')
      setLoading(false)
      setLoadingStep('')
    }
  }

  const isAnyLoading = loading || loadingProjectId !== null

  return (
    <div style={{
      height: '100%', width: '100%', background: '#FAFAFA',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      overflow: 'auto', padding: '64px 24px', position: 'relative'
    }}>

      <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '40px' }}>

        {/* Logo mark */}
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <rect x="0" y="0" width="12" height="12" fill="#0A0A0A" />
          <rect x="16" y="0" width="12" height="12" fill="#0A0A0A" opacity="0.2" />
          <rect x="0" y="16" width="12" height="12" fill="#0A0A0A" opacity="0.2" />
          <rect x="16" y="16" width="12" height="12" fill="#0A0A0A" />
        </svg>

        {/* Title */}
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '40px', fontWeight: '700', lineHeight: '1.1', color: '#0A0A0A', letterSpacing: '-0.02em' }}>
            Sandbox IDE
          </h1>
          <p style={{ fontSize: '16px', fontWeight: '300', lineHeight: '1.65', color: '#71717A', marginTop: '12px' }}>
            Spin up an isolated coding environment in seconds
          </p>
        </div>

        {/* Feature chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px' }}>
          {['AI-Powered', 'Live Preview', 'Terminal Access', 'File Explorer'].map(f => (
            <span key={f} style={{
              display: 'inline-flex', alignItems: 'center', height: '28px',
              padding: '0 12px', border: '1px solid #D4D4D8',
              fontSize: '11px', fontWeight: '400', color: '#71717A',
              textTransform: 'uppercase', letterSpacing: '0.06em'
            }}>
              {f}
            </span>
          ))}
        </div>

        {/* Auth state */}
        {user === null ? (
          /* Checking auth */
          <Spinner />
        ) : user === false ? (
          /* Not logged in — Google login */
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <p style={{ fontSize: '14px', fontWeight: '300', color: '#71717A' }}>
              Sign in to create or open a sandbox
            </p>
            <a
              href="/api/auth/google"
              style={{
                width: '100%', height: '48px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '12px',
                background: '#FFFFFF', color: '#0A0A0A',
                border: '1px solid #D4D4D8', textDecoration: 'none',
                fontSize: '15px', fontWeight: '500', fontFamily: 'inherit',
                transition: 'border-color 0.15s, background 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#0A0A0A'; e.currentTarget.style.background = '#F4F4F5' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#D4D4D8'; e.currentTarget.style.background = '#FFFFFF' }}
            >
              {/* Google logo */}
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Continue with Google
            </a>
          </div>
        ) : (
          /* Logged in — projects + create form */
          <div style={{ width: '100%' }}>

            {!isAnyLoading && (
              <>
                {projectsLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
                    <Spinner />
                  </div>
                ) : projects.length > 0 && (
                  <div style={{ marginBottom: '0' }}>
                    <p style={{ fontSize: '11px', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A', marginBottom: '12px' }}>
                      Recent Projects
                    </p>
                    <div style={{ border: '1px solid #D4D4D8' }}>
                      {projects.map((project, i) => (
                        <button
                          key={project._id}
                          onClick={() => handleOpenProject(project._id)}
                          disabled={isAnyLoading}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', padding: '12px 16px',
                            background: 'transparent', border: 'none',
                            borderTop: i > 0 ? '1px solid #D4D4D8' : 'none',
                            cursor: 'pointer', textAlign: 'left',
                            transition: 'background 0.15s'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F4F4F5'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <span style={{ fontSize: '14px', fontWeight: '400', color: '#0A0A0A' }}>
                            {project.title}
                          </span>
                          {loadingProjectId === project._id ? (
                            <div className="animate-spin" style={{ width: '14px', height: '14px', border: '1.5px solid #D4D4D8', borderTopColor: '#0A0A0A', borderRadius: '50%', flexShrink: 0 }} />
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" strokeWidth="2">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '32px 0' }}>
                      <div style={{ flex: 1, height: '1px', background: '#D4D4D8' }} />
                      <span style={{ fontSize: '12px', fontWeight: '400', color: '#A1A1AA' }}>or create new</span>
                      <div style={{ flex: 1, height: '1px', background: '#D4D4D8' }} />
                    </div>
                  </div>
                )}
              </>
            )}

            {!isAnyLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input
                  type="text"
                  value={title}
                  onChange={e => { setTitle(e.target.value); setError(null) }}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="New project name…"
                  autoFocus={projects.length === 0}
                  style={{
                    width: '100%', height: '40px', padding: '0 16px',
                    border: '1px solid #D4D4D8', borderRadius: '0',
                    fontSize: '14px', fontWeight: '400', color: '#0A0A0A',
                    background: '#FFFFFF', outline: 'none', fontFamily: 'inherit',
                    transition: 'border-color 0.15s'
                  }}
                  onFocus={e => e.target.style.border = '2px solid #0A0A0A'}
                  onBlur={e => e.target.style.border = '1px solid #D4D4D8'}
                />
                <button
                  onClick={handleCreate}
                  style={{
                    width: '100%', height: '48px',
                    background: '#0A0A0A', color: '#FAFAFA',
                    border: '1px solid #0A0A0A',
                    fontSize: '15px', fontWeight: '500',
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background 0.15s, color 0.15s',
                    letterSpacing: '0.01em'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#FAFAFA'; e.currentTarget.style.color = '#0A0A0A' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#0A0A0A'; e.currentTarget.style.color = '#FAFAFA' }}
                >
                  Create New Project
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <Spinner />
                <p style={{ fontSize: '14px', fontWeight: '300', color: '#71717A' }}>
                  {loadingProjectId
                    ? `Starting sandbox${dots}`
                    : loadingStep === 'project'
                      ? `Creating project${dots}`
                      : `Starting sandbox${dots}`}
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <p style={{ fontSize: '13px', color: '#DC2626', fontWeight: '400' }}>
            {error}
          </p>
        )}
      </div>

      <p style={{ position: 'absolute', bottom: '24px', fontSize: '12px', fontWeight: '400', color: '#A1A1AA' }}>
        Powered by AI · Isolated Runtime · Zero Config
      </p>
    </div>
  )
}
