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
import { useMessageStore } from '../../store/messageStore';
import type { CanvasNodePayload, AgentQuestionPayload, AgentChoicesPayload, AgentStatusPayload, AgentConfirmPayload } from '../../types/canvas';

export function AppShell() {
  const [activeView, setActiveView] = useState('dashboard');
  const [showSettings, setShowSettings] = useState(false);
  const { onboardingComplete, loaded, completeOnboarding } = useSettingsStore();
  const { showToast } = useToastStore();

  // Show a toast whenever an agent sends a text message
  const handleAgentEvent = useCallback((payload: CanvasNodePayload) => {
    if (payload.kind.type !== 'text') return;
    const text = payload.kind.text;
    const agent = useAgentStore.getState().agents.find((a) => a.id === payload.agent_id);
    const agentName = agent?.name ?? payload.agent_id;
    const preview = text.split('\n').find((l: string) => l.trim()) ?? text;

    showToast({
      id: payload.agent_id,
      agentId: payload.agent_id,
      agentName,
      message: preview,
      isQuestion: text.trimEnd().endsWith('?'),
      ticketId: payload.ticket_id,
    });

    useMessageStore.getState().addMessage({
      id: payload.node_id ?? `dm-${payload.agent_id}-${Date.now()}`,
      threadId: payload.agent_id,
      threadType: 'dm',
      from: 'agent',
      agentId: payload.agent_id,
      agentName,
      content: text,
      type: 'text',
      ticketId: payload.ticket_id,
      timestamp: Date.now(),
    });
  }, [showToast]);

  useEffect(() => {
    const unlisten = listen<CanvasNodePayload>('agent-event', (e) => handleAgentEvent(e.payload));
    return () => { unlisten.then((fn) => fn()); };
  }, [handleAgentEvent]);

  // Route agent-question to DM
  useEffect(() => {
    const unlisten = listen<AgentQuestionPayload>('agent-question', (event) => {
      const { agent_id, question } = event.payload;
      const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
      useMessageStore.getState().addMessage({
        id: `dm-q-${agent_id}-${Date.now()}`,
        threadId: agent_id,
        threadType: 'dm',
        from: 'agent',
        agentId: agent_id,
        agentName: agent?.name ?? agent_id,
        content: question,
        type: 'question',
        timestamp: Date.now(),
        resolved: false,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Route agent-status to DM
  useEffect(() => {
    const unlisten = listen<AgentStatusPayload>('agent-status', (event) => {
      const { agent_id, message } = event.payload;
      const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
      useMessageStore.getState().addMessage({
        id: `dm-s-${agent_id}-${Date.now()}`,
        threadId: agent_id,
        threadType: 'dm',
        from: 'system',
        agentId: agent_id,
        agentName: agent?.name ?? agent_id,
        content: message,
        type: 'status',
        timestamp: Date.now(),
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Route agent-choices to DM
  useEffect(() => {
    const unlisten = listen<AgentChoicesPayload>('agent-choices', (event) => {
      const { agent_id, question, choices } = event.payload;
      const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
      useMessageStore.getState().addMessage({
        id: `dm-ch-${agent_id}-${Date.now()}`,
        threadId: agent_id,
        threadType: 'dm',
        from: 'agent',
        agentId: agent_id,
        agentName: agent?.name ?? agent_id,
        content: question,
        type: 'choices',
        choices,
        timestamp: Date.now(),
        resolved: false,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Route agent-confirm to DM
  useEffect(() => {
    const unlisten = listen<AgentConfirmPayload>('agent-confirm', (event) => {
      const { agent_id, action, details } = event.payload;
      const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
      useMessageStore.getState().addMessage({
        id: `dm-cf-${agent_id}-${Date.now()}`,
        threadId: agent_id,
        threadType: 'dm',
        from: 'agent',
        agentId: agent_id,
        agentName: agent?.name ?? agent_id,
        content: action,
        type: 'confirm',
        actionDetails: details,
        timestamp: Date.now(),
        resolved: false,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

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
