import { useGpuixRequired } from '@gpuix/react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { observeWindowScale, readWindowScale } from '../../services/window-scale'

const WindowScaleContext = createContext(1)

export function WindowScaleProvider({ children }: { children: ReactNode }) {
  const renderer = useGpuixRequired()
  const [scale, setScale] = useState(() => readWindowScale(renderer))
  useEffect(() => observeWindowScale(renderer, setScale), [renderer])
  return <WindowScaleContext.Provider value={scale}>{children}</WindowScaleContext.Provider>
}

export const useWindowScale = (): number => useContext(WindowScaleContext)
