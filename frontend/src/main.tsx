import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ThemeProvider } from './contexts/ThemeContext';
import { LocaleProvider } from './contexts/LocaleContext';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
	window.addEventListener('load', () => {
		const swUrl = `${import.meta.env.BASE_URL}sw.js`;
		navigator.serviceWorker
			.register(swUrl)
			.then((reg) => {
				if (reg.waiting) {
					reg.waiting.postMessage({ type: 'SKIP_WAITING' });
				}
				reg.addEventListener('updatefound', () => {
					const installing = reg.installing;
					if (!installing) return;
					installing.addEventListener('statechange', () => {
						if (installing.state === 'installed' && navigator.serviceWorker.controller) {
							installing.postMessage({ type: 'SKIP_WAITING' });
						}
					});
				});
				void reg.update().catch(() => {});
			})
			.catch(() => {
				// Best-effort SW registration; app remains functional without SW
			});
	});
}

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<ThemeProvider>
			<LocaleProvider>
				<App />
			</LocaleProvider>
		</ThemeProvider>
	</StrictMode>,
);
