// apps/desktop/src/components/layout/SettingsPanel.tsx
import { useState, useEffect } from 'react';
import { useSecretsStore } from '../../store/secretsStore';

interface Props {
  onClose: () => void;
}

type ConnectionStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; username: string }
  | { state: 'error'; message: string };

export function SettingsPanel({ onClose }: Props) {
  const { ghToken, saveToken, usingFallback } = useSecretsStore();
  const [draft, setDraft] = useState(() => ghToken ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>({ state: 'idle' });

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(id);
  }, [saved]);

  const handleTest = async () => {
    if (!draft.trim()) return;
    setConnection({ state: 'testing' });
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${draft.trim()}` },
      });
      if (res.ok) {
        const data = await res.json() as { login: string };
        setConnection({ state: 'ok', username: data.login });
      } else {
        const text = await res.text();
        setConnection({ state: 'error', message: `${res.status} — ${text}` });
      }
    } catch {
      setConnection({ state: 'error', message: 'Could not reach GitHub. Check your network.' });
    }
  };

  const handleSave = async () => {
    if (!draft.trim()) return;
    setError(null);
    setSaving(true);
    try {
      await saveToken(draft.trim());
      setSaved(true);
    } catch (e) {
      console.error('failed to save GH token:', e);
      setError('Failed to save token. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
    >
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-[480px] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 id="settings-title" className="text-neutral-100 font-semibold">Settings</h2>
          <button onClick={onClose} aria-label="Close settings"
            className="text-neutral-500 hover:text-neutral-300 text-xl leading-none">×</button>
        </div>

        {/* Stronghold fallback warning */}
        {usingFallback && (
          <div className="bg-amber-950 border border-amber-700 rounded-lg px-3 py-2 mb-4">
            <p className="text-amber-300 text-xs">
              Token stored without encryption — secure storage unavailable on this system.
              Install <span className="font-mono">gnome-keyring</span> for encrypted storage.
            </p>
          </div>
        )}

        {/* GitHub section */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-neutral-300 text-sm font-medium">GitHub</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              ghToken ? 'bg-green-950 text-green-400' : 'bg-neutral-800 text-neutral-500'
            }`}>
              {ghToken ? '✓ Connected' : 'Not connected'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowInstructions((v) => !v)}
            className="text-indigo-400 text-xs mb-3 hover:text-indigo-300 flex items-center gap-1"
          >
            {showInstructions ? '▾' : '▸'} How to create a Personal Access Token
          </button>

          {showInstructions && (
            <ol className="text-neutral-400 text-xs space-y-1 mb-3 pl-4 list-decimal leading-relaxed">
              <li>Go to <span className="text-neutral-200">github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens</span></li>
              <li>Click <span className="text-neutral-200">Generate new token</span></li>
              <li>Set Resource owner to your account or org</li>
              <li>Select the repositories you'll use</li>
              <li>
                Enable: Contents (R/W), Pull requests (R/W), Commit statuses (R),
                Issues (R), Workflows (R)
              </li>
              <li>
                <span className="text-neutral-200">Org repos:</span> set Resource owner to the org —
                an org owner may need to approve the token
              </li>
            </ol>
          )}

          <label htmlFor="gh-token" className="block text-neutral-400 text-xs mb-1">
            Personal Access Token
          </label>
          <div className="flex gap-2 mb-2">
            <input
              id="gh-token"
              type="password"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setConnection({ state: 'idle' }); }}
              placeholder="ghp_... or github_pat_..."
              className="flex-1 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                         text-sm text-white placeholder-neutral-500 focus:outline-none
                         focus:border-indigo-500 font-mono"
            />
            <button
              type="button"
              onClick={handleTest}
              disabled={!draft.trim() || connection.state === 'testing'}
              className="text-sm bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50
                         text-white px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
            >
              {connection.state === 'testing' ? 'Testing…' : 'Test'}
            </button>
          </div>

          {connection.state === 'ok' && (
            <p className="text-green-400 text-xs mb-2">✓ Connected as @{connection.username}</p>
          )}
          {connection.state === 'error' && (
            <p className="text-red-400 text-xs mb-2">{connection.message}</p>
          )}

          {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
        </div>

        <div className="flex gap-2 justify-end border-t border-neutral-800 pt-4">
          <button onClick={onClose}
            className="text-sm text-neutral-400 hover:text-neutral-200 px-3 py-1.5">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !draft.trim()}
            className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                       text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
