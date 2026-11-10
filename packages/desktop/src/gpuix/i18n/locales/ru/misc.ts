import { misc } from '../en/misc'

export const ruMisc = {
  'misc.emote.openImage': 'Открыть изображение',
  'misc.emote.viewOn': 'Открыть на {provider}',
  'misc.emote.removeFavorite': 'Убрать из избранного',
  'misc.emote.addFavorite': 'Добавить в избранное',
  'misc.streamerMode.enabled': 'Режим стримера включён',
  'misc.streamerMode.disabled': 'Режим стримера выключен',
  'misc.streamerMode.automaticSuffix': ' (автоматически)',
  'misc.toggle.selected': 'Выбрано',
  'misc.userCard.openFor': 'Открыть карточку пользователя {name}',

  'misc.twitchActivities.capability.checking':
    'Проверка доступности обновлений в реальном времени…',
  'misc.twitchActivities.capability.unavailable': 'Обновления в реальном времени недоступны',
  'misc.twitchActivities.capability.pins': 'закреплённые',
  'misc.twitchActivities.capability.points': 'баллы',
  'misc.twitchActivities.capability.polls': 'опросы',
  'misc.twitchActivities.capability.predictions': 'прогнозы',
  'misc.twitchActivities.capability.rewards': 'награды',
  'misc.twitchActivities.capability.interval': ' каждые {seconds} с',
  'misc.twitchActivities.capability.eventsub':
    'В реальном времени через EventSub · обновление снимка{interval}: {sections}',
  'misc.twitchActivities.capability.eventsubPlain': 'В реальном времени через EventSub',
  'misc.twitchActivities.capability.snapshot': 'Обновление снимка{interval}{sections}',
  'misc.twitchActivities.queue.pageLimit':
    'Загружено 200 страниц очереди. Обработайте эти награды, прежде чем продолжить.',
  'misc.twitchActivities.queue.limitReached':
    'Достигнут лимит очереди (загружено {max}). Обработайте эти награды, прежде чем загружать ещё.',
  'misc.twitchActivities.queue.repeatedCursor':
    'Twitch повторил курсор очереди. Обновите очередь, чтобы продолжить.',
  'misc.twitchActivities.queue.loadedLimit':
    'Загружено наград: {max}. Обработайте их, прежде чем загружать ещё.',
  'misc.twitchActivities.queue.failure.one': '{count} награда: {error}',
  'misc.twitchActivities.queue.failure.few': '{count} награды: {error}',
  'misc.twitchActivities.queue.failure.many': '{count} наград: {error}',
  'misc.twitchActivities.queue.failure.other': '{count} награды: {error}',
  'misc.twitchActivities.queue.feedback.completed.one': 'Выполнено: {count}',
  'misc.twitchActivities.queue.feedback.completed.few': 'Выполнено: {count}',
  'misc.twitchActivities.queue.feedback.completed.many': 'Выполнено: {count}',
  'misc.twitchActivities.queue.feedback.completed.other': 'Выполнено: {count}',
  'misc.twitchActivities.queue.feedback.rejected.one': 'Отклонено и возвращено: {count}',
  'misc.twitchActivities.queue.feedback.rejected.few': 'Отклонено и возвращено: {count}',
  'misc.twitchActivities.queue.feedback.rejected.many': 'Отклонено и возвращено: {count}',
  'misc.twitchActivities.queue.feedback.rejected.other': 'Отклонено и возвращено: {count}',
  'misc.twitchActivities.queue.feedback.retrySuffix':
    '; неудачные элементы остались выбраны для повтора',

  'misc.userCard.created': 'Создан {date}',
  'misc.userCard.unavailable': 'Недоступно',
  'misc.userCard.followingSince': 'Отслеживает с {date}',
  'misc.userCard.followingSinceWithDuration': 'Отслеживает с {date} · {duration}',
  'misc.userCard.currentlySubscribed': 'Подписка активна',
  'misc.userCard.tier': 'Уровень {tier}',
  'misc.userCard.giftedBy': 'Подарок от {name}',
  'misc.userCard.giftedSub': 'Подарочная подписка',
  'misc.userCard.notCurrentlySubscribed': 'Подписка не активна',
  'misc.userCard.duration.zero': '0 секунд',
  'misc.userCard.duration.year.one': '{count} год',
  'misc.userCard.duration.year.few': '{count} года',
  'misc.userCard.duration.year.many': '{count} лет',
  'misc.userCard.duration.year.other': '{count} года',
  'misc.userCard.duration.month.one': '{count} месяц',
  'misc.userCard.duration.month.few': '{count} месяца',
  'misc.userCard.duration.month.many': '{count} месяцев',
  'misc.userCard.duration.month.other': '{count} месяца',
  'misc.userCard.duration.day.one': '{count} день',
  'misc.userCard.duration.day.few': '{count} дня',
  'misc.userCard.duration.day.many': '{count} дней',
  'misc.userCard.duration.day.other': '{count} дня',
  'misc.userCard.duration.hour.one': '{count} час',
  'misc.userCard.duration.hour.few': '{count} часа',
  'misc.userCard.duration.hour.many': '{count} часов',
  'misc.userCard.duration.hour.other': '{count} часа',
  'misc.userCard.duration.minute.one': '{count} минута',
  'misc.userCard.duration.minute.few': '{count} минуты',
  'misc.userCard.duration.minute.many': '{count} минут',
  'misc.userCard.duration.minute.other': '{count} минуты',
  'misc.userCard.duration.second.one': '{count} секунда',
  'misc.userCard.duration.second.few': '{count} секунды',
  'misc.userCard.duration.second.many': '{count} секунд',
  'misc.userCard.duration.second.other': '{count} секунды',
  'misc.userCard.subMonths.one': '{count} месяц',
  'misc.userCard.subMonths.few': '{count} месяца',
  'misc.userCard.subMonths.many': '{count} месяцев',
  'misc.userCard.subMonths.other': '{count} месяца',

  'misc.moderation.banned': 'Пользователь забанен.',
  'misc.moderation.unbanned': 'Бан или тайм-аут снят.',
  'misc.moderation.chooseTimeout': 'Выберите настроенную кнопку тайм-аута, начиная с 1.',
  'misc.moderation.timedOut': 'Тайм-аут на {label}.',

  'misc.pluginChannels.enablePlugin': 'Включите плагин для {name}, чтобы подключиться.',
  'misc.pluginChannels.transportUnavailable': 'Этот транспорт плагина недоступен.',
  'misc.pluginChannels.channelIdentifier': 'Введите идентификатор канала до 256 символов.',
  'misc.pluginChannels.notConnected': 'Этот канал не подключён.',
  'misc.pluginChannels.readOnly': 'Этот транспорт плагина доступен только для чтения.',
  'misc.pluginChannels.messageLength': 'Введите сообщение до 4000 символов.',
  'misc.pluginChannels.notOpen': 'Этот канал не открыт.',

  'misc.chatSearch.closeQuote': 'Закройте кавычку, чтобы завершить фразу.',

  'misc.layoutTree.duplicateIds': 'Найдены повторяющиеся идентификаторы узлов',
  'misc.layoutTree.invalidFlex': 'Недопустимые значения flex (должны быть от 0 до 100)',

  'misc.twitchAdapter.anonymous': 'Аноним',
  'misc.twitchAdapter.unknownName': 'Неизвестный',
  'misc.twitchAdapter.someone': 'Кто-то',
  'misc.twitchAdapter.anonymousSend':
    'Нельзя отправлять сообщения в анонимном режиме. Войдите в Twitch.',
  'misc.twitchAdapter.clientNotInitialized': 'Клиент чата Twitch не инициализирован',
  'misc.twitchAdapter.notConnected': 'Чат Twitch не подключён',
  'misc.twitchAdapter.accountChangedBeforeSend':
    'Аккаунт Twitch изменился перед отправкой. Проверьте черновик и отправьте снова.',
  'misc.twitchAdapter.communityGift.one': 'Сообществу подарена {count} подписка от {name}',
  'misc.twitchAdapter.communityGift.few': 'Сообществу подарены {count} подписки от {name}',
  'misc.twitchAdapter.communityGift.many': 'Сообществу подарено {count} подписок от {name}',
  'misc.twitchAdapter.communityGift.other': 'Сообществу подарено {count} подписки от {name}',
  'misc.twitchAdapter.communityGiftUnknown': 'Сообщество получило подписки в подарок от {name}',
  'misc.twitchAdapter.rewardGift.one': 'За Cheer от {name} передана {count} награда',
  'misc.twitchAdapter.rewardGift.few': 'За Cheer от {name} переданы {count} награды',
  'misc.twitchAdapter.rewardGift.many': 'За Cheer от {name} передано {count} наград',
  'misc.twitchAdapter.rewardGift.other': 'За Cheer от {name} передано {count} награды',
  'misc.twitchAdapter.rewardGiftUnknown': 'За Cheer от {name} переданы награды',
  'misc.twitchAdapter.banned': '@{user} забанен',
  'misc.twitchAdapter.timedOut': '@{user} получил тайм-аут на {seconds} с',
  'misc.twitchAdapter.timedOutNoDuration': '@{user} получил тайм-аут',
  'misc.twitchAdapter.messageDeletedFrom': 'Удалено сообщение от @{user}',
  'misc.twitchAdapter.messageDeleted': 'Удалено сообщение в чате',
  'misc.twitchAdapter.chatCleared': 'Чат очищен',
  'misc.twitchAdapter.slowModeEnabled': 'Медленный режим включён ({seconds} с)',
  'misc.twitchAdapter.slowModeDisabled': 'Медленный режим выключен',
  'misc.twitchAdapter.followersOnlyDisabled': 'Режим «только для фолловеров» выключен',
  'misc.twitchAdapter.followersOnlyEnabledMinutes':
    'Режим «только для фолловеров» включён (минимум {minutes} мин)',
  'misc.twitchAdapter.followersOnlyEnabled': 'Режим «только для фолловеров» включён',
  'misc.twitchAdapter.subscribersOnlyEnabled': 'Режим «только для подписчиков» включён',
  'misc.twitchAdapter.subscribersOnlyDisabled': 'Режим «только для подписчиков» выключен',
  'misc.twitchAdapter.emoteOnlyEnabled': 'Режим «только для эмоутов» включён',
  'misc.twitchAdapter.emoteOnlyDisabled': 'Режим «только для эмоутов» выключен',
  'misc.twitchAdapter.uniqueChatEnabled': 'Режим уникальных сообщений включён',
  'misc.twitchAdapter.uniqueChatDisabled': 'Режим уникальных сообщений выключен',
  'misc.twitchAdapter.months.one': '{count} месяц',
  'misc.twitchAdapter.months.few': '{count} месяца',
  'misc.twitchAdapter.months.many': '{count} месяцев',
  'misc.twitchAdapter.months.other': '{count} месяца',
  'misc.twitchAdapter.withPrime': ' с Prime',
  'misc.twitchAdapter.forMonths': ' на {months}',
  'misc.twitchAdapter.resubscribed': 'Подписка {name} продлена{subscription}{duration}.',
  'misc.twitchAdapter.subscribed': 'Оформлена подписка {name}{subscription}.',
  'misc.twitchAdapter.giftSubTo': 'Подарок в виде подписки от {gifter} для {recipient}.',
  'misc.twitchAdapter.giftSub': 'Подарок в виде подписки от {gifter}.',
  'misc.twitchAdapter.raidedWith.one': 'Рейд от {name}: {count} зритель.',
  'misc.twitchAdapter.raidedWith.few': 'Рейд от {name}: {count} зрителя.',
  'misc.twitchAdapter.raidedWith.many': 'Рейд от {name}: {count} зрителей.',
  'misc.twitchAdapter.raidedWith.other': 'Рейд от {name}: {count} зрителя.',
  'misc.twitchAdapter.raided': 'Рейд от {name} на канал.',

  'misc.youtubeRelay.backendDisconnected': 'Бэкенд отключён. Ожидание возобновления чата YouTube…',
  'misc.youtubeRelay.waitingForBackend':
    'Ожидание подключения к бэкенду для анонимного чата YouTube…',

  'misc.kick.backendRefused': 'Бэкенд Kick недоступен (соединение отклонено).',
  'misc.kick.backendTimeout': 'Запрос к бэкенду Kick превысил время ожидания.',
  'misc.kick.backendFailed':
    'Запрос к бэкенду Kick завершился ошибкой. Проверьте подключение к бэкенду.',

  'misc.kickAdapter.chatroomHttp': 'Бэкенд чата Kick вернул ошибку (HTTP {status}).',
  'misc.kickAdapter.chatroomInvalid': 'Бэкенд чата Kick вернул недопустимый или недоступный канал.',
  'misc.kickAdapter.accountChangedDelivered':
    'Аккаунт Kick изменился во время отправки. Доставку не удалось подтвердить; проверьте чат перед повтором.',
  'misc.kickAdapter.accountChanged':
    'Аккаунт Kick изменился. Проверьте черновик и отправьте снова.',
  'misc.kickAdapter.credentialsAfterRefresh':
    'Учётные данные Kick по-прежнему недоступны после обновления. Войдите снова.',
  'misc.kickAdapter.authUnavailableSignIn': 'Аутентификация Kick недоступна. Войдите снова.',
  'misc.kickAdapter.signInBeforeSending': 'Войдите в Kick, прежде чем отправлять сообщения.',
  'misc.kickAdapter.signInAsAgain': 'Войдите в Kick как @{name} снова.',
  'misc.kickAdapter.credentialsUnavailable':
    'Учётные данные Kick недоступны после обновления. Войдите снова.',
  'misc.kickAdapter.authUnavailable': 'Аутентификация Kick недоступна.',
  'misc.kickAdapter.credentialsRejected':
    'Kick отклонил текущие учётные данные. Обновите их или войдите снова.',
  'misc.kickAdapter.deliveryUnconfirmed':
    'Не удалось подтвердить доставку сообщения Kick. Проверьте чат перед повтором.',
  'misc.kickAdapter.channelNotReady': 'Канал Kick не готов. Переподключите чат перед отправкой.',
  'misc.kickAdapter.messageRejectedHttp': 'Сообщение Kick отклонено (HTTP {status}).',
  'misc.kickAdapter.messageRejectedFrom': 'Kick отклонил сообщение от @{name} (HTTP {status}).',
  'misc.kickAdapter.notSent': 'Kick не отправил сообщение.',
  'misc.kickAdapter.connectionTimeout': 'Время ожидания подключения Kick истекло.',

  'misc.accountSender.otherAccountUnavailable':
    'Отправка от другого аккаунта недоступна для платформы {platform}.',
  'misc.twitchSender.blocked': 'Twitch заблокировал сообщение',
  'misc.twitchSender.connectionTimeout': 'Чат Twitch не принял подключение вовремя.',
  'misc.twitchSender.credentialsRejected': 'Twitch отклонил учётные данные аккаунта.',
  'misc.twitchSender.signInAgain': 'Войдите в этот аккаунт Twitch снова.',
  'misc.twitchSender.closedBeforeSending': 'Чат Twitch был закрыт до отправки.',
  'misc.twitchSender.disconnectedBeforeDelivery':
    'Чат Twitch отключился до подтверждения доставки.',
  'misc.twitchSender.notSent': 'Twitch не отправил сообщение от @{name}: {reason}.',
  'misc.twitchSender.reject.ratelimit': 'вы отправляете сообщения слишком быстро',
  'misc.twitchSender.reject.duplicate': 'такое же сообщение было отправлено менее 30 секунд назад',
  'misc.twitchSender.reject.subsonly': 'в чате включён режим «только подписчики»',
  'misc.twitchSender.reject.followersonly': 'в чате включён режим «только фолловеры»',
  'misc.twitchSender.reject.emoteonly': 'в чате включён режим «только эмоуты»',
  'misc.twitchSender.reject.slowmode': 'в чате включён медленный режим, подождите',
  'misc.twitchSender.reject.r9k': 'в чате включён режим уникальных сообщений',
  'misc.twitchSender.reject.timedout': 'аккаунт находится в тайм-ауте в этом чате',
  'misc.twitchSender.reject.banned': 'аккаунт забанен в этом чате',
  'misc.twitchSender.reject.verifiedEmail': 'для чата требуется подтверждённый email',
  'misc.twitchSender.reject.noPermission': 'у аккаунта нет прав для этого действия',

  'misc.twitchEventSub.removeFailed':
    'Не удалось удалить подписку на события Twitch. Она будет отброшена при закрытии подключения.',
  'misc.twitchEventSub.invalidReconnectUrl': 'Twitch передал недопустимый URL переподключения.',
  'misc.twitchEventSub.revoked':
    'Подписка Twitch отозвана: {reason}. Переподключите Twitch, если авторизация была отозвана.',
  'misc.twitchEventSub.unknownReason': 'неизвестная причина',
  'misc.twitchEventSub.migrationFailed': 'Не удалось перенести подключение Twitch.',
  'misc.twitchEventSub.connectionFailed': 'Не удалось подключиться к событиям Twitch.',
  'misc.twitchEventSub.timedOut':
    'Время ожидания подключения к событиям Twitch истекло; переподключение.',
  'misc.twitchEventSub.subscribeFailed':
    'Не удалось подписаться на события Twitch. Переподключите Twitch, чтобы обновить разрешения.',

  'misc.kickRefresh.requestFailed':
    'Запрос к бэкенду аутентификации Kick завершился ошибкой. Проверьте подключение к бэкенду.',
  'misc.kickRefresh.noCredentials':
    'Аккаунт Kick недоступен или не имеет учётных данных для обновления. Войдите снова.',
  'misc.kickRefresh.refreshedRecently':
    'Учётные данные Kick были обновлены недавно. Подождите несколько секунд перед повтором.',
  'misc.kickRefresh.accountChanged':
    'Аккаунт Kick изменился во время обновления. Старый результат отброшен.',
  'misc.kickRefresh.rejected':
    'Учётные данные Kick для обновления отклонены. Войдите в Kick снова.',
  'misc.kickRefresh.backendHttp': 'Бэкенд аутентификации Kick вернул ошибку (HTTP {status}).',
  'misc.kickRefresh.invalidJson': 'Бэкенд аутентификации Kick вернул некорректный JSON.',
  'misc.kickRefresh.invalidToken':
    'Бэкенд аутентификации Kick вернул недопустимый ответ с токеном.',

  'misc.persisted.paletteColor': 'Ожидается шестнадцатеричный цвет.',

  'misc.obsRemoteProfiles.nameRequired': 'Введите название подключения.',
  'misc.obsRemoteProfiles.addressRequired': 'Введите адрес OBS WebSocket.',
  'misc.obsRemoteProfiles.addressInvalid': 'Введите адрес ws:// или wss:// без учётных данных.',
  'misc.obsRemoteProfiles.invalidLink': 'Недопустимая ссылка подключения OBS.',
  'misc.obsRemoteProfiles.invalidAddress': 'Недопустимый адрес WebSocket.',
  'misc.obsRemoteProfiles.readFailed': 'Не удалось прочитать сохранённые подключения OBS.',
  'misc.obsRemoteProfiles.invalidName': 'Недопустимое название подключения.',
  'misc.obsRemoteProfiles.passwordTooLong': 'Пароль OBS слишком длинный.',
  'misc.obsRemoteProfiles.removed': 'Это подключение было удалено.',
  'misc.obsRemoteProfiles.maxConnections': 'Можно сохранить до {max} подключений OBS.',
  'misc.obsRemoteProfiles.readPasswordFailed':
    'Не удалось прочитать пароль OBS. Измените подключение и сохраните его снова.',

  'misc.imageUploader.rejectedUpload': 'Хост изображений отклонил загрузку (HTTP {status}).',
  'misc.imageUploader.headerFormat':
    'Укажите каждый дополнительный заголовок в формате Имя: значение.',
  'misc.imageUploader.managedHeaders':
    'Content-Type, Content-Length, Host и Transfer-Encoding задаются загрузчиком.',
  'misc.imageUploader.headerInvalid':
    'У одного из дополнительных заголовков недопустимое имя или значение.',
  'misc.imageUploader.invalidSettings':
    'Настройки загрузчика изображений содержат недопустимое или слишком большое поле.',
  'misc.imageUploader.requestUrl': 'Введите URL запроса HTTP или HTTPS.',
  'misc.imageUploader.formField': 'Введите допустимое имя поля multipart-формы.',
  'misc.imageUploader.configTooLarge': 'Конфигурация загрузчика слишком большая.',
  'misc.imageUploader.invalidJson':
    'Скопируйте JSON загрузчика с полями Version, RequestURL, FileFormName и URL.',
  'misc.imageUploader.twirExport': 'Вход через Twir нельзя экспортировать.',
  'misc.imageUploader.emptyImage': 'Скопированное изображение пустое.',
  'misc.imageUploader.imageTooLarge': 'Скопированное изображение превышает 20 МиБ.',
  'misc.imageUploader.openFailed': 'Не удалось открыть файл скопированного изображения.',
  'misc.imageUploader.readFailed': 'Не удалось прочитать файл скопированного изображения.',
  'misc.imageUploader.invalidLink':
    'Ответ загрузки не содержит допустимой ссылки на изображение. Проверьте настройку «Ссылка на изображение».',
  'misc.imageUploader.closedEarly':
    'Соединение закрылось до того, как хост изображений завершил ответ.',
  'misc.imageUploader.oversizedResponse': 'Хост изображений вернул слишком большой ответ.',
  'misc.imageUploader.inProgress': 'Загрузка изображения уже выполняется.',
  'misc.imageUploader.disabled': 'Сначала включите загрузку изображений в настройках.',
  'misc.imageUploader.unsupportedImage': 'В буфере обмена нет поддерживаемого изображения.',
  'misc.imageUploader.unreachable': 'Не удалось связаться с настроенным хостом изображений.',
  'misc.imageUploader.redirected':
    'Хост изображений перенаправил запрос. Используйте итоговый URL загрузки.',
  'misc.imageUploader.canceled': 'Загрузка изображения отменена.',
  'misc.imageUploader.timedOut': 'Время загрузки изображения истекло.',
} satisfies Record<keyof typeof misc, string>
