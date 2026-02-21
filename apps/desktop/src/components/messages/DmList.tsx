import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMessageStore } from '../../store/messageStore';
import type { CanvasNodePayload } from '../../types/canvas';

export function DmList() {
  const { threads, unreadCounts, activeThread, setActiveThread, addMessage } = useMessageStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Route agent text events to DM threads
  useEffect(() => {
    const unlisten = listen<CanvasNodePayload>('agent-event', (event) => {
      const { event: agentEvent, agent_id, node_id, ticket_id } = event.payload;
      if (agentEvent.type !== 'text') return;

      addMessage({
        id: node_id,
        from: 'agent',
        agentId: agent_id,
        agentName: agent_id,
        content: agentEvent.text,
        timestamp: new Date().toISOString(),
        ticketId: ticket_id,
        canvasNodeId: node_id,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [addMessage]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threads, activeThread]);

  const agentIds = Object.keys(threads);

  return (
    <div className="flex h-full">
      {/* Thread list */}
      <div className="w-56 border-r border-zinc-800 flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">
            Direct Messages
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {agentIds.map((agentId) => (
            <button
              key={agentId}
              onClick={() => setActiveThread(agentId)}
              className={`w-full flex items-center gap-3 px-4 py-2 text-sm
                         hover:bg-zinc-800 transition-colors text-left
                         ${activeThread === agentId ? 'bg-zinc-800 text-white' : 'text-zinc-400'}`}
            >
              <div className="w-6 h-6 rounded-full bg-violet-700 flex items-center
                              justify-center text-xs text-white flex-shrink-0">
                {agentId[0]?.toUpperCase()}
              </div>
              <span className="flex-1 truncate">{agentId}</span>
              {(unreadCounts[agentId] ?? 0) > 0 && (
                <span className="bg-violet-600 text-white text-xs rounded-full px-1.5 py-0.5">
                  {unreadCounts[agentId]}
                </span>
              )}
            </button>
          ))}
          {agentIds.length === 0 && (
            <p className="px-4 py-3 text-zinc-600 text-xs">
              No messages yet. Assign a ticket to an agent to start.
            </p>
          )}
        </div>
      </div>

      {/* Message thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeThread ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {(threads[activeThread] ?? []).map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.from === 'user' ? 'justify-end' : ''}`}
              >
                {msg.from === 'agent' && (
                  <div className="w-7 h-7 rounded-full bg-violet-700 flex-shrink-0
                                  flex items-center justify-center text-xs text-white mt-0.5">
                    {msg.agentId[0]?.toUpperCase()}
                  </div>
                )}
                <div
                  className={`rounded-xl px-3 py-2 max-w-sm text-sm leading-relaxed
                    ${msg.from === 'agent'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'bg-violet-700 text-white'
                    }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-zinc-600 text-sm">Select a conversation</p>
          </div>
        )}
      </div>
    </div>
  );
}
