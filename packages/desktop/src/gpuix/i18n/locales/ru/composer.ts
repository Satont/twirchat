import { composer } from '../en/composer'

export const ruComposer = {
  'composer.connection.connecting': 'Подключение к {channel}…',
  'composer.connection.disconnected': '{channel}: нет подключения',
  'composer.connection.error': 'Не удалось подключиться к {channel}',

  'composer.placeholder.message': 'Сообщение для {channel}…',
  'composer.placeholder.messageAs': 'Сообщение для {channel} от @{username}…',
  'composer.placeholder.send': 'Отправьте сообщение…',
  'composer.placeholder.login': 'Войдите, чтобы отправлять сообщения…',
  'composer.placeholder.connectAccount': 'Подключите аккаунт…',
  'composer.send': 'Отправить сообщение',

  'composer.history.hint': 'Поиск отправленных сообщений · Enter или Esc оставляет результат',
  'composer.history.placeholder': 'Поиск по истории сообщений…',
  'composer.history.typeToSearch': 'Начните вводить текст для поиска по отправленным сообщениям',
  'composer.history.noMatch': 'Нет совпадений',

  'composer.autoTranslate.status': 'Автоперевод{target} → {language}',
  'composer.autoTranslate.turnOff': 'Отключить',
  'composer.translateOnSend': 'Перевод при отправке: {state}',

  'composer.translationPreview.title': 'Предпросмотр перевода · {source} → {target}',
  'composer.translationPreview.insert': 'Вставить перевод',
  'composer.translationPreview.copy': 'Копировать перевод',
  'composer.translationPreview.dismiss': 'Закрыть',
  'composer.language.auto': 'авто',

  'composer.preview.preparing': 'Подготовка предпросмотра перевода…',
  'composer.preview.review': 'Проверьте переведённое сообщение перед отправкой',
  'composer.preview.send': 'Отправить переведённое сообщение',
  'composer.preview.retry': 'Повторить перевод',

  'composer.reply.replyingTo': 'Ответ для {author}: {text}',

  'composer.runningCommand': 'Выполнение команды…',
  'composer.dismiss': 'Закрыть',

  'composer.target.loginToSend': 'Войдите, чтобы отправлять',
  'composer.target.sendingHere': 'Отправка сюда',
  'composer.target.clickToEnable': 'Нажмите, чтобы включить',

  'composer.notice.twirReloaded': 'Команды Twir перезагружены.',
  'composer.notice.twirPartial': 'Команды Twir перезагружены для некоторых каналов.',
  'composer.notice.jeetbotReloaded': 'Команды jeetbot перезагружены.',

  'composer.error.whisperNoAccount': 'Подключите аккаунт Twitch, чтобы отправить шёпот.',
  'composer.error.whispersUnavailable': 'Шёпоты недоступны в этом чате.',
  'composer.error.notConnected': 'Подключитесь к чату и войдите, чтобы отправить сообщение.',
  'composer.error.noPlatform': 'Выберите подключённую платформу перед отправкой сообщения.',
  'composer.error.translatedEmpty': 'Переведённое сообщение пустое. Ничего не отправлено.',
  'composer.error.translatedTooLong':
    'Сообщение для {platform} слишком длинное после перевода: максимум {limit} символов. Ничего не отправлено.',
  'composer.error.noWatchedTarget': 'Нет доступного канала для отправки.',
  'composer.error.twirDisabled':
    'Интеграция Twir отключена. Включите её в разделе «Настройки → Команды».',
  'composer.error.twirNoTarget':
    'Откройте отслеживаемый канал или выберите подключённый чат, чтобы перезагрузить команды Twir.',
  'composer.error.twirReload':
    'Не удалось перезагрузить команды Twir ({failures}). Попробуйте /twirreload ещё раз.',
  'composer.error.jeetbotDisabled':
    'Интеграция jeetbot отключена. Включите её в разделе «Настройки → Команды».',
  'composer.error.jeetbotNoTarget': 'Откройте Twitch-чат, чтобы перезагрузить команды jeetbot.',
  'composer.error.jeetbotReload': 'Не удалось перезагрузить команды jeetbot: {error}',
  'composer.error.autoTranslateOnePlatform':
    'Выберите одну платформу перед настройкой автоперевода.',
  'composer.error.usage': 'Использование: /{command}',
  'composer.error.commandUnavailable': 'Эта команда недоступна в этом чате.',
  'composer.error.userCardUsage': 'Использование: /user @ник',
  'composer.error.userCardAmbiguous': 'Этому нику соответствует несколько пользователей.',
  'composer.error.userCardNotFound': 'Пользователь с таким ником не найден.',
  'composer.error.platformCommandOnePlatform':
    'Выберите одну платформу перед запуском команды платформы.',
  'composer.error.platformCommandsUnavailable': 'Команды платформы недоступны в этом чате.',
  'composer.error.busy': 'Сообщение или команда уже подготавливается.',
  'composer.error.customCommandOnePlatform':
    'Выберите одну платформу перед запуском пользовательской команды.',
  'composer.error.composerClosed': 'Редактор закрылся до завершения команды.',
  'composer.error.reviewPreview': 'Проверьте предпросмотр перевода перед отправкой этой команды.',
  'composer.error.composerIsClosed': 'Редактор закрыт.',
  'composer.error.editorActionUnavailable':
    'Это действие недоступно в активном текстовом редакторе.',
  'composer.error.selectTextBeforeCopy': 'Выделите текст в поле ввода перед копированием.',
  'composer.error.noTextToCopy': 'Нет текста чата для копирования.',
  'composer.error.autoTranslateOffOnePlatform':
    'Выберите одну платформу, чтобы отключить автоперевод.',
  'composer.error.copySourceRequired':
    'Выберите источник для копирования перед запуском этого сочетания.',
  'composer.error.copyTranslation': 'Не удалось скопировать перевод.',

  'composer.emotes.favorites': 'Избранное',
  'composer.emotes.channel': 'Канал',
  'composer.emotes.global': 'Глобальные',
  'composer.emotes.collectibles': 'Коллекционные',
  'composer.emotes.personal': 'Личные',
  'composer.emotes.search': 'Поиск эмоутов…',
  'composer.emotes.noMatches': 'Здесь ничего не найдено. Проверьте другие вкладки.',
  'composer.emotes.notFound': 'Эмоуты не найдены',
  'composer.emotes.emptyTab': 'На этой вкладке пока нет эмоутов',
  'composer.emotes.locked': 'Подпишитесь на канал, чтобы использовать этот эмоут',

  'composer.image.preparing': 'Подготовка изображения…',
  'composer.image.confirm.one': 'Загрузить {count} изображение?',
  'composer.image.confirm.few': 'Загрузить {count} изображения?',
  'composer.image.confirm.many': 'Загрузить {count} изображений?',
  'composer.image.confirm.other': 'Загрузить {count} изображений?',
  'composer.image.uploadingSingle': 'Загрузка изображения…',
  'composer.image.uploading': 'Загрузка изображения {index} из {count}…',
  'composer.image.uploaded.one': 'Загружено {count} изображение',
  'composer.image.uploaded.few': 'Загружено {count} изображения',
  'composer.image.uploaded.many': 'Загружено {count} изображений',
  'composer.image.uploaded.other': 'Загружено {count} изображений',
  'composer.image.uploadedLinkCopied': 'Изображение загружено. Ссылка скопирована в буфер обмена.',
  'composer.image.confirmHint': 'На {host}. Ссылка будет вставлена в ваш черновик.',
  'composer.image.uploadAndDontAsk': 'Загрузить и больше не спрашивать',
  'composer.image.copyDeletionLink.one': 'Копировать ссылку удаления',
  'composer.image.copyDeletionLink.few': 'Копировать ссылки удаления',
  'composer.image.copyDeletionLink.many': 'Копировать ссылки удаления',
  'composer.image.copyDeletionLink.other': 'Копировать ссылки удаления',
  'composer.image.deletionCopied': 'Ссылка удаления скопирована.',
  'composer.image.error.settingsChanged':
    'Настройки загрузчика изображений изменились. Вставьте изображение снова.',
  'composer.image.error.noSupportedImages': 'В буфере обмена нет поддерживаемых изображений.',
  'composer.image.error.upload': 'Не удалось загрузить изображение.',
  'composer.image.error.read': 'Не удалось прочитать изображение.',
  'composer.image.error.paste': 'Не удалось вставить изображение.',
  'composer.image.error.copyDeletion': 'Не удалось скопировать ссылку удаления.',
} satisfies Record<keyof typeof composer, string>
