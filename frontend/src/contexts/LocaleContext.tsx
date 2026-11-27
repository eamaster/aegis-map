import { useEffect, useState, type ReactNode } from 'react';
import { LocaleContext } from '../hooks/useLocale';
import { isAppLocale, isRtlLocale, TRANSLATIONS, type AppLocale } from '../i18n/translations';

const LOCALE_STORAGE_KEY = 'aegis:locale:v1';

function resolveInitialLocale(): AppLocale {
	if (typeof window !== 'undefined') {
		const urlLang = new URLSearchParams(window.location.search).get('lang');
		if (isAppLocale(urlLang)) return urlLang;
		try {
			const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
			if (isAppLocale(saved)) return saved;
		} catch {
			// Ignore storage failures
		}
	}
	return 'en';
}

export function LocaleProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<AppLocale>(resolveInitialLocale);
	const dir: 'ltr' | 'rtl' = isRtlLocale(locale) ? 'rtl' : 'ltr';

	useEffect(() => {
		document.documentElement.lang = locale;
		document.documentElement.dir = dir;
		try {
			window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
		} catch {
			// Ignore storage failures
		}
	}, [locale, dir]);

	const setLocale = (next: AppLocale) => {
		setLocaleState(next);
	};

	return (
		<LocaleContext.Provider value={{ locale, dir, t: TRANSLATIONS[locale], setLocale }}>
			{children}
		</LocaleContext.Provider>
	);
}
