import { useState } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useTicketStore, type Ticket, type TicketPhase } from '../../store/ticketStore';
import { useAgentStore } from '../../store/agentStore';
import { Markdown } from '../canvas/nodes/Markdown';

interface Props {
  ticket: Ticket;
  onClose: () => void;
  onOpenCanvas: (ticketId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-zinc-700 text-zinc-300',
  refined: 'bg-blue-900 text-blue-300',
  assigned: 'bg-violet-900 text-violet-300',
  in_progress: 'bg-amber-900 text-amber-300',
  in_review: 'bg-cyan-900 text-cyan-300',
  shipped: 'bg-green-900 text-green-300',
  blocked: 'bg-red-900 text-red-300',
};

function EditableTitleWrapper({ ticket, onChange }: { ticket: Ticket; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ticket.title);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim()) { onChange(draft.trim()); } setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { if (draft.trim()) { onChange(draft.trim()); } setEditing(false); }
          if (e.key === 'Escape') { setDraft(ticket.title); setEditing(false); }
        }}
        className="w-full bg-zinc-800 border border-indigo-500 rounded px-2 py-1 text-lg font-semibold text-white outline-none"
      />
    );
  }

  return (
    <h2
      onClick={() => { setDraft(ticket.title); setEditing(true); }}
      className="text-lg font-semibold text-white cursor-pointer hover:text-indigo-300 transition-colors"
      title="Click to edit"
    >
      <span className="text-zinc-500 font-mono mr-1.5">#{ticket.number}</span>
      {ticket.title}
    </h2>
  );
}

function ArtifactAccordion({ phase, content }: { phase: TicketPhase; content: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-zinc-700/50 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800/50 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium capitalize">{phase}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 max-h-60 overflow-y-auto">
          <Markdown className="text-zinc-400 text-xs" variant="dark">{content}</Markdown>
        </div>
      )}
    </div>
  );
}

