import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSecretsStore } from '../../store/secretsStore';

interface AskUserOverlayProps {
  question: string;
  sessionId: string;
  agentId: string;
  ticketId: string;
  onDismiss: () => void;
}

export function AskUserOverlay({
  question, sessionId, agentId, ticketId, onDismiss,
}: AskUserOverlayProps) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!reply.trim()) return;
    setError(null);
    setSending(true);
    try {
      // Temporary: calls start_agent which will attempt to re-create the worktree.
      // Task 12 replaces this with invoke('resume_agent', ...).
      await invoke<void>('start_agent', {
        payload: {
          agent_id: agentId,
          ticket_id: ticketId,
          ticket_slug: ticketId,
          prompt: reply,
          system_prompt: '',
          repo_root: '',
          gh_token: useSecretsStore.getState().ghToken ?? '',
          resume_session_id: sessionId,
        },
      });
      onDismiss();
    } catch (err) {
      console.error('failed to resume agent:', err);
      setError('Failed to send reply. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-lg
                    bg-neutral-900 border border-amber-600 rounded-xl p-4 shadow-2xl z-10">
      <p className="text-amber-200 text-sm mb-3 font-medium">Agent is waiting for you</p>
      <p className="text-neutral-300 text-sm mb-4 leading-relaxed">{question}</p>
      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
      <div className="flex gap-2">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Your reply..."
          className="flex-1 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white placeholder-neutral-500 focus:outline-none
                     focus:border-amber-500"
          autoFocus
        />
        <button
          onClick={handleSend}
          disabled={sending || !reply.trim()}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50
                     text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          {sending ? 'Sending\u2026' : 'Reply'}
        </button>
      </div>
    </div>
  );
}
