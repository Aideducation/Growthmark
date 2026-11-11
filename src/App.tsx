import { WorkspaceLayout } from './app/layouts/WorkspaceLayout'
import { WorkspacePages } from './features/workspace/WorkspacePages'
import { AuthProvider } from './features/auth/AuthProvider'
import { AuthGate } from './features/auth/AuthGate'
import { WorkspaceDataProvider } from './features/workspace/WorkspaceDataProvider'

export default function App() {
  return <AuthProvider><AuthGate><WorkspaceDataProvider><WorkspaceLayout><WorkspacePages /></WorkspaceLayout></WorkspaceDataProvider></AuthGate></AuthProvider>
}
