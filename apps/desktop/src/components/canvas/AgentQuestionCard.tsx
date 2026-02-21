// apps/desktop/src/components/canvas/AgentQuestionCard.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AgentQuestionPayload } from '../../types/canvas';

interface Props {
  payload: AgentQuestionPayload;
  onAnswered: (agentId: string) => void;
}

export function AgentQuestionCard({ payload, onAnswered }: Props) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await invoke('answer_agent', { agentId: payload.agent_id, reply: reply.trim() });
      onAnswered(payload.agent_id);
    } catch (err) {
      console.error('Failed to deliver reply:', err);
      setSending(false);
    }
  };

  return (
    <div className="border border-violet-400 bg-violet-50 rounded-lg p-4 shadow-md">
      <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-1">
        Agent needs input
      </p>
      <p className="text-sm text-zinc-800 mb-3">{payload.question}</p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Type your reply…"
          disabled={sending}
          autoFocus
          className="flex-1 text-sm border border-zinc-300 rounded px-3 py-1.5
                     focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button
          type="submit"
          disabled={sending || !reply.trim()}
          className="text-sm bg-violet-600 text-white px-3 py-1.5 rounded
                     hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
