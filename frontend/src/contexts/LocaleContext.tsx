import { useEffect, useState, type ReactNode } from 'react';
import { LocaleContext } from '../hooks/useLocale';
import {
	isRtlLocale,
	matchBrowserLocale,
	parseExplicitLocaleParam,
	TRANSLATIONS,
	type AppLocale,
} from '../i18n/translations';

export const MANUAL_LOCALE_STORAGE_KEY = 'aegis:locale:manual:v1';
const LEGACY_LOCALE_STORAGE_KEY = 'aegis:locale:v1';

function resolveInitialLocale(): AppLocale {
	if (typeof window !== 'undefined') {
		const urlLang = parseExplicitLocaleParam(new URLSearchParams(window.location.search).get('lang'));
		if (urlLang) return urlLang;
		try {
			const manual = window.localStorage.getItem(MANUAL_LOCALE_STORAGE_KEY);
			const parsedManual = parseExplicitLocaleParam(manual);
			if (parsedManual) return parsedManual;
		} catch {
			// Ignore storage failures
		}
		if (typeof navigator !== 'undefined') {
			const langs = navigator.languages && navigator.languages.length > 0
				? navigator.languages
				: navigator.language
					? [navigator.language]
					: [];
			return matchBrowserLocale(langs);
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
	}, [locale, dir]);

	const setLocale = (next: AppLocale) => {
		setLocaleState(next);
		try {
			window.localStorage.setItem(MANUAL_LOCALE_STORAGE_KEY, next);
			window.localStorage.setItem(LEGACY_LOCALE_STORAGE_KEY, next);
		} catch {
			// Ignore storage failures
		}
	};

	return (
		<LocaleContext.Provider value={{ locale, dir, t: TRANSLATIONS[locale], setLocale }}>
			{children}
		</LocaleContext.Provider>
	);
}
