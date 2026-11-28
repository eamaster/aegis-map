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
	archiveButtonLabel: string;
	helpButtonLabel: string;
	languageLabel: string;
	nearMeTitle: string;
	nearMeSubtitle: string;
	searchPlaceLabel: string;
	searchPlacePlaceholder: string;
	searchButton: string;
	useGpsButton: string;
	changePlaceButton: string;
	savedBadge: string;
	removeSavedPlaceButton: string;
	manualCoordsDisclosure: string;
	manualCoordsLabel: string;
	manualCoordsPlaceholder: string;
	applyCoordsButton: string;
	authorityOverrideDisclosure: string;
	jurisdictionLabel: string;
	jurisdictionAuto: string;
	savedPlacesHeading: string;
	saveCurrentPlace: string;
	removePlace: string;
	noSavedPlaces: string;
	offlineSearchNotice: string;
	noSearchMatches: string;
	gpsRequesting: string;
	gpsStatusDenied: string;
	gpsStatusTimeout: string;
	gpsStatusUnavailable: string;
	gpsStatusLowAccuracy: string;
	gpsAccuracyLabel: string;
	offlineFirstVisit: string;
	offlineCachedNotice: string;
	offlineExpiredNotice: string;
	localDataSettingsHeading: string;
	localDataSettingsBody: string;
	clearLocalData: string;
	confirmClearLocalDataPrompt: string;
	confirmClearLocalDataAction: string;
	cancelAction: string;
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
	monitoredPlaceLabel: string;
	presentCountryLabel: string;
	confirmPresentCountryAction: string;
	useMonitoredCountryAsPresent: string;
	helpSectionTitle: string;
	presentJurisdictionLabel: string;
	presentJurisdictionHint: string;
	copyLocationButton: string;
	shareLocationButton: string;
	handoffDisclaimer: string;
	subscriptionHeading: string;
	subscriptionUnavailableTitle: string;
	subscriptionUnavailableBody: string;
	smsUnavailableBadge: string;
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
	deselectEventLabel: string;
	expandSheetLabel: string;
	collapseSheetLabel: string;
	tabOverview: string;
	tabImagery: string;
	tabPasses: string;
	inspectEventButton: string;
	browseEventsListLabel: string;
}

