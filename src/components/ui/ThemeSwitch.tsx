import { Segmented } from './Chip';
import { getThemeMode, setThemeMode, type ThemeMode } from '../../utils/theme';

const OPTIONS: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: 'Светлая' },
    { value: 'dark', label: 'Тёмная' },
    { value: 'system', label: 'Авто' },
];

/** Переключатель темы. Страница перезагрузится — несохранённое лучше сохранить до этого. */
export function ThemeSwitch() {
    return (
        <Segmented<ThemeMode>
            aria-label="Тема оформления"
            options={OPTIONS}
            value={getThemeMode()}
            onChange={setThemeMode}
        />
    );
}
