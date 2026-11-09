import { runtime } from '../en/runtime'

export const ruRuntime = {
  // Backend API errors (api.ts)
  'runtime.api.activeTwitchAccountChanged':
    'Активный аккаунт Twitch изменился. Повторите действие в выбранном аккаунте.',
  'runtime.api.connectTwitchFirst': 'Сначала подключите аккаунт Twitch на вкладке «Платформы».',
  'runtime.api.chatNoLongerSaved': 'Этот чат больше не сохранён.',
  'runtime.api.youtubeDefaultAccount': 'Чаты YouTube всегда отправляются с аккаунтом по умолчанию.',
  'runtime.api.accountPlatformMismatch':
    'Выберите сохранённый аккаунт, принадлежащий платформе этого чата.',
  'runtime.api.authExpired':
    '{action}: срок авторизации истёк — подключите аккаунт заново на вкладке «Платформы»',
  'runtime.api.httpStatus': '{action} (HTTP {status})',
  'runtime.api.action.twitchActivityFailed': 'Не удалось выполнить действие в активностях Twitch',
  'runtime.api.action.platformCommandFailed': 'Не удалось выполнить команду платформы',
  'runtime.api.action.loadChatSettings': 'Не удалось загрузить настройки чата',
  'runtime.api.action.checkModerationPermissions': 'Не удалось проверить права модерации',
  'runtime.api.action.moderationFailed': 'Не удалось выполнить действие модерации',
  'runtime.api.action.loadStreamInfo': 'Не удалось загрузить информацию о трансляции',
  'runtime.api.action.updateStream': 'Не удалось обновить трансляцию',
  'runtime.api.action.categorySearchFailed': 'Не удалось найти категории',
  'runtime.api.action.loadChannelStatus': 'Не удалось загрузить статус канала',
  'runtime.api.action.loadUserProfile': 'Не удалось загрузить профиль пользователя',
  'runtime.api.action.loadAccountDetails': 'Не удалось загрузить данные аккаунта',
  'runtime.api.moderationUnsupportedPlatform':
    'модерация: платформа «{platform}» не поддерживается',
  'runtime.api.moderationChannelRequired': 'модерация: требуется имя канала',
  'runtime.api.moderationAuthenticate': 'модерация: войдите в {platform} перед модерацией',
  'runtime.api.moderationCredentialsUnavailable': 'модерация: учётные данные {platform} недоступны',
  'runtime.api.chattersConnectTwitch':
    'Подключите аккаунт Twitch с правами модератора, чтобы увидеть список участников чата.',
  'runtime.api.chattersTwitchRejected':
    'Twitch отклонил учётные данные. Подключите аккаунт заново.',
  'runtime.api.chattersModeratorRequired':
    'Для просмотра списка участников чата нужны права модератора.',
  'runtime.api.chattersChannelNotFound': 'Канал не найден на Twitch.',
  'runtime.api.chattersTwitchUnavailable': 'Список участников чата Twitch сейчас недоступен.',
  'runtime.api.chattersKickUnavailable': 'Список участников чата Kick сейчас недоступен.',
  'runtime.api.twitchActivitiesNotInitialized': 'Активности Twitch не инициализированы.',
  'runtime.api.twitchWebSessionMismatch': 'Используйте веб-сессию подключённого аккаунта Twitch.',
  'runtime.api.twitchEventsNotInitialized': 'События Twitch не инициализированы.',
  'runtime.api.twitchEventsUpdateFailed': 'Не удалось обновить подписки на события Twitch.',
  'runtime.api.reconnectUnavailable': 'Переподключение чата недоступно.',
  'runtime.api.emoteReloadUnavailable': 'Обновление эмоутов недоступно.',
  'runtime.api.channelPlayersUnavailable': 'Проигрыватели каналов недоступны.',
  'runtime.api.playerSettingsUnavailable': 'Настройки проигрывателя недоступны.',
  'runtime.api.accountSwitchingUnavailable': 'Переключение аккаунтов не инициализировано.',
  'runtime.api.slashCommandHandler': 'Для слеш-команд используйте обработчик команд платформы.',
  'runtime.api.noChatAdapter': 'Адаптер чата {platform} не подключён.',
  'runtime.api.platformCommandsUnavailable': 'Команды платформы недоступны для {platform}.',
  'runtime.api.roomSettingsUnavailable': 'Настройки комнаты недоступны для {platform}.',
  'runtime.api.moderationRejected': 'действие модерации отклонено',
  'runtime.api.noAccountFound': 'Аккаунт {platform} не найден',
  'runtime.api.noAccessToken': 'Нет токена доступа для {platform}',
  'runtime.api.pluginTransportsUnavailable': 'Транспорты плагинов недоступны.',
  'runtime.api.chattersUnsupportedPlatform':
    'участники чата: платформа «{platform}» не поддерживается',
  'runtime.api.clipboardUnavailable': 'буфер обмена недоступен: {error}',

  // Backend bootstrap (server.ts)
  'runtime.server.connectTwitchActivities': 'Подключите Twitch, чтобы загрузить активности канала.',
  'runtime.server.saveTwitchWebSession':
    'Сохраните веб-сессию Twitch для опросов, прогнозов, наград и баллов зрителей. Снимки закреплённых сообщений останутся доступны.',
  'runtime.server.accountChatConnectFailed': 'Не удалось подключить чат аккаунта.',

  // Auto-updater (updater.ts)
  'runtime.updater.checking': 'Проверка обновлений',
  'runtime.updater.upToDate': 'У вас последняя версия',
  'runtime.updater.downloaded': 'Обновление загружено — перезапустите приложение',
  'runtime.updater.available': 'Доступно обновление {version}',
  'runtime.updater.checkFailed': 'Не удалось проверить обновления: {error}',
  'runtime.updater.noUpdateToDownload': 'Нет проверенного обновления для загрузки',
  'runtime.updater.downloading': 'Загрузка обновления',
  'runtime.updater.downloadFailed': 'Не удалось загрузить обновление: {error}',
  'runtime.updater.applying': 'Перезапуск для применения обновления',
  'runtime.updater.installFailed': 'Не удалось установить обновление: {error}',
  'runtime.updater.appImageRequired':
    'Нельзя обновить приложение в Linux без пути к AppImage (APPIMAGE).',

  // Image uploader (image-uploader.ts)
  'runtime.imageUploader.settingsOpenFailed':
    'Не удалось открыть настройки загрузчика изображений. Сохраните конфигурацию заново.',
  'runtime.imageUploader.uploaderChanged':
    'Загрузчик изображений изменился. Перезагрузите его настройки.',
  'runtime.imageUploader.browserOpenFailed': 'Не удалось открыть браузер.',
  'runtime.imageUploader.signInInProgress': 'Вход в Twir уже выполняется.',
  'runtime.imageUploader.settingsChanged':
    'Настройки загрузчика изображений изменились. Вставьте изображение снова.',

  // Plugins (packages.ts, manager.ts, process.ts)
  'runtime.plugins.manifestNotRegular':
    'Ожидался обычный файл манифеста плагина размером не более 32 КиБ.',
  'runtime.plugins.invalidManifest': 'Недопустимый манифест плагина{detail}.',
  'runtime.plugins.invalidRemotePointer': 'Недопустимый указатель удалённого плагина.',
  'runtime.plugins.invalidRemoteSource': 'Недопустимый удалённый источник плагина.',
  'runtime.plugins.entryNotRegularFile':
    'Точка входа плагина должна быть обычным файлом внутри пакета.',
  'runtime.plugins.invalidPackageDirectory': 'Недопустимый каталог установленного пакета.',
  'runtime.plugins.idMismatch':
    'Идентификатор установленного плагина не совпадает с именем каталога.',
  'runtime.plugins.incompatibleApi':
    'API плагина {apiVersion} несовместим с API TwirChat {currentApi}.',
  'runtime.plugins.packageTooDeep': 'Пакет плагина имеет слишком глубокую вложенность.',
  'runtime.plugins.packageTooManyFiles': 'Пакет плагина содержит слишком много файлов.',
  'runtime.plugins.packageRegularFilesOnly':
    'Пакеты плагинов могут содержать только обычные файлы.',
  'runtime.plugins.packageTooLarge': 'Пакет плагина превышает 16 МиБ.',
  'runtime.plugins.limitReached': 'Достигнут предел установленных плагинов.',
  'runtime.plugins.selectManifest': 'Выберите файл манифеста плагина manifest.json.',
  'runtime.plugins.alreadyInstalled': 'Плагин {id} уже установлен.',
  'runtime.plugins.packageOutsideInstallDir':
    'Выберите пакет плагина вне каталога установленных плагинов.',
  'runtime.plugins.updateMismatch':
    'Обновление не соответствует установленному удалённому плагину.',
  'runtime.plugins.invalidInstalledDirectory': 'Недопустимый каталог установленного плагина.',
  'runtime.plugins.updateDiscarded': 'Обновление удалённого плагина было отменено.',
  'runtime.plugins.remoteChangedDuringUpdate':
    'Установленный удалённый плагин изменился во время обновления.',
  'runtime.plugins.eventsDropped': 'Некоторые события чата были пропущены, пока плагин был занят.',
  'runtime.plugins.shuttingDown': 'Диспетчер плагинов завершает работу.',
  'runtime.plugins.updatedPluginNotActivated': 'Обновлённый плагин не запустился.',
  'runtime.plugins.remoteManifestDifferentPlugin':
    'Удалённый манифест принадлежит другому плагину.',
  'runtime.plugins.noLongerInstalled': 'Этот плагин больше не установлен.',
  'runtime.plugins.noRemoteSource': 'У этого плагина нет удалённого источника обновлений.',
  'runtime.plugins.remoteInstallInProgress':
    'Уже выполняется установка другого удалённого плагина.',
  'runtime.plugins.pluginIncompatible': 'Плагин несовместим.',
  'runtime.plugins.commandUnavailable': 'Команда плагина /{name} недоступна.',
  'runtime.plugins.commandAlreadyRegistered':
    'Команда /{name} уже зарегистрирована плагином {owner}.',
  'runtime.plugins.transportUnavailable': 'Транспорт этого плагина недоступен.',
  'runtime.plugins.channelLimitReached': 'Достигнут предел каналов плагина.',
  'runtime.plugins.channelReadOnly': 'Этот канал плагина доступен только для чтения.',
  'runtime.plugins.channelClosed': 'Этот канал плагина закрыт.',
  'runtime.plugins.processDisconnected': 'Процесс плагина отключился.',
  'runtime.plugins.activationTimedOut': 'Превышено время ожидания запуска плагина.',
  'runtime.plugins.processExited': 'Процесс плагина завершился (код {code}).',
  'runtime.plugins.noLongerRunning': 'Плагин больше не запущен.',
  'runtime.plugins.tooManyRequests': 'Слишком много ожидающих запросов плагина.',
  'runtime.plugins.requestTimedOut': 'Превышено время ожидания запроса плагина ({action}).',
  'runtime.plugins.tooManyDesktopRequests': 'Слишком много ожидающих запросов к приложению.',
  'runtime.plugins.invalidIpcMessage': 'Недопустимое IPC-сообщение плагина.',
  'runtime.plugins.duplicateRegistration': 'Плагин отправил повторную регистрацию.',
  'runtime.plugins.wasDisabled': 'Плагин был отключён.',
} satisfies Record<keyof typeof runtime, string>
