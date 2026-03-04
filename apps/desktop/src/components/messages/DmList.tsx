import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Send, Check, XCircle, Plus, Hash } from 'lucide-react';
import { useMessageStore } from '../../store/messageStore';
import { useAgentStore } from '../../store/agentStore';
import { useTicketStore } from '../../store/ticketStore';
import { Markdown } from '../canvas/nodes/Markdown';
import type { DmMessage, Channel } from '../../types/message';

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

function MessageBubble({
  msg,
  onReply,
}: {
  msg: DmMessage;
  onReply: (msgId: string, reply: string) => void;
}) {
  const [reply, setReply] = useState('');
  const tickets = useTicketStore((s) => s.tickets);

  // --- Status (centered system pill) ---
  if (msg.type === 'status') {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[10px] text-zinc-500 bg-zinc-800/60 rounded-full px-3 py-0.5 italic">
          {msg.content}
        </span>
      </div>
    );
  }

  // --- User reply (right-aligned violet bubble) ---
  if (msg.type === 'reply' && msg.from === 'user') {
    return (
      <div className="flex gap-2 justify-end">
        <div className="max-w-[80%]">
          <p className="text-[11px] font-semibold text-zinc-300 text-right mb-0.5">You</p>
          <div className="bg-violet-600 text-white rounded-xl px-3 py-2">
            <p className="text-xs leading-relaxed">{msg.content}</p>
          </div>
          <p className="text-[10px] text-zinc-600 text-right mt-0.5">{fmtTime(msg.timestamp)}</p>
        </div>
      </div>
    );
  }

  // --- Agent messages (left-aligned with avatar) ---
  const isQuestion = msg.type === 'question' && !msg.resolved;
  const isChoices = msg.type === 'choices' && !msg.resolved;
  const isConfirm = msg.type === 'confirm' && !msg.resolved;

  const ticketTag = (() => {
    if (!msg.ticketId) return null;
    const t = tickets.find((t) => t.id === msg.ticketId);
    return t ? (
      <span className="text-[10px] text-zinc-600 ml-2">re: {t.title}</span>
    ) : null;
  })();

  return (
    <div className="flex gap-2 items-start">
      <AgentAvatar name={msg.agentName} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[11px] font-semibold text-zinc-200">{msg.agentName}</span>
          <span className="text-[10px] text-zinc-600">{fmtTime(msg.timestamp)}</span>
          {ticketTag}
        </div>

        {/* Message body */}
        {msg.type === 'text' ? (
          <div className="bg-zinc-800 text-zinc-100 rounded-xl px-3 py-2">
            <Markdown className="text-zinc-300">{msg.content}</Markdown>
          </div>
        ) : (
          <div className="bg-zinc-800 text-zinc-100 rounded-xl px-3 py-2">
            <p className="text-xs text-zinc-300 leading-relaxed">{msg.content}</p>
          </div>
        )}

        {/* Resolved indicator */}
        {msg.resolved && msg.resolution && (
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
              <pre className="mt-1 text-[10px] text-zinc-400 bg-zinc-900 rounded p-2 whitespace-pre-wrap">
                {msg.actionDetails}
              </pre>
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

        {/* Free-text reply (for question) */}
        {isQuestion && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim()) {
                onReply(msg.id, reply.trim());
                setReply('');
              }
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

function NewChannelForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const agents = useAgentStore((s) => s.agents);
  const addChannel = useMessageStore((s) => s.addChannel);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    addChannel({
      id: crypto.randomUUID(),
      name: name.trim(),
      agentIds: [...selectedAgentIds],
      createdAt: Date.now(),
    });
    onClose();
  };

  return (
    <div className="px-4 py-2 space-y-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Channel name"
        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-violet-500"
        autoFocus
      />
      {agents.length > 0 && (
        <div className="space-y-1">
          {agents.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedAgentIds.has(a.id)}
                onChange={() => toggleAgent(a.id)}
                className="accent-violet-600"
              />
              {a.name}
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCreate}
          disabled={!name.trim()}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded px-3 py-1 text-xs transition-colors"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DmList() {
  const { threads, channels, unreadCounts, activeThread, setActiveThread, addMessage, resolveMessage } =
    useMessageStore();
  const agents = useAgentStore((s) => s.agents);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);

  const channelIds = new Set(channels.map((c) => c.id));
  const dmThreadIds = Object.keys(threads).filter((id) => !channelIds.has(id));
  const isChannel = activeThread ? channelIds.has(activeThread) : false;
  const activeMessages = activeThread ? (threads[activeThread] ?? []) : [];

  // Auto-scroll when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeMessages.length]);

  // Resolve agent name for DM threads
  const agentNameFor = (threadId: string) => {
    const firstMsg = threads[threadId]?.[0];
    if (firstMsg?.agentName && firstMsg.agentName !== 'You') return firstMsg.agentName;
    const agent = agents.find((a) => a.id === threadId);
    return agent?.name ?? threadId;
  };

  // Channel name lookup
  const channelNameFor = (channelId: string) => {
    const ch = channels.find((c) => c.id === channelId);
    return ch?.name ?? channelId;
  };

  // Thread header display
  const threadHeaderLabel = (() => {
    if (!activeThread) return null;
    if (isChannel) return `# ${channelNameFor(activeThread)}`;
    return agentNameFor(activeThread);
  })();

  const handleReply = async (msgId: string, reply: string) => {
    if (!activeThread) return;
    const msg = activeMessages.find((m) => m.id === msgId);
    if (!msg) return;

    try {
      await invoke('answer_agent', { agentId: msg.agentId, reply });
      resolveMessage(msgId, reply);
      addMessage({
        id: `reply-${Date.now()}`,
        threadId: activeThread,
        threadType: isChannel ? 'channel' : 'dm',
        from: 'user',
        agentId: msg.agentId,
        agentName: 'You',
        content: reply,
        type: 'reply',
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('Failed to deliver reply:', err);
    }
  };

  const handleSend = () => {
    if (!inputText.trim() || !activeThread) return;
    addMessage({
      id: `user-${Date.now()}`,
      threadId: activeThread,
      threadType: isChannel ? 'channel' : 'dm',
      from: 'user',
      agentId: '',
      agentName: 'You',
      content: inputText.trim(),
      type: 'reply',
      timestamp: Date.now(),
    });
    setInputText('');
  };

  return (
    <div className="flex h-full">
      {/* ── Left sidebar ── */}
      <div className="w-56 border-r border-zinc-800 flex flex-col flex-shrink-0">
        <div className="flex-1 overflow-y-auto py-3">
          {/* Direct Messages section */}
          <div className="px-4 mb-2">
            <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">
              Direct Messages
            </h2>
          </div>

          {dmThreadIds.map((agentId) => {
            const name = agentNameFor(agentId);
            const unread = unreadCounts[agentId] ?? 0;
            const isActive = activeThread === agentId;

            return (
              <button
                key={agentId}
                onClick={() => setActiveThread(agentId)}
                className={`w-full flex items-center gap-2.5 px-4 py-1.5 text-sm
                  hover:bg-zinc-800 transition-colors text-left
                  ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400'}`}
              >
                <div className="w-6 h-6 rounded bg-violet-700 flex items-center justify-center text-xs text-white font-bold flex-shrink-0">
                  {name.charAt(0).toUpperCase()}
                </div>
                <span className="flex-1 truncate">{name}</span>
                {unread > 0 && (
                  <span className="bg-violet-600 text-white text-xs rounded-full px-1.5 py-0.5">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}

          {dmThreadIds.length === 0 && (
            <p className="px-4 py-2 text-zinc-600 text-xs">
              No messages yet. Assign a ticket to start.
            </p>
          )}

          {/* Divider */}
          <div className="border-t border-zinc-800 my-2 mx-4" />

          {/* Channels section */}
          <div className="px-4 mb-2 flex items-center justify-between">
            <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">
              Channels
            </h2>
            <button
              type="button"
              onClick={() => setShowNewChannel((v) => !v)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="New channel"
            >
              <Plus size={14} />
            </button>
          </div>

          {showNewChannel && <NewChannelForm onClose={() => setShowNewChannel(false)} />}

          {channels.map((ch) => {
            const unread = unreadCounts[ch.id] ?? 0;
            const isActive = activeThread === ch.id;

            return (
              <button
                key={ch.id}
                onClick={() => setActiveThread(ch.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-1.5 text-sm
                  hover:bg-zinc-800 transition-colors text-left
                  ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400'}`}
              >
                <Hash size={14} className="text-zinc-500 flex-shrink-0" />
                <span className="flex-1 truncate">{ch.name}</span>
                {unread > 0 && (
                  <span className="bg-violet-600 text-white text-xs rounded-full px-1.5 py-0.5">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}

          {channels.length === 0 && !showNewChannel && (
            <p className="px-4 py-2 text-zinc-600 text-xs">No channels yet.</p>
          )}
        </div>
      </div>

      {/* ── Right pane ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeThread ? (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-zinc-800">
              {isChannel ? (
                <Hash size={16} className="text-zinc-400" />
              ) : (
                <AgentAvatar name={agentNameFor(activeThread)} />
              )}
              <span className="text-sm font-semibold text-zinc-200">{threadHeaderLabel}</span>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {activeMessages.length === 0 ? (
                <p className="text-xs text-zinc-600 text-center mt-8">
                  No messages yet. Agents will post here as they work.
                </p>
              ) : (
                activeMessages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} onReply={handleReply} />
                ))
              )}
            </div>

            {/* Message input */}
            <div className="border-t border-zinc-800 px-4 py-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={isChannel ? `Message #${channelNameFor(activeThread)}` : 'Message...'}
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-500 placeholder:text-zinc-600"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg px-3 py-2 transition-colors"
                >
                  <Send size={16} />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-zinc-600 text-sm">Select a conversation</p>
          </div>
        )}
      </div>
    </div>
  );
}
