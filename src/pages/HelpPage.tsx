import { useMemo, useState } from 'react';
import { ArrowLeft, HelpCircle, Search, X } from 'lucide-react';
import { useBackWithFallback } from '../hooks/useBackWithFallback';
import { filterHelpSections, HELP_SECTIONS } from '../core/help';

export function HelpPage() {
    const handleBack = useBackWithFallback();
    const [searchQuery, setSearchQuery] = useState('');

    const filteredSections = useMemo(
        () => filterHelpSections(HELP_SECTIONS, searchQuery),
        [searchQuery]
    );

    const handleSectionJump = (sectionId: string) => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div className="app-page max-w-lg mx-auto px-5 pt-6 pb-28">
            <div className="flex items-center gap-3 mb-5">
                <button
                    onClick={handleBack}
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95"
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
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="キーワードで検索"
                        className="w-full h-11 rounded-xl pl-9 pr-10 text-sm outline-none transition-all"
                        style={{
                            backgroundColor: 'var(--color-bg-card)',
                            color: 'var(--color-text-primary)',
                            border: '1px solid var(--color-border-default)',
                        }}
                    />
                    {searchQuery.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-95"
                            style={{ color: 'var(--color-text-muted)' }}
                            aria-label="検索をクリア"
                        >
                            <X size={15} />
                        </button>
                    )}
                </div>

                <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="ヘルプセクション">
                    {HELP_SECTIONS.map((section) => (
                        <button
                            key={section.id}
                            type="button"
                            onClick={() => handleSectionJump(section.id)}
                            className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap transition-all active:scale-95"
                            style={{
                                backgroundColor: 'var(--color-bg-card)',
                                color: 'var(--color-text-secondary)',
                                border: '1px solid var(--color-border-default)',
                            }}
                        >
                            <span>{section.icon}</span>
                            <span>{section.title}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-4">
                {filteredSections.length === 0 && (
                    <div
                        className="rounded-xl p-4 text-sm"
                        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-muted)' }}
                    >
                        一致する項目がありません
                    </div>
                )}

                {filteredSections.map((section) => (
                    <section
                        key={section.id}
                        id={section.id}
                        className="rounded-xl p-4 scroll-mt-5"
                        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
                    >
                        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
                            <span className="text-base">{section.icon}</span>
                            {section.title}
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
