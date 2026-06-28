import { useMemo, useState } from 'react';
import { ArrowLeft, HelpCircle, Search, X } from 'lucide-react';
import { useBackWithFallback } from '../hooks/useBackWithFallback';

interface HelpSection {
    id: string;
    icon: string;
    title: string;
    items: string[];
}

const SECTIONS: HelpSection[] = [
    {
        id: 'tasks',
        icon: '📋',
        title: 'タスク',
        items: [
            '右上の + ボタンから新規タスクを追加できます',
            '優先度（高/中/低）に応じて完了時のXPが増えます',
            'タスクを完了するとXPを獲得し、5秒以内ならUndoできます',
            'サブタスクで大きなタスクを分解でき、サブタスク完了でも少しXPがもらえます',
            'タグで分類、検索ボックスで名前検索ができます',
            '期限・優先度のクイックフィルタ、並び替え（期限/優先度/作成日）に対応',
            '繰り返しタスク（毎日/毎週/毎月）は完了すると次回分が自動生成されます',
            '完了タスクは「完了N件を削除」ボタンでまとめて削除できます',
        ],
    },
    {
        id: 'habits',
        icon: '🔁',
        title: '習慣',
        items: [
            '毎日チェックする習慣を登録します。完了するとメモを残せます',
            'すべての習慣を達成するとボーナスXPがもらえます',
            'お休みボタンで「今日はお休み」にでき、ストリーク・達成率に影響しません',
            '🔥 連続達成日数、📊 過去30日達成率が習慣カードに表示されます',
            'カテゴリで分類でき、並び替え（名前/作成/ストリーク/達成率）も可能',
        ],
    },
    {
        id: 'character',
        icon: '⭐',
        title: 'キャラクター・レベル・装備',
        items: [
            'タスクや習慣でXPを獲得するとレベルが上がります',
            'レベルアップで攻撃・防御・HPが上昇します',
            'タスクを消化すると一定数ごとに宝箱がもらえます',
            '宝箱を開封すると装備（武器・防具・アクセサリ）が手に入ります',
            '装備は売却してXPにしたり、3つ合成して上位レアリティに昇格できます',
            '過去に開けた宝箱と中身は「獲得履歴」セクションで振り返れます',
        ],
    },
    {
        id: 'battle',
        icon: '⚔️',
        title: 'バトル・マップ',
        items: [
            '初回の青宝箱を開封するとマップ画面が解放されます',
            'ステージをクリアしてXPを獲得し、次のエリアへ進めます',
            '装備の攻撃力・防御力・HPがバトル結果に影響します',
        ],
    },
    {
        id: 'notifications',
        icon: '🔔',
        title: '通知',
        items: [
            '設定画面の「通知」をONにするとブラウザ通知を受け取れます',
            'タスク期限の24時間前と、JST 20:00以降に未完了習慣がある場合に通知します',
            'アプリを開いている間にチェックして通知する方式です（バックグラウンドは非対応）',
        ],
    },
    {
        id: 'login-bonus',
        icon: '🎁',
        title: 'ログインボーナス',
        items: [
            'アプリを開くと1日1回XPがもらえます',
            '連続ログインで獲得XPが増加し、7日連続で特別宝箱がもらえます',
        ],
    },
    {
        id: 'stats',
        icon: '📊',
        title: '統計',
        items: [
            '統計ページで今週のXP、自己ベスト記録、ヒートマップを確認できます',
            '設定画面の「利用統計」で累計データを見られます',
        ],
    },
    {
        id: 'friends',
        icon: '👥',
        title: '友達',
        items: [
            '友達画面で友達のレベル、XP、到達ステージを登録できます',
            '自分の現在値と友達をリーダーボードで比較できます',
            '登録した友達データはこの端末に保存されます',
        ],
    },
    {
        id: 'debuff',
        icon: '🩹',
        title: 'デバフ',
        items: [
            '習慣を全部達成しない日があるとデバフがかかり、XP獲得量が減ります',
            'デバフは時間経過で解除されます',
        ],
    },
];

export function HelpPage() {
    const handleBack = useBackWithFallback();
    const [searchQuery, setSearchQuery] = useState('');

    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredSections = useMemo(() => {
        if (normalizedQuery.length === 0) return SECTIONS;

        return SECTIONS.map((section) => {
            const matchesTitle = section.title.toLowerCase().includes(normalizedQuery);
            const items = matchesTitle
                ? section.items
                : section.items.filter((item) => item.toLowerCase().includes(normalizedQuery));
            return { ...section, items };
        }).filter((section) => section.items.length > 0);
    }, [normalizedQuery]);

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
                    {SECTIONS.map((section) => (
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
