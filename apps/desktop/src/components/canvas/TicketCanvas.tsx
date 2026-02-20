import { useEffect } from 'react';
import { ReactFlow, Background, Controls, BackgroundVariant } from '@xyflow/react';
import { listen } from '@tauri-apps/api/event';
import '@xyflow/react/dist/style.css';

import { useCanvasStore } from '../../store/canvasStore';
import { nodeTypes } from './nodes';
import type { CanvasNodePayload } from '../../types/canvas';

interface TicketCanvasProps {
  ticketId: string;
}

export function TicketCanvas({ ticketId }: TicketCanvasProps) {
  const { nodes, edges, setActiveTicket, addNodeFromEvent } = useCanvasStore();

  // When the ticketId changes, reset the canvas for this ticket
  useEffect(() => {
    setActiveTicket(ticketId);
  }, [ticketId, setActiveTicket]);

  // Listen for agent-event Tauri events and add them as canvas nodes
  useEffect(() => {
    // listen() returns Promise<UnlistenFn> — call it on cleanup to stop listening
    const unlisten = listen<CanvasNodePayload>('agent-event', (event) => {
      addNodeFromEvent(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addNodeFromEvent]);

  return (
    <div className="w-full h-full bg-neutral-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#333"
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
