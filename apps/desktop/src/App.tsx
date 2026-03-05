import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { useAgentStore } from './store/agentStore';
import { useSecretsStore } from './store/secretsStore';
import { useSettingsStore } from './store/settingsStore';
import { useProjectStore } from './store/projectStore';
import { useTicketStore } from './store/ticketStore';
import { useMessageStore } from './store/messageStore';

function App() {
  const { startPolling, stopPolling, restoreAgents } = useAgentStore();
  const { loadToken } = useSecretsStore();
  const { loadSettings } = useSettingsStore();
  const { loadFromDisk: loadProjects } = useProjectStore();
  const { loadFromDisk: loadTickets } = useTicketStore();
  const { loadFromDisk: loadMessages } = useMessageStore();

  useEffect(() => {
    restoreAgents().then(() => startPolling());
    loadToken();
    loadSettings();
    // Load projects first, then project-scoped stores
    loadProjects().then(() => { loadTickets(); loadMessages(); });
    return () => stopPolling();
  }, [startPolling, stopPolling, loadToken, loadSettings, restoreAgents, loadProjects, loadTickets, loadMessages]);

  return <AppShell />;
}

export default App;
