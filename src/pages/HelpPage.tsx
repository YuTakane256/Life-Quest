import { ArrowLeft, HelpCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

interface HelpSection {
    icon: string;
    title: string;
    items: string[];
}

const SECTIONS: HelpSection[] = [
    {
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
        icon: '⚔️',
        title: 'バトル・マップ',
        items: [
            '初回の青宝箱を開封するとマップ画面が解放されます',
            'ステージをクリアしてXPを獲得し、次のエリアへ進めます',
            '装備の攻撃力・防御力・HPがバトル結果に影響します',
        ],
    },
    {
        icon: '🔔',
        title: '通知',
        items: [
            '設定画面の「通知」をONにするとブラウザ通知を受け取れます',
            'タスク期限の24時間前と、JST 20:00以降に未完了習慣がある場合に通知します',
            'アプリを開いている間にチェックして通知する方式です（バックグラウンドは非対応）',
        ],
    },
    {
        icon: '🎁',
        title: 'ログインボーナス',
        items: [
            'アプリを開くと1日1回XPがもらえます',
            '連続ログインで獲得XPが増加し、7日連続で特別宝箱がもらえます',
        ],
    },
    {
        icon: '📊',
        title: '統計',
        items: [
            '統計ページで今週のXP、自己ベスト記録、ヒートマップを確認できます',
            '設定画面の「利用統計」で累計データを見られます',
        ],
    },
    {
        icon: '🩹',
        title: 'デバフ',
        items: [
            '習慣を全部達成しない日があるとデバフがかかり、XP獲得量が減ります',
            'デバフは時間経過で解除されます',
        ],
    },
];

export function HelpPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const handleBack = () => {
        if (location.key === 'default') {
            navigate('/tasks', { replace: true });
            return;
        }
        navigate(-1);
    };

    return (
        <div className="max-w-lg mx-auto px-5 pt-6 pb-28">
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

            <div className="flex flex-col gap-4">
                {SECTIONS.map((section) => (
                    <section
                        key={section.title}
                        className="rounded-xl p-4"
                        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
                    >
                        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
                            <span className="text-base">{section.icon}</span>
                            {section.title}
                        </h2>
                        <ul className="flex flex-col gap-1.5">
                            {section.items.map((item, i) => (
                                <li key={i} className="text-xs leading-relaxed flex gap-2" style={{ color: 'var(--color-text-secondary)' }}>
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
