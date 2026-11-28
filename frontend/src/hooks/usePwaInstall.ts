import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
	readonly platforms?: string[];
	readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	prompt(): Promise<void>;
}

export type InstallPlatform = 'ios' | 'android' | 'desktop';

function detectStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	const matchStandalone =
		typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
	const nav = window.navigator as Navigator & { standalone?: boolean };
	return Boolean(matchStandalone || nav.standalone === true);
}

function detectPlatform(): InstallPlatform {
	if (typeof navigator === 'undefined') return 'desktop';
	const ua = navigator.userAgent || '';
	if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
	if (/Android/i.test(ua)) return 'android';
	return 'desktop';
}

export function usePwaInstall() {
	const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
	const [isInstalledStandalone, setIsInstalledStandalone] = useState<boolean>(() => detectStandalone());
	const [justInstalled, setJustInstalled] = useState(false);
	const [platform] = useState<InstallPlatform>(() => detectPlatform());

	useEffect(() => {
		const updateStandalone = () => setIsInstalledStandalone(detectStandalone());
		const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
		mq?.addEventListener?.('change', updateStandalone);

		const onBeforeInstallPrompt = (e: Event) => {
			e.preventDefault();
			setDeferredPrompt(e as BeforeInstallPromptEvent);
		};
		const onAppInstalled = () => {
			setDeferredPrompt(null);
			setJustInstalled(true);
			setIsInstalledStandalone(true);
		};

		window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
		window.addEventListener('appinstalled', onAppInstalled);
		return () => {
			mq?.removeEventListener?.('change', updateStandalone);
			window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
			window.removeEventListener('appinstalled', onAppInstalled);
		};
	}, []);

	const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
		if (!deferredPrompt) return 'unavailable';
		await deferredPrompt.prompt();
		const choice = await deferredPrompt.userChoice;
		if (choice.outcome === 'accepted') {
			setDeferredPrompt(null);
			setJustInstalled(true);
		}
		return choice.outcome;
	}, [deferredPrompt]);

	return {
		canPromptInstall: deferredPrompt !== null,
		isInstalledStandalone,
		justInstalled,
		platform,
		promptInstall,
	};
}
