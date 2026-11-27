import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as shared from '../../../shared/contracts';
import * as backendConfig from '../../../backend/src/config';
import { OBSERVATION_WINDOWS, VOLCANO_MODES } from './disasters';

describe('shared API contract drift', () => {
    it('mirrors observation windows, volcano modes, disaster types, and capabilities', () => {
        const sharedPath = path.resolve(__dirname, '../../../shared/contracts.ts');
        expect(fs.existsSync(sharedPath)).toBe(true);
        expect(OBSERVATION_WINDOWS).toEqual(shared.OBSERVATION_WINDOWS);
        expect(VOLCANO_MODES).toEqual(shared.VOLCANO_MODES);
        expect(backendConfig.OBSERVATION_WINDOWS).toEqual(shared.OBSERVATION_WINDOWS);
        expect(backendConfig.VOLCANO_MODES).toEqual(shared.VOLCANO_MODES);
        expect(backendConfig.API_CAPABILITIES).toEqual(shared.API_CAPABILITIES);
        expect(backendConfig.APP_VERSION).toBe(shared.APP_VERSION);
    });
});
