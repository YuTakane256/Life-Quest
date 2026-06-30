import { Gem, Shield, Sword } from 'lucide-react';
import type { EquipmentSlot } from '../../types';

export const SLOT_LABELS: Record<EquipmentSlot, string> = {
    weapon: '武器',
    armor: '防具',
    accessory: 'アクセサリー',
};

export const SLOT_ICONS: Record<EquipmentSlot, React.ReactNode> = {
    weapon: <Sword size={18} />,
    armor: <Shield size={18} />,
    accessory: <Gem size={18} />,
};
