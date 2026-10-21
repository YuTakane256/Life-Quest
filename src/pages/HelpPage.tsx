import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, HelpCircle, Search, X } from 'lucide-react';
import { useBackWithFallback } from '../hooks/useBackWithFallback';
import { filterHelpSections, HELP_SECTIONS } from '../core/help';
import { useMotionStore } from '../stores/useMotionStore';
import { resolveMotionState } from '../components/ui/themeControllerUtils';

export function HelpPage() {
    const handleBack = useBackWithFallback();
    const [searchQuery, setSearchQuery] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);

    const filteredSections = useMemo(
        () => filterHelpSections(HELP_SECTIONS, searchQuery),
        [searchQuery]
    );

    const handleSectionJump = (sectionId: string) => {
        if (!filteredSections.some((section) => section.id === sectionId)) return;
        const heading = document.getElementById(`help-heading-${sectionId}`);
        const reduced = resolveMotionState(useMotionStore.getState().mode).resolvedMotion === 'reduced';
        heading?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
        heading?.focus({ preventScroll: true });
    };
    const clearSearch = () => { setSearchQuery(''); searchRef.current?.focus(); };

    return (
        <div className="app-page max-w-lg mx-auto px-5 pt-6 pb-28">
            <div className="flex items-center gap-3 mb-5">
                <button
                    onClick={handleBack}
                    className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center transition-all active:scale-95"
                    style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}
                    aria-label="戻る"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="flex items-center gap-2">
                    <HelpCircle size={22} style={{ color: 'var(--color-accent-primary)' }} />
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>使い方</h1>
                </div>
            </div>

            <div className="mb-4">
                <div className="relative">
                    <Search size={15} className="absolute left-[12px] top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                    <input
                        ref={searchRef}
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="キーワードで検索"
                        aria-label="ヘルプをキーワードで検索"
                        aria-controls="help-results"
                        className="w-full min-h-[44px] py-2 rounded-xl pl-[36px] pr-[52px] text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-all [&::-webkit-search-cancel-button]:hidden"
                        style={{
                            backgroundColor: 'var(--color-bg-card)',
                            color: 'var(--color-text-primary)',
                            border: '1px solid var(--color-border-default)',
                        }}
                    />
                    {searchQuery.length > 0 && (
                        <button
                            type="button"
                            onClick={clearSearch}
                            className="absolute right-[4px] top-1/2 -translate-y-1/2 w-[44px] h-[44px] rounded-lg flex items-center justify-center transition-all active:scale-95"
                            style={{ color: 'var(--color-text-muted)' }}
                            aria-label="検索をクリア"
                        >
                            <X size={15} />
                        </button>
                    )}
                </div>

                <p role="status" aria-label="ヘルプの検索結果" className="mt-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>{filteredSections.length}件のヘルプセクション</p>
                <nav className="mt-3 flex flex-wrap gap-2 pb-1" aria-label="ヘルプセクション">
                    {filteredSections.map((section) => (
                        <button
                            key={section.id}
                            type="button"
                            onClick={() => handleSectionJump(section.id)}
                            aria-label={`${section.title}へ移動する`}
                            aria-controls={`help-heading-${section.id}`}
                            className="min-h-11 max-w-full px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold text-left transition-all active:scale-95"
                            style={{
                                backgroundColor: 'var(--color-bg-card)',
                                color: 'var(--color-text-secondary)',
                                border: '1px solid var(--color-border-default)',
                            }}
                        >
                            <span aria-hidden="true" className="shrink-0">{section.icon}</span>
                            <span className="min-w-0 break-words">{section.title}</span>
                        </button>
                    ))}
                </nav>
            </div>

            <div id="help-results" className="flex flex-col gap-4">
                {filteredSections.length === 0 && (
                    <div
                        className="rounded-xl p-4 text-sm"
                        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-muted)' }}
                    >
                        <p>一致する項目がありません</p>
                        <button type="button" onClick={clearSearch} className="min-h-11 mt-2 underline" style={{ color: 'var(--color-accent-primary)' }}>すべての使い方を表示</button>
                    </div>
                )}

                {filteredSections.map((section) => (
                    <section
                        key={section.id}
                        id={section.id}
                        className="rounded-xl p-4 scroll-mt-5"
                        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
                    >
                        <h2 id={`help-heading-${section.id}`} tabIndex={-1} aria-label={section.title} className="text-sm font-semibold mb-2 flex items-start gap-2 scroll-mt-5" style={{ color: 'var(--color-text-primary)' }}>
                            <span aria-hidden="true" className="text-base shrink-0">{section.icon}</span>
                            <span className="min-w-0 break-words">{section.title}</span>
                        </h2>
                        <ul className="flex flex-col gap-1.5">
                            {section.items.map((item) => (
                                <li key={item} className="text-xs leading-relaxed flex gap-2" style={{ color: 'var(--color-text-secondary)' }}>
                                    <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>・</span>
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}
