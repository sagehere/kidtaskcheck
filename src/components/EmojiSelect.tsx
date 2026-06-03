import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { EmojiSource, EmojiOption } from "../types/api";

const RECOMMENDED_EMOJI = [
  "✅", "⭐", "🎁", "🏅", "✨", "⚠️", "📚", "🧹", "🌱", "🏃", "💪", "🧠", "📝", "📖", "🧮", "🎨", "🎵", "⚽", "🏀", "🏊",
  "🍎", "🥛", "🪥", "🧸", "🎮", "🎬", "🍭", "🍀", "🌈", "🚀", "🔥", "💎", "🎯", "🏆", "🥇", "👏", "💖", "🙂", "😄", "😎"
];
const TASK_RELEVANCE_TERMS = [
  "check", "white_check", "heavy_check", "star", "gift", "trophy", "medal", "sparkles", "warning", "book", "school", "student",
  "memo", "pencil", "brain", "abacus", "broom", "soap", "toothbrush", "bath", "bed", "seedling", "running", "muscle", "soccer",
  "basketball", "swim", "apple", "milk", "art", "musical", "game", "clap", "heart", "smile", "fire", "gem", "dart"
];

function unifiedToEmoji(unified: string) {
  return unified.split("-").map((part) => String.fromCodePoint(parseInt(part, 16))).join("");
}

function relevanceRank(item: { emoji: string; name: string; shortNames: string[] }) {
  const recommendedIndex = RECOMMENDED_EMOJI.indexOf(item.emoji);
  if (recommendedIndex >= 0) return recommendedIndex;
  const haystack = `${item.name} ${item.shortNames.join(" ")}`.toLowerCase();
  const termIndex = TASK_RELEVANCE_TERMS.findIndex((term) => haystack.includes(term));
  return termIndex >= 0 ? RECOMMENDED_EMOJI.length + termIndex : Number.MAX_SAFE_INTEGER;
}

let allOptions: EmojiOption[] | null = null;

async function buildEmojiOptions(): Promise<EmojiOption[]> {
  if (allOptions) return allOptions;
  const { default: rawEmojiData } = await import("emoji-datasource/emoji.json");
  const emojiData = rawEmojiData as EmojiSource[];
  const seen = new Set<string>();
  const options: EmojiOption[] = [];
  function add(source: EmojiSource, unified: string) {
    const emoji = unifiedToEmoji(unified);
    if (seen.has(emoji)) return;
    seen.add(emoji);
    const shortNames = source.short_names?.length ? source.short_names : [source.short_name];
    const base = { emoji, name: source.name, shortNames };
    options.push({
      ...base,
      category: source.category,
      sortOrder: source.sort_order,
      search: `${emoji} ${source.name} ${shortNames.join(" ")}`.toLowerCase(),
      rank: relevanceRank(base)
    });
  }
  for (const source of emojiData) {
    const names = source.short_names?.length ? source.short_names : [source.short_name];
    if (names.some((name) => name?.startsWith("flag-"))) continue;
    add(source, source.unified);
    if (source.skin_variations) {
      for (const key of Object.keys(source.skin_variations)) {
        add(source, source.skin_variations[key].unified);
      }
    }
  }
  allOptions = options.sort((a, b) => a.rank - b.rank || a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return allOptions;
}

export function EmojiSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<EmojiOption[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { buildEmojiOptions().then(setOptions); }, []);

  const filtered = useMemo(() => {
    if (!search) return options.slice(0, 100);
    const term = search.toLowerCase();
    return options.filter((opt) => opt.search.includes(term)).slice(0, 100);
  }, [search, options]);

  return (
    <div className="emoji-select" ref={ref}>
      <button type="button" className="emoji-trigger" onClick={() => setOpen(!open)}>
        <span className="emoji">{value || "⭐"}</span>
      </button>
      {open && (
        <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
          <div className="emoji-search">
            <Search size={14} />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 emoji..." />
            <button type="button" className="icon" onClick={() => setOpen(false)}><X size={14} /></button>
          </div>
          <div className="emoji-grid">
            {filtered.length ? filtered.map((opt) => (
              <button key={opt.emoji} type="button" className={opt.emoji === value ? "active" : ""}
                onClick={() => { onChange(opt.emoji); setOpen(false); }}
                title={opt.name}>
                {opt.emoji}
              </button>
            )) : <span className="empty">加载中...</span>}
          </div>
        </div>
      )}
    </div>
  );
}
