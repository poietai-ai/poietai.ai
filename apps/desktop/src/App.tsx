import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { useAgentStore } from './store/agentStore';

function App() {
  const { startPolling, stopPolling } = useAgentStore();

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  return <AppShell />;
}

export default App;
