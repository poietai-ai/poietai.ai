import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { useAgentStore } from './store/agentStore';
import { useSecretsStore } from './store/secretsStore';

function App() {
  const { startPolling, stopPolling } = useAgentStore();
  const { loadToken } = useSecretsStore();

  useEffect(() => {
    startPolling();
    loadToken();
    return () => stopPolling();
  }, [startPolling, stopPolling, loadToken]);

  return <AppShell />;
}

export default App;
