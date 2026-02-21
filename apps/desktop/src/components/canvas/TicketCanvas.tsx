import { useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, BackgroundVariant } from '@xyflow/react';
import { listen } from '@tauri-apps/api/event';
import '@xyflow/react/dist/style.css';

import { useCanvasStore } from '../../store/canvasStore';
import { nodeTypes } from './nodes';
import { AskUserOverlay } from './AskUserOverlay';
import { AgentQuestionCard } from './AgentQuestionCard';
import type { CanvasNodePayload, AgentQuestionPayload } from '../../types/canvas';

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
    awaitingQuestion, awaitingSessionId,
    setAwaiting, clearAwaiting,
  } = useCanvasStore();

  // Active mid-task questions from ask_human MCP calls (agent stays running)
  const [activeQuestions, setActiveQuestions] = useState<AgentQuestionPayload[]>([]);

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

  // Listen for agent run completion — show ask-user overlay if agent ended with a question
  useEffect(() => {
    const unlisten = listen<AgentResultPayload>('agent-result', (event) => {
      const { session_id } = event.payload;
      if (!session_id) return;

      // Check if the last text node in the canvas ended with a question mark
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
      setActiveQuestions((prev) => {
        // Deduplicate by agent_id — replace if already asking
        const filtered = prev.filter((q) => q.agent_id !== event.payload.agent_id);
        return [...filtered, event.payload];
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleQuestionAnswered = (agentId: string) => {
    setActiveQuestions((prev) => prev.filter((q) => q.agent_id !== agentId));
  };

  const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
  const agentId = lastNode ? String(lastNode.data.agentId ?? '') : '';

  return (
    <div className="relative w-full h-full bg-zinc-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        colorMode="light"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#d4d4d8"
        />
        <Controls />
      </ReactFlow>

      {/* Mid-task questions — agent is still running, waiting for reply */}
      {activeQuestions.length > 0 && (
        <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2 pointer-events-auto">
          {activeQuestions.map((q) => (
            <AgentQuestionCard
              key={q.agent_id}
              payload={q}
              onAnswered={handleQuestionAnswered}
            />
          ))}
        </div>
      )}

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
  );
}
