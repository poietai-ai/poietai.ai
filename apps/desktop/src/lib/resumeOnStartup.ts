import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../store/agentStore';
import { useTicketStore } from '../store/ticketStore';
import { useProjectStore } from '../store/projectStore';
import { useSecretsStore } from '../store/secretsStore';
import { useCanvasStore } from '../store/canvasStore';
import { useMessageStore } from '../store/messageStore';
import { buildPrompt } from './promptBuilder';

/**
 * Detect in_progress tickets with agent assignments where the agent process
 * is no longer running (idle after restart), and restart the agent workflow.
 */
export async function resumeStalledTickets(): Promise<void> {
  const tickets = useTicketStore.getState().tickets;
  const agents = useAgentStore.getState().agents;
  const { projects, activeProjectId } = useProjectStore.getState();
  const project = projects.find((p) => p.id === activeProjectId);
  const repo = project?.repos[0];

  if (!project || !repo) return;

  const ghToken = useSecretsStore.getState().ghToken ?? '';

  // Find tickets that are in_progress (or assigned) with an agent that is idle
  const stalled = tickets.filter((t) => {
    if (t.assignments.length === 0) return false;
    if (t.status !== 'in_progress' && t.status !== 'assigned') return false;
    const agent = agents.find((a) => a.id === t.assignments[0].agentId);
    return agent && agent.status === 'idle' && !agent.chatting;
  });

  if (stalled.length === 0) return;

  // Deduplicate: one ticket per agent (lowest number first)
  const seen = new Set<string>();
  const deduped = stalled
    .sort((a, b) => a.number - b.number)
    .filter((t) => {
      const agentId = t.assignments[0].agentId;
      if (seen.has(agentId)) return false;
      seen.add(agentId);
      return true;
    });

  for (let i = 0; i < deduped.length; i++) {
    const ticket = deduped[i];
    const agentId = ticket.assignments[0].agentId;
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) continue;

    // Stagger by 3s if multiple tickets
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Post a status pill to the DM
    useMessageStore.getState().addMessage({
      id: `dm-resume-${agentId}-${Date.now()}`,
      threadId: agentId,
      threadType: 'dm',
      from: 'system',
      agentId,
      agentName: agent.name,
      content: `Resuming work on #${ticket.number}`,
      type: 'status',
      timestamp: Date.now(),
    });

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

    useCanvasStore.getState().setActiveTicket(ticket.id);

    const resumePrefix = 'RESUME: This ticket was in progress before an app restart. Check your worktree for any existing changes before starting fresh. Pick up where you left off.\n\n';

    try {
      await invoke<void>('start_agent', {
        payload: {
          agent_id: agent.id,
          ticket_id: ticket.id,
          ticket_slug: ticket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
          prompt: `${resumePrefix}${ticket.title}\n\n${ticket.description}`,
          system_prompt: systemPrompt,
          repo_root: repo.repoRoot,
          gh_token: ghToken,
          resume_session_id: null,
          phase: ticket.activePhase ?? 'build',
        },
      });
    } catch (err) {
      console.warn(`[resumeStalledTickets] Failed to resume #${ticket.number}:`, err);
    }
  }
}
