import { ArrowUpDown, CalendarClock, Flag, Search, Tag, Trash2, X } from 'lucide-react';
import { PRIORITY_COLORS } from '../../config/taskLabels';
import type { Priority } from '../../types';
import type { TaskSortMode } from '../../stores/useTaskSortStore';

export type DueFilter = 'all' | 'dueSoon' | 'overdue';
export type PriorityFilter = 'all' | Priority;

const DUE_FILTER_OPTIONS: { value: DueFilter; label: string }[] = [
    { value: 'all', label: 'すべて' },
    { value: 'dueSoon', label: '今日まで' },
    { value: 'overdue', label: '期限切れ' },
];

const PRIORITY_FILTER_OPTIONS: { value: PriorityFilter; label: string }[] = [
    { value: 'all', label: 'すべて' },
    { value: 'high', label: '高' },
    { value: 'medium', label: '中' },
    { value: 'low', label: '低' },
];

interface TaskFiltersProps {
    searchQuery: string;
    dueFilter: DueFilter;
    priorityFilter: PriorityFilter;
    sortMode: TaskSortMode;
    allTags: string[];
    selectedTags: string[];
    deletableCompletedCount: number;
    onSearchQueryChange: (value: string) => void;
    onDueFilterChange: (value: DueFilter) => void;
    onPriorityFilterChange: (value: PriorityFilter) => void;
    onSortModeChange: (value: TaskSortMode) => void;
    onToggleTag: (tag: string) => void;
    onClearTags: () => void;
    onRequestDeleteCompleted: () => void;
}

export function TaskFilters({
    searchQuery,
    dueFilter,
    priorityFilter,
    sortMode,
    allTags,
    selectedTags,
    deletableCompletedCount,
    onSearchQueryChange,
    onDueFilterChange,
    onPriorityFilterChange,
    onSortModeChange,
    onToggleTag,
    onClearTags,
    onRequestDeleteCompleted,
}: TaskFiltersProps) {
    return (
        <>
            <div className="relative mb-3">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => onSearchQueryChange(event.target.value)}
                    placeholder="タスクを検索..."
                    className="w-full pl-9 pr-9 py-2 rounded-lg text-sm outline-none"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                />
                {searchQuery && (
                    <button type="button" onClick={() => onSearchQueryChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-colors hover:opacity-70" style={{ color: 'var(--color-text-muted)' }} aria-label="検索をクリア">
                        <X size={14} />
                    </button>
                )}
            </div>

            <QuickFilterRow icon={<CalendarClock size={14} />}>
                {DUE_FILTER_OPTIONS.map((option) => (
                    <FilterButton
                        key={option.value}
                        active={dueFilter === option.value}
                        label={option.label}
                        activeColor="var(--color-accent-primary)"
                        onClick={() => onDueFilterChange(option.value)}
                    />
                ))}
            </QuickFilterRow>

            <QuickFilterRow icon={<Flag size={14} />}>
                {PRIORITY_FILTER_OPTIONS.map((option) => (
                    <FilterButton
                        key={option.value}
                        active={priorityFilter === option.value}
                        label={option.label}
                        activeColor={option.value === 'all' ? 'var(--color-accent-primary)' : PRIORITY_COLORS[option.value]}
                        onClick={() => onPriorityFilterChange(option.value)}
                    />
                ))}
            </QuickFilterRow>

            <div className="flex items-center gap-2 mb-4">
                <ArrowUpDown size={14} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as TaskSortMode)} aria-label="並び替え" className="px-3 py-1.5 rounded-lg text-xs outline-none" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}>
                    <option value="dueDate">期限順</option>
                    <option value="priority">優先度順</option>
                    <option value="createdAt">作成日順</option>
                </select>
                {deletableCompletedCount > 0 && (
                    <button type="button" onClick={onRequestDeleteCompleted} className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-colors hover:opacity-80" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-danger)', border: '1px solid var(--color-border-default)' }}>
                        <Trash2 size={13} />
                        完了{deletableCompletedCount}件を削除
                    </button>
                )}
            </div>

            {allTags.length > 0 && (
                <div className="mb-4 -mx-4 px-4" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <div className="flex gap-2 pb-1" style={{ minWidth: 'max-content' }}>
                        <Tag size={14} className="flex-shrink-0 mt-1" style={{ color: 'var(--color-text-muted)' }} />
                        {allTags.map((tag) => (
                            <FilterButton
                                key={tag}
                                active={selectedTags.includes(tag)}
                                label={tag}
                                activeColor="var(--color-accent-primary)"
                                onClick={() => onToggleTag(tag)}
                            />
                        ))}
                        {selectedTags.length > 0 && (
                            <button onClick={onClearTags} className="px-2 py-1 rounded-full text-xs transition-colors flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>クリア</button>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

function QuickFilterRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{icon}</span>
            {children}
        </div>
    );
}

function FilterButton({ active, label, activeColor, onClick }: { active: boolean; label: string; activeColor: string; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={active} className="px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 flex-shrink-0" style={{
            backgroundColor: active ? activeColor : 'var(--color-bg-secondary)',
            color: active ? 'white' : 'var(--color-text-secondary)',
            border: `1px solid ${active ? activeColor : 'var(--color-border-default)'}`,
        }}>
            {label}
        </button>
    );
}
