import { useState, useRef, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MessageCircle, X, Send, Check, XCircle } from 'lucide-react';
import { useConversationStore, type ConversationMessage } from '../../store/conversationStore';
import { Markdown } from './nodes/Markdown';

interface Props {
  ticketId: string;
}

/** Format time like Slack: "9:41 AM" */
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** First letter, uppercased — cheap avatar. */
function AgentAvatar({ name }: { name: string }) {
  return (
    <div className="w-7 h-7 rounded bg-violet-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function MessageBubble({ msg, onReply }: { msg: ConversationMessage; onReply: (id: string, reply: string) => void }) {
  const [reply, setReply] = useState('');

  // --- User reply (right-aligned, like Slack "You") ---
  if (msg.type === 'user_reply') {
    return (
      <div className="flex gap-2 justify-end">
        <div className="max-w-[80%]">
          <p className="text-[11px] font-semibold text-zinc-300 text-right mb-0.5">You</p>
          <div className="bg-violet-600 text-white rounded-lg px-3 py-2">
            <p className="text-xs leading-relaxed">{msg.content}</p>
          </div>
          <p className="text-[10px] text-zinc-600 text-right mt-0.5">{fmtTime(msg.timestamp)}</p>
        </div>
      </div>
    );
  }

  // --- Status update (centered pill, like Slack system message) ---
  if (msg.type === 'agent_status') {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[10px] text-zinc-500 bg-zinc-800/60 rounded-full px-3 py-0.5">
          {msg.content}
        </span>
      </div>
    );
  }

  // --- Agent DM (left-aligned with avatar) ---
  const isChoices = msg.type === 'agent_choices' && !msg.resolved;
  const isConfirm = msg.type === 'agent_confirm' && !msg.resolved;
  const needsReply = msg.type === 'agent_question' && !msg.resolved;

  return (
    <div className="flex gap-2 items-start">
      <AgentAvatar name={msg.agentName} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[11px] font-semibold text-zinc-200">{msg.agentName}</span>
          <span className="text-[10px] text-zinc-600">{fmtTime(msg.timestamp)}</span>
        </div>

        {/* DM-style message body */}
        {msg.type === 'agent_message' ? (
          <Markdown className="text-zinc-300">{msg.content}</Markdown>
        ) : (
          <p className="text-xs text-zinc-300 leading-relaxed">{msg.content}</p>
        )}

        {/* Resolved indicator (only for interactive message types) */}
        {msg.resolved && msg.resolution && msg.type !== 'agent_message' && (
          <p className="text-[10px] text-zinc-600 mt-1 italic">Answered: {msg.resolution}</p>
        )}

        {/* Choices (interactive) */}
        {isChoices && (
          <div className="flex flex-col gap-1 mt-2">
            {msg.choices?.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onReply(msg.id, c.label)}
                className="text-left bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 transition-colors"
              >
                <span className="font-medium">{c.label}</span>
                <span className="text-zinc-500 ml-1">— {c.description}</span>
              </button>
            ))}
          </div>
        )}

        {/* Confirm (approve/reject) */}
        {isConfirm && (
          <>
            <p className="text-xs text-amber-400 font-medium mt-1">Requesting approval</p>
            {msg.actionDetails && (
              <pre className="mt-1 text-[10px] text-zinc-400 bg-zinc-900 rounded p-2 whitespace-pre-wrap">{msg.actionDetails}</pre>
            )}
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => onReply(msg.id, JSON.stringify({ approved: true, reply: '' }))}
                className="flex items-center gap-1 bg-green-900/60 hover:bg-green-800 text-green-300 border border-green-800 rounded px-3 py-1 text-xs transition-colors"
              >
                <Check size={12} /> Approve
              </button>
              <button
                type="button"
                onClick={() => onReply(msg.id, JSON.stringify({ approved: false, reply: '' }))}
                className="flex items-center gap-1 bg-red-900/60 hover:bg-red-800 text-red-300 border border-red-800 rounded px-3 py-1 text-xs transition-colors"
              >
                <XCircle size={12} /> Reject
              </button>
            </div>
          </>
        )}

        {/* Free-text reply (for agent_question) */}
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
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              className="bg-violet-600 hover:bg-violet-500 text-white rounded px-2 py-1 text-xs transition-colors"
            >
              <Send size={12} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function ConversationPanel({ ticketId }: Props) {
  const [open, setOpen] = useState(false);
  const allMessages = useConversationStore((s) => s.messages);
  const resolveMessage = useConversationStore((s) => s.resolveMessage);
  const addMessage = useConversationStore((s) => s.addMessage);
  const messages = useMemo(() => allMessages.filter((m) => m.ticketId === ticketId), [allMessages, ticketId]);
  const unresolved = useMemo(() => messages.filter((m) => !m.resolved), [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(messages.length);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Auto-open when first message arrives
  useEffect(() => {
    if (messages.length > 0 && prevCountRef.current === 0) {
      setOpen(true);
    }
    prevCountRef.current = messages.length;
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
    <div className="absolute top-0 right-0 bottom-0 w-80 bg-zinc-900 border-l border-zinc-800 z-20 flex flex-col pointer-events-auto">
      {/* Header — Slack-style */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <MessageCircle size={14} className="text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-200">Thread</span>
          {messages.length > 0 && (
            <span className="text-[10px] text-zinc-500">{messages.length}</span>
          )}
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
          <X size={14} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {messages.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center mt-8">
            No messages yet. Agents will post here as they work.
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
