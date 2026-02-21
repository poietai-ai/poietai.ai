// apps/desktop/src/components/onboarding/StepConnectGitHub.tsx
import { useState } from 'react';
import { useSecretsStore } from '../../store/secretsStore';

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

type ConnectionStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; username: string }
  | { state: 'error'; message: string };

export function StepConnectGitHub({ onNext, onSkip }: Props) {
  const { saveToken } = useSecretsStore();
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>({ state: 'idle' });
  const [showInstructions, setShowInstructions] = useState(false);

  const handleTest = async () => {
    if (!token.trim()) return;
    setConnection({ state: 'testing' });
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (res.ok) {
        const data = await res.json() as { login: string };
        setConnection({ state: 'ok', username: data.login });
      } else {
        const text = await res.text();
        setConnection({ state: 'error', message: `GitHub: ${res.status} — ${text}` });
      }
    } catch (e) {
      setConnection({ state: 'error', message: 'Could not reach GitHub. Check your network.' });
    }
  };

  const handleSave = async () => {
    if (!token.trim()) return;
    setSaveError(null);
    setSaving(true);
    try {
      await saveToken(token.trim());
      onNext();
    } catch (e) {
      console.error('token save failed:', e);
      setSaveError('Failed to save token. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg w-full">
      <h2 className="text-neutral-100 text-xl font-semibold mb-2">Connect GitHub</h2>
      <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
        Poietai.AI uses your GitHub account to push branches and open pull requests.
        You'll need a Personal Access Token — a key you generate on GitHub.
      </p>

      <button
        onClick={() => setShowInstructions((v) => !v)}
        className="text-indigo-400 text-xs mb-4 hover:text-indigo-300 flex items-center gap-1"
      >
        {showInstructions ? '▾' : '▸'} How to create a token
      </button>

      {showInstructions && (
        <ol className="text-neutral-400 text-xs space-y-1 mb-4 pl-4 list-decimal leading-relaxed">
          <li>Go to <span className="text-neutral-200">github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens</span></li>
          <li>Click <span className="text-neutral-200">Generate new token</span></li>
          <li>Set <span className="text-neutral-200">Resource owner</span> to your account or org</li>
          <li>Under <span className="text-neutral-200">Repository access</span>, select the repos you'll use</li>
          <li>
            Enable these permissions:
            <ul className="pl-4 list-disc mt-1 space-y-0.5">
              <li>Contents — Read and write</li>
              <li>Pull requests — Read and write</li>
              <li>Commit statuses — Read</li>
              <li>Issues — Read</li>
              <li>Workflows — Read</li>
            </ul>
          </li>
          <li>If your repo is in an <span className="text-neutral-200">organisation</span>, set Resource owner to that org — an org owner may need to approve the token</li>
          <li>Copy the token and paste it below</li>
        </ol>
      )}

      <label htmlFor="wizard-gh-token" className="block text-neutral-400 text-xs mb-1">
        Personal Access Token
      </label>
      <div className="flex gap-2 mb-2">
        <input
          id="wizard-gh-token"
          type="password"
          value={token}
          onChange={(e) => { setToken(e.target.value); setConnection({ state: 'idle' }); }}
          placeholder="ghp_... or github_pat_..."
          className="flex-1 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white placeholder-neutral-500 focus:outline-none
                     focus:border-indigo-500 font-mono"
          autoFocus
        />
        <button
          onClick={handleTest}
          disabled={!token.trim() || connection.state === 'testing'}
          className="text-sm bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50
                     text-white px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
        >
          {connection.state === 'testing' ? 'Testing…' : 'Test'}
        </button>
      </div>

      {connection.state === 'ok' && (
        <p className="text-green-400 text-xs mb-3">✓ Connected as @{connection.username}</p>
      )}
      {connection.state === 'error' && (
        <p className="text-red-400 text-xs mb-3">{connection.message}</p>
      )}

      {saveError && (
        <p className="text-red-400 text-xs mb-2">{saveError}</p>
      )}
      <div className="flex gap-2 justify-between mt-4">
        <button onClick={onSkip} className="text-sm text-neutral-500 hover:text-neutral-300">
          Skip for now
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !token.trim()}
          className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     text-white px-6 py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