export function TicketDetailPanel({ ticket, onClose, onOpenCanvas }: Props) {
  const { updateTicket } = useTicketStore();
  const agents = useAgentStore((s) => s.agents);

  const [description, setDescription] = useState(ticket.description);
  const [descEditing, setDescEditing] = useState(false);
  const [complexity, setComplexity] = useState(ticket.complexity);
  const [newCriterion, setNewCriterion] = useState('');
  const [tagInput, setTagInput] = useState('');

  const saveDescription = () => {
    updateTicket(ticket.id, { description });
    setDescEditing(false);
  };

  const saveComplexity = (val: number) => {
    setComplexity(val);
    updateTicket(ticket.id, { complexity: val });
  };

  const addCriterion = () => {
    if (!newCriterion.trim()) return;
    const updated = [...ticket.acceptanceCriteria, newCriterion.trim()];
    updateTicket(ticket.id, { acceptanceCriteria: updated });
    setNewCriterion('');
  };

  const removeCriterion = (idx: number) => {
    const updated = ticket.acceptanceCriteria.filter((_, i) => i !== idx);
    updateTicket(ticket.id, { acceptanceCriteria: updated });
  };

  const addTag = () => {
    if (!tagInput.trim()) return;
    const newTags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    const merged = [...new Set([...(ticket.tags ?? []), ...newTags])];
    updateTicket(ticket.id, { tags: merged });
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    updateTicket(ticket.id, { tags: (ticket.tags ?? []).filter((t) => t !== tag) });
  };

  const artifactPhases = Object.keys(ticket.artifacts) as TicketPhase[];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-[480px] bg-neutral-900 border-l border-neutral-700 h-full overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="sticky top-0 bg-neutral-900 border-b border-neutral-700/50 px-5 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_COLORS[ticket.status] ?? 'bg-zinc-700 text-zinc-300'}`}>
              {ticket.status.replace('_', ' ')}
            </span>
            <button
              onClick={() => onOpenCanvas(ticket.id)}
              className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              <ExternalLink size={12} /> View canvas
            </button>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Title */}
          <EditableTitleWrapper
            ticket={ticket}
            onChange={(title) => updateTicket(ticket.id, { title })}
          />

          {/* Description */}
          <section>
            <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Description</h3>
            {descEditing ? (
              <div>
                <textarea
                  autoFocus
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
                <div className="flex gap-2 mt-1">
                  <button onClick={saveDescription} className="text-xs text-indigo-400 hover:text-indigo-300">Save</button>
                  <button onClick={() => { setDescription(ticket.description); setDescEditing(false); }} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setDescEditing(true)}
                className="cursor-pointer hover:bg-zinc-800/50 rounded-lg p-2 -m-2 transition-colors min-h-[2rem]"
                title="Click to edit"
              >
                {ticket.description ? (
                  <Markdown className="text-zinc-300 text-sm" variant="dark">{ticket.description}</Markdown>
                ) : (
                  <p className="text-zinc-600 text-sm italic">No description — click to add</p>
                )}
              </div>
            )}
          </section>

          {/* Complexity */}
          <section>
            <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5">
              Complexity: {complexity}
            </h3>
            <input
              type="range"
              min={1}
              max={10}
              value={complexity}
              onChange={(e) => saveComplexity(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </section>

          {/* Acceptance Criteria */}
          <section>
            <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Acceptance Criteria</h3>
            <div className="space-y-1 mb-2">
              {ticket.acceptanceCriteria.map((c, i) => (
                <div key={i} className="flex items-center gap-2 bg-zinc-800/50 rounded px-3 py-1.5 text-sm text-zinc-300">
                  <span className="text-zinc-600 text-xs mr-1">{i + 1}.</span>
                  <span className="flex-1">{c}</span>
                  <button onClick={() => removeCriterion(i)} className="text-zinc-600 hover:text-red-400 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newCriterion}
                onChange={(e) => setNewCriterion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCriterion(); } }}
                placeholder="Add criterion..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1 text-xs text-white placeholder-zinc-600 outline-none focus:border-indigo-500"
              />
              <button onClick={addCriterion} disabled={!newCriterion.trim()} className="text-indigo-400 hover:text-indigo-300 disabled:opacity-30">
                <Plus size={14} />
              </button>
            </div>
          </section>

          {/* Tags */}
          <section>
            <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Tags</h3>
            <div className="flex flex-wrap gap-1 mb-2">
              {(ticket.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-[10px] bg-indigo-900/40 text-indigo-300 rounded-full px-2 py-0.5"
                >
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-400 transition-colors">
                    <X size={8} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Add tags (comma-separated)..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1 text-xs text-white placeholder-zinc-600 outline-none focus:border-indigo-500"
              />
              <button onClick={addTag} disabled={!tagInput.trim()} className="text-indigo-400 hover:text-indigo-300 disabled:opacity-30">
                <Plus size={14} />
              </button>
            </div>
          </section>

          {/* Assignments */}
          {ticket.assignments.length > 0 && (
            <section>
              <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Assigned Agents</h3>
              <div className="space-y-1">
                {ticket.assignments.map((a) => {
                  const agent = agents.find((ag) => ag.id === a.agentId);
                  return (
                    <div key={a.agentId} className="flex items-center gap-2 text-sm text-zinc-300">
                      <div className="w-5 h-5 rounded bg-violet-700 flex items-center justify-center text-[9px] text-white font-bold">
                        {(agent?.name ?? 'A').charAt(0).toUpperCase()}
                      </div>
                      <span>{agent?.name ?? a.agentId}</span>
                      <span className="text-zinc-600 text-xs">({agent?.role ?? 'unknown'})</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Phase Pipeline */}
          {ticket.phases.length > 0 && (
            <section>
              <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Phase Pipeline</h3>
              <div className="flex flex-wrap gap-1">
                {ticket.phases.map((phase) => {
                  const isActive = phase === ticket.activePhase;
                  const hasArtifact = !!ticket.artifacts[phase];
                  return (
                    <span
                      key={phase}
                      className={`text-[10px] px-2 py-0.5 rounded capitalize ${
                        isActive
                          ? 'bg-indigo-600 text-white font-medium'
                          : hasArtifact
                            ? 'bg-green-900/40 text-green-400'
                            : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {phase}
                    </span>
                  );
                })}
              </div>
            </section>
          )}

          {/* Artifacts */}
          {artifactPhases.length > 0 && (
            <section>
              <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Artifacts</h3>
              <div className="space-y-1.5">
                {artifactPhases.map((phase) => {
                  const artifact = ticket.artifacts[phase];
                  if (!artifact) return null;
                  return <ArtifactAccordion key={phase} phase={phase} content={artifact.content} />;
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
