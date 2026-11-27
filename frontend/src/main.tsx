import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ThemeProvider } from './contexts/ThemeContext';
import { LocaleProvider } from './contexts/LocaleContext';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
	window.addEventListener('load', () => {
		const swUrl = `${import.meta.env.BASE_URL}sw.js`;
		navigator.serviceWorker.register(swUrl).catch(() => {
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
