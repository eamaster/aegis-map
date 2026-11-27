/**
 * Emergency Contact & Authority Shelter Directory.
 * Cross-checked against ITU-T E.161.1 / national emergency directory documentation.
 * Always resolved strictly for the user's CONFIRMED PRESENT jurisdiction,
 * never silently switched to the remote monitored location.
 */

export interface EmergencyServiceNumber {
	label: string;
	number: string;
	notes: string;
}

export interface AuthorityHelpLink {
	label: string;
	url: string;
}

export interface JurisdictionEmergencyProfile {
	countryCode: string;
	countryName: string;
	verified: boolean;
	verificationSource: string;
	numbers: readonly EmergencyServiceNumber[];
	authorityLinks: readonly AuthorityHelpLink[];
	guidanceNote: string;
}

export const EMERGENCY_CONTACTS_BY_COUNTRY: Readonly<Record<string, JurisdictionEmergencyProfile>> = {
	MY: {
		countryCode: 'MY',
		countryName: 'Malaysia',
		verified: true,
		verificationSource: 'MERS 999 Malaysia / ITU National Numbering Plan',
		numbers: [
			{ label: 'Police / Ambulance / Fire / Civil Defence (MERS)', number: '999', notes: 'National single emergency number (Peninsular, Sabah, Sarawak, Labuan)' },
			{ label: 'Mobile Emergency Redirect (ITU GSM)', number: '112', notes: 'Redirects to 999 from mobile networks' },
		],
		authorityLinks: [
			{ label: 'NADMA Malaysia (National Disaster Management Agency)', url: 'https://www.nadma.gov.my/' },
			{ label: 'MET Malaysia Official Portal', url: 'https://www.met.gov.my/' },
			{ label: 'Public InfoBanjir (Flood Levels)', url: 'https://publicinfobanjir.water.gov.my/' },
		],
		guidanceNote: 'Dial 999 (or 112 on mobile) for life-threatening emergencies anywhere in Malaysia.',
	},
	NO: {
		countryCode: 'NO',
		countryName: 'Norway',
		verified: true,
		verificationSource: 'Nkom / Kriseinfo.no / ITU E.161.1',
		numbers: [
			{ label: 'Fire & Rescue (Brann)', number: '110', notes: 'Norwegian fire and rescue dispatch' },
			{ label: 'Police (Politi)', number: '112', notes: 'Police emergency & pan-European 112' },
			{ label: 'Medical Emergency (Ambulanse)', number: '113', notes: 'AMK medical emergency dispatch' },
		],
		authorityLinks: [
			{ label: 'Kriseinfo.no (Norwegian Directorate for Civil Protection — DSB)', url: 'https://www.kriseinfo.no/' },
			{ label: 'Varsom.no (Flood, Avalanche & Landslide Warnings)', url: 'https://www.varsom.no/' },
			{ label: 'Yr / MET Norway Weather Warnings', url: 'https://www.met.no/' },
		],
		guidanceNote: 'Use 110 (Fire), 112 (Police), or 113 (Medical) across mainland and coastal Norway.',
	},
	SJ: {
		countryCode: 'SJ',
		countryName: 'Svalbard and Jan Mayen (Norway)',
		verified: true,
		verificationSource: 'Sysselmesteren på Svalbard / Nkom',
		numbers: [
			{ label: 'Police / Governor of Svalbard Rescue', number: '112', notes: 'Primary emergency coordination on Svalbard' },
			{ label: 'Fire & Rescue', number: '110', notes: 'Fire emergency' },
			{ label: 'Medical Emergency', number: '113', notes: 'Longyearbyen Hospital / AMK' },
		],
		authorityLinks: [
			{ label: 'Governor of Svalbard (Sysselmesteren)', url: 'https://www.sysselmesteren.no/en/' },
			{ label: 'Varsom.no Svalbard Avalanche Warnings', url: 'https://www.varsom.no/en/svalbard/' },
		],
		guidanceNote: 'Emergency coordination in Svalbard routes through the Governor of Svalbard (112).',
	},
	IR: {
		countryCode: 'IR',
		countryName: 'Iran',
		verified: true,
		verificationSource: 'National Emergency Organization / ITU Directory',
		numbers: [
			{ label: 'Medical Emergency (اورژانس)', number: '115', notes: 'National pre-hospital medical emergency' },
			{ label: 'Fire Department (آتش‌نشانی)', number: '125', notes: 'Municipal fire & rescue' },
			{ label: 'Police (پلیس)', number: '110', notes: 'National police dispatch' },
			{ label: 'Red Crescent Relief (هلال احمر)', number: '112', notes: 'Disaster, mountain & road relief' },
		],
		authorityLinks: [
			{ label: 'Iranian Red Crescent Society (RCS)', url: 'https://www.rcs.ir/' },
			{ label: 'IRIMO Official Portal', url: 'https://www.irimo.ir/' },
		],
		guidanceNote: 'In Iran use 115 (Medical), 125 (Fire), 110 (Police), or 112 (Red Crescent Relief).',
	},
	IN: {
		countryCode: 'IN',
		countryName: 'India',
		verified: true,
		verificationSource: 'Ministry of Home Affairs ERSS 112 / NDMA / ITU',
		numbers: [
			{ label: 'Unified Emergency Response (ERSS)', number: '112', notes: 'All-in-one Police, Fire & Medical across India' },
			{ label: 'NDMA Disaster Helpline', number: '1078', notes: 'National / State disaster management helpline (1070 in some states)' },
			{ label: 'Ambulance / Medical', number: '108', notes: 'Emergency ambulance service (also 102)' },
			{ label: 'Fire', number: '101', notes: 'Fire brigade' },
			{ label: 'Police', number: '100', notes: 'Police control room' },
		],
		authorityLinks: [
			{ label: 'NDMA India (National Disaster Management Authority)', url: 'https://ndma.gov.in/' },
			{ label: 'SACHET National Disaster Alert Portal', url: 'https://sachet.ndma.gov.in/' },
		],
		guidanceNote: 'Dial 112 (ERSS) anywhere in India, or 1078 / 1070 for disaster management helplines.',
	},
	US: {
		countryCode: 'US',
		countryName: 'United States',
		verified: true,
		verificationSource: 'FCC / ITU E.161.1',
		numbers: [{ label: 'Emergency (Police / Fire / Ambulance)', number: '911', notes: 'US national emergency number' }],
		authorityLinks: [{ label: 'Ready.gov / FEMA', url: 'https://www.ready.gov/' }],
		guidanceNote: 'Dial 911 for immediate life-safety emergencies in the United States.',
	},
	GB: {
		countryCode: 'GB',
		countryName: 'United Kingdom',
		verified: true,
		verificationSource: 'UK Gov / ITU E.161.1',
		numbers: [
			{ label: 'Emergency Services', number: '999', notes: 'UK emergency services' },
			{ label: 'European / Mobile Emergency', number: '112', notes: 'Equivalent to 999' },
		],
		authorityLinks: [{ label: 'GOV.UK Preparing for Emergencies', url: 'https://prepare.campaign.gov.uk/' }],
		guidanceNote: 'Dial 999 or 112 in the United Kingdom.',
	},
	AU: {
		countryCode: 'AU',
		countryName: 'Australia',
		verified: true,
		verificationSource: 'Triple Zero (000) / ITU',
		numbers: [
			{ label: 'Police / Fire / Ambulance', number: '000', notes: 'Australian national emergency number' },
			{ label: 'GSM Mobile Redirect', number: '112', notes: 'Redirects to 000 on mobile networks' },
		],
		authorityLinks: [{ label: 'Australian Bureau of Meteorology Warnings', url: 'https://www.bom.gov.au/warnings/' }],
		guidanceNote: 'Dial 000 (or 112 on mobile) in Australia.',
	},
	SG: {
		countryCode: 'SG',
		countryName: 'Singapore',
		verified: true,
		verificationSource: 'SPF / SCDF / ITU',
		numbers: [
			{ label: 'Police', number: '999', notes: 'Singapore Police Force' },
			{ label: 'Ambulance & Fire (SCDF)', number: '995', notes: 'Singapore Civil Defence Force' },
		],
		authorityLinks: [{ label: 'Singapore Civil Defence Force (SCDF)', url: 'https://www.scdf.gov.sg/' }],
		guidanceNote: 'Dial 999 for Police or 995 for Ambulance/Fire in Singapore.',
	},
};

export function resolveEmergencyProfile(countryCode: string | null | undefined): JurisdictionEmergencyProfile {
	const cc = (countryCode ?? '').trim().toUpperCase();
	if (cc && EMERGENCY_CONTACTS_BY_COUNTRY[cc]) {
		return EMERGENCY_CONTACTS_BY_COUNTRY[cc];
	}
	return {
		countryCode: cc || 'UNSPECIFIED',
		countryName: cc || 'Unspecified Jurisdiction',
		verified: false,
		verificationSource: 'ITU-T E.161.1 international fallback (local directory not yet verified)',
		numbers: [
			{ label: 'ITU International Mobile Emergency', number: '112', notes: 'Supported on GSM/LTE mobile networks in many regions — confirm locally' },
			{ label: 'North America / Regional Standard', number: '911', notes: 'Confirm whether 911 or a national number applies in your country' },
		],
		authorityLinks: [
			{ label: 'WMO Severe Weather Information Centre', url: 'https://severeweather.wmo.int/' },
		],
		guidanceNote: 'Local emergency numbers for this jurisdiction have not been individually verified in AegisMap. Confirm your country above or contact local authorities directly.',
	};
}
