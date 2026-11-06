import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OBSERVATION_WINDOWS, VOLCANO_MODES } from './disasters';

describe('disasters API contract drift', () => {
    it('mirrors observation windows and volcano modes defined in backend config', () => {
        const backendConfigPath = path.resolve(__dirname, '../../../backend/src/config.ts');
        expect(fs.existsSync(backendConfigPath)).toBe(true);

        const content = fs.readFileSync(backendConfigPath, 'utf-8');

        // Extract OBSERVATION_WINDOWS = [...] from backend/src/config.ts
        const windowMatch = content.match(/export const OBSERVATION_WINDOWS = \[(.*?)\] as const;/s);
        expect(windowMatch).not.toBeNull();
        const backendWindows = windowMatch![1]
            .split(',')
            .map((s) => s.trim().replace(/['"]/g, ''))
            .filter(Boolean);

        expect(OBSERVATION_WINDOWS).toEqual(backendWindows);

        // Extract VOLCANO_MODES = [...] from backend/src/config.ts
        const volcanoMatch = content.match(/export const VOLCANO_MODES = \[(.*?)\] as const;/s);
        expect(volcanoMatch).not.toBeNull();
        const backendVolcanoModes = volcanoMatch![1]
            .split(',')
            .map((s) => s.trim().replace(/['"]/g, ''))
            .filter(Boolean);

        expect(VOLCANO_MODES).toEqual(backendVolcanoModes);
    });
});
