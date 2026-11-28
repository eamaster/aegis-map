import React from 'react';
import type { InstallPlatform } from '../hooks/usePwaInstall';
import { AegisBrandMark } from './AegisBrandMark';

interface InstallAppModalProps {
	open: boolean;
	platform: InstallPlatform;
	canPromptInstall: boolean;
	isDark: boolean;
	onTriggerNativePrompt: () => void;
	onClose: () => void;
	labels?: {
		title: string;
		subtitle: string;
		iosStep1: string;
		iosStep2: string;
		androidStep: string;
		desktopStep: string;
		notificationsNote: string;
		shortcutNote: string;
		nativePromptBtn: string;
		closeBtn: string;
	};
}

export const InstallAppModal: React.FC<InstallAppModalProps> = ({
	open,
	platform,
	canPromptInstall,
	isDark,
	onTriggerNativePrompt,
	onClose,
	labels,
}) => {
	if (!open) return null;

	const cardCls = isDark
		? 'bg-slate-900 border-slate-700 text-slate-100'
		: 'bg-white border-slate-300 text-slate-900';
	const mutedCls = isDark ? 'text-slate-400' : 'text-slate-600';
	const boxCls = isDark ? 'bg-slate-800/70 border-slate-700/80' : 'bg-slate-50 border-slate-200';

	const copy = labels ?? {
		title: 'Install AegisMap',
		subtitle: 'Keep offline Near me checklists, saved places, and cached pages available directly from your device.',
		iosStep1: '1. Tap the Share button in Safari (square with an upward arrow).',
		iosStep2: '2. Scroll down and choose "Add to Home Screen", then tap Add.',
		androidStep: 'Open your browser menu (⋮) and choose "Install app" or "Add to Home screen".',
		desktopStep: 'Use the install icon in your address bar (Chrome or Edge) or choose Browser Menu → Apps / Save and share → Install AegisMap.',
		notificationsNote: 'Installing the app does not enable warning notifications automatically; opt in separately in Near me → Alert Subscriptions when supported.',
		shortcutNote: 'Browsers manage app shortcuts per OS policy; a separate desktop shortcut is never added silently.',
		nativePromptBtn: 'Install with browser prompt',
		closeBtn: 'Close',
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="install-app-modal-title"
			data-testid="install-instructions-dialog"
		>
			<div className={`w-full max-w-md rounded-xl border shadow-2xl p-5 space-y-4 ${cardCls}`}>
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-center gap-2.5">
						<AegisBrandMark size={28} />
						<div>
							<h2 id="install-app-modal-title" className="text-base font-bold leading-snug">
								{copy.title}
							</h2>
							<p className={`text-xs mt-0.5 ${mutedCls}`}>{copy.subtitle}</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label={copy.closeBtn}
						className={`px-2 py-1 rounded text-xs font-medium cursor-pointer ${
							isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
						}`}
					>
						✕
					</button>
				</div>

				{canPromptInstall && (
					<button
						type="button"
						onClick={onTriggerNativePrompt}
						data-testid="install-native-prompt-btn"
						className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer"
					>
						{copy.nativePromptBtn}
					</button>
				)}

				<div className={`rounded-lg border p-3 text-xs space-y-2 ${boxCls}`}>
					{platform === 'ios' ? (
						<>
							<p>{copy.iosStep1}</p>
							<p>{copy.iosStep2}</p>
						</>
					) : platform === 'android' ? (
						<p>{copy.androidStep}</p>
					) : (
						<p>{copy.desktopStep}</p>
					)}
				</div>

				<div className={`text-[11px] space-y-1 leading-relaxed ${mutedCls}`}>
					<p>• {copy.notificationsNote}</p>
					<p>• {copy.shortcutNote}</p>
				</div>

				<div className="flex justify-end">
					<button
						type="button"
						onClick={onClose}
						data-testid="install-modal-close-btn"
						className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
							isDark
								? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
								: 'border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200'
						}`}
					>
						{copy.closeBtn}
					</button>
				</div>
			</div>
		</div>
	);
};
