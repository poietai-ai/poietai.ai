import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MessageCircle, X, Send, Check, XCircle } from 'lucide-react';
import { useConversationStore, type ConversationMessage } from '../../store/conversationStore';

interface Props {
  ticketId: string;
}

function MessageBubble({ msg, onReply }: { msg: ConversationMessage; onReply: (id: string, reply: string) => void }) {
  const [reply, setReply] = useState('');

  if (msg.type === 'user_reply') {
    return (
      <div className="flex justify-end">
        <div className="bg-violet-600 text-white rounded-lg rounded-br-sm px-3 py-2 max-w-[80%]">
          <p className="text-xs">{msg.content}</p>
          <span className="text-[10px] text-violet-200 mt-1 block">{new Date(msg.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>
    );
  }

  if (msg.type === 'agent_status') {
    return (
      <div className="flex justify-center">
        <span className="text-[10px] text-zinc-400 bg-zinc-800 rounded-full px-3 py-0.5">
          {msg.content}
        </span>
      </div>
    );
  }

  if (msg.type === 'agent_choices' && !msg.resolved) {
    return (
      <div className="flex justify-start">
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg rounded-bl-sm px-3 py-2 max-w-[85%]">
          <p className="text-[10px] text-zinc-400 font-medium mb-1">{msg.agentName}</p>
          <p className="text-xs text-zinc-200 mb-2">{msg.content}</p>
          <div className="flex flex-col gap-1">
            {msg.choices?.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onReply(msg.id, c.label)}
                className="text-left bg-zinc-700 hover:bg-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 transition-colors"
              >
                <span className="font-medium">{c.label}</span>
                <span className="text-zinc-400 ml-1">— {c.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (msg.type === 'agent_confirm' && !msg.resolved) {
    return (
      <div className="flex justify-start">
        <div className="bg-zinc-800 border border-amber-700/50 rounded-lg rounded-bl-sm px-3 py-2 max-w-[85%]">
          <p className="text-[10px] text-zinc-400 font-medium mb-1">{msg.agentName}</p>
          <p className="text-xs text-amber-300 font-medium mb-1">Requesting approval</p>
          <p className="text-xs text-zinc-200">{msg.content}</p>
          {msg.actionDetails && (
            <pre className="mt-1 text-[10px] text-zinc-400 bg-zinc-900 rounded p-2 whitespace-pre-wrap">{msg.actionDetails}</pre>
          )}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => onReply(msg.id, JSON.stringify({ approved: true, reply: '' }))}
              className="flex items-center gap-1 bg-green-800 hover:bg-green-700 text-green-200 rounded px-3 py-1 text-xs transition-colors"
            >
              <Check size={12} /> Approve
            </button>
            <button
              type="button"
              onClick={() => onReply(msg.id, JSON.stringify({ approved: false, reply: '' }))}
              className="flex items-center gap-1 bg-red-900 hover:bg-red-800 text-red-200 rounded px-3 py-1 text-xs transition-colors"
            >
              <XCircle size={12} /> Reject
            </button>
          </div>
        </div>
      </div>
    );
  }

  // agent_question (or resolved choices/confirm)
  const needsReply = msg.type === 'agent_question' && !msg.resolved;

  return (
    <div className="flex justify-start">
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg rounded-bl-sm px-3 py-2 max-w-[85%]">
        <p className="text-[10px] text-zinc-400 font-medium mb-1">{msg.agentName}</p>
        <p className="text-xs text-zinc-200">{msg.content}</p>
        {msg.resolved && msg.resolution && (
          <p className="text-[10px] text-zinc-500 mt-1 italic">Answered: {msg.resolution}</p>
        )}
        {needsReply && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim()) onReply(msg.id, reply.trim());
            }}
            className="flex gap-1 mt-2"
          >
            <input
              type="text"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply..."
              className="flex-1 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              className="bg-violet-600 hover:bg-violet-500 text-white rounded px-2 py-1 text-xs transition-colors"
            >
              <Send size={12} />
            </button>
          </form>
        )}
        <span className="text-[10px] text-zinc-500 mt-1 block">{new Date(msg.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

export function ConversationPanel({ ticketId }: Props) {
  const [open, setOpen] = useState(false);
  const messages = useConversationStore((s) => s.messagesForTicket(ticketId));
  const unresolved = useConversationStore((s) => s.unresolvedForTicket(ticketId));
  const resolveMessage = useConversationStore((s) => s.resolveMessage);
  const addMessage = useConversationStore((s) => s.addMessage);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleReply = async (msgId: string, reply: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;

    try {
      await invoke('answer_agent', { agentId: msg.agentId, reply });
      resolveMessage(msgId, reply);
      addMessage({
        ticketId,
        agentId: msg.agentId,
        agentName: 'You',
        type: 'user_reply',
        content: reply,
      });
    } catch (err) {
      console.error('Failed to deliver reply:', err);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-4 right-4 z-20 bg-zinc-800 border border-zinc-700 rounded-full p-2 hover:bg-zinc-700 transition-colors pointer-events-auto"
      >
        <MessageCircle size={18} className="text-zinc-300" />
        {unresolved.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-violet-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
            {unresolved.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="absolute top-0 right-0 bottom-0 w-80 bg-zinc-900 border-l border-zinc-700 z-20 flex flex-col pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <MessageCircle size={14} className="text-zinc-400" />
          <span className="text-xs font-medium text-zinc-300">Conversation</span>
          {unresolved.length > 0 && (
            <span className="bg-violet-600 text-white text-[10px] rounded-full px-1.5 font-bold">
              {unresolved.length}
            </span>
          )}
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
          <X size={14} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 ? (
          <p className="text-xs text-zinc-500 text-center mt-8">
            No messages yet. Agents will communicate here as they work.
          </p>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} onReply={handleReply} />
          ))
        )}
      </div>
    </div>
  );
}
