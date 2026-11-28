/**
 * Curated offline worldwide gazetteer for resilient place selection when live
 * geocoding (Open-Meteo) is unreachable, offline, or rate-limited.
 * Covers pilot jurisdictions (MY incl. East Malaysia, NO/SJ incl. coastal & border,
 * IR incl. coastal/provincial hubs, IN states/coastal hubs) and major global cities
 * across all continents and UTC/dateline timezones.
 */

export interface GazetteerEntry {
	id: string;
	name: string;
	localName?: string;
	admin1?: string;
	country: string;
	countryCode: string;
	lat: number;
	lng: number;
	timezone: string;
	aliases?: readonly string[];
}

export const OFFLINE_GAZETTEER: readonly GazetteerEntry[] = [
	// Malaysia (Peninsular, Sabah, Sarawak, Labuan)
	{ id: 'my-kl', name: 'Kuala Lumpur', localName: 'Wilayah Persekutuan Kuala Lumpur', admin1: 'Kuala Lumpur', country: 'Malaysia', countryCode: 'MY', lat: 3.139, lng: 101.6869, timezone: 'Asia/Kuala_Lumpur', aliases: ['kl', '吉隆坡', '马来西亚'] },
	{ id: 'my-putrajaya', name: 'Putrajaya', admin1: 'Putrajaya', country: 'Malaysia', countryCode: 'MY', lat: 2.9264, lng: 101.6964, timezone: 'Asia/Kuala_Lumpur', aliases: ['布城'] },
	{ id: 'my-georgetown', name: 'George Town', admin1: 'Penang', country: 'Malaysia', countryCode: 'MY', lat: 5.4141, lng: 100.3288, timezone: 'Asia/Kuala_Lumpur', aliases: ['penang', 'pulau pinang', '槟城', '乔治市'] },
	{ id: 'my-jb', name: 'Johor Bahru', admin1: 'Johor', country: 'Malaysia', countryCode: 'MY', lat: 1.4927, lng: 103.7414, timezone: 'Asia/Kuala_Lumpur', aliases: ['johor', '新山', '柔佛'] },
	{ id: 'my-kb', name: 'Kota Bharu', admin1: 'Kelantan', country: 'Malaysia', countryCode: 'MY', lat: 6.1254, lng: 102.2381, timezone: 'Asia/Kuala_Lumpur', aliases: ['kelantan', '哥打巴鲁'] },
	{ id: 'my-kt', name: 'Kuala Terengganu', admin1: 'Terengganu', country: 'Malaysia', countryCode: 'MY', lat: 5.3302, lng: 103.1408, timezone: 'Asia/Kuala_Lumpur', aliases: ['terengganu', '瓜拉登嘉楼'] },
	{ id: 'my-kuantan', name: 'Kuantan', admin1: 'Pahang', country: 'Malaysia', countryCode: 'MY', lat: 3.8077, lng: 103.326, timezone: 'Asia/Kuala_Lumpur', aliases: ['pahang', '关丹'] },
	{ id: 'my-ipoh', name: 'Ipoh', admin1: 'Perak', country: 'Malaysia', countryCode: 'MY', lat: 4.5975, lng: 101.0901, timezone: 'Asia/Kuala_Lumpur', aliases: ['perak', '怡保'] },
	{ id: 'my-alorsetar', name: 'Alor Setar', admin1: 'Kedah', country: 'Malaysia', countryCode: 'MY', lat: 6.1248, lng: 100.3678, timezone: 'Asia/Kuala_Lumpur', aliases: ['kedah', 'langkawi', '亚罗士打'] },
	{ id: 'my-melaka', name: 'Melaka', admin1: 'Melaka', country: 'Malaysia', countryCode: 'MY', lat: 2.1896, lng: 102.2501, timezone: 'Asia/Kuala_Lumpur', aliases: ['malacca', '马六甲'] },
	{ id: 'my-kk', name: 'Kota Kinabalu', admin1: 'Sabah', country: 'Malaysia', countryCode: 'MY', lat: 5.9804, lng: 116.0735, timezone: 'Asia/Kuching', aliases: ['sabah', 'kk', '亚庇', '哥打京那巴鲁', '沙巴'] },
	{ id: 'my-sandakan', name: 'Sandakan', admin1: 'Sabah', country: 'Malaysia', countryCode: 'MY', lat: 5.8402, lng: 118.1179, timezone: 'Asia/Kuching', aliases: ['山打根'] },
	{ id: 'my-tawau', name: 'Tawau', admin1: 'Sabah', country: 'Malaysia', countryCode: 'MY', lat: 4.2448, lng: 117.8912, timezone: 'Asia/Kuching', aliases: ['斗湖'] },
	{ id: 'my-kuching', name: 'Kuching', admin1: 'Sarawak', country: 'Malaysia', countryCode: 'MY', lat: 1.5533, lng: 110.3592, timezone: 'Asia/Kuching', aliases: ['sarawak', '古晋', '砂拉越'] },
	{ id: 'my-miri', name: 'Miri', admin1: 'Sarawak', country: 'Malaysia', countryCode: 'MY', lat: 4.3995, lng: 113.9914, timezone: 'Asia/Kuching', aliases: ['美里'] },
	{ id: 'my-labuan', name: 'Labuan', admin1: 'Labuan', country: 'Malaysia', countryCode: 'MY', lat: 5.2831, lng: 115.2308, timezone: 'Asia/Kuching', aliases: ['纳闽'] },

	// Norway & Svalbard (Mainland, Coastal, Border, Arctic)
	{ id: 'no-oslo', name: 'Oslo', admin1: 'Oslo', country: 'Norway', countryCode: 'NO', lat: 59.9139, lng: 10.7522, timezone: 'Europe/Oslo', aliases: ['奥斯陆', '挪威'] },
	{ id: 'no-bergen', name: 'Bergen', admin1: 'Vestland', country: 'Norway', countryCode: 'NO', lat: 60.3913, lng: 5.3221, timezone: 'Europe/Oslo', aliases: ['vestland', '卑尔根'] },
	{ id: 'no-stavanger', name: 'Stavanger', admin1: 'Rogaland', country: 'Norway', countryCode: 'NO', lat: 58.97, lng: 5.7331, timezone: 'Europe/Oslo', aliases: ['rogaland', '斯塔万格'] },
	{ id: 'no-trondheim', name: 'Trondheim', admin1: 'Trøndelag', country: 'Norway', countryCode: 'NO', lat: 63.4305, lng: 10.3951, timezone: 'Europe/Oslo', aliases: ['trondelag', '特隆赫姆'] },
	{ id: 'no-bodo', name: 'Bodø', localName: 'Bodø', admin1: 'Nordland', country: 'Norway', countryCode: 'NO', lat: 67.2804, lng: 14.4049, timezone: 'Europe/Oslo', aliases: ['bodo', 'nordland', '博德'] },
	{ id: 'no-tromso', name: 'Tromsø', localName: 'Tromsø', admin1: 'Troms', country: 'Norway', countryCode: 'NO', lat: 69.6492, lng: 18.9553, timezone: 'Europe/Oslo', aliases: ['tromso', 'troms', '特罗姆瑟'] },
	{ id: 'no-kirkenes', name: 'Kirkenes', admin1: 'Finnmark', country: 'Norway', countryCode: 'NO', lat: 69.7271, lng: 30.0458, timezone: 'Europe/Oslo', aliases: ['finnmark', 'border'] },
	{ id: 'no-halden', name: 'Halden', admin1: 'Østfold', country: 'Norway', countryCode: 'NO', lat: 59.1248, lng: 11.3875, timezone: 'Europe/Oslo', aliases: ['ostfold', 'border'] },
	{ id: 'no-alesund', name: 'Ålesund', admin1: 'Møre og Romsdal', country: 'Norway', countryCode: 'NO', lat: 62.4722, lng: 6.1495, timezone: 'Europe/Oslo', aliases: ['alesund'] },
	{ id: 'sj-longyearbyen', name: 'Longyearbyen', admin1: 'Svalbard', country: 'Svalbard and Jan Mayen', countryCode: 'SJ', lat: 78.2232, lng: 15.6267, timezone: 'Arctic/Longyearbyen', aliases: ['svalbard', '斯瓦尔巴'] },

	// Iran (Interior & Coastal Provinces)
	{ id: 'ir-tehran', name: 'Tehran', localName: 'تهران', admin1: 'Tehran', country: 'Iran', countryCode: 'IR', lat: 35.6892, lng: 51.389, timezone: 'Asia/Tehran', aliases: ['تهران', '德黑兰', '伊朗'] },
	{ id: 'ir-mashhad', name: 'Mashhad', localName: 'مشهد', admin1: 'Razavi Khorasan', country: 'Iran', countryCode: 'IR', lat: 36.2605, lng: 59.6168, timezone: 'Asia/Tehran', aliases: ['مشهد', '马什哈德'] },
	{ id: 'ir-isfahan', name: 'Isfahan', localName: 'اصفهان', admin1: 'Isfahan', country: 'Iran', countryCode: 'IR', lat: 32.6539, lng: 51.666, timezone: 'Asia/Tehran', aliases: ['اصفهان', 'esfahan', '伊斯法罕'] },
	{ id: 'ir-shiraz', name: 'Shiraz', localName: 'شیراز', admin1: 'Fars', country: 'Iran', countryCode: 'IR', lat: 29.5918, lng: 52.5837, timezone: 'Asia/Tehran', aliases: ['شیراز', '设拉子'] },
	{ id: 'ir-tabriz', name: 'Tabriz', localName: 'تبریز', admin1: 'East Azerbaijan', country: 'Iran', countryCode: 'IR', lat: 38.0962, lng: 46.2738, timezone: 'Asia/Tehran', aliases: ['تبریز', '大不里士'] },
	{ id: 'ir-bandarabbas', name: 'Bandar Abbas', localName: 'بندرعباس', admin1: 'Hormozgan', country: 'Iran', countryCode: 'IR', lat: 27.1832, lng: 56.2666, timezone: 'Asia/Tehran', aliases: ['بندرعباس', 'hormozgan', '阿巴斯港'] },
	{ id: 'ir-bushehr', name: 'Bushehr', localName: 'بوشهر', admin1: 'Bushehr', country: 'Iran', countryCode: 'IR', lat: 28.9234, lng: 50.8203, timezone: 'Asia/Tehran', aliases: ['بوشهر', '布什尔'] },
	{ id: 'ir-ahvaz', name: 'Ahvaz', localName: 'اهواز', admin1: 'Khuzestan', country: 'Iran', countryCode: 'IR', lat: 31.3183, lng: 48.6706, timezone: 'Asia/Tehran', aliases: ['اهواز', 'khuzestan', '阿瓦士'] },
	{ id: 'ir-rasht', name: 'Rasht', localName: 'رشت', admin1: 'Gilan', country: 'Iran', countryCode: 'IR', lat: 37.2808, lng: 49.5832, timezone: 'Asia/Tehran', aliases: ['رشت', 'gilan', '拉什特'] },
	{ id: 'ir-chabahar', name: 'Chabahar', localName: 'چابهار', admin1: 'Sistan and Baluchestan', country: 'Iran', countryCode: 'IR', lat: 25.2919, lng: 60.643, timezone: 'Asia/Tehran', aliases: ['چابهار', '恰巴哈尔'] },

	// India (Metro, Coastal, Mountain, Northeast)
	{ id: 'in-delhi', name: 'New Delhi', admin1: 'Delhi', country: 'India', countryCode: 'IN', lat: 28.6139, lng: 77.209, timezone: 'Asia/Kolkata', aliases: ['delhi', '新德里', '德里', '印度'] },
	{ id: 'in-mumbai', name: 'Mumbai', admin1: 'Maharashtra', country: 'India', countryCode: 'IN', lat: 19.076, lng: 72.8777, timezone: 'Asia/Kolkata', aliases: ['bombay', '孟买'] },
	{ id: 'in-chennai', name: 'Chennai', admin1: 'Tamil Nadu', country: 'India', countryCode: 'IN', lat: 13.0827, lng: 80.2707, timezone: 'Asia/Kolkata', aliases: ['tamil nadu', '钦奈'] },
	{ id: 'in-kolkata', name: 'Kolkata', admin1: 'West Bengal', country: 'India', countryCode: 'IN', lat: 22.5726, lng: 88.3639, timezone: 'Asia/Kolkata', aliases: ['west bengal', '加尔各答'] },
	{ id: 'in-bengaluru', name: 'Bengaluru', admin1: 'Karnataka', country: 'India', countryCode: 'IN', lat: 12.9716, lng: 77.5946, timezone: 'Asia/Kolkata', aliases: ['bangalore', '班加罗尔'] },
	{ id: 'in-panaji', name: 'Panaji', admin1: 'Goa', country: 'India', countryCode: 'IN', lat: 15.4909, lng: 73.8278, timezone: 'Asia/Kolkata', aliases: ['goa', '帕纳吉', '果阿'] },
	{ id: 'in-kochi', name: 'Kochi', admin1: 'Kerala', country: 'India', countryCode: 'IN', lat: 9.9312, lng: 76.2673, timezone: 'Asia/Kolkata', aliases: ['kerala', '科契'] },
	{ id: 'in-bhubaneswar', name: 'Bhubaneswar', admin1: 'Odisha', country: 'India', countryCode: 'IN', lat: 20.2961, lng: 85.8245, timezone: 'Asia/Kolkata', aliases: ['odisha', '布巴内斯瓦尔'] },
	{ id: 'in-guwahati', name: 'Guwahati', admin1: 'Assam', country: 'India', countryCode: 'IN', lat: 26.1445, lng: 91.7362, timezone: 'Asia/Kolkata', aliases: ['assam', '古瓦哈提'] },

	// China & East Asia (Chinese & English search aliases)
	{ id: 'cn-beijing', name: 'Beijing', localName: '北京', admin1: 'Beijing', country: 'China', countryCode: 'CN', lat: 39.9042, lng: 116.4074, timezone: 'Asia/Shanghai', aliases: ['北京', '中国', 'peking'] },
	{ id: 'cn-shanghai', name: 'Shanghai', localName: '上海', admin1: 'Shanghai', country: 'China', countryCode: 'CN', lat: 31.2304, lng: 121.4737, timezone: 'Asia/Shanghai', aliases: ['上海', '中国'] },
	{ id: 'cn-guangzhou', name: 'Guangzhou', localName: '广州', admin1: 'Guangdong', country: 'China', countryCode: 'CN', lat: 23.1291, lng: 113.2644, timezone: 'Asia/Shanghai', aliases: ['广州', '广东', 'canton'] },
	{ id: 'cn-shenzhen', name: 'Shenzhen', localName: '深圳', admin1: 'Guangdong', country: 'China', countryCode: 'CN', lat: 22.5431, lng: 114.0579, timezone: 'Asia/Shanghai', aliases: ['深圳', '广东'] },
	{ id: 'cn-chengdu', name: 'Chengdu', localName: '成都', admin1: 'Sichuan', country: 'China', countryCode: 'CN', lat: 30.5728, lng: 104.0668, timezone: 'Asia/Shanghai', aliases: ['成都', '四川'] },
	{ id: 'hk-hongkong', name: 'Hong Kong', localName: '香港', admin1: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK', lat: 22.3193, lng: 114.1694, timezone: 'Asia/Hong_Kong', aliases: ['香港', 'hk'] },
	{ id: 'tw-taipei', name: 'Taipei', localName: '台北', admin1: 'Taipei', country: 'Taiwan', countryCode: 'TW', lat: 25.033, lng: 121.5654, timezone: 'Asia/Taipei', aliases: ['台北', '臺北'] },

	// Ambiguous names & Global coverage (including UTC±12/dateline)
	{ id: 'gy-georgetown', name: 'Georgetown', admin1: 'Demerara-Mahaica', country: 'Guyana', countryCode: 'GY', lat: 6.8013, lng: -58.1551, timezone: 'America/Guyana', aliases: ['乔治敦'] },
	{ id: 'us-georgetown', name: 'Georgetown', admin1: 'Texas', country: 'United States', countryCode: 'US', lat: 30.6333, lng: -97.6772, timezone: 'America/Chicago' },
	{ id: 'us-la', name: 'Los Angeles', admin1: 'California', country: 'United States', countryCode: 'US', lat: 34.0522, lng: -118.2437, timezone: 'America/Los_Angeles', aliases: ['california', 'la', '洛杉矶', '美国'] },
	{ id: 'us-nyc', name: 'New York', admin1: 'New York', country: 'United States', countryCode: 'US', lat: 40.7128, lng: -74.006, timezone: 'America/New_York', aliases: ['nyc', '纽约', '美国'] },
	{ id: 'us-honolulu', name: 'Honolulu', admin1: 'Hawaii', country: 'United States', countryCode: 'US', lat: 21.3069, lng: -157.8583, timezone: 'Pacific/Honolulu', aliases: ['hawaii', '檀香山', '火奴鲁鲁'] },
	{ id: 'ca-vancouver', name: 'Vancouver', admin1: 'British Columbia', country: 'Canada', countryCode: 'CA', lat: 49.2827, lng: -123.1207, timezone: 'America/Vancouver', aliases: ['温哥华', '加拿大'] },
	{ id: 'br-manaus', name: 'Manaus', admin1: 'Amazonas', country: 'Brazil', countryCode: 'BR', lat: -3.119, lng: -60.0217, timezone: 'America/Manaus', aliases: ['马瑙斯', '巴西'] },
	{ id: 'cl-santiago', name: 'Santiago', admin1: 'Santiago Metropolitan', country: 'Chile', countryCode: 'CL', lat: -33.4489, lng: -70.6693, timezone: 'America/Santiago', aliases: ['圣地亚哥', '智利'] },
	{ id: 'gb-london', name: 'London', admin1: 'England', country: 'United Kingdom', countryCode: 'GB', lat: 51.5074, lng: -0.1278, timezone: 'Europe/London', aliases: ['伦敦', '英国'] },
	{ id: 'fr-paris', name: 'Paris', admin1: 'Île-de-France', country: 'France', countryCode: 'FR', lat: 48.8566, lng: 2.3522, timezone: 'Europe/Paris', aliases: ['巴黎', '法国'] },
	{ id: 'tr-istanbul', name: 'Istanbul', admin1: 'Istanbul', country: 'Turkey', countryCode: 'TR', lat: 41.0082, lng: 28.9784, timezone: 'Europe/Istanbul', aliases: ['伊斯坦布尔', '土耳其'] },
	{ id: 'eg-cairo', name: 'Cairo', admin1: 'Cairo', country: 'Egypt', countryCode: 'EG', lat: 30.0444, lng: 31.2357, timezone: 'Africa/Cairo', aliases: ['开罗', '埃及'] },
	{ id: 'ke-nairobi', name: 'Nairobi', admin1: 'Nairobi', country: 'Kenya', countryCode: 'KE', lat: -1.2921, lng: 36.8219, timezone: 'Africa/Nairobi', aliases: ['内罗毕', '肯尼亚'] },
	{ id: 'za-capetown', name: 'Cape Town', admin1: 'Western Cape', country: 'South Africa', countryCode: 'ZA', lat: -33.9249, lng: 18.4241, timezone: 'Africa/Johannesburg', aliases: ['开普敦', '南非'] },
	{ id: 'sg-singapore', name: 'Singapore', admin1: 'Singapore', country: 'Singapore', countryCode: 'SG', lat: 1.3521, lng: 103.8198, timezone: 'Asia/Singapore', aliases: ['新加坡'] },
	{ id: 'id-jakarta', name: 'Jakarta', admin1: 'Jakarta', country: 'Indonesia', countryCode: 'ID', lat: -6.2088, lng: 106.8456, timezone: 'Asia/Jakarta', aliases: ['雅加达', '印尼', '印度尼西亚'] },
	{ id: 'ph-manila', name: 'Manila', admin1: 'Metro Manila', country: 'Philippines', countryCode: 'PH', lat: 14.5995, lng: 120.9842, timezone: 'Asia/Manila', aliases: ['马尼拉', '菲律宾'] },
	{ id: 'jp-tokyo', name: 'Tokyo', admin1: 'Tokyo', country: 'Japan', countryCode: 'JP', lat: 35.6762, lng: 139.6503, timezone: 'Asia/Tokyo', aliases: ['东京', '日本'] },
	{ id: 'au-sydney', name: 'Sydney', admin1: 'New South Wales', country: 'Australia', countryCode: 'AU', lat: -33.8688, lng: 151.2093, timezone: 'Australia/Sydney', aliases: ['悉尼', '澳大利亚'] },
	{ id: 'nz-auckland', name: 'Auckland', admin1: 'Auckland', country: 'New Zealand', countryCode: 'NZ', lat: -36.8485, lng: 174.7633, timezone: 'Pacific/Auckland', aliases: ['奥克兰', '新西兰'] },
	{ id: 'fj-suva', name: 'Suva', admin1: 'Central', country: 'Fiji', countryCode: 'FJ', lat: -18.1416, lng: 178.4419, timezone: 'Pacific/Fiji', aliases: ['dateline', '苏瓦', '斐济'] },
	{ id: 'ws-apia', name: 'Apia', admin1: 'Tuamasaga', country: 'Samoa', countryCode: 'WS', lat: -13.8507, lng: -171.7514, timezone: 'Pacific/Apia', aliases: ['dateline', '阿皮亚', '萨摩亚'] },
];

export function searchOfflineGazetteer(query: string, limit = 8): GazetteerEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return OFFLINE_GAZETTEER.slice(0, limit);
	const scored: Array<{ entry: GazetteerEntry; score: number }> = [];
	for (const entry of OFFLINE_GAZETTEER) {
		const name = entry.name.toLowerCase();
		const local = (entry.localName ?? '').toLowerCase();
		const admin = (entry.admin1 ?? '').toLowerCase();
		const country = entry.country.toLowerCase();
		const cc = entry.countryCode.toLowerCase();
		const aliases = (entry.aliases ?? []).map((a) => a.toLowerCase());

		let score = 0;
		if (name === q || local === q || cc === q || aliases.includes(q)) score = 100;
		else if (name.startsWith(q) || local.startsWith(q)) score = 80;
		else if (aliases.some((a) => a.startsWith(q))) score = 70;
		else if (name.includes(q) || local.includes(q) || admin.includes(q) || country.includes(q)) score = 50;
		else if (aliases.some((a) => a.includes(q))) score = 40;

		if (score > 0) scored.push({ entry, score });
	}
	scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
	return scored.slice(0, limit).map((s) => s.entry);
}

/** Infer an approximate country code from coordinates using closest gazetteer anchor within 5° when explicit code is absent. */
export function inferNearestGazetteerCountry(lat: number, lng: number, maxDeg = 4.5): GazetteerEntry | null {
	let best: GazetteerEntry | null = null;
	let bestDistSq = maxDeg * maxDeg;
	for (const entry of OFFLINE_GAZETTEER) {
		const dLat = entry.lat - lat;
		let dLng = entry.lng - lng;
		if (dLng > 180) dLng -= 360;
		if (dLng < -180) dLng += 360;
		const distSq = dLat * dLat + dLng * dLng;
		if (distSq <= bestDistSq) {
			bestDistSq = distSq;
			best = entry;
		}
	}
	return best;
}
