import { useEffect, useState } from 'react'
import { ChatWorkspace } from './components/Chat'
import { SidebarLeft, SidebarRight } from './components/Sidebars'
import { FilesPage } from './components/pages/FilesPage'
import { MemoryPage, SettingsPage, ToolsPage, WorkforcePage } from './components/pages/InfoPages'
import { AccountPage, CliPage, ConnectorsPage, DataInputPage, McpPage, PluginsPage } from './components/pages/IntegrationPages'
import { SkillsPage } from './components/pages/SkillsPage'
import { KnowledgePage } from './components/pages/KnowledgePage'
import { MissionsPage } from './components/pages/MissionsPage'
import { ExecutionCenterPage } from './components/pages/ExecutionCenterPage'
import { useActivity, useAuthUser, useConversations, useIsMobile, usePrefs } from './lib/hooks'
import type { ViewId } from './lib/types'
import { cx } from './lib/util'

function ViewPage({ view, ...p }: { view: Exclude<ViewId, 'chat'>; onToggleLeft: () => void; leftCollapsed: boolean; onActivity: (m: string) => void; onNavigate?: (v: ViewId) => void }) {
  switch (view) {
    case 'missions': return <MissionsPage {...p} />
    case 'execution': return <ExecutionCenterPage {...p} onNavigate={p.onNavigate} />
    case 'workforce': return <WorkforcePage {...p} />
    case 'knowledge': return <KnowledgePage {...p} />
    case 'datainput': return <DataInputPage {...p} />
    case 'tools': return <ToolsPage {...p} />
    case 'skills': return <SkillsPage {...p} />
    case 'files': return <FilesPage {...p} />
    case 'memory': return <MemoryPage {...p} />
    case 'account': return <AccountPage {...p} />
    case 'mcp': return <McpPage {...p} />
    case 'cli': return <CliPage {...p} />
    case 'plugins': return <PluginsPage {...p} />
    case 'connectors': return <ConnectorsPage {...p} />
    case 'settings': return <SettingsPage {...p} />
  }
}

export default function App() {
  const isMobile = useIsMobile()
  const [prefs, setPrefs] = usePrefs(
    isMobile ? { leftCollapsed: true, rightCollapsed: true } : { leftCollapsed: false, rightCollapsed: false },
  )
  const conversations = useConversations()
  const [events, pushEvent] = useActivity()
  const [view, setView] = useState<ViewId>('chat')
  const user = useAuthUser()

  useEffect(() => {
    if (conversations.storageError) pushEvent('Penyimpanan lokal gagal — percakapan terbaru mungkin tidak tersimpan')
  }, [conversations.storageError, pushEvent])

  // Layar sempit: sidebar tampil sebagai overlay yang menutupi konten. Preferensi "terbuka" dari sesi lebar tidak boleh
  // ikut terbawa saat jendela menyempit, dan memilih tujuan harus langsung memperlihatkan kontennya.
  useEffect(() => { if (isMobile) setPrefs({ leftCollapsed: true, rightCollapsed: true }) }, [isMobile, setPrefs])
  const closeLeftIfMobile = () => { if (isMobile) setPrefs({ leftCollapsed: true }) }

  const activeConv = conversations.conversations.find(c => c.id === conversations.activeId) ?? null

  useEffect(() => {
    if (!isMobile) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPrefs({ leftCollapsed: true, rightCollapsed: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobile, setPrefs])

  const pageProps = { onToggleLeft: () => setPrefs({ leftCollapsed: !prefs.leftCollapsed }), leftCollapsed: prefs.leftCollapsed, onActivity: pushEvent, onNavigate: (v: ViewId) => { setView(v); closeLeftIfMobile() } }

  const appCls = cx(
    'app',
    prefs.leftCollapsed && 'left-collapsed',
    prefs.rightCollapsed && 'right-collapsed',
    isMobile && (!prefs.leftCollapsed || !prefs.rightCollapsed) && 'has-overlay',
  )

  return (
    <div className={appCls}>
      <a className="skip-link" href="#composer">Langsung ke composer</a>
      <SidebarLeft
        collapsed={prefs.leftCollapsed}
        onToggle={() => setPrefs({ leftCollapsed: !prefs.leftCollapsed })}
        view={view}
        onSelectView={v => { setView(v); closeLeftIfMobile() }}
        conversations={conversations.conversations}
        activeId={conversations.activeId}
        onSelectConversation={id => { conversations.select(id); setView('chat'); closeLeftIfMobile() }}
        onNewChat={() => { conversations.select(null); setView('chat'); closeLeftIfMobile(); pushEvent('Chat baru dimulai') }}
        onRename={conversations.rename}
        onDelete={id => { conversations.remove(id); pushEvent('Percakapan dihapus') }}
        user={user}
      />
      <div className="scrim" onClick={() => setPrefs({ leftCollapsed: true, rightCollapsed: true })} aria-hidden="true" />
      <main className="center" id="main">
        {view === 'chat' ? (
          <ChatWorkspace
            conv={activeConv}
            leftCollapsed={prefs.leftCollapsed}
            rightCollapsed={prefs.rightCollapsed}
            onToggleLeft={() => setPrefs({ leftCollapsed: !prefs.leftCollapsed })}
            onToggleRight={() => setPrefs({ rightCollapsed: !prefs.rightCollapsed })}
            onCreateConversation={() => {
              const id = conversations.create()
              pushEvent('Percakapan dibuat')
              return id
            }}
            onAddMessage={conversations.addMessage}
            onUpdateMessage={conversations.updateMessage}
            onDeleteMessage={conversations.deleteMessage}
            onActivity={pushEvent}
            onNavigate={v => { setView(v); closeLeftIfMobile() }}
          />
        ) : (
          <ViewPage view={view} {...pageProps} />
        )}
      </main>
      <SidebarRight
        collapsed={prefs.rightCollapsed}
        onToggle={() => setPrefs({ rightCollapsed: !prefs.rightCollapsed })}
        events={events}
      />
    </div>
  )
}
