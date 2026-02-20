import { useState, useEffect } from 'react';
import { useSecretsStore } from '../../store/secretsStore';

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const { ghToken, saveToken } = useSecretsStore();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (ghToken) setDraft(ghToken);
  }, [ghToken]);

  const handleSave = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await saveToken(draft.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('failed to save GH token:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-96 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-neutral-100 font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <label className="block text-neutral-400 text-xs mb-1">GitHub Token</label>
        <p className="text-neutral-600 text-xs mb-2">
          Used for PR creation and review polling. Stored in an encrypted local vault.
        </p>
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ghp_..."
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white placeholder-neutral-500 focus:outline-none
                     focus:border-indigo-500 mb-3 font-mono"
        />

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm text-neutral-400 hover:text-neutral-200 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
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
