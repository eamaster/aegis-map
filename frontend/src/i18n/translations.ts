/**
 * Resident & Researcher UI Translations:
 * English (en, LTR), Simplified Chinese (zh-Hans, LTR), Persian (fa, RTL), Malay (ms, LTR).
 * Official warning bulletin text is NEVER machine-translated here; bulletin language is
 * explicitly tagged and kept separate from interface language.
 */

export const SUPPORTED_LOCALES = ['en', 'zh-Hans', 'fa', 'ms'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export interface LocaleStrings {
	appTitle: string;
	appSubtitle: string;
	skipToMain: string;
	navNearMe: string;
	navExploreEvents: string;
	archiveButtonLabel: string;
	helpButtonLabel: string;
	languageLabel: string;
	installAppButton: string;
	installModalTitle: string;
	installModalSubtitle: string;
	installIosStep1: string;
	installIosStep2: string;
	installAndroidStep: string;
	installDesktopStep: string;
	installNotificationsNote: string;
	installShortcutNote: string;
	installNativePromptBtn: string;
	closeButton: string;
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
	gpsRefining: string;
	gpsStatusDenied: string;
	gpsStatusTimeout: string;
	gpsStatusUnavailable: string;
	gpsStatusInsecureContext: string;
	gpsStatusLowAccuracy: string;
	gpsCountryUncertain: string;
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
	privateLocationHeading: string;
	editCoordsLabel: string;
	optionalNoteLabel: string;
	optionalNotePlaceholder: string;
	officialGuidanceLinksHeading: string;
	subscriptionHeading: string;
	subscriptionUnavailableTitle: string;
	subscriptionUnavailableBody: string;
	subscriptionEmailDesc: string;
	subscriptionEmailLabel: string;
	subscriptionSeverityLabel: string;
	subscriptionSeverityModerate: string;
	subscriptionSeveritySevere: string;
	subscriptionSeverityExtreme: string;
	subscriptionSubmitBtn: string;
	pushHeading: string;
	pushActiveBadge: string;
	pushUnsupportedNotice: string;
	pushUnavailableNotice: string;
	pushPermissionDeniedTitle: string;
	pushPermissionDeniedBody: string;
	pushReadyBody: string;
	pushEnableBtn: string;
	pushDisableBtn: string;
	pushActiveSummary: string;
	pushDisabledSuccess: string;
	pushEnablePlaceBtn: string;
	pushDisablePlaceBtn: string;
	pushDisableDeviceBtn: string;
	pushOtherPlacesNote: string;
	pushRetryBtn: string;
	pushPlaceDisabledSuccess: string;
	pushPlaceDisabledOthersActive: string;
	pushServerRegFailedRetry: string;
	pushBrowserUnsubFailedRetry: string;
	pushServerUnsubFailedRetry: string;
	pushIncompleteKeysError: string;
	emailSubFailedError: string;
	emailConfirmFailedError: string;
	emailUnsubFailedError: string;
	authoritySourceCoverageHeading: string;
	verifiedEmergencyContactsLabel: string;
	lastVerifiedLabel: string;
	notifCancelledNotice: string;
	notifExpiredOrInactiveNotice: string;
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
	liveMonitorTitle: string;
	activeEventsLabel: string;
	windowLabel: string;
	scopeLabel: string;
	scopeActive: string;
	scopeStrict: string;
	filterWildfires: string;
	filterHotspots: string;
	filterVolcanoes: string;
	filterEarthquakes: string;
	scopeDisclosureLabel: string;
	updatedLabel: string;
	justNowLabel: string;
}

export const TRANSLATIONS: Record<AppLocale, LocaleStrings> = {
	en: {
		appTitle: 'AegisMap',
		appSubtitle: 'Disaster Monitoring System',
		skipToMain: 'Skip to main content',
		navNearMe: 'Near me',
		navExploreEvents: 'Explore events',
		archiveButtonLabel: 'Archive',
		helpButtonLabel: 'Show help',
		languageLabel: 'Interface language',
		installAppButton: 'Install AegisMap',
		installModalTitle: 'Install AegisMap',
		installModalSubtitle: 'Keep offline Near me checklists, saved places, and cached warnings quickly accessible.',
		installIosStep1: '1. Tap the Share button in Safari (square with an upward arrow).',
		installIosStep2: '2. Scroll down and choose "Add to Home Screen", then tap Add.',
		installAndroidStep: 'Open your browser menu (⋮) and choose "Install app" or "Add to Home screen".',
		installDesktopStep: 'Use the install icon in your address bar (Chrome or Edge) or Browser Menu → Apps / Save and share → Install AegisMap.',
		installNotificationsNote: 'Installing the app never enables warning notifications automatically; opt in separately under Alert Subscriptions.',
		installShortcutNote: 'Browsers manage app shortcuts per OS policy; no extra desktop shortcut is added silently.',
		installNativePromptBtn: 'Install with browser prompt',
		closeButton: 'Close',
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
		gpsRefining: 'Got coarse location — refining accuracy…',
		gpsStatusDenied: 'Location permission was denied. Search for a place or enter coordinates below.',
		gpsStatusTimeout: 'Location request timed out. Try again, search by name, or enter coordinates below.',
		gpsStatusUnavailable: 'Device location is unavailable in this browser. Search or enter coordinates below.',
		gpsStatusInsecureContext: 'Location access requires HTTPS (or localhost). Search for a place or enter coordinates below.',
		gpsStatusLowAccuracy: 'Location accuracy is coarse (>5 km). Verify your city or adjust coordinates.',
		gpsCountryUncertain: 'Location is near a border or coarse; confirm your country / authority override if needed.',
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
		helpSectionTitle: 'Local Help & Emergency Contacts',
		presentJurisdictionLabel: 'Country you are currently in (for emergency numbers)',
		presentJurisdictionHint: 'Emergency numbers depend on where you physically are right now, separate from the place you are monitoring.',
		copyLocationButton: 'Copy location card',
		shareLocationButton: 'Share location',
		handoffDisclaimer: 'Calling, texting, or sharing opens your device apps. AegisMap never transmits your location automatically or confirms responder receipt.',
		privateLocationHeading: 'Private Location Card (Shared Only When You Choose)',
		editCoordsLabel: 'Edit coordinates if needed',
		optionalNoteLabel: 'Optional short note',
		optionalNotePlaceholder: 'e.g., Landmarks or floor…',
		officialGuidanceLinksHeading: 'Official Emergency Guidance Links',
		subscriptionHeading: 'Alert Subscriptions (Optional)',
		subscriptionUnavailableTitle: 'Email alerts are not available right now',
		subscriptionUnavailableBody: 'Automated email delivery is not enabled on this deployment. Check official warnings directly in Near me and save places for quick access.',
		subscriptionEmailDesc: 'Receive email updates when {authority} publishes verified warnings matching {place}. Requires email confirmation; unsubscribe anytime.',
		subscriptionEmailLabel: 'Email address',
		subscriptionSeverityLabel: 'Minimum severity',
		subscriptionSeverityModerate: 'Moderate & above',
		subscriptionSeveritySevere: 'Severe & Extreme',
		subscriptionSeverityExtreme: 'Extreme only',
		subscriptionSubmitBtn: 'Request Email Alerts',
		pushHeading: 'Browser Push Notifications',
		pushActiveBadge: 'Subscribed',
		pushUnsupportedNotice: 'Browser Push requires a modern HTTPS browser with Service Worker & PushManager support.',
		pushUnavailableNotice: 'Browser push notifications are not configured on this server yet. Near me live checks remain available.',
		pushPermissionDeniedTitle: 'Notification permission blocked',
		pushPermissionDeniedBody: 'Notifications were blocked by the browser. Reset Notification permissions for this site in browser settings to re-enable.',
		pushReadyBody: 'Receive encrypted push notifications for verified official warnings even when this tab is closed.',
		pushEnableBtn: 'Enable warning notifications',
		pushDisableBtn: 'Disable notifications',
		pushActiveSummary: 'Push notifications are enabled for verified warnings near {place}.',
		pushDisabledSuccess: 'Browser push notifications have been disabled across all places on this browser.',
		pushEnablePlaceBtn: 'Enable alerts for this place',
		pushDisablePlaceBtn: 'Disable for this place',
		pushDisableDeviceBtn: 'Disable on this browser',
		pushOtherPlacesNote: 'Also active for {count} other place(s) on this browser.',
		pushRetryBtn: 'Retry sync',
		pushPlaceDisabledSuccess: 'Browser push alerts disabled for {place}.',
		pushPlaceDisabledOthersActive: 'Browser push alerts disabled for {place}. {count} other place(s) remain active on this browser.',
		pushServerRegFailedRetry: 'Browser push permission succeeded, but registering this place with the server failed. Retry to finish activation.',
		pushBrowserUnsubFailedRetry: 'Server alerts were stopped, but this browser did not finish unsubscribing. Retry cleanup to complete removal.',
		pushServerUnsubFailedRetry: 'Could not reach the server to disable push alerts. Local enrollment was kept so you can retry.',
		pushIncompleteKeysError: 'This browser returned an incomplete push subscription key bundle. Try again or use a supported browser.',
		emailSubFailedError: 'Could not submit email alert request. Please try again.',
		emailConfirmFailedError: 'Could not confirm email subscription. Please try again.',
		emailUnsubFailedError: 'Could not unsubscribe right now. Please try again.',
		authoritySourceCoverageHeading: 'Authority Source Coverage & Freshness',
		verifiedEmergencyContactsLabel: 'Verified Emergency Contacts',
		lastVerifiedLabel: 'Last verified',
		notifCancelledNotice: 'The official issuer cancelled the warning you opened ({id}). Current live status for this place is shown below.',
		notifExpiredOrInactiveNotice: 'The warning you opened ({id}) is no longer active (it may have expired, been updated, or superseded). Current official status is shown below.',
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
		liveMonitorTitle: 'Live Monitor',
		activeEventsLabel: 'Active Events',
		windowLabel: 'Window',
		scopeLabel: 'Scope',
		scopeActive: 'Active',
		scopeStrict: 'Strict',
		filterWildfires: 'Wildfires',
		filterHotspots: 'Satellite Hotspots',
		filterVolcanoes: 'Volcanoes',
		filterEarthquakes: 'Earthquakes',
		scopeDisclosureLabel: 'Data scope & attribution',
		updatedLabel: 'Updated',
		justNowLabel: 'Just now',
	},
	'zh-Hans': {
		appTitle: 'AegisMap',
		appSubtitle: '灾害监测与预警系统',
		skipToMain: '跳到主要内容',
		navNearMe: '我附近',
		navExploreEvents: '浏览事件',
		archiveButtonLabel: '历史档案',
		helpButtonLabel: '显示帮助',
		languageLabel: '界面语言',
		installAppButton: '安装 AegisMap',
		installModalTitle: '安装 AegisMap',
		installModalSubtitle: '将离线“我附近”清单、已保存地点与缓存预警固定到设备以便快速打开。',
		installIosStep1: '1. 点击 Safari 的“分享”按钮（带向上箭头的方框）。',
		installIosStep2: '2. 向下滚动并选择“添加到主屏幕”，然后点按“添加”。',
		installAndroidStep: '打开浏览器菜单 (⋮)，选择“安装应用”或“添加到主屏幕”。',
		installDesktopStep: '点击地址栏中的安装图标（Chrome 或 Edge），或打开浏览器菜单 → 应用 / 保存与分享 → 安装 AegisMap。',
		installNotificationsNote: '安装应用不会自动开启预警通知；如需推送，请在“我附近 → 预警订阅”中单独授权开启。',
		installShortcutNote: '桌面或主屏幕快捷方式由浏览器和系统策略管理，应用不会擅自添加额外桌面图标。',
		installNativePromptBtn: '通过浏览器安装提示安装',
		closeButton: '关闭',
		nearMeTitle: '我附近',
		nearMeSubtitle: '选择地点以查看官方预警、阅读安全指引并获取当地紧急求助方式 —— 即使地图或 AI 不可用也能正常使用。',
		searchPlaceLabel: '选择要监测的地点',
		searchPlacePlaceholder: '城市、城镇或地区（例如：北京、吉隆坡、奥斯陆、德黑兰、帕纳吉）',
		searchButton: '搜索',
		useGpsButton: '使用我的位置',
		changePlaceButton: '更换地点',
		savedBadge: '已保存',
		removeSavedPlaceButton: '取消保存',
		manualCoordsDisclosure: '手动输入经纬度坐标',
		manualCoordsLabel: '纬度与经度',
		manualCoordsPlaceholder: '例如：39.9042, 116.4074 或 39.90N 116.41E',
		applyCoordsButton: '应用坐标',
		authorityOverrideDisclosure: '国家/机构手动覆盖',
		jurisdictionLabel: '监测的国家/预警机构',
		jurisdictionAuto: '根据所选地点自动识别',
		savedPlacesHeading: '本设备已保存的地点',
		saveCurrentPlace: '保存此地点',
		removePlace: '移除',
		noSavedPlaces: '暂无保存的地点。',
		offlineSearchNotice: '在线地名搜索暂不可用 —— 显示内置离线地名目录匹配结果。',
		noSearchMatches: '未找到匹配地点。请检查拼写或手动输入坐标。',
		gpsRequesting: '正在获取设备位置…',
		gpsRefining: '已获得粗略定位，正在提高精度…',
		gpsStatusDenied: '定位权限已被拒绝。请在下方搜索地名或手动输入坐标。',
		gpsStatusTimeout: '定位请求超时。请重试、按名称搜索或在下方输入坐标。',
		gpsStatusUnavailable: '当前浏览器无法获取设备位置。请按名称搜索或输入坐标。',
		gpsStatusInsecureContext: '定位需要 HTTPS（或 localhost）安全上下文。请搜索地名或输入坐标。',
		gpsStatusLowAccuracy: '定位精度较粗（>5 公里）。请核对所在城市或微调坐标。',
		gpsCountryUncertain: '当前位置靠近边境或精度较粗，请按需在下方确认所在国家/机构。',
		gpsAccuracyLabel: '精度',
		offlineFirstVisit: '当前处于离线状态，此地点尚未缓存官方预警记录。',
		offlineCachedNotice: '离线模式：当前显示此地点最近一次成功保存的官方预警检查结果。',
		offlineExpiredNotice: '缓存的预警已过发布时效 —— 恢复联网后请重新核实。',
		localDataSettingsHeading: '本设备的本地数据与隐私',
		localDataSettingsBody: '已保存地点、当前所在国家设置和预警缓存仅保存在您的本地设备中。清除本地数据会将其全部移除。',
		clearLocalData: '清除所有本地数据',
		confirmClearLocalDataPrompt: '确认清除此浏览器中保存的所有地点、缓存预警与偏好设置吗？',
		confirmClearLocalDataAction: '确认清除本地数据',
		cancelAction: '取消',
		clearLocalDataConfirm: '已从此设备清除保存的地点与缓存预警记录。',
		warningsSectionTitle: '官方预警',
		bulletinLanguageNote: '官方发布机构的原文将按其原始语言准确保留显示，不作机器改写。',
		interfaceLanguageTag: '界面语言',
		bulletinLanguageTag: '公告语言',
		originalBulletinLink: '查看官方原公告',
		issuerInstructionsHeading: '官方行动指引',
		affectedAreaHeading: '影响区域',
		issuedLabel: '发布时间',
		onsetLabel: '生效时间',
		expiresLabel: '失效时间',
		lastCheckedLabel: '上次检查',
		monitoredPlaceLabel: '当前监测地点',
		presentCountryLabel: '您当前实际所在的国家',
		confirmPresentCountryAction: '请确认当前所在国家以显示本地紧急电话',
		useMonitoredCountryAsPresent: '我当前位于此国家：',
		helpSectionTitle: '当地求助与紧急电话',
		presentJurisdictionLabel: '您当前实际所在的国家（用于紧急电话）',
		presentJurisdictionHint: '紧急求助电话取决于您当前身处的国家，可与上方监测地点不同。',
		copyLocationButton: '复制位置信息卡',
		shareLocationButton: '分享位置',
		handoffDisclaimer: '拨号、短信或分享仅会调起您设备上的原生应用；AegisMap 不会自动外传位置或确认对方已收到。',
		privateLocationHeading: '私密位置信息卡（仅由您主动分享）',
		editCoordsLabel: '如需调整，可修改坐标',
		optionalNoteLabel: '可选简短备注',
		optionalNotePlaceholder: '例如：附近地标、楼层或人数…',
		officialGuidanceLinksHeading: '官方应急指南链接',
		subscriptionHeading: '预警订阅提醒（可选）',
		subscriptionUnavailableTitle: '邮件预警发送暂不可用',
		subscriptionUnavailableBody: '当前部署未启用自动邮件投递服务。您仍可直接在“我附近”页面实时查看官方预警并保存常用地点。',
		subscriptionEmailDesc: '当 {authority} 发布匹配 {place} 的已核验预警时发送邮件通知。需邮箱确认，可随时退订。',
		subscriptionEmailLabel: '电子邮箱',
		subscriptionSeverityLabel: '最低级别',
		subscriptionSeverityModerate: '中级及以上',
		subscriptionSeveritySevere: '严重及极端',
		subscriptionSeverityExtreme: '仅极端级别',
		subscriptionSubmitBtn: '申请邮件提醒',
		pushHeading: '浏览器推送通知',
		pushActiveBadge: '已开启推送',
		pushUnsupportedNotice: '浏览器推送需要在支持 Service Worker 与 PushManager 的 HTTPS 环境中运行。',
		pushUnavailableNotice: '当前服务器尚未启用浏览器推送通知，您仍可直接在“我附近”页面实时查看官方预警。',
		pushPermissionDeniedTitle: '通知权限已被拦截',
		pushPermissionDeniedBody: '浏览器已拒绝通知权限。请在浏览器站点设置中允许此网站发送通知后重试。',
		pushReadyBody: '开启后，即使关闭页面也能通过系统推送收到经核验的官方预警更新。',
		pushEnableBtn: '开启预警推送通知',
		pushDisableBtn: '关闭推送通知',
		pushActiveSummary: '已为 {place} 附近的官方预警开启浏览器推送。',
		pushDisabledSuccess: '已在此浏览器上停用全部地点的预警推送。',
		pushEnablePlaceBtn: '为此地点开启推送',
		pushDisablePlaceBtn: '仅停用此地点推送',
		pushDisableDeviceBtn: '停用本浏览器全部推送',
		pushOtherPlacesNote: '本浏览器上同时已订阅另外 {count} 个地点。',
		pushRetryBtn: '重试同步',
		pushPlaceDisabledSuccess: '已停用 {place} 的浏览器预警推送。',
		pushPlaceDisabledOthersActive: '已停用 {place} 的浏览器预警推送，本浏览器上其余 {count} 个地点仍保持开启。',
		pushServerRegFailedRetry: '浏览器已授权推送，但向服务器注册此地点失败。请点击重试以完成激活。',
		pushBrowserUnsubFailedRetry: '服务器已停止发送预警，但浏览器端退订尚未完成。请点击重试完成清理。',
		pushServerUnsubFailedRetry: '暂时无法连接服务器停用推送。已保留本地状态以便您稍后重试。',
		pushIncompleteKeysError: '浏览器返回的推送密钥不完整，请重试或更换受支持的浏览器。',
		emailSubFailedError: '提交邮件提醒请求失败，请稍后重试。',
		emailConfirmFailedError: '确认邮件订阅失败，请稍后重试。',
		emailUnsubFailedError: '退订请求失败，请稍后重试。',
		authoritySourceCoverageHeading: '官方预警数据源覆盖与时效',
		verifiedEmergencyContactsLabel: '已核验紧急求助电话',
		lastVerifiedLabel: '最近核验',
		notifCancelledNotice: '官方发布机构已取消您点击的预警（{id}）。下方显示该地点当前的最新官方状态。',
		notifExpiredOrInactiveNotice: '您点击的预警（{id}）已不再处于生效状态（可能已过期、更新或被替代）。下方显示当前最新官方状态。',
		smsUnavailableBadge: '短信通知暂未上线',
		researchNoticeTitle: '卫星与传感器地图（科研分析工具）',
		researchNoticeBody: '热异常点、合成孔径雷达影像及过境预报仅供科研观测参考 —— 不得作为官方疏散指令。',
		openExploreEvents: '打开“浏览事件”地图',
		coverageActive: '当前有生效官方预警',
		coverageEmpty: '已成功检查 —— 暂无生效预警',
		coveragePartial: '部分覆盖 —— 个别官方源数据不完整',
		coverageStale: '快照过期 —— 显示上次成功检查结果',
		coverageUnavailable: '官方预警数据源暂不可用',
		coverageUnsupported: '该区域暂无受支持的官方预警接入源',
		refreshWarnings: '刷新预警',
		deselectEventLabel: '关闭事件详情并取消选择',
		expandSheetLabel: '展开事件详情',
		collapseSheetLabel: '收起并返回地图视图',
		tabOverview: '概览',
		tabImagery: '影像与雷达',
		tabPasses: '过境预报',
		inspectEventButton: '查看事件详情',
		browseEventsListLabel: '事件列表',
		liveMonitorTitle: '实时监测',
		activeEventsLabel: '活动事件',
		windowLabel: '时间窗口',
		scopeLabel: '筛选范围',
		scopeActive: '全部活动',
		scopeStrict: '严格窗内',
		filterWildfires: '野火灾害',
		filterHotspots: '卫星火点热点',
		filterVolcanoes: '火山活动',
		filterEarthquakes: '地震事件',
		scopeDisclosureLabel: '数据范围与来源说明',
		updatedLabel: '更新时间',
		justNowLabel: '刚刚',
	},
	fa: {
		appTitle: 'AegisMap',
		appSubtitle: 'سامانه پایش مخاطرات و هشدارها',
		skipToMain: 'رفتن به محتوای اصلی',
		navNearMe: 'اطراف من',
		navExploreEvents: 'کاوش رویدادها',
		archiveButtonLabel: 'بایگانی',
		helpButtonLabel: 'راهنما',
		languageLabel: 'زبان رابط کاربری',
		installAppButton: 'نصب AegisMap',
		installModalTitle: 'نصب AegisMap',
		installModalSubtitle: 'فهرست‌های آفلاین، مکان‌های ذخیره‌شده و هشدارهای کش‌شده را سریع در دسترس نگه دارید.',
		installIosStep1: '۱. در سافاری روی دکمه اشتراک‌گذاری (مربع با فلش رو به بالا) بزنید.',
		installIosStep2: '۲. به پایین اسکرول کنید و «Add to Home Screen» را انتخاب و تایید کنید.',
		installAndroidStep: 'منوی مرورگر (⋮) را باز کنید و «Install app» یا «Add to Home screen» را بزنید.',
		installDesktopStep: 'روی نماد نصب در نوار آدرس (کروم یا اج) بزنید یا از منوی مرورگر Install AegisMap را انتخاب کنید.',
		installNotificationsNote: 'نصب برنامه به‌صورت خودکار اعلان‌ها را فعال نمی‌کند؛ اشتراک اعلان در بخش «اطراف من» جداگانه فعال می‌شود.',
		installShortcutNote: 'میان‌برهای صفحه اصلی طبق سیاست مرورگر و سیستم‌عامل ساخته می‌شوند و برنامه میان‌بر مخفی اضافه نمی‌کند.',
		installNativePromptBtn: 'نصب با پنجره مرورگر',
		closeButton: 'بستن',
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
		gpsRefining: 'موقعیت تقریبی دریافت شد — در حال بهبود دقت…',
		gpsStatusDenied: 'اجازه دسترسی به موقعیت رد شد. نام شهر را جستجو کنید یا مختصات را در زیر وارد نمایید.',
		gpsStatusTimeout: 'زمان دریافت موقعیت به پایان رسید. دوباره تلاش کنید یا نام شهر / مختصات را وارد کنید.',
		gpsStatusUnavailable: 'موقعیت‌یاب در این مرورگر در دسترس نیست. نام شهر یا مختصات را وارد کنید.',
		gpsStatusInsecureContext: 'دریافت موقعیت نیازمند اتصال امن HTTPS است. نام شهر را جستجو کنید یا مختصات وارد نمایید.',
		gpsStatusLowAccuracy: 'دقت موقعیت پایین است (بیش از ۵ کیلومتر). شهر را بررسی یا مختصات را اصلاح کنید.',
		gpsCountryUncertain: 'مکان نزدیک مرز یا با دقت پایین است؛ در صورت نیاز کشور مرجع را تأیید کنید.',
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
		helpSectionTitle: 'کمک محلی و شماره‌های اضطراری',
		presentJurisdictionLabel: 'کشور محل حضور فعلی شما (برای شماره‌های اضطراری)',
		presentJurisdictionHint: 'شماره‌های اضطراری بر اساس کشوری که الان در آن حضور دارید تعیین می‌شوند، جدا از مکانی که پایش می‌کنید.',
		copyLocationButton: 'کپی کارت موقعیت',
		shareLocationButton: 'اشتراک‌گذاری موقعیت',
		handoffDisclaimer: 'تماس تلفنی، پیامک یا اشتراک‌گذاری فقط ابزار دستگاه شما را باز می‌کند. AegisMap موقعیت را خودکار ارسال نمی‌کند.',
		privateLocationHeading: 'کارت موقعیت خصوصی (ارسال فقط به انتخاب شما)',
		editCoordsLabel: 'ویرایش مختصات در صورت نیاز',
		optionalNoteLabel: 'یادداشت کوتاه اختیاری',
		optionalNotePlaceholder: 'مثال: نشانی نزدیک یا طبقه…',
		officialGuidanceLinksHeading: 'پیوندهای رسمی راهنمای امدادی',
		subscriptionHeading: 'اشتراک اعلان هشدارها (اختیاری)',
		subscriptionUnavailableTitle: 'ارسال ایمیل هشدار در حال حاضر فعال نیست',
		subscriptionUnavailableBody: 'ارسال خودکار ایمیل روی این سرویس فعال نشده است. همچنان می‌توانید هشدارهای رسمی را مستقیم در همین صفحه بررسی کنید.',
		subscriptionEmailDesc: 'دریافت ایمیل هنگام انتشار هشدارهای معتبر {authority} برای {place}. نیازمند تأیید ایمیل.',
		subscriptionEmailLabel: 'نشانی ایمیل',
		subscriptionSeverityLabel: 'حداقل شدت',
		subscriptionSeverityModerate: 'متوسط و بالاتر',
		subscriptionSeveritySevere: 'شدید و بحرانی',
		subscriptionSeverityExtreme: 'فقط بحرانی',
		subscriptionSubmitBtn: 'درخواست اعلان ایمیلی',
		pushHeading: 'اعلان فوری مرورگر (Push)',
		pushActiveBadge: 'فعال',
		pushUnsupportedNotice: 'اعلان فوری مرورگر نیازمند HTTPS، سرویس‌ورکر و PushManager است.',
		pushUnavailableNotice: 'اعلان فوری مرورگر روی این سرور پیکربندی نشده است. بررسی زنده در «اطراف من» فعال است.',
		pushPermissionDeniedTitle: 'دسترسی اعلان مسدود شده است',
		pushPermissionDeniedBody: 'مجوز اعلان در مرورگر رد شده است. برای فعال‌سازی مجدد، مجوز Notifications را در تنظیمات مرورگر باز کنید.',
		pushReadyBody: 'دریافت اعلان رمزنگاری‌شده هشدارهای رسمی حتی زمانی که برگه مرورگر بسته است.',
		pushEnableBtn: 'فعال‌سازی اعلان هشدارها',
		pushDisableBtn: 'غیرفعال‌سازی اعلان‌ها',
		pushActiveSummary: 'اعلان فوری مرورگر برای هشدارهای نزدیک {place} فعال است.',
		pushDisabledSuccess: 'اعلان فوری مرورگر برای همه مکان‌ها در این مرورگر غیرفعال شد.',
		pushEnablePlaceBtn: 'فعال‌سازی برای این مکان',
		pushDisablePlaceBtn: 'غیرفعال‌سازی این مکان',
		pushDisableDeviceBtn: 'غیرفعال‌سازی کل مرورگر',
		pushOtherPlacesNote: 'همچنین برای {count} مکان دیگر در این مرورگر فعال است.',
		pushRetryBtn: 'تلاش دوباره',
		pushPlaceDisabledSuccess: 'اعلان فوری برای {place} غیرفعال شد.',
		pushPlaceDisabledOthersActive: 'اعلان فوری برای {place} غیرفعال شد. {count} مکان دیگر در این مرورگر همچنان فعال است.',
		pushServerRegFailedRetry: 'مجوز مرورگر تأیید شد اما ثبت این مکان در سرور ناموفق بود. برای تکمیل دوباره تلاش کنید.',
		pushBrowserUnsubFailedRetry: 'ارسال هشدار از سرور متوقف شد اما لغو اشتراک در مرورگر کامل نشد. برای پاک‌سازی دوباره تلاش کنید.',
		pushServerUnsubFailedRetry: 'ارتباط با سرور برای لغو اشتراک برقرار نشد. وضعیت محلی برای تلاش مجدد حفظ شد.',
		pushIncompleteKeysError: 'مرورگر کلیدهای اشتراک اعلان ناقص برگرداند. دوباره تلاش کنید.',
		emailSubFailedError: 'ثبت درخواست اعلان ایمیلی ناموفق بود. لطفاً دوباره تلاش کنید.',
		emailConfirmFailedError: 'تأیید اشتراک ایمیل ناموفق بود. لطفاً دوباره تلاش کنید.',
		emailUnsubFailedError: 'لغو اشتراک در حال حاضر ممکن نیست. لطفاً دوباره تلاش کنید.',
		authoritySourceCoverageHeading: 'پوشش و تازگی منابع رسمی',
		verifiedEmergencyContactsLabel: 'شماره‌های اضطراری تأییدشده',
		lastVerifiedLabel: 'آخرین بررسی موفق',
		notifCancelledNotice: 'مرجع رسمی هشدار بازشده ({id}) را لغو کرده است. وضعیت زنده فعلی در زیر نمایش داده می‌شود.',
		notifExpiredOrInactiveNotice: 'هشدار بازشده ({id}) دیگر فعال نیست (ممکن است منقضی یا به‌روزرسانی شده باشد). وضعیت رسمی فعلی در زیر نمایش داده می‌شود.',
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
		liveMonitorTitle: 'پایش زنده',
		activeEventsLabel: 'رویدادهای فعال',
		windowLabel: 'بازه زمانی',
		scopeLabel: 'محدوده',
		scopeActive: 'همه فعال‌ها',
		scopeStrict: 'بازه دقیق',
		filterWildfires: 'آتش‌سوزی‌ها',
		filterHotspots: 'نقاط حرارتی ماهواره',
		filterVolcanoes: 'آتشفشان‌ها',
		filterEarthquakes: 'زمین‌لرزه‌ها',
		scopeDisclosureLabel: 'محدوده داده و منابع',
		updatedLabel: 'به‌روزرسانی',
		justNowLabel: 'هم‌اکنون',
	},
	ms: {
		appTitle: 'AegisMap',
		appSubtitle: 'Sistem Pemantauan Bencana',
		skipToMain: 'Langkau ke kandungan utama',
		navNearMe: 'Berhampiran saya',
		navExploreEvents: 'Teroka peristiwa',
		archiveButtonLabel: 'Arkib',
		helpButtonLabel: 'Bantuan',
		languageLabel: 'Bahasa antara muka',
		installAppButton: 'Pasang AegisMap',
		installModalTitle: 'Pasang AegisMap',
		installModalSubtitle: 'Simpan senarai semak luar talian, lokasi disimpan, dan amaran cache terus pada peranti anda.',
		installIosStep1: '1. Ketik butang Kongsi dalam Safari (petak dengan anak panah ke atas).',
		installIosStep2: '2. Tatal ke bawah dan pilih "Add to Home Screen", kemudian ketik Add.',
		installAndroidStep: 'Buka menu pelayar (⋮) dan pilih "Install app" atau "Add to Home screen".',
		installDesktopStep: 'Klik ikon pasang pada bar alamat (Chrome atau Edge) atau Menu Pelayar → Apps → Install AegisMap.',
		installNotificationsNote: 'Pemasangan aplikasi tidak menghidupkan pemberitahuan amaran secara automatik; daftar masuk secara berasingan di Berhampiran saya.',
		installShortcutNote: 'Pelayar mengurus pintasan aplikasi mengikut dasar OS; tiada pintasan desktop tambahan ditambah secara senyap.',
		installNativePromptBtn: 'Pasang melalui gesaan pelayar',
		closeButton: 'Tutup',
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
		gpsRefining: 'Lokasi kasar diperoleh — menajamkan ketepatan…',
		gpsStatusDenied: 'Kebenaran lokasi ditolak. Cari nama bandar atau masukkan koordinat di bawah.',
		gpsStatusTimeout: 'Permintaan lokasi tamat masa. Cuba lagi, cari nama, atau masukkan koordinat di bawah.',
		gpsStatusUnavailable: 'Lokasi peranti tidak tersedia dalam pelayar ini. Cari atau masukkan koordinat di bawah.',
		gpsStatusInsecureContext: 'Lokasi memerlukan konteks selamat HTTPS (atau localhost). Cari nama bandar atau masukkan koordinat.',
		gpsStatusLowAccuracy: 'Ketepatan lokasi kasar (>5 km). Sahkan bandar anda atau laraskan koordinat.',
		gpsCountryUncertain: 'Lokasi berhampiran sempadan atau kasar; sahkan negara / pihak berkuasa di bawah jika perlu.',
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
		helpSectionTitle: 'Bantuan Tempatan & Nombor Kecemasan',
		presentJurisdictionLabel: 'Negara tempat anda berada sekarang (untuk nombor kecemasan)',
		presentJurisdictionHint: 'Nombor kecemasan bergantung pada negara keberadaan fizikal anda sekarang, berasingan daripada lokasi yang dipantau.',
		copyLocationButton: 'Salin kad lokasi',
		shareLocationButton: 'Kongsi lokasi',
		handoffDisclaimer: 'Panggilan, SMS, atau kongsi hanya membuka aplikasi peranti anda. AegisMap tidak menghantar lokasi secara automatik.',
		privateLocationHeading: 'Kad Lokasi Peribadi (Dikongsi Hanya Atas Pilihan Anda)',
		editCoordsLabel: 'Sunting koordinat jika perlu',
		optionalNoteLabel: 'Nota ringkas pilihan',
		optionalNotePlaceholder: 'cth., Mercu tanda atau tingkat…',
		officialGuidanceLinksHeading: 'Pautan Panduan Kecemasan Rasmi',
		subscriptionHeading: 'Langganan Makluman Amaran (Pilihan)',
		subscriptionUnavailableTitle: 'Makluman e-mel tidak tersedia buat masa ini',
		subscriptionUnavailableBody: 'Penghantaran e-mel automatik tidak diaktifkan pada perkhidmatan ini. Anda masih boleh menyemak amaran rasmi secara terus di halaman ini.',
		subscriptionEmailDesc: 'Terima kemas kini e-mel apabila {authority} menerbitkan amaran sah yang sepadan dengan {place}. Memerlukan pengesahan e-mel.',
		subscriptionEmailLabel: 'Alamat e-mel',
		subscriptionSeverityLabel: 'Tahap minimum',
		subscriptionSeverityModerate: 'Sederhana & ke atas',
		subscriptionSeveritySevere: 'Teruk & Melampau',
		subscriptionSeverityExtreme: 'Melampau sahaja',
		subscriptionSubmitBtn: 'Mohon Makluman E-mel',
		pushHeading: 'Pemberitahuan Tolak Pelayar',
		pushActiveBadge: 'Dilanggan',
		pushUnsupportedNotice: 'Tolak Pelayar memerlukan pelayar HTTPS moden dengan sokongan Service Worker dan PushManager.',
		pushUnavailableNotice: 'Pemberitahuan tolak pelayar belum dikonfigurasi pada pelayan ini. Semakan langsung Berhampiran saya kekal tersedia.',
		pushPermissionDeniedTitle: 'Kebenaran pemberitahuan disekat',
		pushPermissionDeniedBody: 'Pemberitahuan disekat oleh pelayar. Tetapkan semula kebenaran Notifications untuk laman ini dalam tetapan pelayar.',
		pushReadyBody: 'Terima pemberitahuan tolak disulitkan untuk amaran rasmi walaupun tab ditutup.',
		pushEnableBtn: 'Aktifkan pemberitahuan amaran',
		pushDisableBtn: 'Matikan pemberitahuan',
		pushActiveSummary: 'Pemberitahuan tolak pelayar diaktifkan untuk amaran berhampiran {place}.',
		pushDisabledSuccess: 'Pemberitahuan tolak pelayar telah dimatikan untuk semua lokasi pada pelayar ini.',
		pushEnablePlaceBtn: 'Aktifkan untuk lokasi ini',
		pushDisablePlaceBtn: 'Matikan untuk lokasi ini',
		pushDisableDeviceBtn: 'Matikan pada pelayar ini',
		pushOtherPlacesNote: 'Juga aktif untuk {count} lokasi lain pada pelayar ini.',
		pushRetryBtn: 'Cuba semula',
		pushPlaceDisabledSuccess: 'Makluman tolak dimatikan untuk {place}.',
		pushPlaceDisabledOthersActive: 'Makluman tolak dimatikan untuk {place}. {count} lokasi lain kekal aktif pada pelayar ini.',
		pushServerRegFailedRetry: 'Kebenaran pelayar berjaya, tetapi pendaftaran lokasi di pelayan gagal. Cuba semula untuk melengkapkan.',
		pushBrowserUnsubFailedRetry: 'Makluman pelayan dihentikan, tetapi pelayar gagal menamatkan langganan. Cuba semula untuk melengkapkan.',
		pushServerUnsubFailedRetry: 'Tidak dapat menghubungi pelayan untuk mematikan makluman. Keadaan tempatan dikekalkan untuk cuba semula.',
		pushIncompleteKeysError: 'Pelayar mengembalikan kunci langganan tolak yang tidak lengkap. Sila cuba lagi.',
		emailSubFailedError: 'Permintaan makluman e-mel gagal. Sila cuba lagi.',
		emailConfirmFailedError: 'Pengesahan langganan e-mel gagal. Sila cuba lagi.',
		emailUnsubFailedError: 'Gagal menyahlanggan buat masa ini. Sila cuba lagi.',
		authoritySourceCoverageHeading: 'Liputan & Kesegaran Sumber Rasmi',
		verifiedEmergencyContactsLabel: 'Nombor Kecemasan Disahkan',
		lastVerifiedLabel: 'Disahkan terakhir',
		notifCancelledNotice: 'Pihak berkuasa rasmi telah membatalkan amaran yang dibuka ({id}). Status rasmi terkini dipaparkan di bawah.',
		notifExpiredOrInactiveNotice: 'Amaran yang dibuka ({id}) tidak lagi aktif (mungkin telah tamat tempoh atau dikemas kini). Status rasmi terkini dipaparkan di bawah.',
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
		liveMonitorTitle: 'Pemantau Langsung',
		activeEventsLabel: 'Peristiwa Aktif',
		windowLabel: 'Tempoh',
		scopeLabel: 'Skop',
		scopeActive: 'Aktif',
		scopeStrict: 'Ketat',
		filterWildfires: 'Kebakaran Hutan',
		filterHotspots: 'Titik Panas Satelit',
		filterVolcanoes: 'Gunung Berapi',
		filterEarthquakes: 'Gempa Bumi',
		scopeDisclosureLabel: 'Skop data & sumber',
		updatedLabel: 'Dikemas kini',
		justNowLabel: 'Baru sahaja',
	},
};

export function isAppLocale(value: unknown): value is AppLocale {
	return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isRtlLocale(locale: AppLocale): boolean {
	return locale === 'fa';
}

export function parseExplicitLocaleParam(raw: string | null | undefined): AppLocale | null {
	if (!raw || typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (isAppLocale(trimmed)) return trimmed;
	const lower = trimmed.toLowerCase();
	if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh-sg' || lower === 'zh-hans') {
		return 'zh-Hans';
	}
	if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo' || lower === 'zh-hant') {
		return 'en';
	}
	if (lower === 'fa' || lower.startsWith('fa-')) return 'fa';
	if (lower === 'ms' || lower.startsWith('ms-')) return 'ms';
	if (lower === 'en' || lower.startsWith('en-')) return 'en';
	return null;
}

/**
 * Resolve browser navigator.languages into a supported app locale:
 * - zh-CN, zh-SG, zh-MY, zh-Hans, bare zh -> 'zh-Hans'
 * - zh-TW, zh-HK, zh-MO, zh-Hant -> explicit fallback 'en' (never silently convert Traditional Chinese requests to Simplified)
 * - fa* -> 'fa', ms* -> 'ms', else 'en'
 */
export function matchBrowserLocale(languages: readonly string[] | undefined): AppLocale {
	if (!languages || languages.length === 0) return 'en';
	for (const raw of languages) {
		if (typeof raw !== 'string') continue;
		const tag = raw.trim().toLowerCase();
		if (!tag) continue;
		if (tag === 'zh-tw' || tag === 'zh-hk' || tag === 'zh-mo' || tag.startsWith('zh-hant')) {
			return 'en';
		}
		if (
			tag === 'zh' ||
			tag === 'zh-cn' ||
			tag === 'zh-sg' ||
			tag === 'zh-my' ||
			tag.startsWith('zh-hans') ||
			tag.startsWith('zh-cn-')
		) {
			return 'zh-Hans';
		}
		if (tag === 'fa' || tag.startsWith('fa-')) return 'fa';
		if (tag === 'ms' || tag.startsWith('ms-')) return 'ms';
		if (tag === 'en' || tag.startsWith('en-')) return 'en';
	}
	return 'en';
}

export function selectPreferredWarningTranslationIndex(
	translations: ReadonlyArray<{ language: string }>,
	locale: string,
): number {
	if (translations.length <= 1) return 0;
	const target = locale.toLowerCase();
	if (target === 'zh-hans' || target.startsWith('zh')) {
		const exact = translations.findIndex((tr) => /^zh[-_](hans|cn|sg)/i.test(tr.language));
		if (exact >= 0) return exact;
		const genericZh = translations.findIndex((tr) => /^zh\b/i.test(tr.language) && !/hant|tw|hk|mo/i.test(tr.language));
		if (genericZh >= 0) return genericZh;
		return 0;
	}
	const prefix = target.split('-')[0];
	const hit = translations.findIndex((tr) => {
		const l = tr.language.trim().toLowerCase();
		return l === target || l === prefix || l.startsWith(`${prefix}-`);
	});
	return hit >= 0 ? hit : 0;
}
