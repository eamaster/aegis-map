/**
 * Resident & Researcher UI Translations: English (en, LTR), Persian (fa, RTL), Malay (ms, LTR).
 * Official warning bulletin text is NEVER machine-translated here; bulletin language is
 * explicitly tagged and kept separate from interface language.
 */

export const SUPPORTED_LOCALES = ['en', 'fa', 'ms'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export interface LocaleStrings {
	appTitle: string;
	skipToMain: string;
	navNearMe: string;
	navExploreEvents: string;
	languageLabel: string;
	nearMeTitle: string;
	nearMeSubtitle: string;
	searchPlaceLabel: string;
	searchPlacePlaceholder: string;
	searchButton: string;
	useGpsButton: string;
	manualCoordsLabel: string;
	manualCoordsPlaceholder: string;
	applyCoordsButton: string;
	jurisdictionLabel: string;
	jurisdictionAuto: string;
	savedPlacesHeading: string;
	saveCurrentPlace: string;
	removePlace: string;
	noSavedPlaces: string;
	offlineSearchNotice: string;
	gpsStatusDenied: string;
	gpsStatusTimeout: string;
	gpsStatusUnavailable: string;
	gpsStatusLowAccuracy: string;
	gpsAccuracyLabel: string;
	offlineFirstVisit: string;
	offlineCachedNotice: string;
	offlineExpiredNotice: string;
	clearLocalData: string;
	clearLocalDataConfirm: string;
	warningsSectionTitle: string;
	bulletinLanguageNote: string;
	interfaceLanguageTag: string;
	bulletinLanguageTag: string;
	originalBulletinLink: string;
	issuerInstructionsHeading: string;
	affectedAreaHeading: string;
	issuedLabel: string;
	onsetLabel: string;
	expiresLabel: string;
	lastCheckedLabel: string;
	helpSectionTitle: string;
	presentJurisdictionLabel: string;
	presentJurisdictionHint: string;
	copyLocationButton: string;
	shareLocationButton: string;
	handoffDisclaimer: string;
	researchNoticeTitle: string;
	researchNoticeBody: string;
	openExploreEvents: string;
	coverageActive: string;
	coverageEmpty: string;
	coveragePartial: string;
	coverageStale: string;
	coverageUnavailable: string;
	coverageUnsupported: string;
	refreshWarnings: string;
}

export const TRANSLATIONS: Record<AppLocale, LocaleStrings> = {
	en: {
		appTitle: 'AegisMap',
		skipToMain: 'Skip to main content',
		navNearMe: 'Near me',
		navExploreEvents: 'Explore events',
		languageLabel: 'Interface language',
		nearMeTitle: 'Local Official Warnings & Help',
		nearMeSubtitle: 'Text-first resident safety view. Works without interactive map or AI.',
		searchPlaceLabel: 'Search city, town, or district',
		searchPlacePlaceholder: 'e.g., Kota Kinabalu, Bergen, Tehran, Panaji',
		searchButton: 'Search',
		useGpsButton: 'Use GPS',
		manualCoordsLabel: 'Or enter coordinates (lat, lng)',
		manualCoordsPlaceholder: 'e.g., 5.9804, 116.0735 or 59.91N 10.75E',
		applyCoordsButton: 'Set coordinates',
		jurisdictionLabel: 'Monitored country/authority',
		jurisdictionAuto: 'Auto from selected place',
		savedPlacesHeading: 'Saved places (stored only on this device)',
		saveCurrentPlace: 'Save place',
		removePlace: 'Delete',
		noSavedPlaces: 'No saved places yet. Select or enter a place to save it locally.',
		offlineSearchNotice: 'Live place search unavailable — showing built-in offline directory matches.',
		gpsStatusDenied: 'GPS permission was denied. Select a place or enter coordinates manually.',
		gpsStatusTimeout: 'GPS request timed out. Enter coordinates or pick a place manually.',
		gpsStatusUnavailable: 'GPS is unavailable in this browser. Enter coordinates or pick a place manually.',
		gpsStatusLowAccuracy: 'GPS accuracy is coarse (>5 km). Verify your city or edit coordinates manually.',
		gpsAccuracyLabel: 'Location accuracy',
		offlineFirstVisit: 'You are offline and no warnings have been cached for this place yet.',
		offlineCachedNotice: 'Offline mode: showing the last retrieved public notice snapshot.',
		offlineExpiredNotice: 'Cached notice has passed its expiry time — verify when back online.',
		clearLocalData: 'Remove all local data',
		clearLocalDataConfirm: 'Local saved places and cached notices removed from this device.',
		warningsSectionTitle: 'Official Authority Warnings',
		bulletinLanguageNote: 'Official issuer text is shown verbatim in its published language.',
		interfaceLanguageTag: 'UI language',
		bulletinLanguageTag: 'Bulletin language',
		originalBulletinLink: 'Open original official bulletin',
		issuerInstructionsHeading: 'Official Instructions',
		affectedAreaHeading: 'Affected Area',
		issuedLabel: 'Issued',
		onsetLabel: 'Onset',
		expiresLabel: 'Expires',
		lastCheckedLabel: 'Last checked',
		helpSectionTitle: 'Emergency Contacts & Share Location',
		presentJurisdictionLabel: 'Confirmed present location for emergency numbers',
		presentJurisdictionHint: 'Emergency numbers match your confirmed present country, separate from the place you are monitoring.',
		copyLocationButton: 'Copy location card',
		shareLocationButton: 'Share location',
		handoffDisclaimer: 'Opening your phone dialer, SMS, or share sheet hands off to your device. AegisMap does not transmit requests to responders or confirm responder acceptance.',
		researchNoticeTitle: 'Satellite & Sensor Observations (Research Only)',
		researchNoticeBody: 'Thermal hotspots, predicted satellite passes, and AI metadata notes are research aids — never official evacuation instructions.',
		openExploreEvents: 'Open Explore events map',
		coverageActive: 'Active Official Warnings',
		coverageEmpty: 'Successfully Checked — No Active Warnings',
		coveragePartial: 'Partial Coverage — Some Sources Unavailable',
		coverageStale: 'Stale Snapshot — Using Last Successful Check',
		coverageUnavailable: 'Official Warning Source Unavailable',
		coverageUnsupported: 'Authority Feed Unsupported Here',
		refreshWarnings: 'Refresh warnings',
	},
	fa: {
		appTitle: 'AegisMap',
		skipToMain: 'رفتن به محتوای اصلی',
		navNearMe: 'اطراف من',
		navExploreEvents: 'کاوش رویدادها',
		languageLabel: 'زبان رابط کاربری',
		nearMeTitle: 'هشدارهای رسمی محلی و کمک فوری',
		nearMeSubtitle: 'نمای متنی ویژه ساکنان. بدون نیاز به نقشه یا هوش مصنوعی کار می‌کند.',
		searchPlaceLabel: 'جستجوی شهر یا منطقه',
		searchPlacePlaceholder: 'مثال: تهران، بندرعباس، رشت، اسلو',
		searchButton: 'جستجو',
		useGpsButton: 'موقعیت GPS',
		manualCoordsLabel: 'یا وارد کردن مختصات (عرض، طول جغرافیایی)',
		manualCoordsPlaceholder: 'مثال: 35.6892, 51.3890',
		applyCoordsButton: 'ثبت مختصات',
		jurisdictionLabel: 'کشور/نهاد پایش‌شده',
		jurisdictionAuto: 'خودکار بر اساس مکان انتخابی',
		savedPlacesHeading: 'مکان‌های ذخیره‌شده (فقط روی این دستگاه)',
		saveCurrentPlace: 'ذخیره مکان',
		removePlace: 'حذف',
		noSavedPlaces: 'هنوز مکانی ذخیره نشده است. یک مکان انتخاب یا وارد کنید.',
		offlineSearchNotice: 'جستجوی آنلاین در دسترس نیست — نتایج از فهرست آفلاین داخلی نمایش داده می‌شود.',
		gpsStatusDenied: 'دسترسی به GPS رد شد. مکان یا مختصات را دستی وارد کنید.',
		gpsStatusTimeout: 'زمان دریافت GPS تمام شد. مکان یا مختصات را دستی وارد کنید.',
		gpsStatusUnavailable: 'GPS در این مرورگر در دسترس نیست. مختصات را دستی وارد کنید.',
		gpsStatusLowAccuracy: 'دقت GPS پایین است (بیش از ۵ کیلومتر). شهر خود را بررسی یا مختصات را ویرایش کنید.',
		gpsAccuracyLabel: 'دقت موقعیت',
		offlineFirstVisit: 'آفلاین هستید و هنوز هشداری برای این مکان ذخیره نشده است.',
		offlineCachedNotice: 'حالت آفلاین: نمایش آخرین وضعیت دریافت‌شده هشدارها.',
		offlineExpiredNotice: 'زمان انقضای هشدار ذخیره‌شده گذشته است — پس از اتصال دوباره بررسی کنید.',
		clearLocalData: 'پاک‌کردن همه داده‌های محلی',
		clearLocalDataConfirm: 'مکان‌های ذخیره‌شده و هشدارهای کش‌شده از این دستگاه پاک شدند.',
		warningsSectionTitle: 'هشدارهای مراجع رسمی',
		bulletinLanguageNote: 'متن رسمی صادرکننده عیناً به زبان اصلی منتشرشده نمایش داده می‌شود.',
		interfaceLanguageTag: 'زبان رابط',
		bulletinLanguageTag: 'زبان اطلاعیه',
		originalBulletinLink: 'مشاهده اطلاعیه اصلی رسمی',
		issuerInstructionsHeading: 'دستورالعمل‌های رسمی',
		affectedAreaHeading: 'محدوده تحت تأثیر',
		issuedLabel: 'زمان صدور',
		onsetLabel: 'شروع اثر',
		expiresLabel: 'انقضا',
		lastCheckedLabel: 'آخرین بررسی',
		helpSectionTitle: 'شماره‌های اضطراری و اشتراک‌گذاری موقعیت',
		presentJurisdictionLabel: 'کشور محل حضور فعلی برای شماره‌های اضطراری',
		presentJurisdictionHint: 'شماره‌های اضطراری بر اساس محل حضور فعلی شما تعیین می‌شوند، جدا از مکانی که پایش می‌کنید.',
		copyLocationButton: 'کپی کارت موقعیت',
		shareLocationButton: 'اشتراک‌گذاری موقعیت',
		handoffDisclaimer: 'تماس تلفنی، پیامک یا اشتراک‌گذاری فقط از طریق ابزار دستگاه شما انجام می‌شود. AegisMap درخواستی برای امدادگران ارسال یا تأیید نمی‌کند.',
		researchNoticeTitle: 'مشاهدات ماهواره‌ای و حسگرها (فقط پژوهشی)',
		researchNoticeBody: 'نقاط حرارتی، پیش‌بینی گذر ماهواره و تحلیل هوش مصنوعی ابزار پژوهشی هستند و جایگزین دستور تخلیه رسمی نیستند.',
		openExploreEvents: 'باز کردن نقشه کاوش رویدادها',
		coverageActive: 'هشدارهای رسمی فعال',
		coverageEmpty: 'بررسی موفق — بدون هشدار فعال',
		coveragePartial: 'پوشش ناقص — برخی منابع در دسترس نیستند',
		coverageStale: 'داده قدیمی — نمایش آخرین بررسی موفق',
		coverageUnavailable: 'منبع هشدار رسمی در دسترس نیست',
		coverageUnsupported: 'نهاد رسمی این منطقه هنوز پشتیبانی نمی‌شود',
		refreshWarnings: 'به‌روزرسانی هشدارها',
	},
	ms: {
		appTitle: 'AegisMap',
		skipToMain: 'Langkau ke kandungan utama',
		navNearMe: 'Berhampiran saya',
		navExploreEvents: 'Teroka peristiwa',
		languageLabel: 'Bahasa antara muka',
		nearMeTitle: 'Amaran Rasmi Tempatan & Bantuan',
		nearMeSubtitle: 'Paparan teks untuk penduduk. Berfungsi walaupun peta atau AI gagal.',
		searchPlaceLabel: 'Cari bandar, pekan, atau daerah',
		searchPlacePlaceholder: 'cth., Kota Kinabalu, Kuching, George Town, Oslo',
		searchButton: 'Cari',
		useGpsButton: 'Guna GPS',
		manualCoordsLabel: 'Atau masukkan koordinat (lat, lng)',
		manualCoordsPlaceholder: 'cth., 5.9804, 116.0735',
		applyCoordsButton: 'Tetapkan koordinat',
		jurisdictionLabel: 'Negara/pihak berkuasa dipantau',
		jurisdictionAuto: 'Auto daripada lokasi dipilih',
		savedPlacesHeading: 'Lokasi disimpan (pada peranti ini sahaja)',
		saveCurrentPlace: 'Simpan lokasi',
		removePlace: 'Padam',
		noSavedPlaces: 'Tiada lokasi disimpan. Pilih atau masukkan lokasi untuk disimpan.',
		offlineSearchNotice: 'Carian langsung tidak tersedia — memaparkan direktori luar talian terbina dalam.',
		gpsStatusDenied: 'Kebenaran GPS ditolak. Pilih lokasi atau masukkan koordinat secara manual.',
		gpsStatusTimeout: 'Permintaan GPS tamat masa. Masukkan koordinat atau pilih lokasi secara manual.',
		gpsStatusUnavailable: 'GPS tidak tersedia dalam pelayar ini. Masukkan koordinat secara manual.',
		gpsStatusLowAccuracy: 'Ketepatan GPS rendah (>5 km). Sahkan bandar anda atau sunting koordinat.',
		gpsAccuracyLabel: 'Ketepatan lokasi',
		offlineFirstVisit: 'Anda berada di luar talian dan tiada amaran disimpan untuk lokasi ini lagi.',
		offlineCachedNotice: 'Mod luar talian: memaparkan notis awam terakhir yang berjaya dimuat turun.',
		offlineExpiredNotice: 'Notis cache telah melepasi masa tamat — semak semula apabila dalam talian.',
		clearLocalData: 'Padam semua data tempatan',
		clearLocalDataConfirm: 'Lokasi disimpan dan notis cache telah dipadamkan daripada peranti ini.',
		warningsSectionTitle: 'Amaran Pihak Berkuasa Rasmi',
		bulletinLanguageNote: 'Teks rasmi pengeluar dipaparkan mengikut bahasa asal penerbitan.',
		interfaceLanguageTag: 'Bahasa UI',
		bulletinLanguageTag: 'Bahasa buletin',
		originalBulletinLink: 'Buka buletin rasmi asal',
		issuerInstructionsHeading: 'Arahan Rasmi',
		affectedAreaHeading: 'Kawasan Terjejas',
		issuedLabel: 'Dikeluarkan',
		onsetLabel: 'Bermula',
		expiresLabel: 'Tamat',
		lastCheckedLabel: 'Semakan terakhir',
		helpSectionTitle: 'Nombor Kecemasan & Kongsi Lokasi',
		presentJurisdictionLabel: 'Lokasi kehadiran semasa untuk nombor kecemasan',
		presentJurisdictionHint: 'Nombor kecemasan mengikut negara kehadiran sebenar anda, berasingan daripada kawasan dipantau.',
		copyLocationButton: 'Salin kad lokasi',
		shareLocationButton: 'Kongsi lokasi',
		handoffDisclaimer: 'Membuka pendail telefon, SMS, atau helaian kongsi hanya menyerahkan tindakan kepada peranti anda. AegisMap tidak menghantar permintaan terus kepada penyelamat atau mengesahkan penerimaan.',
		researchNoticeTitle: 'Pemerhatian Satelit & Penderia (Penyelidikan Sahaja)',
		researchNoticeBody: 'Titik panas haba, ramalan lintasan satelit, dan nota AI ialah alat penyelidikan — bukan arahan pemindahan rasmi.',
		openExploreEvents: 'Buka peta Teroka peristiwa',
		coverageActive: 'Amaran Rasmi Aktif',
		coverageEmpty: 'Berjaya Disemak — Tiada Amaran Aktif',
		coveragePartial: 'Liputan Separa — Sebahagian Sumber Tidak Tersedia',
		coverageStale: 'Data Lama — Memaparkan Semakan Berjaya Terakhir',
		coverageUnavailable: 'Sumber Amaran Rasmi Tidak Tersedia',
		coverageUnsupported: 'Suapan Pihak Berkuasa Belum Disokong Di Sini',
		refreshWarnings: 'Segar semula amaran',
	},
};

export function isAppLocale(value: unknown): value is AppLocale {
	return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isRtlLocale(locale: AppLocale): boolean {
	return locale === 'fa';
}
