import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { useAgentStore } from './store/agentStore';
import { useSecretsStore } from './store/secretsStore';
import { useSettingsStore } from './store/settingsStore';

function App() {
  const { startPolling, stopPolling, restoreAgents } = useAgentStore();
  const { loadToken } = useSecretsStore();
  const { loadSettings } = useSettingsStore();

  useEffect(() => {
    restoreAgents().then(() => startPolling());
    loadToken();
    loadSettings();
    return () => stopPolling();
  }, [startPolling, stopPolling, loadToken, loadSettings, restoreAgents]);

  return <AppShell />;
}

export default App;
