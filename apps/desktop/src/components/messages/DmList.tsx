import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode, type ChangeEvent, type KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Send, Check, XCircle, Plus, Hash, MessageSquare, X, ArrowDown } from 'lucide-react';
import { useMessageStore, getTopLevelMessages, getRepliesForParent } from '../../store/messageStore';
import { useAgentStore, type Agent } from '../../store/agentStore';
import { useTicketStore } from '../../store/ticketStore';
import { useProjectStore } from '../../store/projectStore';
import { useChatSessionStore } from '../../store/chatSessionStore';
import { buildChatPrompt } from '../../lib/chatPromptBuilder';
import { AgentFormModal } from '../agents/AgentFormModal';
import { Markdown } from '../canvas/nodes/Markdown';
import { parseTokens } from '../../lib/tokenParser';
import { MCP_TOOLS } from '../../lib/mcpTools';
import { TokenChip } from './TokenChip';
import type { DmMessage, Conversation } from '../../types/message';

/** Format time like Slack: "9:41 AM" */
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Relative time for reply counts: "2m ago", "1h ago" */
function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Two messages belong in the same visual group if same sender within 5 min. */
const GROUP_GAP_MS = 5 * 60 * 1000;

function isSameGroup(prev: DmMessage | undefined, cur: DmMessage): boolean {
  if (!prev) return false;
  if (prev.type === 'status' || cur.type === 'status') return false;
  if (prev.from !== cur.from) return false;
  if (prev.agentName !== cur.agentName) return false;
  return cur.timestamp - prev.timestamp < GROUP_GAP_MS;
}

