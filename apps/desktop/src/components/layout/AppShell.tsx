import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Sidebar } from './Sidebar';
import { MainArea } from './MainArea';
import { ProjectSwitcher } from './ProjectSwitcher';
import { SettingsPanel } from './SettingsPanel';
import { OnboardingWizard } from '../onboarding/OnboardingWizard';
import { ToastContainer } from '../ui/ToastContainer';
import { useSettingsStore } from '../../store/settingsStore';
import { useAgentStore } from '../../store/agentStore';
import { useToastStore } from '../../store/toastStore';
import type { CanvasNodePayload } from '../../types/canvas';

export function AppShell() {
  const [activeView, setActiveView] = useState('dashboard');
  const [showSettings, setShowSettings] = useState(false);
  const { onboardingComplete, loaded, completeOnboarding } = useSettingsStore();
  const { showToast } = useToastStore();

  // Show a toast whenever an agent sends a text message
  const handleAgentEvent = useCallback((payload: CanvasNodePayload) => {
    if (payload.event.type !== 'text') return;
    const text = payload.event.text;
    const agent = useAgentStore.getState().agents.find((a) => a.id === payload.agent_id);
    const agentName = agent?.name ?? payload.agent_id;
    const preview = text.split('\n').find((l) => l.trim()) ?? text;

    showToast({
      id: payload.agent_id,
      agentId: payload.agent_id,
      agentName,
      message: preview,
      isQuestion: text.trimEnd().endsWith('?'),
      ticketId: payload.ticket_id,
    });
  }, [showToast]);

  useEffect(() => {
    const unlisten = listen<CanvasNodePayload>('agent-event', (e) => handleAgentEvent(e.payload));
    return () => { unlisten.then((fn) => fn()); };
  }, [handleAgentEvent]);

  if (!loaded) return null;

  if (!onboardingComplete) {
    return <OnboardingWizard onComplete={completeOnboarding} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-900">
      <ProjectSwitcher />
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        onSettings={() => setShowSettings(true)}
      />
      <MainArea activeView={activeView} />
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <ToastContainer />
    </div>
  );
}
