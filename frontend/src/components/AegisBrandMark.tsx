interface AegisBrandMarkProps {
	size?: number;
	className?: string;
}

/**
 * Canonical AegisMap vector brand mark matching public/icons/aegis-mark.svg and
 * all generated PWA/favicon assets.
 */
export function AegisBrandMark({ size = 24, className = '' }: AegisBrandMarkProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 512 512"
			width={size}
			height={size}
			fill="none"
			className={className}
			aria-hidden="true"
		>
			<rect x="24" y="24" width="464" height="464" rx="112" fill="#0b1326" stroke="#3b82f6" strokeWidth="22" />
			<circle cx="256" cy="256" r="142" fill="#172554" fillOpacity="0.72" stroke="#60a5fa" strokeWidth="26" />
			<ellipse cx="256" cy="256" rx="68" ry="142" stroke="#60a5fa" strokeWidth="20" />
			<line x1="118" y1="256" x2="394" y2="256" stroke="#60a5fa" strokeWidth="20" strokeLinecap="round" />
			<path d="M136 184 Q256 218 376 184" stroke="#93c5fd" strokeWidth="18" strokeLinecap="round" />
			<path d="M136 328 Q256 294 376 328" stroke="#93c5fd" strokeWidth="18" strokeLinecap="round" />
			<path d="M98 346 C158 294 282 198 416 146" stroke="#38bdf8" strokeWidth="24" strokeLinecap="round" />
			<circle cx="384" cy="160" r="32" fill="#f97316" stroke="#ffffff" strokeWidth="12" />
		</svg>
	);
}

export default AegisBrandMark;
