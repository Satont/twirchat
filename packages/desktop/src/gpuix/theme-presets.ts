import type { CustomPalette, ThemePreset } from '@twirchat/shared/types'

export interface ThemePresetPalette extends CustomPalette {
  readonly success?: string
  readonly warning?: string
  readonly danger?: string
}

type OpenCodePaletteTuple = readonly [
  background: string,
  surface: string,
  text: string,
  muted: string,
  accent: string,
  success: string,
  warning: string,
  danger: string,
]

interface OpenCodeThemeSource {
  readonly id: ThemePreset
  readonly label: string
  readonly dark: OpenCodePaletteTuple
  readonly light: OpenCodePaletteTuple
}

// Resolved from the OpenCode theme tokens at the pinned upstream revision.
// https://github.com/anomalyco/opencode/tree/12a661ea40cd5863b271a89bb06b8a3ddb7ab5a0/packages/ui/src/theme/themes
const OPENCODE_THEME_SOURCES: readonly OpenCodeThemeSource[] = [
  {
    id: 'aura',
    label: 'Aura',
    dark: ['#0b0a10', '#131218', '#edecee', '#c9c8ca', '#d7cbff', '#a9ffdd', '#ffc69e', '#fec3be'],
    light: ['#f6f3fe', '#f0edf8', '#271f39', '#423b55', '#986af4', '#0b7342', '#8f4c16', '#b11927'],
  },
  {
    id: 'ayu',
    label: 'Ayu',
    dark: ['#060a0f', '#0e1217', '#d6dae0', '#b3b7bc', '#96dfff', '#6cf832', '#fcc7a5', '#fbc5ba'],
    light: ['#fdfbf5', '#f8f6f1', '#3d4752', '#5c6570', '#269ec2', '#15733a', '#974514', '#b3102f'],
  },
  {
    id: 'carbonfox',
    label: 'Carbonfox',
    dark: ['#222222', '#2a2a2a', '#f2f4f8', '#ced0d3', '#bcd5fe', '#45fa7e', '#fdca82', '#fec2c2'],
    light: ['#eeeeee', '#e8e8e8', '#151515', '#2f2f2f', '#105ae6', '#0f7430', '#845515', '#b2171f'],
  },
  {
    id: 'cobalt2',
    label: 'Cobalt2',
    dark: ['#041f32', '#0d273a', '#ffffff', '#adb7c9', '#b9d6fb', '#c9feb9', '#fec988', '#fcc1d2'],
    light: ['#ffffff', '#f8f9fa', '#102d41', '#5c6b7d', '#045cb8', '#067519', '#9f3e0c', '#ad1d4a'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    dark: ['#0e0e0e', '#161616', '#e4e4e4', '#5d5d5d', '#54eee9', '#30fa90', '#fcc7a4', '#fec1ca'],
    light: ['#fcfcfc', '#f5f5f5', '#131313', '#5f5f5f', '#0e5b8b', '#197152', '#a82b3d', '#b11043'],
  },
  {
    id: 'dracula',
    label: 'Dracula',
    dark: ['#0f1019', '#181921', '#f8f8f2', '#d4d4ce', '#dcc8fe', '#88fe9d', '#fbc7a9', '#fec3bd'],
    light: ['#f9f9f4', '#f3f3ee', '#1b1b2b', '#363646', '#7358f7', '#167341', '#9f3d12', '#ad1b47'],
  },
  {
    id: 'everforest',
    label: 'Everforest',
    dark: ['#181f25', '#1f252a', '#daccaf', '#7a8478', '#bce575', '#bce575', '#fec3ba', '#fcc3c2'],
    light: ['#fdf8e8', '#f8f4e5', '#46535b', '#a6b0a0', '#839511', '#5b680e', '#b4130f', '#b4111f'],
  },
  {
    id: 'flexoki',
    label: 'Flexoki',
    dark: ['#090808', '#100f0f', '#d2d1c7', '#6f6e69', '#b3d8fb', '#c5e517', '#fbc5b8', '#fec3ba'],
    light: ['#fffcf3', '#f8f5ec', '#100f0f', '#6f6e69', '#10539c', '#556a0c', '#ac262f', '#b50d12'],
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    dark: ['#0f0f1d', '#161625', '#cdd6f5', '#abb3ce', '#c9d0fe', '#90f889', '#fed4a5', '#fec0cf'],
    light: ['#f1f3f6', '#eceef2', '#3c3e58', '#5a5c75', '#6578fe', '#22740c', '#9b4108', '#b11631'],
  },
  {
    id: 'catppuccin-frappe',
    label: 'Catppuccin Frappe',
    dark: ['#1b1e2e', '#212535', '#c8d2f9', '#b5bfe2', '#c1d4fb', '#a4ec6e', '#fec88d', '#ffc2c1'],
    light: ['#f1f3f6', '#eceef2', '#3c3e58', '#5a5c75', '#6578fe', '#22740c', '#9b4108', '#b11631'],
  },
  {
    id: 'catppuccin-macchiato',
    label: 'Catppuccin Macchiato',
    dark: ['#131526', '#1a1c2e', '#cbd4f8', '#b8c0e0', '#bfd4fe', '#97ee78', '#fbc992', '#fec1c8'],
    light: ['#f1f3f6', '#eceef2', '#3c3e58', '#5a5c75', '#6578fe', '#22740c', '#9b4108', '#b11631'],
  },
  {
    id: 'github',
    label: 'GitHub',
    dark: ['#05080e', '#0c0f16', '#ccd4dc', '#8b949e', '#b7d7fd', '#19fe54', '#fec88b', '#fec3bc'],
    light: ['#ffffff', '#f9f9f9', '#1e2329', '#57606a', '#0c5fc5', '#127430', '#924a0f', '#b6051f'],
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    dark: ['#181818', '#201f1e', '#ecdbb0', '#c7b892', '#a7e3cd', '#dade19', '#fdc892', '#fcc4ba'],
    light: ['#fcf5d7', '#f6f0d2', '#322e2c', '#4f4b49', '#075b6b', '#676313', '#98450a', '#b31413'],
  },
  {
    id: 'kanagawa',
    label: 'Kanagawa',
    dark: ['#101018', '#18171e', '#ddd8b9', '#727169', '#c0d4fc', '#b0ea5a', '#fbc89e', '#fdc3bb'],
    light: ['#f4ede3', '#efe8de', '#46352c', '#8a8980', '#174664', '#4f6b23', '#ab2c02', '#b50b12'],
  },
  {
    id: 'material',
    label: 'Material',
    dark: ['#131e23', '#1b262b', '#efffff', '#546e7a', '#ace4fc', '#c0fb54', '#fec893', '#fbc3c3'],
    light: ['#fafafa', '#f4f4f4', '#1e2a30', '#90a4ae', '#24a2aa', '#4c6d05', '#8f4d11', '#b01f1f'],
  },
  {
    id: 'matrix',
    label: 'Matrix',
    dark: ['#040704', '#081009', '#6ffd99', '#8ca391', '#aadafe', '#a7febb', '#ffea52', '#fcc4be'],
    light: ['#f0f5ed', '#eaefe7', '#19291c', '#748476', '#11a7f4', '#087529', '#725f02', '#b21722'],
  },
  {
    id: 'mercury',
    label: 'Mercury',
    dark: ['#0b0b14', '#13131c', '#dddde5', '#9d9da8', '#c4d2fd', '#62f3aa', '#fdc3ba', '#fec0d1'],
    light: ['#ffffff', '#f9f9fa', '#2c2c3a', '#70707d', '#3844de', '#187248', '#a82c32', '#aa1b5d'],
  },
  {
    id: 'monokai',
    label: 'Monokai',
    dark: ['#161712', '#1e1f1a', '#f8f8f2', '#d4d4ce', '#d8cbfb', '#aeee27', '#fcc6ac', '#fec1cb'],
    light: ['#fdf9ef', '#f7f3e9', '#241e13', '#3f392f', '#b867fe', '#1a741a', '#97460c', '#b11b26'],
  },
  {
    id: 'nightowl',
    label: 'Night Owl',
    dark: ['#010a15', '#09121d', '#d6deec', '#b4bac7', '#c0d4fc', '#c9f43c', '#fdc79e', '#fbc4be'],
    light: ['#f1f1f1', '#ececec', '#343346', '#515063', '#2f66e0', '#166f68', '#9b375d', '#b3131d'],
  },
  {
    id: 'nord',
    label: 'Nord',
    dark: ['#191e29', '#212630', '#e5e9f0', '#c2c5cb', '#8be3fb', '#b7e48f', '#fec2bf', '#fdc2c5'],
    light: ['#eef1f5', '#e8ecf0', '#252b37', '#414753', '#4a76ac', '#366b6a', '#93444c', '#a13545'],
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    dark: ['#161920', '#1c1f26', '#bac1cf', '#5c6370', '#afd9fe', '#a4ec69', '#ffc890', '#fcc3c4'],
    light: ['#fafafa', '#f4f4f5', '#2e3038', '#a0a1a7', '#2b68f4', '#15751a', '#904c15', '#b31413'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    dark: ['#121212', '#232323', '#a0a0a0', '#707070', '#c0d4fb', '#25ff18', '#ffca76', '#f29b96'],
    light: ['#f8f8f8', '#f3f3f3', '#6f6f6f', '#8f8f8f', '#0445e6', '#197414', '#805711', '#b82d35'],
  },
  {
    id: 'orng',
    label: 'Orng',
    dark: ['#050505', '#0e0e0e', '#eeeeee', '#808080', '#fdc4b3', '#bad6fb', '#fcc4c1', '#fcc3c4'],
    light: ['#ffffff', '#f8f8f8', '#181818', '#8a8a8a', '#e14d17', '#155dba', '#b20f3b', '#b01c28'],
  },
  {
    id: 'lucent-orng',
    label: 'Lucent Orng',
    dark: ['#1a0c08', '#221411', '#eeeeee', '#808080', '#fdc4b3', '#bad6fb', '#fcc4c1', '#fcc3c4'],
    light: ['#fef7f3', '#f7f1ed', '#181818', '#8a8a8a', '#e14d17', '#155dba', '#b20f3b', '#b01c28'],
  },
  {
    id: 'osaka-jade',
    label: 'Osaka Jade',
    dark: ['#06100c', '#0d1711', '#cace9e', '#53685b', '#6aece0', '#6bf498', '#fecb6f', '#ffc3ba'],
    light: ['#f8f7e4', '#f1f1de', '#0f1a16', '#53685b', '#249d85', '#237143', '#805807', '#b4120d'],
  },
  {
    id: 'palenight',
    label: 'Palenight',
    dark: ['#161929', '#1b1e2f', '#b6bcdf', '#676e95', '#c0d4fc', '#c0fb54', '#fec893', '#fbc3c3'],
    light: ['#fafafa', '#f4f4f5', '#222637', '#8796b0', '#3162f9', '#4c6d05', '#8f4d11', '#b01f1f'],
  },
  {
    id: 'rosepine',
    label: 'Rose Pine',
    dark: ['#0c0a16', '#14121e', '#e0def5', '#6e6a86', '#8be4f3', '#9edefb', '#fbc8a1', '#fdc1ce'],
    light: ['#fbf5ef', '#f6f0ec', '#454066', '#9893a5', '#136a89', '#106a89', '#994307', '#983c5a'],
  },
  {
    id: 'solarized',
    label: 'Solarized',
    dark: ['#011820', '#061d25', '#a9b8b8', '#889595', '#cad0fe', '#c8e41d', '#fdc98d', '#fec3bb'],
    light: ['#fdf8e8', '#f8f4e5', '#41575e', '#61767d', '#0c80c8', '#5b6815', '#8a5007', '#b60613'],
  },
  {
    id: 'synthwave84',
    label: "Synthwave '84",
    dark: ['#151222', '#1e1b2a', '#ffffff', '#848bbd', '#82fefb', '#74fec1', '#fdcf83', '#fdc3c0'],
    light: ['#fafafa', '#f4f4f4', '#211e30', '#5c5c8a', '#1aafc5', '#067519', '#9f3e0c', '#b21b15'],
  },
  {
    id: 'tokyonight',
    label: 'Tokyonight',
    dark: ['#0d0e17', '#14151f', '#c4cefb', '#a3abd2', '#c0d4fc', '#a0ef23', '#fec79c', '#fbc2c9'],
    light: ['#e5e6ea', '#dfe1e6', '#1f284a', '#3b4566', '#006fea', '#4b6c22', '#855330', '#af1647'],
  },
  {
    id: 'vercel',
    label: 'Vercel',
    dark: ['#000000', '#090909', '#ededed', '#878787', '#b6d7fc', '#3afb6e', '#fec79b', '#fcc4c0'],
    light: ['#ffffff', '#f8f8f8', '#161616', '#666666', '#0767dd', '#0a751a', '#9f3c11', '#b4092b'],
  },
  {
    id: 'vesper',
    label: 'Vesper',
    dark: ['#080808', '#111111', '#ffffff', '#dbdbdb', '#fed6b6', '#b3fee9', '#fcc6ae', '#fbc4c1'],
    light: ['#f1f1f1', '#eaeaea', '#101010', '#2a2a2a', '#fdb77c', '#0d715e', '#8e4b35', '#b1192e'],
  },
  {
    id: 'zenburn',
    label: 'Zenburn',
    dark: ['#262626', '#2d2d2c', '#dcdccb', '#9f9f9f', '#6deaf0', '#ade5ad', '#fecf8e', '#fcc3c2'],
    light: ['#fffff4', '#f9f9ef', '#333333', '#6f6f6f', '#4d7689', '#366f38', '#735d2b', '#864f4f'],
  },
]

function palette(colors: OpenCodePaletteTuple): ThemePresetPalette {
  const [background, surface, text, muted, accent, success, warning, danger] = colors
  return { background, surface, text, muted, accent, success, warning, danger }
}

export const OPENCODE_THEME_PRESETS = OPENCODE_THEME_SOURCES.map(({ id, label, dark, light }) => ({
  id,
  label,
  palette: palette(dark),
  lightPalette: palette(light),
}))