/** First letter, uppercased — cheap avatar. */
function AgentAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const cls = size === 'sm'
    ? 'w-5 h-5 text-[9px]'
    : 'w-8 h-8 text-xs';
  return (
    <div className={`${cls} rounded bg-violet-700 flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

/** Inline tokenizer for non-markdown text (question/choices/confirm bodies). */
function TokenizedText({ text, agentNames }: { text: string; agentNames?: string[] }) {
  const segments = parseTokens(text, agentNames);
  if (segments.length === 1 && segments[0].type === 'text') return <>{text}</>;
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          seg.value
        ) : (
          <TokenChip key={i} tokenType={seg.tokenType} raw={seg.raw} value={seg.value} />
        ),
      )}
    </>
  );
}

/** Renders input text with token highlights for the overlay div. */
function renderInputOverlay(text: string, agentNames?: string[]) {
  const segments = parseTokens(text, agentNames);
  return segments.map((seg, i) =>
    seg.type === 'text' ? (
      <span key={i}>{seg.value}</span>
    ) : (
      <span
        key={i}
        className={
          seg.tokenType === 'mention'
            ? 'bg-violet-500/20 text-violet-300 rounded-sm'
            : seg.tokenType === 'ticket'
              ? 'bg-blue-500/20 text-blue-300 rounded-sm'
              : 'bg-amber-500/20 text-amber-300 rounded-sm'
        }
      >
        {seg.raw}
      </span>
    ),
  );
}

function MessageBubble({
  msg,
  onReply,
  onOpenThread,
  showReplyAction = true,
  isGrouped = false,
}: {
  msg: DmMessage;
  onReply: (msgId: string, reply: string) => void;
  onOpenThread?: (msgId: string) => void;
  showReplyAction?: boolean;
  isGrouped?: boolean;
}) {
  const [reply, setReply] = useState('');
  const [hovered, setHovered] = useState(false);
  const tickets = useTicketStore((s) => s.tickets);

  // --- Status (centered system pill) ---
  if (msg.type === 'status') {
    return (
      <div className="flex justify-center py-0.5">
        <span className="text-[10px] text-zinc-500 bg-zinc-800/50 rounded-full px-3 py-0.5 italic">
          {msg.content}
        </span>
      </div>
    );
  }

  // --- User reply (right-aligned bubble) ---
  if (msg.type === 'reply' && msg.from === 'user') {
    return (
      <div className={`flex justify-end ${isGrouped ? 'mt-0.5' : 'mt-3'}`}>
        <div className="max-w-[60%]">
          {!isGrouped && (
            <p className="text-[11px] font-medium text-zinc-400 text-right mb-1">You</p>
          )}
          <div className="bg-violet-600/90 text-white rounded-2xl rounded-br-sm px-3 py-1.5">
            <p className="text-[13px] leading-relaxed"><TokenizedText text={msg.content} /></p>
          </div>
          {!isGrouped && (
            <p className="text-[10px] text-zinc-600 text-right mt-0.5">{fmtTime(msg.timestamp)}</p>
          )}
        </div>
      </div>
    );
  }

  // --- Agent messages (Slack-style: avatar + name on first, indented continuation) ---
  const isQuestion = msg.type === 'question' && !msg.resolved;
  const isChoices = msg.type === 'choices' && !msg.resolved;
  const isConfirm = msg.type === 'confirm' && !msg.resolved;

  const ticketTag = (() => {
    if (!msg.ticketId || isGrouped) return null;
    const t = tickets.find((t) => t.id === msg.ticketId);
    return t ? (
      <span className="text-[10px] text-zinc-500 bg-zinc-800/50 rounded px-1.5 py-0.5">
        #{t.number} {t.title}
      </span>
    ) : null;
  })();

  return (
    <div
      className={`relative group ${isGrouped ? 'mt-0.5' : 'mt-3'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex gap-2.5 items-start">
        {/* Avatar column — placeholder spacer for grouped messages */}
        {isGrouped ? (
          <div className="w-8 flex-shrink-0 flex items-start justify-center">
            {hovered && (
              <span className="text-[9px] text-zinc-600 mt-0.5">{fmtTime(msg.timestamp)}</span>
            )}
          </div>
        ) : (
          <AgentAvatar name={msg.agentName} />
        )}

        <div className="min-w-0">
          {/* Name + time header — only on first in group */}
          {!isGrouped && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="text-[13px] font-semibold text-zinc-100">{msg.agentName}</span>
              <span className="text-[10px] text-zinc-500">{fmtTime(msg.timestamp)}</span>
              {ticketTag}
            </div>
          )}

          {/* Message body — bubble */}
          <div className="bg-zinc-800 rounded-2xl rounded-tl-sm px-3 py-1.5 text-[13px] text-zinc-300 leading-relaxed">
            {msg.type === 'text' ? (
              <Markdown className="text-zinc-300" variant="dark" tokenize>{msg.content}</Markdown>
            ) : (
              <p><TokenizedText text={msg.content} /></p>
            )}
          </div>

          {/* Resolved indicator */}
          {msg.resolved && msg.resolution && (
            <p className="text-[10px] text-zinc-600 mt-1 italic">Answered: {msg.resolution}</p>
          )}

          {/* Choices (interactive) */}
          {isChoices && (
            <div className="flex flex-col gap-1 mt-2 max-w-md">
              {msg.choices?.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => onReply(msg.id, c.label)}
                  className="text-left bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-zinc-200 transition-colors"
                >
                  <span className="font-medium">{c.label}</span>
                  <span className="text-zinc-500 ml-1.5">— {c.description}</span>
                </button>
              ))}
            </div>
          )}

          {/* Confirm (approve/reject) */}
          {isConfirm && (
            <div className="mt-2 max-w-md">
              <p className="text-xs text-amber-400 font-medium mb-1">Requesting approval</p>
              {msg.actionDetails && (
                <pre className="text-[10px] text-zinc-400 bg-zinc-900/80 border border-zinc-800 rounded-lg p-2.5 whitespace-pre-wrap mb-2">
                  {msg.actionDetails}
                </pre>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onReply(msg.id, JSON.stringify({ approved: true, reply: '' }))}
                  className="flex items-center gap-1 bg-green-900/40 hover:bg-green-800/60 text-green-300 border border-green-800/50 rounded-lg px-3 py-1.5 text-xs transition-colors"
                >
                  <Check size={12} /> Approve
                </button>
                <button
                  type="button"
                  onClick={() => onReply(msg.id, JSON.stringify({ approved: false, reply: '' }))}
                  className="flex items-center gap-1 bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-800/50 rounded-lg px-3 py-1.5 text-xs transition-colors"
                >
                  <XCircle size={12} /> Reject
                </button>
              </div>
            </div>
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
              className="flex gap-1.5 mt-2 max-w-md"
            >
              <input
                type="text"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Reply..."
                className="flex-1 bg-zinc-900 border border-zinc-700/50 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                className="bg-violet-600 hover:bg-violet-500 text-white rounded-lg px-2 py-1.5 text-xs transition-colors"
              >
                <Send size={12} />
              </button>
            </form>
          )}

          {/* Reply count indicator */}
          {showReplyAction && (msg.replyCount ?? 0) > 0 && onOpenThread && (
            <button
              type="button"
              onClick={() => onOpenThread(msg.id)}
              className="flex items-center gap-1.5 mt-1 text-[11px] text-violet-400 hover:text-violet-300 hover:underline transition-colors"
            >
              <MessageSquare size={11} />
              <span className="font-medium">{msg.replyCount} {msg.replyCount === 1 ? 'reply' : 'replies'}</span>
              {msg.lastReplyAt && (
                <span className="text-zinc-500 font-normal">{relativeTime(msg.lastReplyAt)}</span>
              )}
            </button>
          )}

          {/* Reply button — always rendered to avoid layout shift, opacity-controlled */}
          {showReplyAction && onOpenThread && (
            <div className={`flex justify-end mt-0.5 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <button
                type="button"
                onClick={() => onOpenThread(msg.id)}
                className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-[10px] transition-colors"
                title="Reply in thread"
              >
                <MessageSquare size={10} /> Reply
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ThreadPanel({
  parentMsg,
  replies,
  threadId,
  isChannel,
  onReply,
  onClose,
}: {
  parentMsg: DmMessage;
  replies: DmMessage[];
  threadId: string;
  isChannel: boolean;
  onReply: (msgId: string, reply: string) => void;
  onClose: () => void;
}) {
  const addMessage = useMessageStore((s) => s.addMessage);
  const [threadInput, setThreadInput] = useState('');
  const threadScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll thread panel on new replies
  useEffect(() => {
    if (threadScrollRef.current) {
      threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight;
    }
  }, [replies.length]);

  const isUnresolved =
    (parentMsg.type === 'question' || parentMsg.type === 'choices' || parentMsg.type === 'confirm') &&
    !parentMsg.resolved;

  const handleThreadSend = () => {
    if (!threadInput.trim()) return;
    if (isUnresolved) {
      onReply(parentMsg.id, threadInput.trim());
    } else {
      addMessage({
        id: `thread-reply-${Date.now()}`,
        threadId,
        threadType: isChannel ? 'channel' : 'dm',
        from: 'user',
        agentId: parentMsg.agentId,
        agentName: 'You',
        content: threadInput.trim(),
        type: 'reply',
        parentId: parentMsg.id,
        timestamp: Date.now(),
      });
    }
    setThreadInput('');
  };

  return (
    <div className="w-96 min-w-[384px] border-l border-zinc-800 flex flex-col flex-shrink-0">
      {/* Thread header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800">
        <span className="text-sm font-semibold text-zinc-200">Thread</span>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Thread body */}
      <div ref={threadScrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {/* Parent message */}
        <MessageBubble
          msg={parentMsg}
          onReply={onReply}
          showReplyAction={false}
        />
        <div className="border-t border-zinc-700/50 my-2" />
        <p className="text-[10px] text-zinc-500 mb-1">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </p>

        {/* Replies */}
        {replies.map((r, i) => (
          <MessageBubble
            key={r.id}
            msg={r}
            onReply={onReply}
            showReplyAction={false}
            isGrouped={isSameGroup(replies[i - 1], r)}
          />
        ))}
      </div>

      {/* Thread input */}
      <div className="border-t border-zinc-800 px-3 py-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleThreadSend();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={threadInput}
            onChange={(e) => setThreadInput(e.target.value)}
            placeholder={isUnresolved ? 'Reply to question...' : 'Reply in thread...'}
            className="flex-1 bg-zinc-900 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500 placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={!threadInput.trim()}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg px-2 py-1.5 transition-colors"
          >
            <Send size={14} />
          </button>
        </form>
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

function NewGroupDmForm({ onClose }: { onClose: () => void }) {
  const agents = useAgentStore((s) => s.agents);
  const addConversation = useMessageStore((s) => s.addConversation);
  const setActiveThread = useMessageStore((s) => s.setActiveThread);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());

  const handleCreate = () => {
    if (selectedAgentIds.size === 0) return;
    const participants = [...selectedAgentIds];
    const id = crypto.randomUUID();
    const conv: Conversation = {
      id,
      type: 'dm',
      participants,
      locked: false,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
    };
    addConversation(conv);
    setActiveThread(id);
    onClose();
  };

  return (
    <div className="px-4 py-2 border-b border-zinc-800">
      <p className="text-xs text-zinc-400 mb-1">Select agents for group DM:</p>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {agents.map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedAgentIds.has(a.id)}
              onChange={() => {
                const next = new Set(selectedAgentIds);
                next.has(a.id) ? next.delete(a.id) : next.add(a.id);
                setSelectedAgentIds(next);
              }}
              className="accent-violet-600"
            />
            {a.name}
          </label>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={handleCreate}
          disabled={selectedAgentIds.size === 0}
          className="text-xs bg-violet-700 hover:bg-violet-600 text-white rounded px-2 py-1 disabled:opacity-50"
        >
          Create
        </button>
        <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300">
          Cancel
        </button>
      </div>
    </div>
  );
}

type AutocompleteMode = 'mention' | 'ticket' | 'slash';

interface AutocompleteItem {
  id: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
}

/** Generalized autocomplete popup — handles @mentions, #tickets, and /commands */
function AutocompletePopup({
  items,
  filter,
  selectedIdx,
  onSelect,
}: {
  items: AutocompleteItem[];
  filter: string;
  selectedIdx: number;
  onSelect: (item: AutocompleteItem) => void;
}) {
  const matches = useMemo(
    () =>
      items.filter(
        (it) =>
          it.label.toLowerCase().includes(filter.toLowerCase()) ||
          (it.detail && it.detail.toLowerCase().includes(filter.toLowerCase())),
      ),
    [items, filter],
  );

  if (matches.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 w-72 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg overflow-hidden z-10 max-h-60 overflow-y-auto">
      {matches.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(item);
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors
            ${i === selectedIdx ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-700'}`}
        >
          {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
          <span className="truncate">{item.label}</span>
          {item.detail && (
            <span className={`ml-auto text-xs truncate ${i === selectedIdx ? 'text-violet-200' : 'text-zinc-500'}`}>
              {item.detail}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function DmList() {
  const {
    threads, channels, unreadCounts, activeThread, openThreadParentId,
    setActiveThread, setOpenThread, addMessage, resolveMessage,
  } = useMessageStore();
  const agents = useAgentStore((s) => s.agents);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputText, setInputText] = useState('');
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showNewGroupDm, setShowNewGroupDm] = useState(false);
  const [agentContextMenu, setAgentContextMenu] = useState<{ x: number; y: number; agent: Agent } | null>(null);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [showChannelMembers, setShowChannelMembers] = useState(false);
  const [autocomplete, setAutocomplete] = useState<{
    active: boolean;
    mode: AutocompleteMode;
    startIdx: number;
  }>({ active: false, mode: 'mention', startIdx: -1 });
  const [acSelectedIdx, setAcSelectedIdx] = useState(0);

  const tickets = useTicketStore((s) => s.tickets);
  const conversations = useMessageStore((s) => s.conversations);
  const migrateToConversations = useMessageStore((s) => s.migrateToConversations);
  const loaded = useMessageStore((s) => s.loaded);

  useEffect(() => {
    if (loaded && conversations.length === 0) {
      migrateToConversations();
    }
  }, [loaded, conversations.length, migrateToConversations]);

  const channelIds = new Set(channels.map((c) => c.id));

  // Build conversation list: existing conversations + ensure all agents have a 1:1
  const sortedConversations = useMemo(() => {
    const convMap = new Map(conversations.map((c) => [c.id, c]));
    const stubs: Conversation[] = [];
    for (const agent of agents) {
      if (!convMap.has(agent.id)) {
        stubs.push({
          id: agent.id,
          type: 'dm',
          participants: [agent.id],
          locked: true,
          createdAt: Date.now(),
          lastMessageAt: 0,
        });
      }
    }
    const all = [...conversations.filter((c) => c.type === 'dm'), ...stubs];
    return all.sort((a, b) => {
      if (a.lastMessageAt === 0 && b.lastMessageAt === 0) return 0;
      if (a.lastMessageAt === 0) return 1;
      if (b.lastMessageAt === 0) return -1;
      return b.lastMessageAt - a.lastMessageAt;
    });
  }, [conversations, agents]);
  const isChannel = activeThread ? channelIds.has(activeThread) : false;
  const activeMessages = activeThread ? (threads[activeThread] ?? []) : [];
  const topLevelMessages = useMemo(() => getTopLevelMessages(activeMessages), [activeMessages]);

  // Find the most recent unresolved blocking question in the active thread
  const pendingQuestion = useMemo(() => {
    if (!activeThread || isChannel) return null;
    const msgs = threads[activeThread] ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if ((m.type === 'question' || m.type === 'choices' || m.type === 'confirm') && !m.resolved) {
        return m;
      }
    }
    return null;
  }, [activeThread, isChannel, threads]);

  // Typing indicator — only show when the agent is actively responding in chat,
  // NOT when a subagent is working on a ticket in the background
  const activeAgent = activeThread && !isChannel
    ? (() => {
        const conv = conversations.find((c) => c.id === activeThread);
        if (conv && conv.participants.length === 1) {
          return agents.find((a) => a.id === conv.participants[0]);
        }
        return agents.find((a) => a.id === activeThread);
      })()
    : null;
  const isAgentTyping = activeAgent?.chatting === true;

  // Thread panel data
  const threadParentMsg = openThreadParentId
    ? activeMessages.find((m) => m.id === openThreadParentId) ?? null
    : null;
  const threadReplies = openThreadParentId
    ? getRepliesForParent(activeMessages, openThreadParentId)
    : [];

  // Track whether user is scrolled to bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40; // px from bottom considered "at bottom"
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
  }, []);

  // Auto-scroll only when already at bottom
  useEffect(() => {
    if (isAtBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeMessages.length, isAgentTyping, isAtBottom]);

  // Reset to bottom when switching threads
  useEffect(() => {
    setIsAtBottom(true);
    setShowChannelMembers(false);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeThread]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsAtBottom(true);
    }
  }, []);

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

    // For confirm messages, wrap plain-text replies as JSON
    let finalReply = reply;
    if (msg.type === 'confirm') {
      try {
        JSON.parse(reply); // already valid JSON — use as-is
      } catch {
        const rejectWords = /^(no|reject|deny|denied|nope|don't|stop|cancel)\b/i;
        const approved = !rejectWords.test(reply.trim());
        finalReply = JSON.stringify({ approved, reply });
      }
    }

    try {
      if (msg.sessionId) {
        // End-of-session question — resume the agent with --resume
        await invoke('resume_agent', {
          agentId: msg.agentId,
          sessionId: msg.sessionId,
          prompt: finalReply,
        });
      } else {
        // MCP ask_human question — answer via the MCP server
        await invoke('answer_agent', { agentId: msg.agentId, reply: finalReply });
      }
      // Show clean "Approved"/"Rejected" instead of raw JSON for confirm messages
      let displayResolution = reply;
      if (msg.type === 'confirm') {
        try {
          const parsed = JSON.parse(finalReply);
          displayResolution = parsed.approved ? 'Approved' : 'Rejected';
          if (parsed.reply) displayResolution += `: ${parsed.reply}`;
        } catch { /* keep raw */ }
      }
      resolveMessage(msgId, displayResolution);
      addMessage({
        id: `reply-${Date.now()}`,
        threadId: activeThread,
        threadType: isChannel ? 'channel' : 'dm',
        from: 'user',
        agentId: msg.agentId,
        agentName: 'You',
        content: reply,
        type: 'reply',
        parentId: msgId,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('Failed to deliver reply:', err);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || !activeThread) return;
    const message = inputText.trim();
    setInputText('');

    // If there's a pending question, route the input as a reply to it
    if (pendingQuestion) {
      handleReply(pendingQuestion.id, message);
      return;
    }

    // Add user message to local store immediately
    addMessage({
      id: `user-${Date.now()}`,
      threadId: activeThread,
      threadType: isChannel ? 'channel' : 'dm',
      from: 'user',
      agentId: '',
      agentName: 'You',
      content: message,
      type: 'reply',
      timestamp: Date.now(),
    });

    // For DM threads, invoke the chat agent backend for all participants
    if (!isChannel) {
      const conv = conversations.find((c) => c.id === activeThread);
      const participantIds = conv ? conv.participants : [activeThread];

      for (const agentId of participantIds) {
        const agent = agents.find((a) => a.id === agentId);
        if (!agent) continue;

        const tickets = useTicketStore.getState().tickets;
        const contextUpdate = useChatSessionStore.getState().flushUpdates(agentId);
        const { projects, activeProjectId } = useProjectStore.getState();
        const activeProject = projects.find((p) => p.id === activeProjectId);
        const projectRoot = activeProject?.repos[0]?.repoRoot;
        const systemPrompt = buildChatPrompt({
          agent,
          tickets,
          projectName: activeProject?.name,
          projectRoot,
        });

        try {
          await invoke('chat_agent', {
            payload: {
              agent_id: agentId,
              message,
              system_prompt: systemPrompt,
              context_update: contextUpdate,
            },
          });
        } catch (err) {
          console.warn(`[chat_agent] invoke failed for ${agentId}:`, err);
        }
      }
    }
  };

  // ── Autocomplete data sources ──

  const SLASH_COMMANDS: AutocompleteItem[] = useMemo(
    () => MCP_TOOLS
      .filter((t) => t.slashCommand)
      .map((t) => ({ id: `/${t.name}`, label: `/${t.name}`, detail: t.description })),
    [],
  );

  const acItems: AutocompleteItem[] = useMemo(() => {
    if (!autocomplete.active) return [];
    switch (autocomplete.mode) {
      case 'mention':
        return agents.map((a) => ({
          id: a.id,
          label: a.name,
          icon: (
            <div className="w-5 h-5 rounded bg-violet-700 flex items-center justify-center text-[10px] text-white font-bold">
              {a.name.charAt(0).toUpperCase()}
            </div>
          ),
        }));
      case 'ticket':
        return tickets.map((t) => ({
          id: String(t.number),
          label: `#${t.number} ${t.title}`,
          detail: t.status,
        }));
      case 'slash':
        return SLASH_COMMANDS;
    }
  }, [autocomplete.active, autocomplete.mode, agents, tickets, SLASH_COMMANDS]);

  const acFilter = autocomplete.active ? inputText.slice(autocomplete.startIdx + 1) : '';

  // Count visible matches for keyboard nav bounds
  const acMatchCount = useMemo(
    () =>
      acItems.filter(
        (it) =>
          it.label.toLowerCase().includes(acFilter.toLowerCase()) ||
          (it.detail && it.detail.toLowerCase().includes(acFilter.toLowerCase())),
      ).length,
    [acItems, acFilter],
  );

  const closeAutocomplete = useCallback(() => {
    setAutocomplete({ active: false, mode: 'mention', startIdx: -1 });
    setAcSelectedIdx(0);
  }, []);

  const handleAutocompleteSelect = useCallback(
    (item: AutocompleteItem) => {
      const before = inputText.slice(0, autocomplete.startIdx);
      const cursorPos = inputRef.current?.selectionStart ?? inputText.length;
      const after = inputText.slice(cursorPos);

      switch (autocomplete.mode) {
        case 'mention':
          setInputText(`${before}@${item.label} ${after}`);
          break;
        case 'ticket':
          setInputText(`${before}#${item.id} ${after}`);
          break;
        case 'slash':
          setInputText(`${item.label} ${after}`);
          break;
      }
      closeAutocomplete();
      inputRef.current?.focus();
    },
    [inputText, autocomplete, closeAutocomplete],
  );

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputText(val);
      setAcSelectedIdx(0);

      const cursor = e.target.selectionStart ?? val.length;
      const textBeforeCursor = val.slice(0, cursor);

      // Check for / at start of input
      if (val.startsWith('/')) {
        setAutocomplete({ active: true, mode: 'slash', startIdx: 0 });
        return;
      }

      // Check for # trigger
      const lastHash = textBeforeCursor.lastIndexOf('#');
      if (lastHash >= 0) {
        const charBefore = lastHash > 0 ? val[lastHash - 1] : ' ';
        const fragment = textBeforeCursor.slice(lastHash + 1);
        if ((charBefore === ' ' || lastHash === 0) && !/\s/.test(fragment)) {
          setAutocomplete({ active: true, mode: 'ticket', startIdx: lastHash });
          return;
        }
      }

      // Check for @ trigger
      const lastAt = textBeforeCursor.lastIndexOf('@');
      if (lastAt >= 0) {
        const charBefore = lastAt > 0 ? val[lastAt - 1] : ' ';
        const fragment = textBeforeCursor.slice(lastAt + 1);
        if ((charBefore === ' ' || lastAt === 0) && !/\s/.test(fragment)) {
          setAutocomplete({ active: true, mode: 'mention', startIdx: lastAt });
          return;
        }
      }

      closeAutocomplete();
    },
    [closeAutocomplete],
  );

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!autocomplete.active) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeAutocomplete();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcSelectedIdx((prev) => (prev + 1) % (acMatchCount || 1));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcSelectedIdx((prev) => (prev - 1 + (acMatchCount || 1)) % (acMatchCount || 1));
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (acMatchCount > 0) {
          e.preventDefault();
          // Find the matching item at selectedIdx
          const matches = acItems.filter(
            (it) =>
              it.label.toLowerCase().includes(acFilter.toLowerCase()) ||
              (it.detail && it.detail.toLowerCase().includes(acFilter.toLowerCase())),
          );
          if (matches[acSelectedIdx]) {
            handleAutocompleteSelect(matches[acSelectedIdx]);
          }
        }
      }
    },
    [autocomplete.active, acMatchCount, acItems, acFilter, acSelectedIdx, closeAutocomplete, handleAutocompleteSelect],
  );

  return (
    <div className="flex h-full">
      {/* ── Left sidebar ── */}
      <div className="w-56 border-r border-zinc-800 flex flex-col flex-shrink-0">
        <div className="flex-1 overflow-y-auto py-3">
          {/* Direct Messages section */}
          <div className="px-4 mb-2 flex items-center justify-between">
            <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">
              Direct Messages
            </h2>
            <button
              type="button"
              onClick={() => setShowNewGroupDm((v) => !v)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="New group message"
            >
              <Plus size={14} />
            </button>
          </div>

          {showNewGroupDm && <NewGroupDmForm onClose={() => setShowNewGroupDm(false)} />}

          {sortedConversations.map((conv) => {
            const unread = unreadCounts[conv.id] ?? 0;
            const isActive = activeThread === conv.id;
            const displayName = conv.participants.length === 1
              ? agentNameFor(conv.participants[0])
              : conv.participants.map(agentNameFor).join(', ');
            const avatarName = agentNameFor(conv.participants[0]);

            return (
              <button
                key={conv.id}
                onClick={() => setActiveThread(conv.id)}
                onContextMenu={(e) => {
                  if (conv.participants.length !== 1) return;
                  const agent = agents.find((a) => a.id === conv.participants[0]);
                  if (!agent) return;
                  e.preventDefault();
                  setAgentContextMenu({ x: e.clientX, y: e.clientY, agent });
                }}
                className={`w-full flex items-center gap-2.5 px-4 py-1.5 text-sm
                  hover:bg-zinc-800 transition-colors text-left
                  ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400'}`}
              >
                {conv.participants.length === 1 ? (
                  <div className="w-6 h-6 rounded bg-violet-700 flex items-center justify-center text-xs text-white font-bold flex-shrink-0">
                    {avatarName.charAt(0).toUpperCase()}
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded bg-indigo-700 flex items-center justify-center text-[9px] text-white font-bold flex-shrink-0">
                    {conv.participants.length}
                  </div>
                )}
                <span className="flex-1 truncate">{displayName}</span>
                {unread > 0 && (
                  <span className="bg-violet-600 text-white text-xs rounded-full px-1.5 py-0.5">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}

          {sortedConversations.length === 0 && agents.length === 0 && (
            <p className="px-4 py-2 text-zinc-600 text-xs">
              No agents yet. Create an agent to start.
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
            <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-zinc-800">
              {isChannel ? (
                <Hash size={16} className="text-zinc-400" />
              ) : (
                <AgentAvatar name={agentNameFor(activeThread)} size="sm" />
              )}
              <span className="text-sm font-semibold text-zinc-200">{threadHeaderLabel}</span>
              {/* Channel member avatars */}
              {isChannel && (() => {
                const ch = channels.find((c) => c.id === activeThread);
                if (!ch) return null;
                return (
                  <button
                    type="button"
                    onClick={() => setShowChannelMembers(!showChannelMembers)}
                    className="ml-auto flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <div className="flex -space-x-1">
                      {ch.agentIds.slice(0, 4).map((aid) => {
                        const a = agents.find((ag) => ag.id === aid);
                        return (
                          <div key={aid} className="w-5 h-5 rounded bg-violet-700 flex items-center justify-center text-[8px] text-white font-bold border border-zinc-800">
                            {(a?.name ?? 'A').charAt(0).toUpperCase()}
                          </div>
                        );
                      })}
                    </div>
                    <span>{ch.agentIds.length} members</span>
                  </button>
                );
              })()}
            </div>

            {/* Channel member management panel */}
            {isChannel && showChannelMembers && (() => {
              const ch = channels.find((c) => c.id === activeThread);
              if (!ch) return null;
              const updateChannel = useMessageStore.getState().updateChannel;
              return (
                <div className="px-5 py-2 border-b border-zinc-800 bg-zinc-900/50">
                  <p className="text-xs text-zinc-500 mb-1.5">Members</p>
                  <div className="space-y-1">
                    {agents.map((a) => {
                      const isMember = ch.agentIds.includes(a.id);
                      return (
                        <label key={a.id} className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isMember}
                            onChange={() => {
                              const newIds = isMember
                                ? ch.agentIds.filter((id) => id !== a.id)
                                : [...ch.agentIds, a.id];
                              updateChannel(ch.id, { agentIds: newIds });
                            }}
                            className="accent-violet-600"
                          />
                          <AgentAvatar name={a.name} size="sm" />
                          <span>{a.name}</span>
                          <span className="text-zinc-600">({a.role})</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Messages + Thread panel row */}
            <div className="flex-1 flex flex-row min-h-0">
              {/* Main messages column */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Messages */}
                <div ref={scrollRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto px-5 py-3">
                  {topLevelMessages.length === 0 ? (
                    <p className="text-xs text-zinc-600 text-center mt-8">
                      No messages yet. Agents will post here as they work.
                    </p>
                  ) : (
                    topLevelMessages.map((msg, i) => (
                      <MessageBubble
                        key={msg.id}
                        msg={msg}
                        onReply={handleReply}
                        onOpenThread={(msgId) => setOpenThread(msgId)}
                        showReplyAction={true}
                        isGrouped={isSameGroup(topLevelMessages[i - 1], msg)}
                      />
                    ))
                  )}

                  {/* Typing indicator */}
                  {isAgentTyping && (
                    <div className="flex gap-2.5 items-center mt-3">
                      <AgentAvatar name={agentNameFor(activeThread)} />
                      <div className="bg-zinc-800 rounded-2xl rounded-tl-sm px-4 py-2.5 flex gap-1">
                        <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Scroll-to-bottom indicator */}
                {!isAtBottom && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={scrollToBottom}
                      className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-full px-3 py-1 text-xs shadow-lg transition-colors -mt-3 mb-1 z-10"
                    >
                      <ArrowDown size={12} />
                      New messages
                    </button>
                  </div>
                )}

                {/* Message input */}
                <div className="border-t border-zinc-800 px-5 py-3">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="relative flex gap-2"
                  >
                    {autocomplete.active && (
                      <AutocompletePopup
                        items={acItems}
                        filter={acFilter}
                        selectedIdx={acSelectedIdx}
                        onSelect={handleAutocompleteSelect}
                      />
                    )}
                    <div className="relative flex-1">
                      {/* Styled overlay — shows token highlights over transparent input text */}
                      {inputText && (
                        <div
                          className="absolute inset-0 pointer-events-none px-3 py-2 text-sm whitespace-pre overflow-hidden text-zinc-200 leading-normal"
                          aria-hidden
                        >
                          {renderInputOverlay(inputText)}
                        </div>
                      )}
                      <input
                        ref={inputRef}
                        type="text"
                        value={inputText}
                        onChange={handleInputChange}
                        onKeyDown={handleInputKeyDown}
                        placeholder={pendingQuestion ? 'Reply to agent question...' : isChannel ? `Message #${channelNameFor(activeThread)}` : 'Message...'}
                        className={`w-full bg-zinc-900 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-500 placeholder:text-zinc-600 ${inputText ? 'text-transparent caret-zinc-200' : 'text-zinc-200'}`}
                        style={inputText ? { caretColor: '#e4e4e7' } : undefined}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!inputText.trim()}
                      className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg px-3 py-2 transition-colors"
                    >
                      <Send size={16} />
                    </button>
                  </form>
                </div>
              </div>

              {/* Thread panel (conditional) */}
              {threadParentMsg && activeThread && (
                <ThreadPanel
                  parentMsg={threadParentMsg}
                  replies={threadReplies}
                  threadId={activeThread}
                  isChannel={isChannel}
                  onReply={handleReply}
                  onClose={() => setOpenThread(null)}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-zinc-600 text-sm">Select a conversation</p>
          </div>
        )}
      </div>

      {/* Agent context menu */}
      {agentContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAgentContextMenu(null)} />
          <div
            className="fixed z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[140px]"
            style={{ left: agentContextMenu.x, top: agentContextMenu.y }}
          >
            <button
              type="button"
              onClick={() => { setEditAgent(agentContextMenu.agent); setAgentContextMenu(null); }}
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              Edit agent
            </button>
            <button
              type="button"
              onClick={() => {
                const agent = agentContextMenu.agent;
                setAgentContextMenu(null);
                if (confirm(`Delete agent "${agent.name}"? Message history will be preserved.`)) {
                  useAgentStore.getState().deleteAgent(agent.id);
                }
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700 transition-colors"
            >
              Delete agent
            </button>
          </div>
        </>
      )}

      {/* Agent edit modal */}
      {editAgent && (
        <AgentFormModal agent={editAgent} onClose={() => setEditAgent(null)} />
      )}
    </div>
  );
}
