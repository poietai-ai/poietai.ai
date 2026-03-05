import { useEffect, useMemo } from 'react';
import { ReactFlow, Background, Controls, BackgroundVariant } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useCanvasStore } from '../../store/canvasStore';
import { useTicketStore } from '../../store/ticketStore';
import { nodeTypes } from './nodes';
import { CanvasFilterBar } from './CanvasFilterBar';
import { PhaseBreadcrumb } from './PhaseBreadcrumb';
import { useSettingsStore, NODE_CATEGORIES, type NodeCategory } from '../../store/settingsStore';

interface TicketCanvasProps {
  ticketId: string;
}

export function TicketCanvas({ ticketId }: TicketCanvasProps) {
  const {
    nodes, edges,
    setActiveTicket,
    onNodesChange,
  } = useCanvasStore();

  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === ticketId));

  useEffect(() => {
    setActiveTicket(ticketId);
  }, [ticketId, setActiveTicket]);

  // Canvas event listeners (agent-event, agent-status, fan-out, fan-in)
  // are in AppShell so they run regardless of which view is active.

  const hiddenNodeCategories = useSettingsStore((s) => s.hiddenNodeCategories);

  // Build a set of hidden node type strings from the hidden categories
  const hiddenNodeTypes = useMemo(() => {
    const types = new Set<string>();
    for (const cat of hiddenNodeCategories) {
      for (const t of NODE_CATEGORIES[cat as NodeCategory]) {
        types.add(t);
      }
    }
    return types;
  }, [hiddenNodeCategories]);

  const filteredNodes = useMemo(() => {
    if (hiddenNodeTypes.size === 0) return nodes;
    return nodes.filter((n) => !hiddenNodeTypes.has(n.type ?? ''));
  }, [nodes, hiddenNodeTypes]);

  const filteredEdges = useMemo(() => {
    if (hiddenNodeTypes.size === 0) return edges;
    const visibleIds = new Set(filteredNodes.map((n) => n.id));
    return edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  }, [edges, filteredNodes, hiddenNodeTypes]);

  return (
    <div className="flex flex-col h-full">
      {ticket && ticket.phases.length > 0 && (
        <PhaseBreadcrumb phases={ticket.phases} activePhase={ticket.activePhase} />
      )}
      <div className="relative flex-1 bg-zinc-50">
        <ReactFlow
          nodes={filteredNodes}
          edges={filteredEdges}
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

        <CanvasFilterBar />
      </div>
    </div>
  );
}
