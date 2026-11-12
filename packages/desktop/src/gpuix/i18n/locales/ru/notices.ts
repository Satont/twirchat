import { notices } from '../en/notices'

export const ruNotices = {
  'notices.app.connected': 'Подключено к {name}',
  'notices.app.disconnected': '{name}: соединение прервано',
  'notices.app.connectionError': '{name}: ошибка подключения',
  'notices.app.connectionErrorDetail': '{name}: {error}',
  'notices.app.emoteAdded': '7TV: эмоут {emote} добавлен в {channel}',
  'notices.app.emoteRemoved': '7TV: эмоут удалён из {channel}',
  'notices.app.emoteRenamed': '7TV: эмоут переименован в {emote} в {channel}',
  'notices.app.refreshAccountsFailed': 'Не удалось обновить аккаунты: {error}',
  'notices.app.authError': '{platform}: {error}',
  'notices.app.refreshHistoryFailed': 'Не удалось обновить историю чата: {error}',
  'notices.app.refreshStatusFailed': 'Не удалось обновить статус канала: {error}',

  'notices.moderation.chatCleared': '(чат очищен)',
  'notices.moderation.messageDeleted': '(сообщение удалено)',
  'notices.moderation.banned': '(забанен)',
  'notices.moderation.timedOut': '(тайм-аут на {duration})',
  'notices.moderation.durationDays.one': '{count} день',
  'notices.moderation.durationDays.few': '{count} дня',
  'notices.moderation.durationDays.many': '{count} дней',
  'notices.moderation.durationDays.other': '{count} дня',
  'notices.moderation.durationHours.one': '{count} час',
  'notices.moderation.durationHours.few': '{count} часа',
  'notices.moderation.durationHours.many': '{count} часов',
  'notices.moderation.durationHours.other': '{count} часа',
  'notices.moderation.durationMinutes.one': '{count} минута',
  'notices.moderation.durationMinutes.few': '{count} минуты',
  'notices.moderation.durationMinutes.many': '{count} минут',
  'notices.moderation.durationMinutes.other': '{count} минуты',
  'notices.moderation.durationSeconds.one': '{count} секунда',
  'notices.moderation.durationSeconds.few': '{count} секунды',
  'notices.moderation.durationSeconds.many': '{count} секунд',
  'notices.moderation.durationSeconds.other': '{count} секунды',

  'notices.customCommands.loadFailed': 'Не удалось загрузить сохранённые команды: {error}',
  'notices.customCommands.saveFailed': 'Не удалось сохранить команды: {error}',

  'notices.watchedSubscriptions.updateFailed':
    'Не удалось обновить подключения открытых чатов: {error}',

  'notices.hotkeys.shortcutFailed': 'Не удалось выполнить сочетание клавиш: {error}',
  'notices.hotkeys.actionUnavailable': 'Это действие недоступно в текущем окне.',

  'notices.autoMod.decisionFailed': 'Не удалось принять решение AutoMod.',

  'notices.search.messageNotInBuffer':
    'Этого сообщения больше нет в буфере открытого чата. Обновите поиск, чтобы обновить снимок.',
  'notices.search.revealFailed':
    'Не удалось показать сообщение на этой панели. Возможно, оно покинуло буфер; обновите поиск, чтобы обновить снимок.',

  'notices.layout.saveFailed': 'Не удалось сохранить раскладку: {error}',
  'notices.layout.splitFailed': 'Не удалось разделить панель: {error}',
  'notices.layout.closePaneFailed': 'Не удалось закрыть панель: {error}',
  'notices.layout.assignFailed': 'Не удалось назначить канал: {error}',
  'notices.layout.updatedLayoutUnavailable': 'Не удалось загрузить обновлённую раскладку.',
  'notices.layout.paneClosed': 'Эта панель больше не открыта.',
  'notices.layout.homeNeedsPane': 'В разделе «Мои каналы» должна остаться хотя бы одна панель.',
  'notices.layout.chatWindowClosed': 'Окно чата больше не открыто.',
  'notices.layout.targetLayoutUnavailable': 'Не удалось загрузить раскладку целевой вкладки.',
  'notices.layout.homeLayoutUnavailable': 'Раскладка «Моих каналов» недоступна.',
  'notices.layout.paneChannelMismatch': 'Эта панель больше не показывает выбранный канал.',
  'notices.layout.sourceLayoutUnavailable': 'Не удалось загрузить исходную раскладку.',
  'notices.layout.sourcePaneClosed': 'Исходная панель больше не открыта.',
  'notices.layout.clonedLayoutFailed': 'Не удалось создать копию раскладки.',

  'notices.chatTabs.recovered':
    'Не удалось прочитать сохранённые вкладки. Предыдущие вкладки каналов восстановлены; при следующих изменениях будет сохранена исправленная конфигурация.',
  'notices.chatTabs.compatibilitySaveFailed': 'Не удалось сохранить совместимость вкладок: {error}',
  'notices.chatTabs.tabClosed': 'Эта вкладка больше не открыта.',
  'notices.chatTabs.layoutUnavailable': 'Не удалось загрузить раскладку вкладки.',
  'notices.chatTabs.unlockBeforeClose': 'Открепите вкладку, прежде чем закрывать её.',
  'notices.chatTabs.closeBeforeRestore': 'Закройте вкладку, прежде чем восстанавливать другую.',
  'notices.chatTabs.closeBeforeOpen': 'Закройте вкладку, прежде чем открывать новую.',
  'notices.chatTabs.closeBeforeDuplicate': 'Закройте вкладку, прежде чем дублировать другую.',
  'notices.chatTabs.invalidColor': 'Укажите цвет в формате #RRGGBB.',
  'notices.chatTabs.unlockBeforeMove': 'Открепите вкладку, прежде чем перемещать её.',
  'notices.chatTabs.emptyTab': 'Пустая вкладка',

  'notices.homePlugin.sourceLimit':
    'Удалите источник плагина из «Моих каналов», прежде чем добавлять новый.',

  'notices.obs.connectionClosed': 'Соединение с OBS закрыто',
  'notices.obs.sessionClosed': 'Сеанс OBS закрыт',
  'notices.obs.requestTimedOut': 'Запрос к OBS превысил время ожидания',
  'notices.obs.connectionFailed': 'Не удалось подключиться к OBS',
  'notices.obs.refreshFailed': 'Не удалось обновить данные OBS',
  'notices.obs.sourceLimit': 'Коллекция сцен OBS превышает предельное число удалённых источников',
  'notices.obs.sceneLimit': 'Коллекция сцен OBS превышает предельное число удалённых сцен',
  'notices.obs.nestedLimit':
    'Вложенное дерево источников OBS превышает предельное число удалённых источников',
  'notices.obs.sourceMissing': 'Источник OBS больше не существует',

  'notices.translation.languageCode': 'Введите код языка, например en, ru, de или zh-CN.',
  'notices.translation.endpoint':
    'Укажите HTTPS-адрес провайдера без учётных данных, параметров запроса и фрагмента. Локальный LibreTranslate может использовать HTTP.',
  'notices.translation.settingsObject': 'Настройки перевода должны быть объектом.',
  'notices.translation.chooseProvider': 'Выберите провайдера перевода.',
  'notices.translation.chooseLanguages': 'Выберите исходный и целевой языки.',
  'notices.translation.invalidMode': 'Некорректный режим перевода.',
  'notices.translation.invalidConnection': 'Некорректные настройки подключения к провайдеру.',
  'notices.translation.azureRegion': 'Введите регион Azure, например eastus или westeurope.',
  'notices.translation.invalidChannelList': 'Некорректный список перевода по каналам.',
  'notices.translation.channelInvalid':
    'Для канала перевода нужны платформа, название канала и корректные режимы.',
  'notices.translation.channelDuplicate': 'Канал перевода указан более одного раза.',
  'notices.translation.protectedChanged':
    'Провайдер изменил защищённый эмоут, упоминание или ссылку. Ничего не отправлено.',
  'notices.translation.busy': 'Перевод занят. Повторите попытку позже.',
  'notices.translation.unreachable':
    'Не удалось связаться с {provider}. Проверьте подключение или выберите другого провайдера.',
  'notices.translation.invalidResponse': '{provider} вернул некорректный ответ ({status}).',
  'notices.translation.rejected': '{provider} отклонил перевод ({status}){detail}',
  'notices.translation.temporarilyUnavailable': '{provider} временно недоступен.',
  'notices.translation.apiKeyRequired': 'Укажите API-ключ {provider} в настройках перевода.',
  'notices.translation.incompleteGoogle': 'Google вернул неполный перевод.',
  'notices.translation.noText': '{provider} не вернул переведённый текст. Ничего не отправлено.',
  'notices.translation.tooLong':
    '{provider} вернул неожиданно длинный перевод. Ничего не отправлено.',
  'notices.translation.characterLimit': 'Переводите от 1 до 5000 символов за раз.',
  'notices.translation.invalidMorse': 'Исходный текст не является корректным кодом Морзе.',
  'notices.translation.deeplKey': 'Сначала укажите API-ключ DeepL.',
  'notices.translation.googleKey': 'Сначала укажите API-ключ Google Cloud.',
  'notices.translation.noLanguages': '{provider} не вернул список поддерживаемых языков.',
  'notices.translation.autoCommandUsage': 'Использование: {command} <язык|off>',
  'notices.translation.translateCommandUsage': 'Использование: /translate <сообщение>',
  'notices.translation.commandUsage': 'Использование: /{name} <язык> <сообщение>',

  'notices.streamerMode.invalidSettings': 'Некорректные настройки приватности стример-режима.',
  'notices.streamerMode.invalidConfiguration':
    'Выберите «Авто», «Вкл.» или «Выкл.» для стример-режима с корректными настройками приватности.',
  'notices.streamerMode.detectionTimeout':
    'Определение процесса трансляции превысило время ожидания.',
  'notices.streamerMode.detectionExitCode': 'Не удалось определить процессы (код выхода {code}).',
  'notices.streamerMode.processListTooLarge': 'Список процессов слишком большой.',
  'notices.streamerMode.detectionTimeoutOverride':
    'Определение процесса трансляции превысило время ожидания. Выберите «Вкл.» или «Выкл.», чтобы задать режим вручную.',
  'notices.streamerMode.detectionFailed': 'Не удалось определить программу трансляции: {error}',
  'notices.streamerMode.invalidMode':
    'Выберите «Авто», «Вкл.», «Выкл.» или «Переключить» для стример-режима.',

  'notices.privateCommands.whisperUsage': 'Использование: /w <пользователь> <сообщение>',
  'notices.privateCommands.replyUsage': 'Использование: /r <сообщение>',
  'notices.privateCommands.noRecipient':
    'Получатель шёпота ещё не выбран. Сначала используйте /w <пользователь> <сообщение>.',
  'notices.privateCommands.botUsage': 'Использование: /{command} <сообщение>',
  'notices.privateCommands.invalidRecipient':
    'Введите корректное имя пользователя Twitch для получателя шёпота.',
  'notices.privateCommands.emptyMessage': 'Сообщение шёпота не может быть пустым.',

  'notices.channelActions.invalidSettings': 'Некорректные настройки плеера.',
  'notices.channelActions.playerCustom': 'Пользовательский',
  'notices.channelActions.playerStreamlink': 'Streamlink',
  'notices.channelActions.invalidCommand': '{name}: некорректная команда плеера.',
  'notices.channelActions.commandHint':
    '{name}: укажите путь к исполняемому файлу и по одному непустому аргументу на строку.',
  'notices.channelActions.unknownPlaceholder':
    'Неизвестный заполнитель плеера {{token}}. Используйте {url}, {channel} или {platform}.',
  'notices.channelActions.urlRequired': '{name}: добавьте {url} в список аргументов.',
  'notices.channelActions.channelRequired': 'Укажите канал.',
  'notices.channelActions.invalidChannel':
    'Укажите корректный логин канала, ID канала YouTube или @имя.',
  'notices.channelActions.httpsRequired': 'Ссылки плеера должны использовать HTTPS.',
  'notices.channelActions.httpRequired': 'Ссылки плеера должны использовать HTTP или HTTPS.',
  'notices.channelActions.reconnectNoAccount':
    'Подключите аккаунт или выберите отслеживаемый канал, прежде чем переподключаться.',
  'notices.channelActions.reconnectFailed':
    'Некоторым чатам не удалось переподключиться: {failures}',
  'notices.channelActions.chooseEmoteKind': 'Выберите эмоуты канала или подписчика.',
  'notices.channelActions.subscriberNeedsAccount':
    'Подключите аккаунт, прежде чем обновлять эмоуты подписчика.',
  'notices.channelActions.subscriberTwitchOnly':
    'Обновление эмоутов подписчика поддерживается только для аккаунтов Twitch.',
  'notices.channelActions.subscriberScope':
    'Войдите в Twitch снова с разрешением user:read:emotes, чтобы обновить эмоуты подписчика.',
  'notices.channelActions.unknownMode': 'Неизвестный режим плеера.',
  'notices.channelActions.configureExecutable':
    'Сначала укажите исполняемый файл для «{name}» в настройках плеера.',
  'notices.channelActions.launchFailed':
    'Не удалось запустить плеер «{name}» ({executable}). Установите его или проверьте настройки плеера. {error}',
  'notices.channelActions.playerExited': 'Плеер завершился с кодом {code}.',

  'notices.twirCommands.channelLookup': 'Поиск канала Twir: HTTP {status}.',
  'notices.twirCommands.commandLookup': 'Поиск команд Twir: HTTP {status}.',
  'notices.twirCommands.invalidResponse': 'Twir вернул некорректный ответ.',
  'notices.jeetbotCommands.lookup': 'Поиск команд jeetbot: HTTP {status}.',
  'notices.jeetbotCommands.invalidResponse': 'jeetbot вернул некорректный ответ.',

  'notices.seventv.setChanged': 'Активный набор эмоутов изменён на «{name}»',
  'notices.seventv.setRenamed': 'Набор эмоутов «{oldName}» переименован в «{newName}»',
  'notices.seventv.setDeleted': 'Набор эмоутов «{name}» удалён',
  'notices.seventv.emotePrefix': 'Эмоут «{alias}» ',
  'notices.seventv.emoteAdded': '{prefix}{placeholder}{was} добавлен в канал',
  'notices.seventv.emoteRemoved': '{prefix}{placeholder}{was} удалён из канала',
  'notices.seventv.emoteUpdated': '{prefix}{placeholder}{was} переименован в канале',
  'notices.seventv.wasAlias': ' (был {alias})',
  'notices.seventv.actorSuffix': ' · Автор — {actor}',

  'notices.twitchModeration.unbanned': 'разбанил {user}',
  'notices.twitchModeration.removedTimeout': 'снял тайм-аут с {user}',
  'notices.twitchModeration.madeModerator': 'назначил {user} модератором',
  'notices.twitchModeration.removedModerator': 'снял права модератора с {user}',
  'notices.twitchModeration.madeVip': 'выдал {user} статус VIP',
  'notices.twitchModeration.removedVip': 'снял статус VIP с {user}',
  'notices.twitchModeration.warned': 'предупредил {user}',
  'notices.twitchModeration.raidStarted': 'запустил рейд на {user}',
  'notices.twitchModeration.raidCanceled': 'отменил рейд на {user}',
  'notices.twitchModeration.banned': 'забанил {user}',
  'notices.twitchModeration.timedOut': 'выдал тайм-аут {user}',
  'notices.twitchModeration.messageDeleted': 'удалил сообщение от {user}',
  'notices.twitchModeration.unbanApproved': 'одобрил запрос на разбан от {user}',
  'notices.twitchModeration.unbanDenied': 'отклонил запрос на разбан от {user}',
  'notices.twitchModeration.blockedTermAdded': 'добавил запрещённый термин',
  'notices.twitchModeration.blockedTermRemoved': 'удалил запрещённый термин',
  'notices.twitchModeration.permittedTermAdded': 'добавил разрешённый термин',
  'notices.twitchModeration.permittedTermRemoved': 'удалил разрешённый термин',
  'notices.twitchModeration.sharedChat': ' в #{channel} (Shared Chat)',

  'notices.twitchHistory.emptyResponse': 'Бэкенд истории вернул пустой ответ.',
  'notices.twitchHistory.tooLarge': 'Ответ истории слишком большой.',
  'notices.twitchHistory.badgesUnavailable': 'Значки канала недоступны.',
  'notices.twitchHistory.stopped': 'Загрузка истории остановлена.',
  'notices.twitchHistory.tooManyRequests':
    'Слишком много запросов истории. Повторите попытку позже.',
  'notices.twitchHistory.backendUnavailable': 'Бэкенд истории Twitch недоступен ({status}).',

  'notices.accounts.platformMismatch':
    'Выберите сохранённый аккаунт, принадлежащий этой платформе.',
  'notices.accounts.reconnectFailed':
    'Аккаунт выбран, но некоторым чатам не удалось переподключиться: {failures}',
  'notices.accounts.missing': 'Этот сохранённый аккаунт больше не существует.',
  'notices.startup.preferencesFailed': 'Не удалось загрузить настройки: {error}',
  'notices.startup.chatStateFailed': 'Не удалось загрузить состояние чатов: {error}',
  'notices.window.error': 'Ошибка окна: {error}',
  'notices.window.trayUnavailable': 'Системный трей недоступен: {error}',
  'notices.window.saveFailed': 'Не удалось сохранить окна: {error}',
  'notices.window.restoreFailed': 'Не удалось восстановить окна: {error}',
  'notices.window.restoreOneFailed': 'Не удалось восстановить {title}: {error}',
  'notices.window.cleanupFailed': 'Не удалось удалить данные закрытого окна: {error}',
  'notices.window.clickThroughUnsupported':
    'Этот композитор не поддерживает пропуск кликов сквозь оверлей.',
  'notices.window.closeOneFirst': 'Закройте одно из окон, прежде чем открывать новое.',
  'notices.window.noOverlay': 'Нет окна оверлея, которое можно изменить.',
} satisfies Record<keyof typeof notices, string>
