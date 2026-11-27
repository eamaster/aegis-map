import { createContext, useContext } from 'react';
import type { AppLocale, LocaleStrings } from '../i18n/translations';

export interface LocaleContextType {
	locale: AppLocale;
	dir: 'ltr' | 'rtl';
	t: LocaleStrings;
	setLocale: (locale: AppLocale) => void;
}

export const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

export function useLocale(): LocaleContextType {
	const ctx = useContext(LocaleContext);
	if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
	return ctx;
}
