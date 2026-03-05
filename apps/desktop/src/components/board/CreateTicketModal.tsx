import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { useTicketStore } from '../../store/ticketStore';

interface Props {
  onClose: () => void;
}

export function CreateTicketModal({ onClose }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [complexity, setComplexity] = useState(3);
  const [criteria, setCriteria] = useState<string[]>([]);
  const [newCriterion, setNewCriterion] = useState('');
  const [tagInput, setTagInput] = useState('');
  const addTicket = useTicketStore((s) => s.addTicket);

  const tags = tagInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const handleAddCriterion = () => {
    if (!newCriterion.trim()) return;
    setCriteria([...criteria, newCriterion.trim()]);
    setNewCriterion('');
  };

  const handleRemoveCriterion = (idx: number) => {
    setCriteria(criteria.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    if (!title.trim()) return;
    addTicket({
      title: title.trim(),
      description: description.trim(),
      complexity,
      acceptanceCriteria: criteria,
      tags,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-[28rem] shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-neutral-100 font-semibold">New ticket</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Title */}
        <label htmlFor="ticket-title" className="block text-neutral-400 text-xs mb-1">Title *</label>
        <input
          id="ticket-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          placeholder="e.g. Add user authentication"
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white placeholder-neutral-500 focus:outline-none
                     focus:border-indigo-500 mb-3"
        />

        {/* Description */}
        <label htmlFor="ticket-desc" className="block text-neutral-400 text-xs mb-1">Description</label>
        <textarea
          id="ticket-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Markdown supported..."
          rows={4}
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white placeholder-neutral-500 focus:outline-none
                     focus:border-indigo-500 mb-3 resize-none"
        />

        {/* Complexity */}
        <label htmlFor="ticket-complexity" className="block text-neutral-400 text-xs mb-1">
          Complexity: {complexity}
        </label>
        <input
          id="ticket-complexity"
          type="range"
          min={1}
          max={10}
          value={complexity}
          onChange={(e) => setComplexity(Number(e.target.value))}
          className="w-full accent-indigo-500 mb-3"
        />

        {/* Acceptance Criteria */}
        <label className="block text-neutral-400 text-xs mb-1">Acceptance Criteria</label>
        <div className="space-y-1 mb-2">
          {criteria.map((c, i) => (
            <div key={i} className="flex items-center gap-2 bg-neutral-800 rounded-lg px-3 py-1.5 text-sm text-zinc-300">
              <span className="flex-1">{c}</span>
              <button
                type="button"
                onClick={() => handleRemoveCriterion(i)}
                className="text-neutral-500 hover:text-red-400 transition-colors"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mb-3">
          <input
            value={newCriterion}
            onChange={(e) => setNewCriterion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCriterion(); } }}
            placeholder="Add criterion..."
            className="flex-1 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-1.5
                       text-sm text-white placeholder-neutral-500 focus:outline-none
                       focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={handleAddCriterion}
            disabled={!newCriterion.trim()}
            className="text-indigo-400 hover:text-indigo-300 disabled:opacity-30 transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Tags */}
        <label htmlFor="ticket-tags" className="block text-neutral-400 text-xs mb-1">Tags</label>
        <input
          id="ticket-tags"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="comma-separated, e.g. frontend, bug"
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white placeholder-neutral-500 focus:outline-none
                     focus:border-indigo-500 mb-1"
        />
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {tags.map((tag) => (
              <span key={tag} className="text-[10px] bg-indigo-900/50 text-indigo-300 rounded-full px-2 py-0.5">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end mt-4">
          <button
            onClick={onClose}
            className="text-sm text-neutral-400 hover:text-neutral-200 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                       text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
