import { useEffect } from 'react';
import { ReactFlow, Background, Controls, BackgroundVariant } from '@xyflow/react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import '@xyflow/react/dist/style.css';

import { useCanvasStore } from '../../store/canvasStore';
import { useTicketStore } from '../../store/ticketStore';
import { useAgentStore } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { useSecretsStore } from '../../store/secretsStore';
import { useConversationStore } from '../../store/conversationStore';
import { buildPrompt } from '../../lib/promptBuilder';
import { parseValidateResult } from '../../lib/parseValidateResult';
import { parseQaResult } from '../../lib/parseQaResult';
import { parseSecurityResult } from '../../lib/parseSecurityResult';
import { nodeTypes } from './nodes';
import { AskUserOverlay } from './AskUserOverlay';
import { ConversationPanel } from './ConversationPanel';
import { PhaseBreadcrumb } from './PhaseBreadcrumb';
import type { CanvasNodePayload, AgentQuestionPayload, AgentChoicesPayload, AgentStatusPayload, AgentConfirmPayload } from '../../types/canvas';

interface AgentResultPayload {
  agent_id: string;
  ticket_id: string;
  session_id?: string;
}

interface TicketCanvasProps {
  ticketId: string;
}

export function TicketCanvas({ ticketId }: TicketCanvasProps) {
  const {
    nodes, edges,
    setActiveTicket, addNodeFromEvent,
    onNodesChange,
    awaitingQuestion, awaitingSessionId,
    setAwaiting, clearAwaiting,
  } = useCanvasStore();

  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === ticketId));

  useEffect(() => {
    setActiveTicket(ticketId);
  }, [ticketId, setActiveTicket]);

  // Listen for canvas node events from the agent stream
  useEffect(() => {
    const unlisten = listen<CanvasNodePayload>('agent-event', (event) => {
      addNodeFromEvent(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [addNodeFromEvent]);

  // Listen for agent run completion — capture artifact, advance phase, auto-trigger next agent
  useEffect(() => {
    const unlisten = listen<AgentResultPayload>('agent-result', async (event) => {
      const { agent_id, ticket_id, session_id } = event.payload;

      // --- Phase lifecycle: capture artifact + get completed phase ---
      const ticket = useTicketStore.getState().tickets.find((t) => t.id === ticket_id);
      const completedPhase = ticket?.activePhase;

      if (ticket && completedPhase && completedPhase !== 'ship') {
        const currentNodes = useCanvasStore.getState().nodes;
        const lastTextNode = [...currentNodes]
          .reverse()
          .find((n) => n.data.nodeType === 'agent_message');

        let wasBlocked = false;

        if (lastTextNode) {
          const content = String(lastTextNode.data.content);
          useTicketStore.getState().setPhaseArtifact(ticket_id, {
            phase: completedPhase,
            content,
            createdAt: new Date().toISOString(),
            agentId: agent_id,
          });

          // If VALIDATE just completed: parse result + add summary node + maybe block
          if (completedPhase === 'validate') {
            const result = parseValidateResult(content);
            useCanvasStore.getState().addValidateResultNode(result);
            if (result.critical > 0) {
              useTicketStore.getState().blockTicket(ticket_id);
              wasBlocked = true;
            }
          }

          // If QA just completed: parse result + add summary node + maybe block
          if (completedPhase === 'qa') {
            const result = parseQaResult(content);
            useCanvasStore.getState().addQaResultNode(result);
            if (result.critical > 0) {
              useTicketStore.getState().blockTicket(ticket_id);
              wasBlocked = true;
            }
          }

          // If SECURITY just completed: parse result + add summary node + synthesis + maybe block
          if (completedPhase === 'security') {
            const secResult = parseSecurityResult(content);
            useCanvasStore.getState().addSecurityResultNode(secResult);

            // Gather summaries from existing canvas nodes for the synthesis card
            const latestNodes = useCanvasStore.getState().nodes;
            const validateNode = latestNodes.find((n) => n.type === 'validate_result');
            const qaNode = latestNodes.find((n) => n.type === 'qa_result');
            useCanvasStore.getState().addReviewSynthesisNode({
              validate: validateNode?.data.validateSummary ?? { critical: 0, verified: 0 },
              qa: qaNode?.data.qaSummary ?? { critical: 0, warnings: 0, advisory: 0 },
              security: secResult,
            });

            if (secResult.critical > 0) {
              useTicketStore.getState().blockTicket(ticket_id);
              wasBlocked = true;
            }
          }
        }

        // Advance to the next phase only if not blocked by critical mismatches
        if (!wasBlocked) {
          useTicketStore.getState().advanceTicketPhase(ticket_id);
        }

        // After advance: check if we've entered VALIDATE — auto-trigger
        const updatedTicket = useTicketStore.getState().tickets.find((t) => t.id === ticket_id);
        if (!wasBlocked && updatedTicket?.activePhase === 'validate') {
          const planArtifact = updatedTicket.artifacts.plan;
          if (planArtifact) {
            try {
              // Get build agent's worktree info
              await useAgentStore.getState().refresh();
              const buildAgent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
              const worktreePath = buildAgent?.worktree_path;

              // Get git diff from the build worktree
              const diff = await invoke<string>('get_worktree_diff', { agentId: agent_id });

              // Get repo info from ticket assignment
              const assignment = updatedTicket.assignments[0];
              const project = useProjectStore
                .getState()
                .projects.find((p) => p.id === useProjectStore.getState().activeProjectId);
              const repo =
                project?.repos.find((r) => r.id === assignment?.repoId) ?? project?.repos[0];
              const ghToken = useSecretsStore.getState().ghToken ?? '';

              if (!repo) {
                console.warn('[TicketCanvas] No repo found — cannot auto-trigger VALIDATE');
              } else {
                // Build validate prompt: plan + diff
                const validatePrompt = [
                  'Validate the following plan against the code changes.',
                  '',
                  '## Approved Plan',
                  planArtifact.content,
                  '',
                  '## Git Diff (code changes to validate)',
                  diff || '(no diff available)',
                ].join('\n');

                const systemPrompt = buildPrompt({
                  agentId: agent_id,
                  role: buildAgent?.role ?? 'qa',
                  personality: buildAgent?.personality ?? 'pragmatic',
                  projectName: project?.name ?? '',
                  projectStack: 'Rust, React 19, Tauri 2, TypeScript',
                  projectContext: '',
                  ticketNumber: 0,
                  ticketTitle: updatedTicket.title,
                  ticketDescription: updatedTicket.description,
                  ticketAcceptanceCriteria: updatedTicket.acceptanceCriteria,
                  phase: updatedTicket.activePhase,
                });

                await invoke<void>('start_agent', {
                  payload: {
                    // Reuse the BUILD agent's id — the validate agent runs as the same agent
                    // identity. This is intentional: the agent switches roles via the phase
                    // prompt rather than being a separate roster entry.
                    agent_id,
                    ticket_id,
                    ticket_slug: updatedTicket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
                    prompt: validatePrompt,
                    system_prompt: systemPrompt,
                    repo_root: repo.repoRoot,
                    gh_token: ghToken,
                    resume_session_id: null,
                    phase: 'validate',
                    worktree_path_override: worktreePath ?? null,
                  },
                });
              }
            } catch (err) {
              console.error('[TicketCanvas] Failed to auto-trigger VALIDATE:', err);
            }
          }
        }
        // After advance: check if we've entered QA — auto-trigger
        if (!wasBlocked && updatedTicket?.activePhase === 'qa') {
          const planArtifact = updatedTicket.artifacts.plan;
          if (planArtifact) {
            try {
              // Get build agent's worktree info (QA reuses BUILD agent identity via phase prompt)
              await useAgentStore.getState().refresh();
              const buildAgent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
              const worktreePath = buildAgent?.worktree_path;

              // Get git diff from the build worktree
              const diff = await invoke<string>('get_worktree_diff', { agentId: agent_id });

              // Get repo info from ticket assignment
              const assignment = updatedTicket.assignments[0];
              const project = useProjectStore
                .getState()
                .projects.find((p) => p.id === useProjectStore.getState().activeProjectId);
              const repo =
                project?.repos.find((r) => r.id === assignment?.repoId) ?? project?.repos[0];
              const ghToken = useSecretsStore.getState().ghToken ?? '';

              if (!repo) {
                console.warn('[TicketCanvas] No repo found — cannot auto-trigger QA');
              } else {
                // Build QA prompt: plan + diff
                const qaPrompt = [
                  'Review the following code changes for quality issues.',
                  '',
                  '## Approved Plan',
                  planArtifact.content,
                  '',
                  '## Git Diff (code changes to review)',
                  diff || '(no diff available)',
                ].join('\n');

                const systemPrompt = buildPrompt({
                  agentId: agent_id,
                  role: buildAgent?.role ?? 'qa',
                  personality: buildAgent?.personality ?? 'pragmatic',
                  projectName: project?.name ?? '',
                  projectStack: 'Rust, React 19, Tauri 2, TypeScript',
                  projectContext: '',
                  ticketNumber: 0,
                  ticketTitle: updatedTicket.title,
                  ticketDescription: updatedTicket.description,
                  ticketAcceptanceCriteria: updatedTicket.acceptanceCriteria,
                  phase: updatedTicket.activePhase,
                });

                await invoke<void>('start_agent', {
                  payload: {
                    // Reuse the BUILD agent's id — QA runs as the same agent identity via phase prompt
                    agent_id,
                    ticket_id,
                    ticket_slug: updatedTicket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
                    prompt: qaPrompt,
                    system_prompt: systemPrompt,
                    repo_root: repo.repoRoot,
                    gh_token: ghToken,
                    resume_session_id: null,
                    phase: 'qa',
                    worktree_path_override: worktreePath ?? null,
                  },
                });
              }
            } catch (err) {
              console.error('[TicketCanvas] Failed to auto-trigger QA:', err);
            }
          }
        }
        // After advance: check if we've entered SECURITY — auto-trigger
        if (!wasBlocked && updatedTicket?.activePhase === 'security') {
          const planArtifact = updatedTicket.artifacts.plan;
          if (planArtifact) {
            try {
              // Get build agent's worktree info (SECURITY reuses BUILD agent identity via phase prompt)
              await useAgentStore.getState().refresh();
              const buildAgent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
              const worktreePath = buildAgent?.worktree_path;

              // Get git diff from the build worktree
              const diff = await invoke<string>('get_worktree_diff', { agentId: agent_id });

              // Get repo info from ticket assignment
              const assignment = updatedTicket.assignments[0];
              const project = useProjectStore
                .getState()
                .projects.find((p) => p.id === useProjectStore.getState().activeProjectId);
              const repo =
                project?.repos.find((r) => r.id === assignment?.repoId) ?? project?.repos[0];
              const ghToken = useSecretsStore.getState().ghToken ?? '';

              if (!repo) {
                console.warn('[TicketCanvas] No repo found — cannot auto-trigger SECURITY');
              } else {
                // Build security prompt: plan + diff
                const securityPrompt = [
                  'Review the following code changes for security vulnerabilities.',
                  '',
                  '## Approved Plan',
                  planArtifact.content,
                  '',
                  '## Git Diff (code changes to review)',
                  diff || '(no diff available)',
                ].join('\n');

                const systemPrompt = buildPrompt({
                  agentId: agent_id,
                  role: buildAgent?.role ?? 'security',
                  personality: buildAgent?.personality ?? 'pragmatic',
                  projectName: project?.name ?? '',
                  projectStack: 'Rust, React 19, Tauri 2, TypeScript',
                  projectContext: '',
                  ticketNumber: 0,
                  ticketTitle: updatedTicket.title,
                  ticketDescription: updatedTicket.description,
                  ticketAcceptanceCriteria: updatedTicket.acceptanceCriteria,
                  phase: updatedTicket.activePhase,
                });

                await invoke<void>('start_agent', {
                  payload: {
                    // Reuse the BUILD agent's id — SECURITY runs as the same agent identity via phase prompt
                    agent_id,
                    ticket_id,
                    ticket_slug: updatedTicket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
                    prompt: securityPrompt,
                    system_prompt: systemPrompt,
                    repo_root: repo.repoRoot,
                    gh_token: ghToken,
                    resume_session_id: null,
                    phase: 'security',
                    worktree_path_override: worktreePath ?? null,
                  },
                });
              }
            } catch (err) {
              console.error('[TicketCanvas] Failed to auto-trigger SECURITY:', err);
            }
          }
        }
      }
      // --- End phase lifecycle ---

      // Existing: check for end-of-session question (awaiting resume)
      if (!session_id) return;
      const currentNodes = useCanvasStore.getState().nodes;
      const lastTextNode = [...currentNodes]
        .reverse()
        .find((n) => n.data.nodeType === 'agent_message');
      if (lastTextNode && String(lastTextNode.data.content).trim().endsWith('?')) {
        setAwaiting(String(lastTextNode.data.content), session_id);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [setAwaiting]);

  // Listen for mid-task questions from ask_human MCP calls (agent is still running)
  useEffect(() => {
    const unlisten = listen<AgentQuestionPayload>('agent-question', (event) => {
      useConversationStore.getState().addMessage({
        ticketId: ticketId,
        agentId: event.payload.agent_id,
        agentName: event.payload.agent_id,
        type: 'agent_question',
        content: event.payload.question,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [ticketId]);

  // Listen for status updates (non-blocking)
  useEffect(() => {
    const unlisten = listen<AgentStatusPayload>('agent-status', (event) => {
      const { agent_id, message } = event.payload;
      useCanvasStore.getState().addStatusUpdateNode(agent_id, message);
      useConversationStore.getState().addMessage({
        ticketId: ticketId,
        agentId: agent_id,
        agentName: agent_id,
        type: 'agent_status',
        content: message,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [ticketId]);

  // Listen for choices (blocking — user must pick)
  useEffect(() => {
    const unlisten = listen<AgentChoicesPayload>('agent-choices', (event) => {
      const { agent_id, question, choices } = event.payload;
      useConversationStore.getState().addMessage({
        ticketId: ticketId,
        agentId: agent_id,
        agentName: agent_id,
        type: 'agent_choices',
        content: question,
        choices,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [ticketId]);

  // Listen for confirmation requests (blocking — user must approve/reject)
  useEffect(() => {
    const unlisten = listen<AgentConfirmPayload>('agent-confirm', (event) => {
      const { agent_id, action, details } = event.payload;
      useConversationStore.getState().addMessage({
        ticketId: ticketId,
        agentId: agent_id,
        agentName: agent_id,
        type: 'agent_confirm',
        content: action,
        actionDetails: details,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [ticketId]);

  const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
  const agentId = lastNode ? String(lastNode.data.agentId ?? '') : '';

  return (
    <div className="flex flex-col h-full">
      {ticket && ticket.phases.length > 0 && (
        <PhaseBreadcrumb phases={ticket.phases} activePhase={ticket.activePhase} />
      )}
      <div className="relative flex-1 bg-zinc-50">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView
          colorMode="light"
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={28}
            size={2}
            color="#a1a1aa"
          />
          <Controls />
        </ReactFlow>

        {/* Conversation panel — persistent sidebar for all agent-user interactions */}
        <ConversationPanel ticketId={ticketId} />

        {/* End-of-run question — agent exited, will resume via --resume */}
        {awaitingQuestion && awaitingSessionId && (
          <AskUserOverlay
            question={awaitingQuestion}
            sessionId={awaitingSessionId}
            agentId={agentId}
            onDismiss={clearAwaiting}
          />
        )}
      </div>
    </div>
  );
}
