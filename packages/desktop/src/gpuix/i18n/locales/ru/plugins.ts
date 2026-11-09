import { plugins } from '../en/plugins'

export const ruPlugins = {
  'plugins.status.connecting': 'Подключение…',
  'plugins.status.connected': 'Подключено',
  'plugins.status.disconnected': 'Не подключено',
  'plugins.status.error': 'Не удалось подключиться',
  'plugins.readOnly': 'Только чтение',
  'plugins.action.moveToHome': 'Переместить в «Мои каналы»',
  'plugins.action.channel': 'Канал',
  'plugins.action.split': 'Разделить',
  'plugins.input.label': 'Сообщение или команда плагина',
  'plugins.input.placeholderSend': 'Отправить сообщение',
  'plugins.input.placeholderCommand': 'Выполнить команду плагина',
  'plugins.action.sending': 'Отправка…',
  'plugins.action.run': 'Выполнить',
  'plugins.action.send': 'Отправить',
} satisfies Record<keyof typeof plugins, string>