export const TRANSLATIONS: Record<AppLocale, LocaleStrings> = {
	en: {
		appTitle: 'AegisMap',
		skipToMain: 'Skip to main content',
		navNearMe: 'Near me',
		navExploreEvents: 'Explore events',
		archiveButtonLabel: 'Archive',
		helpButtonLabel: 'Show help',
		languageLabel: 'Interface language',
		nearMeTitle: 'Near me',
		nearMeSubtitle: 'Choose a place to check official warnings, read safety instructions, and reach local help — even without map or AI.',
		searchPlaceLabel: 'Choose a place to monitor',
		searchPlacePlaceholder: 'City, town, or district (e.g., Kota Kinabalu, Bergen, Tehran, Panaji)',
		searchButton: 'Search',
		useGpsButton: 'Use my location',
		changePlaceButton: 'Change place',
		savedBadge: 'Saved',
		removeSavedPlaceButton: 'Remove saved',
		manualCoordsDisclosure: 'Enter coordinates manually',
		manualCoordsLabel: 'Latitude and longitude',
		manualCoordsPlaceholder: 'e.g., 5.9804, 116.0735 or 59.91N 10.75E',
		applyCoordsButton: 'Set coordinates',
		authorityOverrideDisclosure: 'Authority & country override',
		jurisdictionLabel: 'Monitored country / authority',
		jurisdictionAuto: 'Auto from selected place',
		savedPlacesHeading: 'Saved places on this device',
		saveCurrentPlace: 'Save place',
		removePlace: 'Remove',
		noSavedPlaces: 'No saved places yet.',
		offlineSearchNotice: 'Live place search unavailable — showing built-in offline directory matches.',
		noSearchMatches: 'No matching places found. Check spelling or enter coordinates manually.',
		gpsRequesting: 'Requesting device location…',
		gpsStatusDenied: 'Location permission was denied. Search for a place or enter coordinates below.',
		gpsStatusTimeout: 'Location request timed out. Try again, search by name, or enter coordinates below.',
		gpsStatusUnavailable: 'Device location is unavailable in this browser. Search or enter coordinates below.',
		gpsStatusLowAccuracy: 'Location accuracy is coarse (>5 km). Verify your city or adjust coordinates.',
		gpsAccuracyLabel: 'Accuracy',
		offlineFirstVisit: 'You are offline and no warnings have been cached for this place yet.',
		offlineCachedNotice: 'Offline mode: showing the last saved official warning check for this place.',
		offlineExpiredNotice: 'Cached warning has passed its stated expiry time — verify when back online.',
		localDataSettingsHeading: 'Local data & privacy on this device',
		localDataSettingsBody: 'Saved places, present country choice, and cached warning snapshots stay on your device. Removing local data clears them all.',
		clearLocalData: 'Remove all local data',
		confirmClearLocalDataPrompt: 'Remove all saved places, cached warnings, and preferences stored on this browser?',
		confirmClearLocalDataAction: 'Yes, remove local data',
		cancelAction: 'Cancel',
		clearLocalDataConfirm: 'Saved places and cached warning snapshots were removed from this device.',
		warningsSectionTitle: 'Official Warnings',
		bulletinLanguageNote: 'Official issuer text is shown verbatim in its published language.',
		interfaceLanguageTag: 'UI language',
		bulletinLanguageTag: 'Bulletin language',
		originalBulletinLink: 'Open official bulletin',
		issuerInstructionsHeading: 'Official Instructions',
		affectedAreaHeading: 'Affected Area',
		issuedLabel: 'Issued',
		onsetLabel: 'Onset',
		expiresLabel: 'Expires',
		lastCheckedLabel: 'Last checked',
		monitoredPlaceLabel: 'Place you are monitoring',
		presentCountryLabel: 'Country you are currently in',
		confirmPresentCountryAction: 'Confirm country for local emergency numbers',
		useMonitoredCountryAsPresent: 'I am currently in',
		helpSectionTitle: 'Local Help & Share Location',
		presentJurisdictionLabel: 'Country you are currently in (for emergency numbers)',
		presentJurisdictionHint: 'Emergency numbers depend on where you physically are right now, which may differ from the place you are monitoring.',
		copyLocationButton: 'Copy location card',
		shareLocationButton: 'Share location',
		handoffDisclaimer: 'Calling, texting, or sharing opens your device apps. AegisMap never transmits your location automatically or confirms responder receipt.',
		subscriptionHeading: 'Email Warning Alerts (Optional)',
		subscriptionUnavailableTitle: 'Email alerts are not available right now',
		subscriptionUnavailableBody: 'Automated email delivery is not enabled on this service. You can check official warnings directly on this page and save places for quick access.',
		smsUnavailableBadge: 'SMS alerts not yet available',
		researchNoticeTitle: 'Satellite & Sensor Map (Research Tool)',
		researchNoticeBody: 'Thermal hotspots, radar scenes, and predicted passes are research observations — never official evacuation notices.',
		openExploreEvents: 'Open Explore events',
		coverageActive: 'Active Official Warnings',
		coverageEmpty: 'Successfully Checked — No Active Warnings',
		coveragePartial: 'Partial Coverage — Some Sources Incomplete',
		coverageStale: 'Stale Snapshot — Showing Last Successful Check',
		coverageUnavailable: 'Official Warning Source Unavailable',
		coverageUnsupported: 'No Supported Official Feed for This Area Yet',
		refreshWarnings: 'Refresh warnings',
		deselectEventLabel: 'Close event inspector and deselect',
		expandSheetLabel: 'Expand event details',
		collapseSheetLabel: 'Collapse to map view',
		tabOverview: 'Overview',
		tabImagery: 'Imagery',
		tabPasses: 'Passes',
		inspectEventButton: 'Inspect event',
		browseEventsListLabel: 'Event list',
	},
	fa: {
		appTitle: 'AegisMap',
		skipToMain: 'رفتن به محتوای اصلی',
		navNearMe: 'اطراف من',
		navExploreEvents: 'کاوش رویدادها',
		archiveButtonLabel: 'بایگانی',
		helpButtonLabel: 'راهنما',
		languageLabel: 'زبان رابط کاربری',
		nearMeTitle: 'اطراف من',
		nearMeSubtitle: 'مکان مورد نظر را انتخاب کنید تا هشدارهای رسمی، دستورالعمل‌های ایمنی و شماره‌های امدادی را ببینید — حتی بدون نقشه یا هوش مصنوعی.',
		searchPlaceLabel: 'انتخاب مکان برای پایش هشدارها',
		searchPlacePlaceholder: 'نام شهر یا منطقه (مثال: تهران، بندرعباس، رشت، اسلو)',
		searchButton: 'جستجو',
		useGpsButton: 'موقعیت فعلی من',
		changePlaceButton: 'تغییر مکان',
		savedBadge: 'ذخیره‌شده',
		removeSavedPlaceButton: 'حذف از ذخیره‌ها',
		manualCoordsDisclosure: 'وارد کردن دستی مختصات جغرافیایی',
		manualCoordsLabel: 'عرض و طول جغرافیایی',
		manualCoordsPlaceholder: 'مثال: 35.6892, 51.3890',
		applyCoordsButton: 'ثبت مختصات',
		authorityOverrideDisclosure: 'تنظیم دستی کشور یا مرجع هشدار',
		jurisdictionLabel: 'کشور / نهاد پایش‌شده',
		jurisdictionAuto: 'خودکار بر اساس مکان انتخابی',
		savedPlacesHeading: 'مکان‌های ذخیره‌شده روی این دستگاه',
		saveCurrentPlace: 'ذخیره مکان',
		removePlace: 'حذف',
		noSavedPlaces: 'هنوز مکانی ذخیره نشده است.',
		offlineSearchNotice: 'جستجوی آنلاین در دسترس نیست — نتایج از فهرست آفلاین داخلی نمایش داده می‌شود.',
		noSearchMatches: 'مکانی با این نام پیدا نشد. املا را بررسی کنید یا مختصات را دستی وارد نمایید.',
		gpsRequesting: 'در حال دریافت موقعیت دستگاه…',
		gpsStatusDenied: 'اجازه دسترسی به موقعیت رد شد. نام شهر را جستجو کنید یا مختصات را در زیر وارد نمایید.',
		gpsStatusTimeout: 'زمان دریافت موقعیت به پایان رسید. دوباره تلاش کنید یا نام شهر / مختصات را وارد کنید.',
		gpsStatusUnavailable: 'موقعیت‌یاب در این مرورگر در دسترس نیست. نام شهر یا مختصات را وارد کنید.',
		gpsStatusLowAccuracy: 'دقت موقعیت پایین است (بیش از ۵ کیلومتر). شهر را بررسی یا مختصات را اصلاح کنید.',
		gpsAccuracyLabel: 'دقت',
		offlineFirstVisit: 'شما آفلاین هستید و هنوز هشداری برای این مکان ذخیره نشده است.',
		offlineCachedNotice: 'حالت آفلاین: نمایش آخرین بررسی ذخیره‌شده هشدارهای رسمی برای این مکان.',
		offlineExpiredNotice: 'زمان انقضای هشدار ذخیره‌شده گذشته است — پس از اتصال مجدد بررسی کنید.',
		localDataSettingsHeading: 'داده‌های محلی و حریم خصوصی در این دستگاه',
		localDataSettingsBody: 'مکان‌های ذخیره‌شده، کشور محل حضور و هشدارهای کش‌شده فقط در مرورگر شما نگهداری می‌شوند.',
		clearLocalData: 'پاک‌کردن همه داده‌های محلی',
		confirmClearLocalDataPrompt: 'آیا همه مکان‌های ذخیره‌شده، هشدارهای کش‌شده و تنظیمات محلی از این مرورگر پاک شوند؟',
		confirmClearLocalDataAction: 'بله، داده‌های محلی پاک شوند',
		cancelAction: 'انصراف',
		clearLocalDataConfirm: 'مکان‌های ذخیره‌شده و هشدارهای کش‌شده از این دستگاه پاک شدند.',
		warningsSectionTitle: 'هشدارهای مراجع رسمی',
		bulletinLanguageNote: 'متن رسمی صادرکننده عیناً به زبان اصلی منتشرشده نمایش داده می‌شود.',
		interfaceLanguageTag: 'زبان رابط',
		bulletinLanguageTag: 'زبان اطلاعیه',
		originalBulletinLink: 'مشاهده اطلاعیه رسمی اصلی',
		issuerInstructionsHeading: 'دستورالعمل‌های رسمی',
		affectedAreaHeading: 'محدوده تحت تأثیر',
		issuedLabel: 'زمان صدور',
		onsetLabel: 'شروع اثر',
		expiresLabel: 'انقضا',
		lastCheckedLabel: 'آخرین بررسی',
		monitoredPlaceLabel: 'مکانی که پایش می‌کنید',
		presentCountryLabel: 'کشوری که هم‌اکنون در آن حضور دارید',
		confirmPresentCountryAction: 'کشور محل حضور خود را برای نمایش شماره‌های اضطراری تأیید کنید',
		useMonitoredCountryAsPresent: 'هم‌اکنون در این کشور هستم:',
		helpSectionTitle: 'کمک محلی و اشتراک‌گذاری موقعیت',
		presentJurisdictionLabel: 'کشور محل حضور فعلی شما (برای شماره‌های اضطراری)',
		presentJurisdictionHint: 'شماره‌های اضطراری بر اساس کشوری که الان در آن حضور دارید تعیین می‌شوند، جدا از مکانی که پایش می‌کنید.',
		copyLocationButton: 'کپی کارت موقعیت',
		shareLocationButton: 'اشتراک‌گذاری موقعیت',
		handoffDisclaimer: 'تماس تلفنی، پیامک یا اشتراک‌گذاری فقط ابزار دستگاه شما را باز می‌کند. AegisMap موقعیت را خودکار ارسال نمی‌کند.',
		subscriptionHeading: 'اعلان ایمیلی هشدارها (اختیاری)',
		subscriptionUnavailableTitle: 'ارسال ایمیل هشدار در حال حاضر فعال نیست',
		subscriptionUnavailableBody: 'ارسال خودکار ایمیل روی این سرویس فعال نشده است. همچنان می‌توانید هشدارهای رسمی را مستقیم در همین صفحه بررسی و مکان‌ها را ذخیره کنید.',
		smsUnavailableBadge: 'پیامک هنوز در دسترس نیست',
		researchNoticeTitle: 'نقشه ماهواره‌ای و حسگرها (ابزار پژوهشی)',
		researchNoticeBody: 'نقاط حرارتی، تصاویر راداری و پیش‌بینی گذر ماهواره‌ها مشاهدات پژوهشی هستند — نه دستور تخلیه رسمی.',
		openExploreEvents: 'باز کردن نقشه کاوش رویدادها',
		coverageActive: 'هشدارهای رسمی فعال',
		coverageEmpty: 'بررسی موفق — بدون هشدار فعال',
		coveragePartial: 'پوشش ناقص — برخی منابع کامل نیستند',
		coverageStale: 'داده قدیمی — نمایش آخرین بررسی موفق',
		coverageUnavailable: 'منبع هشدار رسمی در دسترس نیست',
		coverageUnsupported: 'پوشش رسمی این منطقه هنوز پشتیبانی نمی‌شود',
		refreshWarnings: 'به‌روزرسانی هشدارها',
		deselectEventLabel: 'بستن جزئیات و لغو انتخاب رویداد',
		expandSheetLabel: 'نمایش کامل جزئیات رویداد',
		collapseSheetLabel: 'جمع‌کردن پنل و نمایش نقشه',
		tabOverview: 'خلاصه',
		tabImagery: 'تصاویر و رادار',
		tabPasses: 'گذر ماهواره‌ها',
		inspectEventButton: 'بررسی رویداد',
		browseEventsListLabel: 'فهرست رویدادها',
	},
	ms: {
		appTitle: 'AegisMap',
		skipToMain: 'Langkau ke kandungan utama',
		navNearMe: 'Berhampiran saya',
		navExploreEvents: 'Teroka peristiwa',
		archiveButtonLabel: 'Arkib',
		helpButtonLabel: 'Bantuan',
		languageLabel: 'Bahasa antara muka',
		nearMeTitle: 'Berhampiran saya',
		nearMeSubtitle: 'Pilih lokasi untuk menyemak amaran rasmi, membaca arahan keselamatan, dan menghubungi bantuan tempatan — walaupun tanpa peta atau AI.',
		searchPlaceLabel: 'Pilih lokasi untuk dipantau',
		searchPlacePlaceholder: 'Bandar, pekan, atau daerah (cth., Kota Kinabalu, Kuching, George Town, Oslo)',
		searchButton: 'Cari',
		useGpsButton: 'Guna lokasi saya',
		changePlaceButton: 'Tukar lokasi',
		savedBadge: 'Disimpan',
		removeSavedPlaceButton: 'Buang simpanan',
		manualCoordsDisclosure: 'Masukkan koordinat secara manual',
		manualCoordsLabel: 'Latitud dan longitud',
		manualCoordsPlaceholder: 'cth., 5.9804, 116.0735',
		applyCoordsButton: 'Tetapkan koordinat',
		authorityOverrideDisclosure: 'Tetapan negara / pihak berkuasa',
		jurisdictionLabel: 'Negara / pihak berkuasa dipantau',
		jurisdictionAuto: 'Auto daripada lokasi dipilih',
		savedPlacesHeading: 'Lokasi disimpan pada peranti ini',
		saveCurrentPlace: 'Simpan lokasi',
		removePlace: 'Padam',
		noSavedPlaces: 'Tiada lokasi disimpan lagi.',
		offlineSearchNotice: 'Carian langsung tidak tersedia — memaparkan padanan direktori luar talian.',
		noSearchMatches: 'Tiada lokasi sepadan ditemui. Semak ejaan atau masukkan koordinat secara manual.',
		gpsRequesting: 'Meminta lokasi peranti…',
		gpsStatusDenied: 'Kebenaran lokasi ditolak. Cari nama bandar atau masukkan koordinat di bawah.',
		gpsStatusTimeout: 'Permintaan lokasi tamat masa. Cuba lagi, cari nama, atau masukkan koordinat di bawah.',
		gpsStatusUnavailable: 'Lokasi peranti tidak tersedia dalam pelayar ini. Cari atau masukkan koordinat di bawah.',
		gpsStatusLowAccuracy: 'Ketepatan lokasi kasar (>5 km). Sahkan bandar anda atau laraskan koordinat.',
		gpsAccuracyLabel: 'Ketepatan',
		offlineFirstVisit: 'Anda berada di luar talian dan tiada amaran disimpan untuk lokasi ini lagi.',
		offlineCachedNotice: 'Mod luar talian: memaparkan semakan amaran rasmi terakhir yang disimpan.',
		offlineExpiredNotice: 'Amaran cache telah melepasi masa tamat — semak semula apabila dalam talian.',
		localDataSettingsHeading: 'Data tempatan & privasi pada peranti ini',
		localDataSettingsBody: 'Lokasi disimpan, pilihan negara semasa, dan amaran cache kekal pada peranti anda sahaja.',
		clearLocalData: 'Padam semua data tempatan',
		confirmClearLocalDataPrompt: 'Padam semua lokasi disimpan, amaran cache, dan tetapan pada pelayar ini?',
		confirmClearLocalDataAction: 'Ya, padam data tempatan',
		cancelAction: 'Batal',
		clearLocalDataConfirm: 'Lokasi disimpan dan amaran cache telah dipadamkan daripada peranti ini.',
		warningsSectionTitle: 'Amaran Rasmi',
		bulletinLanguageNote: 'Teks rasmi pengeluar dipaparkan mengikut bahasa asal penerbitan.',
		interfaceLanguageTag: 'Bahasa UI',
		bulletinLanguageTag: 'Bahasa buletin',
		originalBulletinLink: 'Buka buletin rasmi',
		issuerInstructionsHeading: 'Arahan Rasmi',
		affectedAreaHeading: 'Kawasan Terjejas',
		issuedLabel: 'Dikeluarkan',
		onsetLabel: 'Bermula',
		expiresLabel: 'Tamat',
		lastCheckedLabel: 'Semakan terakhir',
		monitoredPlaceLabel: 'Lokasi yang dipantau',
		presentCountryLabel: 'Negara tempat anda berada sekarang',
		confirmPresentCountryAction: 'Sahkan negara semasa untuk nombor kecemasan tempatan',
		useMonitoredCountryAsPresent: 'Saya berada di negara ini sekarang:',
		helpSectionTitle: 'Bantuan Tempatan & Kongsi Lokasi',
		presentJurisdictionLabel: 'Negara tempat anda berada sekarang (untuk nombor kecemasan)',
		presentJurisdictionHint: 'Nombor kecemasan bergantung pada negara keberadaan fizikal anda sekarang, berasingan daripada lokasi yang dipantau.',
		copyLocationButton: 'Salin kad lokasi',
		shareLocationButton: 'Kongsi lokasi',
		handoffDisclaimer: 'Panggilan, SMS, atau kongsi hanya membuka aplikasi peranti anda. AegisMap tidak menghantar lokasi secara automatik.',
		subscriptionHeading: 'Makluman E-mel Amaran (Pilihan)',
		subscriptionUnavailableTitle: 'Makluman e-mel tidak tersedia buat masa ini',
		subscriptionUnavailableBody: 'Penghantaran e-mel automatik tidak diaktifkan pada perkhidmatan ini. Anda masih boleh menyemak amaran rasmi secara terus di halaman ini.',
		smsUnavailableBadge: 'Makluman SMS belum tersedia',
		researchNoticeTitle: 'Peta Satelit & Penderia (Alat Penyelidikan)',
		researchNoticeBody: 'Titik panas haba, imej radar, dan ramalan lintasan satelit ialah pemerhatian penyelidikan — bukan arahan pemindahan rasmi.',
		openExploreEvents: 'Buka Teroka peristiwa',
		coverageActive: 'Amaran Rasmi Aktif',
		coverageEmpty: 'Berjaya Disemak — Tiada Amaran Aktif',
		coveragePartial: 'Liputan Separa — Sebahagian Sumber Tidak Lengkap',
		coverageStale: 'Data Lama — Memaparkan Semakan Berjaya Terakhir',
		coverageUnavailable: 'Sumber Amaran Rasmi Tidak Tersedia',
		coverageUnsupported: 'Tiada Suapan Rasmi Disokong Di Kawasan Ini',
		refreshWarnings: 'Segar semula amaran',
		deselectEventLabel: 'Tutup pemeriksa dan nyahpilih peristiwa',
		expandSheetLabel: 'Buka butiran penuh peristiwa',
		collapseSheetLabel: 'Kecilkan panel ke paparan peta',
		tabOverview: 'Ringkasan',
		tabImagery: 'Imej & Radar',
		tabPasses: 'Lintasan Satelit',
		inspectEventButton: 'Periksa peristiwa',
		browseEventsListLabel: 'Senarai peristiwa',
	},
};

export function isAppLocale(value: unknown): value is AppLocale {
	return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isRtlLocale(locale: AppLocale): boolean {
	return locale === 'fa';
}
