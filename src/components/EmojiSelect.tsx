import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { EmojiSource, EmojiOption } from "../types/api";

function unifiedToEmoji(unified: string) {
  return unified.split("-").map((part) => String.fromCodePoint(parseInt(part, 16))).join("");
}

let allOptions: EmojiOption[] | null = null;
let optionsPromise: Promise<EmojiOption[]> | null = null;
const fallbackOptions: EmojiOption[] = ["⭐", "✅", "📚", "🧩", "🎁", "🏅", "✨", "🌱", "🧹", "🏃", "❤️", "🎯"].map((emoji, sortOrder) => ({ emoji, name: emoji, shortNames: [], category: "常用", sortOrder, search: "", rank: 0 }));

async function buildEmojiOptions(): Promise<EmojiOption[]> {
  if (allOptions) return allOptions;
  if (!optionsPromise) optionsPromise = import("emoji-datasource/emoji.json").then(({ default: rawEmojiData }) => {
    const seen = new Set<string>();
    const options: EmojiOption[] = [];
    for (const source of rawEmojiData as EmojiSource[]) {
      const names = source.short_names?.length ? source.short_names : [source.short_name];
      if (names.some((name) => name?.startsWith("flag-"))) continue;
      const emoji = unifiedToEmoji(source.unified);
      if (seen.has(emoji)) continue;
      seen.add(emoji);
      options.push({ emoji, name: source.name, shortNames: source.short_names?.length ? source.short_names : [source.short_name], category: source.category, sortOrder: source.sort_order, search: "", rank: 0 });
    }
    allOptions = options.sort((a, b) => a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder);
    return allOptions;
  }).catch((error) => { optionsPromise = null; throw error; });
  return optionsPromise;
}

export function EmojiSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<EmojiOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || options.length > 0) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    buildEmojiOptions().then((result) => {
      if (cancelled) return;
      setOptions(result);
    }).catch(() => {
      if (!cancelled) { setOptions(fallbackOptions); setFailed(true); }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, retry]);

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
              <>{failed && <div className="empty">完整符号加载失败，正在显示常用符号。<button type="button" className="secondary" onClick={() => { setOptions([]); setRetry((value) => value + 1); }}>重试完整符号</button></div>}{options.map((opt) => (
                <button key={opt.emoji} type="button" className={opt.emoji === value ? "active" : ""}
                  onClick={() => { onChange(opt.emoji); setOpen(false); }}
                  title={opt.name}>
                  {opt.emoji}
                </button>
              ))}</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
