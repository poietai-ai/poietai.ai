import { useState, useEffect, useCallback, useRef } from 'react';
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
import { useCanvasStore } from '../../store/canvasStore';
import { useProjectStore } from '../../store/projectStore';
import { useChatSessionStore } from '../../store/chatSessionStore';
import { useSecretsStore } from '../../store/secretsStore';
import { buildPrompt } from '../../lib/promptBuilder';
import { buildChatPrompt } from '../../lib/chatPromptBuilder';
import { resolveInitiative, type InitiativeLevel } from '../../lib/initiativeResolver';
import { resumeStalledTickets } from '../../lib/resumeOnStartup';
import { checkAgentMessageRate, checkConversationDepth } from '../../lib/agentMessageRateLimit';
import type { CanvasNodePayload, AgentQuestionPayload, AgentChoicesPayload, AgentStatusPayload, AgentConfirmPayload } from '../../types/canvas';

export function AppShell() {
  const { activeView, setActiveView } = useNavigationStore();
  const [showSettings, setShowSettings] = useState(false);
  const { onboardingComplete, loaded, completeOnboarding } = useSettingsStore();
  const { showToast } = useToastStore();

  // Route agent text events to DM (chat only — ticket work goes to the canvas)
  const handleAgentEvent = useCallback((payload: CanvasNodePayload) => {
    if (payload.kind.type !== 'text') return;

    // Ticket work events stay on the canvas — don't spam the DM
    if (payload.ticket_id && payload.ticket_id !== 'chat') return;

    const text = payload.kind.text;
    const agent = useAgentStore.getState().agents.find((a) => a.id === payload.agent_id);
    const agentName = agent?.name ?? payload.agent_id;

    const ticketId = undefined; // chat messages never show a ticket badge

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

  // Route agent-event to canvas store (always-on, regardless of active view)
  useEffect(() => {
    const unlisten = listen<CanvasNodePayload>('agent-event', (e) => {
      useCanvasStore.getState().addNodeFromEvent(e.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Route agent-status to canvas
  useEffect(() => {
    const unlisten = listen<AgentStatusPayload>('agent-status', (event) => {
      const { agent_id, message } = event.payload;
      useCanvasStore.getState().addStatusUpdateNode(agent_id, message);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Route orchestrator fan-out/fan-in to canvas
  useEffect(() => {
    const unlistenFanOut = listen<{ ticket_id: string; groups: { group_id: string; agent_role: string }[] }>(
      'orchestrator-fan-out',
      (event) => {
        useCanvasStore.getState().addFanOutNode(event.payload.ticket_id, event.payload.groups);
      },
    );
    const unlistenFanIn = listen<{ ticket_id: string; merge_status: string }>(
      'orchestrator-fan-in',
      (event) => {
        useCanvasStore.getState().addFanInNode(event.payload.ticket_id, event.payload.merge_status);
      },
    );
    return () => {
      unlistenFanOut.then((fn) => fn());
      unlistenFanIn.then((fn) => fn());
    };
  }, []);

  // Route agent-question to DM. The subagent IS the chat agent (same entity),
  // so questions appear directly in the DM. User replies via answer_agent.
  useEffect(() => {
    const unlisten = listen<AgentQuestionPayload>('agent-question', (event) => {
      const { agent_id, question } = event.payload;
      const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
      const agentName = agent?.name ?? agent_id;

      // If working on a ticket, tag the question with the ticket ref
      let content = question;
      if (agent?.current_ticket_id) {
        const ticket = useTicketStore.getState().tickets.find((t) => t.id === agent.current_ticket_id);
        if (ticket) {
          content = question;  // question content is already from "Atlas" — keep it natural
        }
      }

      useMessageStore.getState().addMessage({
        id: `dm-q-${agent_id}-${Date.now()}`,
        threadId: agent_id,
        threadType: 'dm',
        from: 'agent',
        agentId: agent_id,
        agentName,
        content,
        type: 'question',
        timestamp: Date.now(),
        resolved: false,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Route agent-status to DM + channels
  useEffect(() => {
    const unlisten = listen<AgentStatusPayload>('agent-status', (event) => {
      const { agent_id, message } = event.payload;
      const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
      const agentName = agent?.name ?? agent_id;
      const ts = Date.now();

      // Post to DM
      useMessageStore.getState().addMessage({
        id: `dm-s-${agent_id}-${ts}`,
        threadId: agent_id,
        threadType: 'dm',
        from: 'system',
        agentId: agent_id,
        agentName,
        content: message,
        type: 'status',
        timestamp: ts,
      });

      // Also post to channels where this agent is a member
      const channels = useMessageStore.getState().channels;
      for (const ch of channels) {
        if (ch.agentIds.includes(agent_id)) {
          useMessageStore.getState().addMessage({
            id: `ch-s-${ch.id}-${agent_id}-${ts}`,
            threadId: ch.id,
            threadType: 'channel',
            from: 'system',
            agentId: agent_id,
            agentName,
            content: message,
            type: 'status',
            timestamp: ts,
          });
        }
      }
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

  // Agent-to-agent message listener
  useEffect(() => {
    const unlisten = listen<{
      from_agent_id: string;
      to: string[];
      message: string;
      conversation_id?: string;
    }>('agent-message', (event) => {
      const { from_agent_id, to, message, conversation_id } = event.payload;
      const fromAgent = useAgentStore.getState().agents.find((a) => a.id === from_agent_id);
      const store = useMessageStore.getState();

      // Find or create conversation
      let convId = conversation_id;
      if (!convId) {
        const participants = [from_agent_id, ...to];
        const conv = store.findOrCreateDm(participants);
        convId = conv.id;
      }

      // Rate limit check
      if (!checkAgentMessageRate(convId, from_agent_id)) {
        console.warn(`[agent-message] rate limited: ${from_agent_id} in ${convId}`);
        return;
      }

      // Add the message to the conversation thread
      store.addMessage({
        id: `agent-msg-${from_agent_id}-${Date.now()}`,
        threadId: convId,
        threadType: 'dm',
        from: from_agent_id,
        agentId: from_agent_id,
        agentName: fromAgent?.name ?? from_agent_id,
        content: message,
        type: 'text',
        timestamp: Date.now(),
      });

      // Check conversation depth — pause if too many agent messages without user input
      const threadMsgs = store.threads[convId] ?? [];
      if (checkConversationDepth(threadMsgs)) {
        store.addMessage({
          id: `depth-warn-${Date.now()}`,
          threadId: convId,
          threadType: 'dm',
          from: 'system',
          agentId: '',
          agentName: 'System',
          content: 'Conversation paused — agents have been going back and forth. Want to weigh in?',
          type: 'status',
          timestamp: Date.now(),
        });
        return; // Don't wake agents
      }

      // Wake each idle recipient agent
      for (const recipientId of to) {
        const recipient = useAgentStore.getState().agents.find((a) => a.id === recipientId);
        if (!recipient || recipient.chatting) continue;

        // Build context for the wake
        const tickets = useTicketStore.getState().tickets;
        const contextUpdate = useChatSessionStore.getState().flushUpdates(recipientId);
        const { projects, activeProjectId } = useProjectStore.getState();
        const activeProject = projects.find((p) => p.id === activeProjectId);
        const projectRoot = activeProject?.repos[0]?.repoRoot;
        const systemPrompt = buildChatPrompt({
          agent: recipient,
          tickets,
          projectName: activeProject?.name,
          projectRoot,
        });

        const wakeMessage = `[AGENT_MESSAGE from ${fromAgent?.name ?? from_agent_id}]: ${message}`;

        invoke('chat_agent', {
          payload: {
            agent_id: recipientId,
            message: wakeMessage,
            system_prompt: systemPrompt,
            context_update: contextUpdate,
          },
        }).catch((err) => {
          console.warn(`[agent-message] failed to wake ${recipientId}:`, err);
          // Queue as context update instead
          useChatSessionStore.getState().pushUpdate(
            recipientId,
            `Message from ${fromAgent?.name ?? from_agent_id}: ${message}`
          );
        });
      }
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

  // Auto-respond to agent-update-ticket
  useEffect(() => {
    const unlisten = listen<{
      request_id: string;
      agent_id: string;
      ticket_number: number;
      title: string;
      description: string;
      acceptance_criteria: string[];
      tags: string[];
      complexity: number;
      status: string;
    }>('agent-update-ticket', (event) => {
      const { request_id, ticket_number, title, description, acceptance_criteria, tags, complexity, status } = event.payload;
      const ticket = useTicketStore.getState().tickets.find((t) => t.number === ticket_number);

      if (!ticket) {
        invoke('answer_tickets', { requestId: request_id, data: `Ticket #${ticket_number} not found.` }).catch((err) =>
          console.warn('[answer_tickets] failed:', err),
        );
        return;
      }

      const patch: Record<string, unknown> = {};
      if (title) patch.title = title;
      if (description) patch.description = description;
      if (acceptance_criteria.length > 0) patch.acceptanceCriteria = acceptance_criteria;
      if (tags.length > 0) patch.tags = tags;
      if (complexity > 0) patch.complexity = complexity;

      if (Object.keys(patch).length > 0) {
        useTicketStore.getState().updateTicket(ticket.id, patch as any);
      }
      if (status) {
        useTicketStore.getState().updateTicketStatus(ticket.id, status as any);
      }

      const updated = Object.keys(patch).concat(status ? ['status'] : []).join(', ') || 'no fields';
      invoke('answer_tickets', { requestId: request_id, data: `Updated #${ticket_number}: ${updated}` }).catch((err) =>
        console.warn('[answer_tickets] failed:', err),
      );
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Auto-respond to agent-create-ticket
  useEffect(() => {
    const unlisten = listen<{
      request_id: string;
      agent_id: string;
      title: string;
      description: string;
      complexity: number;
      acceptance_criteria: string[];
    }>('agent-create-ticket', (event) => {
      const { request_id, title, description, complexity, acceptance_criteria } = event.payload;

      useTicketStore.getState().addTicket({
        title: title || 'Untitled',
        description: description || '',
        complexity: complexity || 3,
        acceptanceCriteria: acceptance_criteria.length > 0 ? acceptance_criteria : [],
      });

      const newNumber = useTicketStore.getState().nextTicketNumber - 1;
      invoke('answer_tickets', { requestId: request_id, data: `Created ticket #${newNumber}: ${title}` }).catch((err) =>
        console.warn('[answer_tickets] failed:', err),
      );
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Auto-respond to agent-complete-phase
  useEffect(() => {
    const unlisten = listen<{
      request_id: string;
      agent_id: string;
      ticket_number: number;
      artifact: string;
    }>('agent-complete-phase', (event) => {
      const { request_id, agent_id, ticket_number, artifact } = event.payload;
      const ticket = useTicketStore.getState().tickets.find((t) => t.number === ticket_number);

      if (!ticket) {
        invoke('answer_tickets', { requestId: request_id, data: `Ticket #${ticket_number} not found.` }).catch((err) =>
          console.warn('[answer_tickets] failed:', err),
        );
        return;
      }

      if (artifact && ticket.activePhase) {
        useTicketStore.getState().setPhaseArtifact(ticket.id, {
          phase: ticket.activePhase,
          content: artifact,
          createdAt: new Date().toISOString(),
          agentId: agent_id,
        });
      }

      useTicketStore.getState().advanceTicketPhase(ticket.id);

      const updatedTicket = useTicketStore.getState().tickets.find((t) => t.id === ticket.id);
      const nextPhase = updatedTicket?.activePhase ?? 'done';
      invoke('answer_tickets', { requestId: request_id, data: `Phase completed. Next phase: ${nextPhase}` }).catch((err) =>
        console.warn('[answer_tickets] failed:', err),
      );
    });
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

  // Auto-respond to agent-claim-ticket — validate, assign, and start the agent workflow
  useEffect(() => {
    const unlisten = listen<{ request_id: string; agent_id: string; ticket_number: number }>(
      'agent-claim-ticket',
      async (event) => {
        const { request_id, agent_id, ticket_number } = event.payload;
        const ticket = useTicketStore.getState().tickets.find((t) => t.number === ticket_number);

        if (!ticket) {
          invoke('answer_tickets', { requestId: request_id, data: `Ticket #${ticket_number} not found.` }).catch(console.warn);
          return;
        }

        if (ticket.assignments.length > 0) {
          const assignedToSelf = ticket.assignments[0].agentId === agent_id;
          const msg = assignedToSelf
            ? `You're already on #${ticket_number} — your work is in progress.`
            : `Ticket #${ticket_number} is assigned to someone else.`;
          invoke('answer_tickets', { requestId: request_id, data: msg }).catch(console.warn);
          return;
        }

        if (ticket.status !== 'refined' && ticket.status !== 'backlog') {
          invoke('answer_tickets', { requestId: request_id, data: `Ticket #${ticket_number} is in status "${ticket.status}" — must be refined or backlog to claim.` }).catch(console.warn);
          return;
        }

        const { projects, activeProjectId } = useProjectStore.getState();
        const project = projects.find((p) => p.id === activeProjectId);
        const repo = project?.repos[0];

        if (!project || !repo) {
          invoke('answer_tickets', { requestId: request_id, data: 'No active project/repo configured.' }).catch(console.warn);
          return;
        }

        const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
        if (!agent) {
          invoke('answer_tickets', { requestId: request_id, data: `Agent "${agent_id}" not found.` }).catch(console.warn);
          return;
        }

        const ghToken = useSecretsStore.getState().ghToken ?? '';

        const planContent =
          ticket.activePhase === 'build' && ticket.artifacts.plan
            ? ticket.artifacts.plan.content
            : undefined;

        const systemPrompt = buildPrompt({
          agentId: agent.id,
          role: agent.role,
          personality: agent.personality,
          projectName: project.name,
          projectStack: 'Rust, React 19, Tauri 2, TypeScript',
          projectContext: '',
          ticketNumber: ticket.number,
          ticketTitle: ticket.title,
          ticketDescription: ticket.description,
          ticketAcceptanceCriteria: ticket.acceptanceCriteria,
          planContent,
          phase: ticket.activePhase,
        });

        // Set canvas context so events are captured even if user is on the messages tab
        useCanvasStore.getState().setActiveTicket(ticket.id);

        try {
          await invoke<void>('start_agent', {
            payload: {
              agent_id: agent.id,
              ticket_id: ticket.id,
              ticket_slug: ticket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
              prompt: `${ticket.title}\n\n${ticket.description}`,
              system_prompt: systemPrompt,
              repo_root: repo.repoRoot,
              gh_token: ghToken,
              resume_session_id: null,
              phase: ticket.activePhase ?? 'build',
            },
          });
          useTicketStore.getState().assignTicket(ticket.id, { agentId: agent.id, repoId: repo.id });
          useTicketStore.getState().updateTicketStatus(ticket.id, 'in_progress');
          invoke('answer_tickets', { requestId: request_id, data: `Done — you're now working on #${ticket_number}: ${ticket.title}. Your coding environment is set up and work has started. Just confirm to your lead and move on to chat. Do NOT attempt to read, edit, or fix code here — that's already happening in the background.` }).catch(console.warn);
        } catch (err) {
          invoke('answer_tickets', { requestId: request_id, data: `Failed to start agent workflow: ${err}` }).catch(console.warn);
        }
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Nudge an agent to check the board for available work
  const nudgeAgent = useCallback(async (
    agent: { id: string; name: string; role: string; personality: string },
    level: InitiativeLevel,
    unassignedTickets: Array<{ number: number; title: string; complexity: number }>,
  ) => {
    const ticketSummary = unassignedTickets
      .slice(0, 5)
      .map((t) => `#${t.number}: ${t.title}`)
      .join(', ');

    // The nudge is a lightweight internal prompt — the system prompt's Initiative section
    // tells the agent HOW to behave. This just gives them the context to act on.
    const instruction = `[System: You're free. Unassigned tickets on the board: ${ticketSummary}]`;

    // Post a status pill
    useMessageStore.getState().addMessage({
      id: `dm-nudge-${agent.id}-${Date.now()}`,
      threadId: agent.id,
      threadType: 'dm',
      from: 'system',
      agentId: agent.id,
      agentName: agent.name,
      content: 'Checking board...',
      type: 'status',
      timestamp: Date.now(),
    });

    const { projects, activeProjectId } = useProjectStore.getState();
    const activeProject = projects.find((p) => p.id === activeProjectId);
    const projectRoot = activeProject?.repos[0]?.repoRoot;
    const tickets = useTicketStore.getState().tickets;

    const systemPrompt = buildChatPrompt({
      agent: agent as any,
      tickets,
      projectName: activeProject?.name,
      projectRoot,
      initiativeLevel: level,
    });

    try {
      await invoke('chat_agent', {
        payload: {
          agent_id: agent.id,
          message: instruction,
          system_prompt: systemPrompt,
          context_update: instruction,
        },
      });
    } catch (err) {
      console.warn('[nudgeAgent] invoke failed:', err);
    }
  }, []);

  // Idle detection — nudge agents when:
  //   1. They finish work (working → idle)
  //   2. Initiative settings change while idle
  //   3. App starts with an idle agent that has initiative enabled (startup nudge)
  const prevAgentSnapshots = useRef<Record<string, { status: string; initiative: string | null | undefined; lastNudgeAt: number }>>({});
  const startupNudged = useRef<Set<string>>(new Set());
  const agents = useAgentStore((s) => s.agents);

  useEffect(() => {
    const prev = prevAgentSnapshots.current;

    for (const agent of agents) {
      const prevSnap = prev[agent.id];
      const level = resolveInitiative(agent.personality, agent.initiative);

      // First time seeing this agent — initialize tracking
      if (!prevSnap) {
        prev[agent.id] = { status: agent.status, initiative: agent.initiative, lastNudgeAt: 0 };

        // Startup nudge: agent is idle with initiative enabled on first mount
        if (agent.status === 'idle' && level !== 'off' && !agent.chatting && !startupNudged.current.has(agent.id)) {
          startupNudged.current.add(agent.id);
          const unassigned = useTicketStore.getState().tickets.filter(
            (t) => t.assignments.length === 0 && (t.status === 'refined' || t.status === 'backlog'),
          );
          if (unassigned.length > 0) {
            prev[agent.id].lastNudgeAt = Date.now();
            // Delay startup nudge 5s to let app finish loading
            setTimeout(() => nudgeAgent(agent, level, unassigned), 5000);
          }
        }
        continue;
      }

      const wasWorking = prevSnap.status === 'working';
      const isNowIdle = agent.status === 'idle';
      const prevLevel = resolveInitiative(agent.personality, prevSnap.initiative);

      // Detect trigger conditions:
      // 1. Agent just finished work (working → idle)
      // 2. Initiative settings changed while agent is already idle
      const finishedWork = wasWorking && isNowIdle;
      const settingsChanged = agent.status === 'idle' && level !== prevLevel && level !== 'off';

      // Update tracked state
      const lastNudgeAt = prevSnap.lastNudgeAt;
      prev[agent.id] = { status: agent.status, initiative: agent.initiative, lastNudgeAt };

      const shouldNudge = finishedWork || settingsChanged;
      if (!shouldNudge) continue;
      if (level === 'off') continue;
      if (agent.chatting) continue;

      // Cooldown: 30s since last nudge
      if (Date.now() - lastNudgeAt < 30_000) continue;

      // Find unassigned refined tickets
      const unassigned = useTicketStore.getState().tickets.filter(
        (t) => t.assignments.length === 0 && (t.status === 'refined' || t.status === 'backlog'),
      );
      if (unassigned.length === 0) continue;

      // Skip nudge if this agent still has tickets being worked on
      const agentBusyTickets = useTicketStore.getState().tickets.filter(
        (t) => t.assignments.some((a) => a.agentId === agent.id) &&
               (t.status === 'in_progress' || t.status === 'assigned'),
      );
      if (agentBusyTickets.length > 0) continue;

      prev[agent.id].lastNudgeAt = Date.now();

      // Stagger nudge by random 0-5s
      const delay = Math.random() * 5000;
      setTimeout(() => nudgeAgent(agent, level, unassigned), delay);
    }
  }, [agents, nudgeAgent]);

  // Resume stalled tickets on startup — fires once after stores are loaded
  const ticketsLoaded = useTicketStore((s) => s.loaded);
  const projectsLoaded = useProjectStore((s) => s.loaded);
  const resumeComplete = useRef(false);

  useEffect(() => {
    if (resumeComplete.current) return;
    if (!ticketsLoaded || !projectsLoaded || agents.length === 0) return;
    resumeComplete.current = true;

    // Pre-register stalled agent IDs to prevent initiative nudge conflict
    const tickets = useTicketStore.getState().tickets;
    const stalledAgentIds = tickets
      .filter((t) =>
        t.assignments.length > 0 &&
        (t.status === 'in_progress' || t.status === 'assigned') &&
        agents.find((a) => a.id === t.assignments[0].agentId && a.status === 'idle' && !a.chatting),
      )
      .map((t) => t.assignments[0].agentId);

    for (const id of stalledAgentIds) {
      startupNudged.current.add(id);
    }

    if (stalledAgentIds.length > 0) {
      resumeStalledTickets().catch((err) =>
        console.warn('[resumeStalledTickets] error:', err),
      );
    }
  }, [ticketsLoaded, projectsLoaded, agents]);

  // Orchestrator: phase completed — advance ticket phase + store artifact + notify channels
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

      // Post phase event to channels containing the assigned agent
      const ticket = useTicketStore.getState().tickets.find((t) => t.id === ticket_id);
      if (ticket) {
        const assignedAgentIds = ticket.assignments.map((a) => a.agentId);
        const channels = useMessageStore.getState().channels;
        const ts = Date.now();
        const statusText = blocked
          ? `#${ticket.number} ${ticket.title} — blocked at ${phase}`
          : `#${ticket.number} ${ticket.title} — completed ${phase}`;

        for (const ch of channels) {
          if (ch.agentIds.some((id) => assignedAgentIds.includes(id))) {
            useMessageStore.getState().addMessage({
              id: `ch-phase-${ch.id}-${ticket_id}-${ts}`,
              threadId: ch.id,
              threadType: 'channel',
              from: 'system',
              agentId: '',
              agentName: 'System',
              content: statusText,
              type: 'status',
              ticketId: ticket_id,
              timestamp: ts,
            });
          }
        }
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
