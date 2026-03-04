import { useSettingsStore, NODE_CATEGORIES, type NodeCategory } from '../../store/settingsStore';

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  thoughts: 'Thoughts',
  messages: 'Messages',
  tools: 'Tools',
  status: 'Status',
  plan: 'Plan',
};

const categories = Object.keys(NODE_CATEGORIES) as NodeCategory[];

export function CanvasFilterBar() {
  const hiddenNodeCategories = useSettingsStore((s) => s.hiddenNodeCategories);
  const toggleNodeCategory = useSettingsStore((s) => s.toggleNodeCategory);

  return (
    <div className="absolute bottom-2 right-14 z-10 flex gap-1.5">
      {categories.map((cat) => {
        const hidden = hiddenNodeCategories.has(cat);
        return (
          <button
            key={cat}
            onClick={() => toggleNodeCategory(cat)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              hidden
                ? 'bg-zinc-900/50 text-zinc-500'
                : 'bg-zinc-800 text-zinc-200'
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        );
      })}
    </div>
  );
}
