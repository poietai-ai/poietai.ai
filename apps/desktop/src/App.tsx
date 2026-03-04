import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { useAgentStore } from './store/agentStore';
import { useSecretsStore } from './store/secretsStore';
import { useSettingsStore } from './store/settingsStore';
import { useTicketStore } from './store/ticketStore';
import { useConversationStore } from './store/conversationStore';
import { useMessageStore } from './store/messageStore';

function App() {
  const { startPolling, stopPolling, restoreAgents } = useAgentStore();
  const { loadToken } = useSecretsStore();
  const { loadSettings } = useSettingsStore();
  const { loadFromDisk: loadTickets } = useTicketStore();
  const { loadFromDisk: loadConversations } = useConversationStore();
  const { loadFromDisk: loadMessages } = useMessageStore();

  useEffect(() => {
    restoreAgents().then(() => startPolling());
    loadToken();
    loadSettings();
    loadTickets();
    loadConversations();
    loadMessages();
    return () => stopPolling();
  }, [startPolling, stopPolling, loadToken, loadSettings, restoreAgents, loadTickets, loadConversations, loadMessages]);

  return <AppShell />;
}

export default App;
