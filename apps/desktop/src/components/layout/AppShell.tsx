import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Titlebar } from './Titlebar';
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
import { useTicketStore } from '../../store/ticketStore';
import { useNavigationStore } from '../../store/navigationStore';
import type { CanvasNodePayload, AgentQuestionPayload, AgentChoicesPayload, AgentStatusPayload, AgentConfirmPayload } from '../../types/canvas';

export function AppShell() {
  const { activeView, setActiveView } = useNavigationStore();
  const [showSettings, setShowSettings] = useState(false);
  const { onboardingComplete, loaded, completeOnboarding } = useSettingsStore();
  const { showToast } = useToastStore();

  // Route agent text events to DM
  const handleAgentEvent = useCallback((payload: CanvasNodePayload) => {
    if (payload.kind.type !== 'text') return;
    const text = payload.kind.text;
    const agent = useAgentStore.getState().agents.find((a) => a.id === payload.agent_id);
    const agentName = agent?.name ?? payload.agent_id;

    // Chat messages use sentinel ticket_id "chat" — strip it so no ticket badge shows
    const ticketId = payload.ticket_id === 'chat' ? undefined : payload.ticket_id;

    // Detect low-value narration ("Let me explore...", "I'll read the files...")
    // and route as status pills instead of full messages
    const firstLine = text.split('\n').find((l: string) => l.trim()) ?? text;
    const isNarration = /^(Let me|I'll|I need to|I'm going to|First,? (?:let me|I'll)|Now (?:let me|I'll))\b/i.test(firstLine)
      && text.split('\n').filter((l: string) => l.trim()).length <= 2
      && text.length < 200;

    if (isNarration) {
      useMessageStore.getState().addMessage({
        id: payload.node_id ?? `dm-${payload.agent_id}-${Date.now()}`,
        threadId: payload.agent_id,
        threadType: 'dm',
        from: 'system',
        agentId: payload.agent_id,
        agentName,
        content: firstLine,
        type: 'status',
        ticketId,
        timestamp: Date.now(),
      });
      return;
    }

    const preview = firstLine;

    // Skip toast if user is already viewing this agent's DM
    const isViewingDm = activeView === 'messages'
      && useMessageStore.getState().activeThread === payload.agent_id;
    if (!isViewingDm) {
      showToast({
        id: payload.agent_id,
        agentId: payload.agent_id,
        agentName,
        message: preview,
        isQuestion: text.trimEnd().endsWith('?'),
        ticketId,
      });
    }

    useMessageStore.getState().addMessage({
      id: payload.node_id ?? `dm-${payload.agent_id}-${Date.now()}`,
      threadId: payload.agent_id,
      threadType: 'dm',
      from: 'agent',
      agentId: payload.agent_id,
      agentName,
      content: text,
      type: 'text',
      ticketId,
      timestamp: Date.now(),
    });
  }, [showToast, activeView]);

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

  // Auto-respond to agent-list-tickets with current ticket data
  useEffect(() => {
    const unlisten = listen<{ request_id: string; agent_id: string; status_filter: string }>(
      'agent-list-tickets',
      (event) => {
        const { request_id, status_filter } = event.payload;
        let tickets = useTicketStore.getState().tickets;
        if (status_filter) {
          tickets = tickets.filter((t) => t.status === status_filter);
        }
        const data = tickets.length === 0
          ? 'No tickets on the board.'
          : tickets
              .map((t) => {
                const phase = t.activePhase ? `/${t.activePhase}` : '';
                const assignees = t.assignments.map((a) => a.agentId).join(', ');
                const desc = t.description.length > 100
                  ? t.description.slice(0, 97) + '...'
                  : t.description;
                return `#${t.number}: ${t.title} [${t.status}${phase}]${assignees ? ` (${assignees})` : ''} — ${desc}`;
              })
              .join('\n');
        invoke('answer_tickets', { requestId: request_id, data }).catch((err) =>
          console.warn('[answer_tickets] failed:', err),
        );
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Auto-respond to agent-get-ticket-details with full ticket data + artifacts
  useEffect(() => {
    const unlisten = listen<{ request_id: string; agent_id: string; ticket_number: number }>(
      'agent-get-ticket-details',
      (event) => {
        const { request_id, ticket_number } = event.payload;
        const ticket = useTicketStore.getState().tickets.find((t) => t.number === ticket_number);

        if (!ticket) {
          invoke('answer_tickets', { requestId: request_id, data: `Ticket #${ticket_number} not found.` }).catch((err) =>
            console.warn('[answer_tickets] failed:', err),
          );
          return;
        }

        const assignees = ticket.assignments.map((a) => {
          const agent = useAgentStore.getState().agents.find((ag) => ag.id === a.agentId);
          return agent?.name ?? a.agentId;
        });

        const lines = [
          `# #${ticket.number}: ${ticket.title}`,
          `Status: ${ticket.status}${ticket.activePhase ? ` / phase: ${ticket.activePhase}` : ''}`,
          `Complexity: ${ticket.complexity}/10`,
          assignees.length > 0 ? `Assigned to: ${assignees.join(', ')}` : 'Unassigned',
          '',
          '## Description',
          ticket.description,
        ];

        if (ticket.acceptanceCriteria.length > 0) {
          lines.push('', '## Acceptance Criteria');
          ticket.acceptanceCriteria.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
        }

        if (ticket.phases.length > 0) {
          lines.push('', `## Phases: ${ticket.phases.join(' → ')}`);
        }

        // Include artifacts
        const artifactPhases = Object.keys(ticket.artifacts) as Array<keyof typeof ticket.artifacts>;
        if (artifactPhases.length > 0) {
          for (const phase of artifactPhases) {
            const artifact = ticket.artifacts[phase];
            if (!artifact) continue;
            const truncated = artifact.content.length > 2000
              ? artifact.content.slice(0, 1997) + '...'
              : artifact.content;
            lines.push('', `## Artifact: ${phase}`, truncated);
          }
        }

        invoke('answer_tickets', { requestId: request_id, data: lines.join('\n') }).catch((err) =>
          console.warn('[answer_tickets] failed:', err),
        );
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Show chat agent errors as status pills in the DM
  useEffect(() => {
    const unlisten = listen<{ agent_id: string; error: string }>(
      'agent-chat-error',
      (event) => {
        const { agent_id, error } = event.payload;
        const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
        useMessageStore.getState().addMessage({
          id: `dm-err-${agent_id}-${Date.now()}`,
          threadId: agent_id,
          threadType: 'dm',
          from: 'system',
          agentId: agent_id,
          agentName: agent?.name ?? agent_id,
          content: `Failed to respond — ${error}`,
          type: 'status',
          timestamp: Date.now(),
        });
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Orchestrator: phase completed — advance ticket phase + store artifact
  useEffect(() => {
    const unlisten = listen<{
      ticket_id: string;
      phase: string;
      artifact_content?: string;
      blocked: boolean;
    }>('orchestrator-phase-completed', (event) => {
      const { ticket_id, phase, artifact_content, blocked } = event.payload;

      if (artifact_content) {
        useTicketStore.getState().setPhaseArtifact(ticket_id, {
          phase: phase as any,
          content: artifact_content,
          createdAt: new Date().toISOString(),
          agentId: '',
        });
      }

      if (blocked) {
        useTicketStore.getState().blockTicket(ticket_id);
      } else {
        useTicketStore.getState().advanceTicketPhase(ticket_id);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Orchestrator: blocked — block the ticket
  useEffect(() => {
    const unlisten = listen<{
      ticket_id: string;
      reason: string;
      details?: string;
    }>('orchestrator-blocked', (event) => {
      const { ticket_id, reason } = event.payload;
      useTicketStore.getState().blockTicket(ticket_id);
      showToast({
        id: `orc-blocked-${ticket_id}-${Date.now()}`,
        agentId: '',
        agentName: 'Orchestrator',
        message: reason,
        isQuestion: false,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [showToast]);

  // Orchestrator: question — route to DM
  useEffect(() => {
    const unlisten = listen<{
      ticket_id: string;
      agent_id: string;
      content: string;
      session_id: string;
    }>('orchestrator-question', (event) => {
      const { ticket_id, agent_id, content, session_id } = event.payload;
      if (!content) return;
      const agent = useAgentStore.getState().agents.find((a: any) => a.id === agent_id);
      useMessageStore.getState().addMessage({
        id: `dm-resume-${agent_id}-${Date.now()}`,
        threadId: agent_id,
        threadType: 'dm',
        from: 'agent',
        agentId: agent_id,
        agentName: agent?.name ?? agent_id,
        content,
        type: 'question',
        ticketId: ticket_id,
        timestamp: Date.now(),
        resolved: false,
        sessionId: session_id,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  if (!loaded) return null;

  if (!onboardingComplete) {
    return <OnboardingWizard onComplete={completeOnboarding} />;
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-neutral-900">
      <Titlebar />
      <div className="flex flex-1 min-h-0">
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
    </div>
  );
}
