import type { ReactNode } from 'react';

/**
 * Isolates LTR values (coordinates, UTC timestamps, phone numbers, codes)
 * inside RTL Persian layouts using `<bdi dir="ltr">` so bidirectional text
 * ordering never scrambles numbers or signs.
 */
export function BdiLtr({
	children,
	className = '',
	mono = false,
}: {
	children: ReactNode;
	className?: string;
	mono?: boolean;
}) {
	return (
		<bdi
			dir="ltr"
			className={`${mono ? 'font-mono tabular-nums' : ''} ${className}`.trim()}
			style={{ unicodeBidi: 'isolate' }}
		>
			{children}
		</bdi>
	);
}
