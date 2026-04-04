// Ambient declaration to suppress missing type errors for transitive deps
declare module 'three'

declare module 'splitpanes' {
  import type { DefineComponent } from 'vue'

  interface SplitpaneProps {
    horizontal?: boolean
    pushOtherPanes?: boolean
    maximizePanes?: boolean
    rtl?: boolean
    firstSplitter?: boolean
  }

  interface PaneProps {
    size?: number
    minSize?: number
    maxSize?: number
  }

  export const Splitpanes: DefineComponent<SplitpaneProps>
  export const Pane: DefineComponent<PaneProps>
}
