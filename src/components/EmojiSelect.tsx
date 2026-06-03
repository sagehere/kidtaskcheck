import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { EmojiSource, EmojiOption } from "../types/api";

function unifiedToEmoji(unified: string) {
  return unified.split("-").map((part) => String.fromCodePoint(parseInt(part, 16))).join("");
}

let allOptions: EmojiOption[] | null = null;

async function buildEmojiOptions(): Promise<EmojiOption[]> {
  if (allOptions) return allOptions;
  const { default: rawEmojiData } = await import("emoji-datasource/emoji.json");
  const emojiData = rawEmojiData as EmojiSource[];
  const seen = new Set<string>();
  const options: EmojiOption[] = [];
  for (const source of emojiData) {
    const names = source.short_names?.length ? source.short_names : [source.short_name];
    if (names.some((name) => name?.startsWith("flag-"))) continue;
    const emoji = unifiedToEmoji(source.unified);
    if (seen.has(emoji)) continue;
    seen.add(emoji);
    const shortNames = source.short_names?.length ? source.short_names : [source.short_name];
    options.push({
      emoji,
      name: source.name,
      shortNames,
      category: source.category,
      sortOrder: source.sort_order,
      search: "",
      rank: 0
    });
  }
  allOptions = options.sort((a, b) => a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder);
  return allOptions;
}

export function EmojiSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<EmojiOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    buildEmojiOptions().then((result) => {
      setOptions(result);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="emoji-select" ref={ref}>
      <button type="button" className="emoji-trigger" onClick={() => setOpen(!open)}>
        <span className="emoji">{value || "⭐"}</span>
      </button>
      {open && (
        <div className="emoji-picker">
          <div className="emoji-picker-head">
            <span>选择符号</span>
            <button type="button" className="icon" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>
          <div className="emoji-grid">
            {loading ? (
              <span className="empty">加载中...</span>
            ) : (
              options.map((opt) => (
                <button key={opt.emoji} type="button" className={opt.emoji === value ? "active" : ""}
                  onClick={() => { onChange(opt.emoji); setOpen(false); }}
                  title={opt.name}>
                  {opt.emoji}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
