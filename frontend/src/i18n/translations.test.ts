import { describe, expect, it } from 'vitest';
import {
	matchBrowserLocale,
	parseExplicitLocaleParam,
	selectPreferredWarningTranslationIndex,
	SUPPORTED_LOCALES,
	TRANSLATIONS,
} from './translations';
import { searchOfflineGazetteer } from '../../../shared/gazetteer';

describe('Translations & locale resolution (including zh-Hans)', () => {
	it('maintains complete non-empty key parity across all supported locales', () => {
		const baseKeys = Object.keys(TRANSLATIONS.en).sort();
		for (const loc of SUPPORTED_LOCALES) {
			const keys = Object.keys(TRANSLATIONS[loc]).sort();
			expect(keys).toEqual(baseKeys);
			for (const k of keys) {
				const val = TRANSLATIONS[loc][k as keyof (typeof TRANSLATIONS)['en']];
				expect(typeof val).toBe('string');
				expect(val.trim().length, `${loc}.${k} must be non-empty`).toBeGreaterThan(0);
			}
		}
	});

	it('maps Simplified Chinese browser tags to zh-Hans and falls back Traditional tags to en', () => {
		expect(matchBrowserLocale(['zh-CN', 'en-US'])).toBe('zh-Hans');
		expect(matchBrowserLocale(['zh-SG'])).toBe('zh-Hans');
		expect(matchBrowserLocale(['zh-Hans-CN'])).toBe('zh-Hans');
		expect(matchBrowserLocale(['zh'])).toBe('zh-Hans');

		expect(matchBrowserLocale(['zh-TW', 'en-US'])).toBe('en');
		expect(matchBrowserLocale(['zh-HK'])).toBe('en');
		expect(matchBrowserLocale(['zh-Hant-TW'])).toBe('en');

		expect(matchBrowserLocale(['fa-IR'])).toBe('fa');
		expect(matchBrowserLocale(['ms-MY'])).toBe('ms');
		expect(matchBrowserLocale(['fr-FR'])).toBe('en');
	});

	it('parses explicit locale params accurately', () => {
		expect(parseExplicitLocaleParam('zh-Hans')).toBe('zh-Hans');
		expect(parseExplicitLocaleParam('zh-CN')).toBe('zh-Hans');
		expect(parseExplicitLocaleParam('zh-TW')).toBe('en');
		expect(parseExplicitLocaleParam('fa')).toBe('fa');
		expect(parseExplicitLocaleParam('unknown')).toBeNull();
	});

	it('supports Chinese queries in offline gazetteer and auto-selects Chinese warning blocks when locale is zh-Hans', () => {
		expect(searchOfflineGazetteer('北京')[0]?.id).toBe('cn-beijing');
		expect(searchOfflineGazetteer('吉隆坡')[0]?.id).toBe('my-kl');
		expect(searchOfflineGazetteer('德黑兰')[0]?.id).toBe('ir-tehran');
		expect(searchOfflineGazetteer('奥斯陆')[0]?.id).toBe('no-oslo');

		const blocks = [
			{ language: 'no' },
			{ language: 'en' },
			{ language: 'zh-CN' },
		];
		expect(selectPreferredWarningTranslationIndex(blocks, 'zh-Hans')).toBe(2);
		expect(selectPreferredWarningTranslationIndex(blocks, 'en')).toBe(1);
		expect(selectPreferredWarningTranslationIndex(blocks, 'ms')).toBe(0);
	});
});
